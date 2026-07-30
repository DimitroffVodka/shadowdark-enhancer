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
  RENOWN_HISTORY_CAP,
  RENOWN_SOURCE_LABELS,
  RENOWN_TRIGGERS,
  appendRenownHistory,
  authorizeRenownAward,
  groupHistoryByPlayer,
  historyRow,
  isDoubleOnes,
  recapRow,
  renownBand,
  renownBonus,
  renownChangeLine,
  renownValue,
  shouldSeedStartingRenown,
  signedRenown,
  startingRenown,
} from "./renown-core.mjs";

export {
  RENOWN_BANDS, RENOWN_HISTORY_CAP, RENOWN_SOURCE_LABELS, RENOWN_TRIGGERS,
  appendRenownHistory, groupHistoryByPlayer, historyRow, isDoubleOnes, recapRow,
  renownBand, renownBonus, renownChangeLine, renownValue,
  shouldSeedStartingRenown, signedRenown, startingRenown,
};

/**
 * World setting: award a point of renown automatically when a PC levels up.
 * The registration below spells the key out as a literal on purpose — the docs
 * contract test scans for `game.settings.register(MODULE_ID, "<key>"` and would
 * not see a setting registered through this constant.
 */
const LEVEL_UP_SETTING = "renownOnLevelUp";

/**
 * World setting: seed a new character's renown from their CHA modifier.
 * Spelled out as a literal at the registration below for the same reason.
 */
const ON_CREATE_SETTING = "renownOnCreate";

/**
 * Actor flags. `renownLog` is the permanent per-character ledger; `renownSeeded`
 * records that the automatic starting seed has been spent.
 *
 * WHY A LEDGER ON THE ACTOR: `SessionRecap.logRenown` returns early when no
 * session is running (session-recap.mjs:247), so before this the only record of
 * an out-of-session change was the chat card, which gets cleared. The ledger is
 * written in the SAME `actor.update` as the number it describes, so the two
 * cannot disagree.
 */
const HISTORY_FLAG = "renownLog";
const SEEDED_FLAG = "renownSeeded";
const HISTORY_PATH = `flags.${MODULE_ID}.${HISTORY_FLAG}`;

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

/**
 * Last-seen renown per actor id, so a write this module did NOT make can still
 * be measured and logged.
 *
 * WHY THIS EXISTS: `system.renown` is the SYSTEM's field, and anything may write
 * it — the Shadowdark sheet's own input, a macro, or another module.
 * shadowdark-extras applies carousing renown with a bare
 * `actor.update({"system.renown": next})` (CarousingSD.mjs `applyRenownDelta`),
 * carrying nothing that identifies it. Without this, a -3 from a carousing mishap
 * moved the number on the sheet and left no trace in the log, which makes the log
 * a record of *our* awards rather than of the character's renown.
 *
 * A cache rather than `preUpdateActor`, which fires only on the client that
 * initiated the write; `updateActor` fires on every client, so the value has to
 * be diffed against something this client already had. Same reasoning, and the
 * same shape, as `_levelSeen` above.
 */
const _renownSeen = new Map();

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

    game.settings.register(MODULE_ID, "renownOnCreate", {
      name: "SDE.settings.renownOnCreate.name",
      hint: "SDE.settings.renownOnCreate.hint",
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

  /**
   * One character's renown ledger, oldest change first.
   *
   * A copy, not the live flag array — a caller that sorts or reverses it must not
   * reorder what is stored on the actor.
   *
   * @param {Actor} actor
   * @returns {Array<object>}
   */
  history(actor) {
    const stored = actor?.getFlag?.(MODULE_ID, HISTORY_FLAG);
    return Array.isArray(stored) ? stored.filter((r) => r && typeof r === "object").map((r) => ({ ...r })) : [];
  },

  /**
   * The whole party's ledger, grouped by the player who owns the character.
   *
   * Each entry carries the character it belongs to, since one player may run
   * several. Rows are stamped with the owner AT THE TIME OF THE AWARD, so a
   * character handed to another player keeps its history where it happened.
   *
   * @returns {Array<{player:string, net:number, count:number, entries:Array<object>}>}
   */
  historyByPlayer() {
    const all = [];
    for (const member of this.party()) {
      const actor = game.actors.get(member.actorId);
      if (!actor) continue;
      for (const row of this.history(actor)) {
        all.push({ ...row, actorId: actor.id, actorName: actor.name });
      }
    }
    all.sort((a, b) => renownValue(a.at) - renownValue(b.at));
    return groupHistoryByPlayer(all);
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
    const player = _controllingPlayerName(live);

    // The ledger row rides along in the same update as the number. Two writes
    // could half-apply; one cannot, so the ledger can never claim a change the
    // actor did not take (or miss one it did).
    const nextHistory = appendRenownHistory(live?.getFlag?.(MODULE_ID, HISTORY_FLAG), {
      delta: step,
      before,
      after,
      reason,
      source,
      player,
      gm: game.user?.name ?? "",
      at: Date.now(),
    });

    try {
      await live.update({ "system.renown": after, [HISTORY_PATH]: nextHistory });
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
        player,
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
   * Record a change to `system.renown` that this module did not make.
   *
   * The number is already committed by whoever wrote it, so this is a
   * best-effort follow-up rather than the atomic write `_awardNow` performs: the
   * row is appended in its own update, and it deliberately posts NO chat card,
   * because whatever made the change has already reported it its own way (SDX's
   * carousing card, or the GM simply typing in the field).
   *
   * Serialized through the same queue as an award, so an external change landing
   * beside one cannot clobber its ledger row.
   *
   * @param {Actor} actor
   * @param {number} before  this client's last-seen value
   * @param {number} after   the value now on the actor
   */
  async _recordExternalChange(actor, before, after, { reason = "", source = "external" } = {}) {
    const step = after - before;
    if (!step) return null;

    return this._enqueueTx(async () => {
      const live = game.actors?.get(actor?.id) ?? actor;
      const player = _controllingPlayerName(live);
      const next = appendRenownHistory(live?.getFlag?.(MODULE_ID, HISTORY_FLAG), {
        delta: step,
        before,
        after,
        reason,
        source,
        player,
        gm: game.user?.name ?? "",
        at: Date.now(),
      });

      try {
        await live.update({ [HISTORY_PATH]: next });
      } catch (err) {
        console.warn(`${MODULE_ID} | renown: could not log an external change to ${live?.name}`, err);
        return null;
      }

      try {
        await SessionRecap.logRenown({
          actorId: live.id,
          actorName: live.name,
          player,
          delta: step,
          before,
          after,
          reason,
          source,
        });
      } catch (err) {
        console.warn(`${MODULE_ID} | renown: recap write failed`, err);
      }

      return { ok: true, before, after, delta: step, band: renownBand(after), summary: renownChangeLine({ actorName: live.name, delta: step, after }) };
    });
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

  /**
   * Seed a new character's starting renown, once, automatically.
   *
   * WHY THIS IS NOT SIMPLY `createActor` → `seedFromCha`: at `createActor` the
   * abilities may not exist yet. The system's Character Builder writes them as
   * part of the creation data, so that path seeds correctly on the spot — but an
   * actor made through **Create Actor** starts on the model's default 10s (CHA
   * mod 0) and gets its real scores minutes later, by hand or from the level-0
   * funnel. So the seed is *attempted* at creation and again whenever CHA
   * changes, and `shouldSeedStartingRenown` decides whether it is still owed.
   *
   * A seed of exactly +0 does not stamp the flag, precisely so the placeholder
   * case above stays eligible. That leaves the automatic seed idempotent in the
   * only sense that matters: it can never move a character whose renown is
   * already non-zero or already has a ledger entry.
   *
   * `chat: false` — a funnel drops four or five characters in at once, and five
   * "Starting renown" cards is noise, not news. It is still ledgered.
   *
   * @param {Actor} actor
   * @param {{force?:boolean, chat?:boolean}} [opts]  force skips the setting and
   *   the eligibility rule, for the dialog's explicit button, which also asks for
   *   the chat card the automatic path suppresses
   * @returns {Promise<object|null>} the award result, or null if nothing was owed
   */
  async maybeSeedFromCha(actor, { force = false, chat = false } = {}) {
    if (actor?.type !== "Player") return null;
    if (!force) {
      if (!_isPrimaryGM()) return null;
      if (!game.settings.get(MODULE_ID, ON_CREATE_SETTING)) return null;
      const eligible = shouldSeedStartingRenown({
        seeded: !!actor.getFlag?.(MODULE_ID, SEEDED_FLAG),
        renown: this.valueOf(actor),
        historyCount: this.history(actor).length,
      });
      if (!eligible) return null;
    }

    const result = await this.seedFromCha(actor, { chat });

    // Only a seed that actually moved the number spends the flag — see above.
    if (result?.ok && result.delta !== 0) {
      try {
        await actor.setFlag(MODULE_ID, SEEDED_FLAG, true);
      } catch (err) {
        console.warn(`${MODULE_ID} | renown: could not stamp the seed flag on ${actor?.name}`, err);
      }
    }
    return result;
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
      if (actor.type !== "Player") continue;
      _levelSeen.set(actor.id, _levelOf(actor));
      _renownSeen.set(actor.id, this.valueOf(actor));
    }

    Hooks.on("createActor", async (actor) => {
      if (actor?.type !== "Player") return;
      _levelSeen.set(actor.id, _levelOf(actor));
      _renownSeen.set(actor.id, this.valueOf(actor));
      await this.maybeSeedFromCha(actor);
    });

    // A character can come back with the same id — an export re-imported, an
    // undone delete — and a stale cached value would mis-measure the first
    // external change after it returns.
    Hooks.on("deleteActor", (actor) => {
      _levelSeen.delete(actor?.id);
      _renownSeen.delete(actor?.id);
    });

    Hooks.on("updateActor", async (actor, changed, options, userId) => {
      if (actor?.type !== "Player") return;

      // Any write to the system's renown field, ours or somebody else's. The
      // cache is refreshed on EVERY client before the active-GM gate, so a
      // later external change is still measured against the right value.
      if (foundry.utils.getProperty(changed, "system.renown") !== undefined) {
        const prev = _renownSeen.get(actor.id);
        const next = this.valueOf(actor);
        _renownSeen.set(actor.id, next);

        // `_awardNow` writes the number and its ledger row in ONE update, so an
        // update carrying the ledger flag is ours and is already recorded.
        const ours = foundry.utils.getProperty(changed, `flags.${MODULE_ID}.${HISTORY_FLAG}`) !== undefined;
        if (!ours && _isPrimaryGM() && prev !== undefined && next !== prev) {
          const hint = _renownHint(options, userId);
          if (!hint.silent) {
            await this._recordExternalChange(actor, prev, next, hint);
          }
        }
      }

      // A character created before its abilities were rolled is still owed its
      // starting seed; `maybeSeedFromCha` decides. Independent of the level
      // branch below, so both can fire on an update that touches both.
      //
      // `cha.mod` is derived, not stored, so the diff never mentions it — match
      // on the whole cha object, which covers base and bonus alike.
      if (foundry.utils.getProperty(changed, "system.abilities.cha") !== undefined) {
        await this.maybeSeedFromCha(actor);
      }

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

/**
 * Read a writer's own account of a renown change out of the update options.
 *
 * The integration point for a module that writes `system.renown` itself instead
 * of calling `award` — a one-off data migration, or a caller that cannot await an
 * async API:
 *
 *   actor.update({ "system.renown": next },
 *                { "shadowdark-enhancer": { renown: { reason, source } } });
 *   actor.update({ "system.renown": next },
 *                { "shadowdark-enhancer": { renown: { silent: true } } });
 *
 * `silent` is what a migration wants: shadowdark-extras' `migrateLegacyRenown`
 * moves a retired flag into the system field, which is a data move rather than a
 * change in anybody's fame, and would otherwise log one row per character on the
 * first load after an upgrade.
 *
 * ONLY HONOURED FROM A GM-INITIATED UPDATE. Options travel with the update from
 * whoever made it, and a player owns their own character — so an untrusted
 * sender could otherwise label their own edit, or hide it with `silent`. A
 * non-GM's update is always recorded plainly. `userId` is Foundry's, not the
 * payload's, so it cannot be spoofed.
 *
 * @returns {{reason:string, source:string, silent:boolean}}
 */
function _renownHint(options, userId) {
  const fallback = { reason: "", source: "external", silent: false };
  if (!game.users?.get(userId)?.isGM) return fallback;

  const hint = options?.[MODULE_ID]?.renown;
  if (!hint || typeof hint !== "object") return fallback;

  return {
    reason: String(hint.reason ?? ""),
    source: String(hint.source ?? "") || "external",
    silent: !!hint.silent,
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
