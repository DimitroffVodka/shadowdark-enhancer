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
 * loudly on a non-GM rather than half-applying. No player-facing control writes
 * renown either: the award dialog is GM-only and the downtime callers were
 * already GM-side (see their file headers).
 *
 * ONE WRITER, ONE AT A TIME. Renown is read-compute-write — read the current
 * value, add the delta, write the sum — and that shape loses updates under
 * concurrency in two distinct ways:
 *
 *   1. Two GM CLIENTS. This world runs a second always-on GM (the Bridge
 *      watchdog), so "GM-only" is not "one client". Both read 5, both write 6,
 *      and two awards of +1 leave the actor at 6 with both logged. Fixed by
 *      forwarding every non-active-GM award to the active GM over the
 *      authenticated query channel, so exactly one client ever writes.
 *   2. Two awards on ONE client. `actor.update` awaits a server round trip, so
 *      an award that starts while another is in flight still reads the old
 *      value. Being on one client is not enough — hence `_txQueue`.
 *
 * The pure band/format half lives in renown-core.mjs (node-tested), including
 * `authorizeRenownAward`, which is the rule both the direct call and the query
 * handler check.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { SessionRecap } from "../session-recap/session-recap.mjs";
import { isActiveGM, queryActiveGM, refuseQuery } from "../shared/gm-relay.mjs";
import {
  RENOWN_BANDS,
  RENOWN_TRIGGERS,
  authorizeRenownAward,
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
 * Query channel a non-active GM's award is forwarded down, so every write to
 * `system.renown` lands on one client. Registered by GM clients only — a player
 * who addresses it gets the "unregistered query" throw, and would be turned away
 * by `authorizeRenownAward` even if they didn't.
 */
export const RENOWN_QUERY = `${MODULE_ID}.renown`;

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

  /**
   * The bonus an actor's renown grants (0–3). Automated for reaction rolls
   * only; carousing is applied by hand — see renownBonus in renown-core.mjs.
   */
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

    // Deliberately loud. Renown writes the recap world setting too, so a
    // player-side call would silently record nothing even where the actor
    // update itself succeeded.
    const denied = authorizeRenownAward({ requesterIsGM: !!game.user?.isGM });
    if (denied) {
      return { ok: false, before, after: before, delta: 0, band: renownBand(before), summary: "", error: denied.error };
    }

    if (step === 0) {
      return { ok: true, before, after: before, delta: 0, band: renownBand(before), summary: "" };
    }

    // Hand off to the one client allowed to write (see the file header). The
    // delta travels, never the computed total — the active GM re-reads and adds
    // it there, so a stale read here cannot overwrite somebody else's award.
    if (!isActiveGM()) {
      const reply = await queryActiveGM(RENOWN_QUERY, {
        action: "award",
        actorId: actor.id,
        delta: step,
        reason: String(reason ?? ""),
        source: String(source ?? "gm"),
        chat: chat !== false,
      }, { label: "Renown changes" });
      return _shapeReply(reply, before);
    }

    return this._enqueueTx(() => this._awardNow({ actor, step, reason, source, chat }));
  },

  /**
   * The critical section: re-read, write, log, announce.
   *
   * Runs on the active GM only, and only via `_enqueueTx`. The re-read is the
   * point of it — the caller measured `before` prior to joining the queue, and
   * an award ahead of it may have moved the value in the meantime.
   */
  async _awardNow({ actor, step, reason = "", source = "gm", chat = true } = {}) {
    const live = game.actors?.get(actor?.id) ?? actor;
    const before = this.valueOf(live);
    const after = before + step;

    try {
      await live.update({ "system.renown": after });
    } catch (err) {
      console.error(`${MODULE_ID} | renown: could not update ${live?.name}`, err);
      return { ok: false, before, after: before, delta: 0, band: renownBand(before), summary: "", error: err?.message ?? "The update failed." };
    }

    const summary = renownChangeLine({ actorName: live.name, delta: step, after });

    // Logging must never take down the thing that caused the award.
    try {
      await SessionRecap.logRenown({
        actorId: live.id,
        actorName: live.name,
        player: _controllingPlayerName(live),
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
        await _postRenownCard({ actor: live, delta: step, after, reason });
      } catch (err) {
        console.warn(`${MODULE_ID} | renown: chat card failed`, err);
      }
    }

    return { ok: true, before, after, delta: step, band: renownBand(after), summary };
  },

  /**
   * Serializes awards on the writing client — see failure mode 2 in the header.
   * The same single-promise-chain mechanism as merchant-shop.mjs:84 and
   * downtime-session.mjs:351, and for the same reason: check-then-write across
   * an await double-applies without it.
   */
  _txQueue: Promise.resolve(),

  _enqueueTx(fn) {
    const run = this._txQueue.then(fn, fn);
    this._txQueue = run.catch(() => {});
    return run;
  },

  /**
   * Query entry point — where another GM's award arrives.
   *
   * `refuseQuery` makes the RECEIVING client decide whether it is the active GM.
   * That is not redundant with addressing `game.users.activeGM`: `User#query`
   * lets the SENDER pick any active recipient, so a caller can address every
   * connected GM in turn and `_txQueue` is per-client — the exact duplicate the
   * activeGM gate exists to stop.
   *
   * The isGM check is separate and load-bearing. This handler is registered on
   * GM clients, and a player may address it directly; nothing else on this path
   * would refuse them.
   *
   * @param {object} data  Ids and a delta only — never a computed total.
   * @param {User}   user  The AUTHENTICATED sender, from core's query context.
   */
  async handleQuery(data, user) {
    const refusal = refuseQuery(user, "Renown changes");
    if (refusal) return refusal;

    if (data?.action !== "award") return { ok: false, error: "Unknown renown action." };

    const denied = authorizeRenownAward({ requesterIsGM: !!user?.isGM });
    if (denied) return denied;

    const actor = game.actors?.get(data.actorId);
    if (!actor) return { ok: false, error: "No character was supplied." };

    return this._enqueueTx(() => this._awardNow({
      actor,
      step: renownValue(data.delta),
      reason: String(data.reason ?? ""),
      source: String(data.source ?? "gm"),
      chat: data.chat !== false,
    }));
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

    // Every GM registers the handler; the handler decides for itself whether
    // this client is the active GM, so a forwarded award still runs exactly once.
    CONFIG.queries[RENOWN_QUERY] = (data, { user } = {}) => Renown.handleQuery(data, user);

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

/**
 * Give a relayed award the same result shape a local one returns. On a delivery
 * failure `queryActiveGM` answers `{ok:false, error}` and none of the numeric
 * fields every caller reads, so fill them from what this client last saw.
 */
function _shapeReply(reply, before) {
  if (reply?.ok) return reply;
  return {
    ok: false,
    before,
    after: before,
    delta: 0,
    band: renownBand(before),
    summary: "",
    error: reply?.error ?? "The primary GM did not answer.",
  };
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
