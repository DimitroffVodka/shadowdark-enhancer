/**
 * Renown — the single write path for `system.renown`, plus the party readers
 * the encounter roller and the downtime window consult.
 *
 * WHY ONE WRITE PATH: before this file, two places bumped renown by hand
 * (downtime-effects.mjs and downtime-app.mjs) and nothing recorded that it had
 * happened. Everything now goes through `Renown.award`, so every change is
 * logged the same way whoever caused it.
 *
 * EXECUTION CONTEXT: **GM-side only.** `award` writes an actor AND the
 * `sessionRecap` world setting, which a player client cannot do. It refuses
 * loudly on a non-GM rather than half-applying. No player relay exists because
 * no player-facing control writes renown: the award dialog is GM-only, the
 * level-up watcher is active-GM-gated, and the downtime callers were already
 * GM-side (see their file headers).
 *
 * The pure band/format half lives in renown-core.mjs (node-tested).
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { SessionRecap } from "../session-recap/session-recap.mjs";
import {
  RENOWN_BANDS,
  RENOWN_TRIGGERS,
  isDoubleOnes,
  recapRow,
  renownBand,
  renownBonus,
  renownChangeLine,
  renownValue,
  signedRenown,
  startingRenown,
} from "./renown-core.mjs";

export {
  RENOWN_BANDS, RENOWN_TRIGGERS, isDoubleOnes, recapRow,
  renownBand, renownBonus, renownChangeLine, renownValue,
  signedRenown, startingRenown,
};

/**
 * World setting: award a point of renown automatically when a PC levels up.
 * The registration below spells the key out as a literal on purpose — the docs
 * contract test scans for `game.settings.register(MODULE_ID, "<key>"` and would
 * not see a setting registered through this constant.
 */
const LEVEL_UP_SETTING = "renownOnLevelUp";

/**
 * Last-seen level per actor id, kept on the GM client only.
 *
 * `updateActor` hands us the NEW value and no prior state, so the level gain
 * has to be diffed against something. A client-side cache is used rather than
 * stashing the old level in the update `options` because the level-up dialog is
 * driven from the PLAYER's own sheet (systems/shadowdark LevelUpSD writes
 * `system.level.value` at :394) — the cache lives where the award is made and
 * does not depend on an options round-trip surviving the socket.
 */
const _levelSeen = new Map();

export const Renown = {

  // ── Settings ───────────────────────────────────────────────

  registerSettings() {
    game.settings.register(MODULE_ID, "renownOnLevelUp", {
      name: "SDE.settings.renownOnLevelUp.name",
      hint: "SDE.settings.renownOnLevelUp.hint",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
    });
  },

  // ── Reads ──────────────────────────────────────────────────

  /** An actor's renown as an integer. Non-players and junk read as 0. */
  valueOf(actor) {
    return renownValue(actor?.system?.renown);
  },

  /** The band an actor currently sits in. */
  bandOf(actor) {
    return renownBand(this.valueOf(actor));
  },

  /** The reaction / carousing bonus an actor's renown grants (0–3). */
  bonusOf(actor) {
    return renownBonus(this.valueOf(actor));
  },

  /**
   * The party roster with renown resolved, highest renown first (ties by name).
   * Same PC definition the rest of the module uses — a Player actor with a
   * player owner (party-xp.mjs:42, downtime-app.mjs:211).
   *
   * @returns {Array<{actorId:string, name:string, renown:number, band:object, bonus:number}>}
   */
  party() {
    return game.actors
      .filter((a) => a.type === "Player" && a.hasPlayerOwner)
      .map((a) => {
        const value = this.valueOf(a);
        const band = renownBand(value);
        return { actorId: a.id, name: a.name, renown: value, band, bonus: band.bonus };
      })
      .sort((a, b) => (b.renown - a.renown) || a.name.localeCompare(b.name));
  },

  /** The party member with the most renown, or null on an empty party. */
  mostRenowned() {
    return this.party()[0] ?? null;
  },

  // ── The write path ─────────────────────────────────────────

  /**
   * Adjust one character's renown, record it, and (optionally) announce it.
   *
   * GM-side only. Returns a result object rather than throwing, so a caller
   * mid-way through a downtime roll can report the failure and carry on.
   *
   * @param {object} args
   * @param {Actor}   args.actor    the character
   * @param {number}  args.delta    signed change; 0 is a no-op
   * @param {string} [args.reason]  short GM-supplied cause ("Gained a level")
   * @param {string} [args.source]  provenance tag for the log ("gm"|"downtime"|"level-up")
   * @param {boolean}[args.chat]    post the announcement card (default true)
   * @returns {Promise<{ok:boolean, before:number, after:number, delta:number,
   *                    band:object, summary:string, error?:string}>}
   */
  async award({ actor, delta, reason = "", source = "gm", chat = true } = {}) {
    const step = renownValue(delta);
    const before = this.valueOf(actor);

    if (!actor) {
      return { ok: false, before: 0, after: 0, delta: 0, band: renownBand(0), summary: "", error: "No character was supplied." };
    }
    if (!game.user?.isGM) {
      // Deliberately loud. Renown writes the recap world setting too, so a
      // player-side call would silently record nothing even where the actor
      // update itself succeeded.
      return { ok: false, before, after: before, delta: 0, band: renownBand(before), summary: "", error: "Only a GM can change renown." };
    }
    if (step === 0) {
      return { ok: true, before, after: before, delta: 0, band: renownBand(before), summary: "" };
    }

    const after = before + step;
    try {
      await actor.update({ "system.renown": after });
    } catch (err) {
      console.error(`${MODULE_ID} | renown: could not update ${actor.name}`, err);
      return { ok: false, before, after: before, delta: 0, band: renownBand(before), summary: "", error: err?.message ?? "The update failed." };
    }

    const summary = renownChangeLine({ actorName: actor.name, delta: step, after });

    // Logging must never take down the thing that caused the award.
    try {
      await SessionRecap.logRenown({
        actorId: actor.id,
        actorName: actor.name,
        player: _controllingPlayerName(actor),
        delta: step,
        before,
        after,
        reason,
        source,
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | renown: recap write failed`, err);
    }

    if (chat) {
      try {
        await _postRenownCard({ actor, delta: step, after, reason });
      } catch (err) {
        console.warn(`${MODULE_ID} | renown: chat card failed`, err);
      }
    }

    return { ok: true, before, after, delta: step, band: renownBand(after), summary };
  },

  /**
   * Set renown to the book's starting value — the character's CHA modifier.
   * Routed through `award` so it is logged like every other change.
   */
  async seedFromCha(actor, { chat = true } = {}) {
    const chaMod = Number(actor?.system?.abilities?.cha?.mod);
    if (!Number.isFinite(chaMod)) {
      return { ok: false, before: this.valueOf(actor), after: this.valueOf(actor), delta: 0, band: this.bandOf(actor), summary: "", error: "That character has no CHA modifier." };
    }
    const target = startingRenown(chaMod);
    const delta = target - this.valueOf(actor);
    return this.award({ actor, delta, reason: `Starting renown (CHA ${signedRenown(chaMod)})`, source: "start", chat });
  },

  // ── The GM affordance ──────────────────────────────────────

  /** Open the award / dock dialog (GM only). */
  async openDialog(opts = {}) {
    const { RenownAwardDialog } = await import("./renown-award-dialog.mjs");
    return RenownAwardDialog.open(opts);
  },

  // ── Level-up watcher ───────────────────────────────────────

  /**
   * Award a point of renown when a PC's level goes up.
   *
   * The one book trigger that is not a GM judgement call, so it is the one
   * thing wired automatically. Gated on the ACTIVE GM: this world runs a second
   * always-on GM client (the Bridge watchdog), and an ungated `updateActor`
   * handler awards twice.
   *
   * Level 1 is deliberately excluded. The Character Builder and the level-0
   * funnel both write `system.level.value` as part of creating the character,
   * and renown already starts at the CHA modifier — awarding there would hand
   * every new PC a point for existing.
   */
  init() {
    if (!game.user?.isGM) return;

    for (const actor of game.actors) {
      if (actor.type === "Player") _levelSeen.set(actor.id, _levelOf(actor));
    }

    Hooks.on("createActor", (actor) => {
      if (actor?.type === "Player") _levelSeen.set(actor.id, _levelOf(actor));
    });

    Hooks.on("updateActor", async (actor, changed) => {
      if (actor?.type !== "Player") return;
      // Foundry diffs updates, so the key is present only on a real change.
      if (foundry.utils.getProperty(changed, "system.level.value") === undefined) return;

      const next = _levelOf(actor);
      const prev = _levelSeen.get(actor.id);
      _levelSeen.set(actor.id, next);

      if (!_isPrimaryGM()) return;
      if (!game.settings.get(MODULE_ID, LEVEL_UP_SETTING)) return;
      if (prev === undefined || next <= prev || next < 2) return;

      // One point per level, so a two-level jump grants two.
      const gained = next - prev;
      await this.award({
        actor,
        delta: gained,
        reason: gained > 1 ? `Gained ${gained} levels` : "Gained a level",
        source: "level-up",
      });
    });
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function _levelOf(actor) {
  return renownValue(actor?.system?.level?.value);
}

/** True only on the single active GM — the multi-GM guard used module-wide. */
function _isPrimaryGM() {
  return !!game.user?.isGM && game.users.activeGM?.id === game.user.id;
}

/** The name of the player who owns this PC, for the recap's per-player grouping. */
function _controllingPlayerName(actor) {
  const owner = game.users.find((u) => !u.isGM && actor.testUserPermission(u, "OWNER"));
  return owner?.name ?? "GM";
}

/**
 * Announce the change in chat. Public by design — renown IS public reputation,
 * and both halves of it (a triumph, a humiliation) are things the table saw.
 */
async function _postRenownCard({ actor, delta, after, reason }) {
  const band = renownBand(after);
  const up = delta > 0;
  const esc = foundry.utils.escapeHTML;
  const content = `
    <div class="sde-renown-card ${up ? "sde-renown-up" : "sde-renown-down"}">
      <header class="sde-renown-card-head">
        <i class="fas fa-crown"></i> Renown
        <span class="sde-renown-delta">${esc(signedRenown(delta))}</span>
      </header>
      <div class="sde-renown-card-body">
        <span class="sde-renown-who">${esc(actor.name)}</span>
        <span class="sde-renown-total">${renownValue(after)}</span>
        <span class="sde-renown-band">${esc(band.label)}${band.bonus ? ` · ${signedRenown(band.bonus)} reaction` : ""}</span>
      </div>
      ${reason ? `<footer class="sde-renown-card-foot">${esc(String(reason))}</footer>` : ""}
    </div>`;

  return ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
  });
}
