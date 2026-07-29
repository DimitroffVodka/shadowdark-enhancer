/**
 * Shadowdark Enhancer — Downtime session (the multi-client player flow).
 *
 * The GM opens a downtime session for one book; every player picks ONE activity
 * for their own character, reading the full outcome text before they commit;
 * the GM locks the picks; then each PLAYER presses their own die. The dice are
 * theirs — the roll executes on their client so their Dice So Nice colours and
 * their roll history are the ones that show up.
 *
 * TRUST MODEL — the two rules everything here follows:
 *
 *   1. THE GM NEVER TRUSTS A NUMBER FROM A PAYLOAD. A player message carries
 *      only ids ({actorId, slotKey}, a messageId, a choice id). The GM re-reads
 *      the skeleton, the unlock setting, the actor and the session at handling
 *      time and recomputes the DC, the cost and the gating itself. Even the
 *      roll total is read back off the ChatMessage document, never taken from
 *      the payload. Mirrors merchant-shop `_txContext` (merchant-shop.mjs:585).
 *
 *   2. AUTOMATIC REACTIONS ARE activeGM-GATED. This world runs an always-on
 *      second GM (the Bridge watchdog), so a handler gated only on `isGM`
 *      double-fires in NORMAL use — that is exactly how spell-mishap shipped
 *      broken (.planning/STATUS.md:322). Socket handlers and hook reactions
 *      therefore check `isActiveGM()`. Direct GM button clicks are NOT gated:
 *      those are one physical click by whichever GM made it, so a second GM's
 *      Lock button still has to work (crawl-state.mjs:36-45).
 *
 * State sync copies CrawlState: the world setting is the single source of
 * truth, the socket carries a payload-free "go re-read" nudge, and listeners
 * re-read + re-render (crawl-state.mjs:96, :369).
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { canAfford, spendFromPurse, toCopper, fromCopper, formatPrice } from "../shared/coins.mjs";
import { SessionRecap } from "../session-recap/session-recap.mjs";
import { SOURCES, DOWNTIME_SKELETON } from "./downtime-skeleton.mjs";
import {
  effectiveDC,
  nextStepsOnFailure,
  attemptCost,
  martialTierForHitDie,
  casterListForAbility,
  readStored,
  ladderIndex,
} from "./downtime-core.mjs";
import { effectPlanFor, applyDowntimeEffect } from "./downtime-effects.mjs";

const SETTING_KEY = "downtimeSession";
const CONTENT_KEY = "downtimeContent";
const SOCKET = `module.${MODULE_ID}`;
const HOOK_CHANGED = "sde.downtimeSessionChanged";
const DOWNTIME_FLAG = "downtime";

/** Socket action names. The live-verification pass drives these directly. */
export const ACTIONS = {
  SYNC:   "downtime:sync",          // any → all      { action }                                    (payload-free nudge)
  PICK:   "downtime:pick",          // player → GM    { action, actorId, slotKey, ability, advantage, userId }
  ROLLED: "downtime:rolled",        // player → GM    { action, actorId, slotKey, messageId, userId }
  CHOICE: "downtime:effectChoice",  // player → GM    { action, actorId, slotKey, choice, userId }
  REJECT: "downtime:reject",        // GM → player    { action, userId, reason }
};

/**
 * Active-GM check. Gates AUTOMATIC reactions only — see the header note and
 * crawl-state.mjs:36-45 for why direct clicks are deliberately NOT gated.
 */
export function isActiveGM() {
  return !!game.user?.isGM && game.users?.activeGM?.id === game.user?.id;
}

export function defaultSession() {
  return { active: false, source: null, phase: "select", picks: {}, results: {}, announcementId: null };
}

/** Defensive normalizer — a hand-edited or partial setting can't crash a render. */
export function normalizeSession(raw) {
  const d = defaultSession();
  if (!raw || typeof raw !== "object") return d;
  return {
    active: !!raw.active,
    source: typeof raw.source === "string" ? raw.source : null,
    phase: raw.phase === "roll" ? "roll" : "select",
    picks: raw.picks && typeof raw.picks === "object" ? { ...raw.picks } : {},
    results: raw.results && typeof raw.results === "object" ? { ...raw.results } : {},
    announcementId: typeof raw.announcementId === "string" ? raw.announcementId : null,
  };
}

// ─── Shared resolution helpers ──────────────────────────────────────────────
// Exported so the app renders from EXACTLY the same functions the GM validates
// with. If these ever diverged, a player could see one DC and be charged for
// another.

/** Clamped ±4 ability modifier off the SD data model. */
export function abilityMod(actor, key) {
  return Number(actor?.system?.abilities?.[key]?.mod ?? 0);
}

/** Best modifier among ability keys, and which one won. */
export function bestOf(actor, keys) {
  let best = { ability: null, mod: -99 };
  for (const k of keys ?? []) {
    const m = abilityMod(actor, k);
    if (m > best.mod) best = { ability: k, mod: m };
  }
  return best.ability ? best : { ability: (keys ?? [])[0] ?? null, mod: 0 };
}

/** Hit-die tier + caster list for the gates. Never guesses. */
export async function classFacts(actor) {
  const facts = {
    hitDie: null, martialTier: null,
    castingAbility: null, casterList: null, classError: null,
  };
  if (!actor) return facts;
  let classItem = null;
  try {
    classItem = await actor.system?.getClass?.();
  } catch (err) {
    console.warn(`${MODULE_ID} | downtime: getClass() failed`, err);
    facts.classError = "the class item could not be loaded";
    return facts;
  }
  if (!classItem) {
    facts.classError = "no class is set on this character";
    return facts;
  }
  facts.hitDie = classItem.system?.hitPoints ?? null;
  facts.martialTier = facts.hitDie ? (martialTierForHitDie(facts.hitDie) ?? null) : null;
  if (!facts.martialTier) facts.classError = "couldn't read class hit die";
  facts.castingAbility = classItem.system?.spellcasting?.ability ?? null;
  facts.casterList = facts.castingAbility ? (casterListForAbility(facts.castingAbility) ?? null) : null;
  return facts;
}

/** Per-actor downtime flag blob (steps + pinned caster list). */
export function downtimeFlag(actor) {
  const raw = actor?.getFlag(MODULE_ID, DOWNTIME_FLAG);
  return {
    steps: { ...(raw?.steps ?? {}) },
    ...(raw?.casterList ? { casterList: raw.casterList } : {}),
  };
}

/** Step count for one slot out of the per-actor steps map (core takes a scalar). */
export function stepsFor(slot, steps) {
  return Math.max(0, Number(steps?.[slot?.key] ?? 0) || 0);
}

export function effDC(slot, steps) {
  try {
    const dc = effectiveDC(slot, stepsFor(slot, steps));
    return Number.isFinite(dc) ? dc : slot?.dc;
  } catch { return slot?.dc; }
}

export function costFor(sourceSlug, slot, level) {
  try { return Number(attemptCost(sourceSlug, slot, level)) || 0; } catch { return 0; }
}

/**
 * Can this character pay for this attempt right now?
 *
 * The single source of affordability truth. RAW is pay-per-attempt: no fee, no
 * attempt, no dice — so the PLAYER'S client calls this before it builds a Roll,
 * and the GM calls it again when the roll arrives (coins can move in between).
 * Both sides must agree, which is why neither re-implements the math.
 *
 * Reads coins off the live actor at call time; never from a cached context.
 */
export function affordability(actor, sourceSlug, slot, level) {
  const cost = costFor(sourceSlug, slot, level);
  if (cost <= 0) return { cost: 0, affordable: true, shortfall: null, shortfallText: "" };
  const price = { gp: cost, sp: 0, cp: 0 };
  const purse = actor?.system?.coins ?? { gp: 0, sp: 0, cp: 0 };
  if (canAfford(purse, price)) return { cost, affordable: true, shortfall: null, shortfallText: "" };
  const shortCp = Math.max(0, toCopper(price) - toCopper(purse));
  return {
    cost,
    affordable: false,
    shortfall: fromCopper(shortCp),
    shortfallText: formatPrice(fromCopper(shortCp)),
  };
}

/** Does this actor's class/caster gating allow this slot? */
export function slotAllowed(activity, slot, { facts, casterList }) {
  const gate = activity?.gate ?? null;
  if (gate?.kind === "hitDie") {
    if (!facts.martialTier) return false;          // unreadable class → never legal
    return !slot.tier || slot.tier === facts.martialTier;
  }
  if (gate?.kind === "spellcaster") {
    if (!casterList || casterList === "ambiguous") return false;
    return !slot.list || slot.list === casterList;
  }
  return true;
}

/** The ability + modifier a slot's check rolls against. */
export function modForCheck(activity, slot, actor, { facts, choiceAbility } = {}) {
  const check = activity?.check ?? {};
  if (check.kind === "ability") return bestOf(actor, check.abilities);
  if (check.kind === "choice") {
    const abilities = check.abilities ?? [];
    const picked = abilities.includes(choiceAbility) ? choiceAbility : bestOf(actor, abilities).ability;
    return { ability: picked, mod: abilityMod(actor, picked) };
  }
  if (check.kind === "grouped") {
    const group = (check.groups ?? []).find(g => g.id === slot.group) ?? (check.groups ?? [])[0];
    return bestOf(actor, group?.abilities);
  }
  if (check.kind === "spellcasting") {
    const ability = facts?.castingAbility ?? null;
    return ability ? { ability, mod: abilityMod(actor, ability) } : { ability: null, mod: 0 };
  }
  return { ability: null, mod: 0 };
}

/** Printed labels for the two gate axes. The book prints these as subsection
 *  headers; the skeleton only carries the machine keys. */
export const MARTIAL_TIER_LABELS = { d4: "d4", d6: "d6", d8plus: "d8+" };
export const CASTER_LIST_LABELS = {
  arcane: "INT or CHA Spellcasters",
  divine: "WIS or CHA Spellcasters",
};

/**
 * Clamp a manual step adjustment to the ladder. `nextStepsOnFailure` caps at
 * ladderIndex(dc) — the DC can never fall below the bottom rung — so a GM's
 * hand-set value obeys exactly the same bound.
 */
export function clampSteps(slot, steps) {
  const idx = ladderIndex(slot?.dc);
  if (idx < 0) return 0;
  return Math.max(0, Math.min(Number(steps) || 0, idx));
}

/**
 * The ability a given SLOT rolls against, as a short chip ("CHA", "INT/STR/DEX",
 * "Spellcasting"). Skulduggery mixes CHA and DEX rows in one activity, so the
 * section header alone can't tell a player what they're rolling.
 */
export function abilityChipFor(activity, slot) {
  const check = activity?.check ?? {};
  if (check.kind === "ability") return (check.abilities ?? []).map(a => a.toUpperCase()).join("/");
  if (check.kind === "choice") return (check.abilities ?? []).map(a => a.toUpperCase()).join("/");
  if (check.kind === "grouped") {
    const g = (check.groups ?? []).find(x => x.id === slot?.group) ?? (check.groups ?? [])[0];
    return (g?.abilities ?? []).map(a => a.toUpperCase()).join("/");
  }
  if (check.kind === "spellcasting") return "Spellcasting";
  return "";
}

/**
 * Hand a settled attempt to the downtime log.
 *
 * Guarded on both axes: the module is imported dynamically (it may not be
 * present in every build) and any throw is swallowed. A logging failure must
 * never lose a paid roll, so this is called AFTER the result is committed.
 *
 * Called exactly ONCE per resolved attempt, from the GM side only. When the
 * outcome still owes the player a choice, `effectSummary` is null — the log
 * records the roll as it resolved rather than waiting on a pick that may never
 * come, and is not retro-patched when the choice lands.
 */
export async function recordDowntimeSafe(entry) {
  try {
    const mod = await import("./downtime-log.mjs");
    if (typeof mod?.recordDowntime === "function") await mod.recordDowntime(entry);
  } catch (err) {
    console.warn(`${MODULE_ID} | downtime: log unavailable, attempt not recorded`, err);
  }
}

/** Advantage modes. Declared at PICK time so the GM sees them before unlocking. */
// `label` stays compact because the GM roster prints it inline next to a pick
// ("Lay low (Advantage)"); `long` spells the dice out for the picker itself.
export const ADV_MODES = [
  { key: "adv",    label: "Advantage",    long: "Advantage (2d20 keep highest)", dice: "2d20kh" },
  { key: "normal", label: "Normal",       long: "Normal (1d20)",                 dice: "1d20" },
  { key: "dis",    label: "Disadvantage", long: "Disadvantage (2d20 keep lowest)", dice: "2d20kl" },
];
export function advMode(key) {
  return ADV_MODES.find(m => m.key === key) ?? ADV_MODES[1];
}

// ─── The session singleton ──────────────────────────────────────────────────

export const DowntimeSession = {
  _state: defaultSession(),

  // Serializes GM-side writes. Handlers read state, await, then write — without
  // a queue two near-simultaneous player messages both read the pre-write state
  // and the second clobbers the first (merchant-shop.mjs:53-64).
  _txQueue: Promise.resolve(),
  _enqueue(fn) {
    const run = this._txQueue.then(fn, fn);
    this._txQueue = run.catch(() => {});
    return run;
  },

  // ── Getters ───────────────────────────────────────────────────────────────
  get state()   { return this._state; },
  get active()  { return !!this._state.active; },
  get phase()   { return this._state.phase; },
  get source()  { return this._state.source; },
  get picks()   { return this._state.picks ?? {}; },
  get results() { return this._state.results ?? {}; },
  get rollsUnlocked() { return this._state.active && this._state.phase === "roll"; },

  pickFor(actorId)   { return this._state.picks?.[actorId] ?? null; },
  resultFor(actorId) { return this._state.results?.[actorId] ?? null; },

  HOOK_CHANGED,

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  init() {
    this._state = normalizeSession(game.settings.get(MODULE_ID, SETTING_KEY));

    game.socket.on(SOCKET, async (msg) => {
      const action = msg?.action;
      if (typeof action !== "string" || !action.startsWith("downtime:")) return;

      // Payload-free nudge: re-read the world setting (the only source of
      // truth) and let listeners re-render. Safe for every client, GM or not.
      if (action === ACTIONS.SYNC) {
        this._state = normalizeSession(game.settings.get(MODULE_ID, SETTING_KEY));
        Hooks.callAll(HOOK_CHANGED, this._state);
        return;
      }

      // Targeted rejection notice back to one player.
      if (action === ACTIONS.REJECT) {
        if (msg.userId === game.user.id) ui.notifications.warn(msg.reason ?? "Downtime action refused.");
        return;
      }

      // Everything below MUTATES world state. Exactly one GM may handle it.
      if (!isActiveGM()) return;
      if (action === ACTIONS.PICK)   return this._enqueue(() => this._handlePick(msg));
      if (action === ACTIONS.ROLLED) return this._enqueue(() => this._handleRolled(msg));
      if (action === ACTIONS.CHOICE) return this._enqueue(() => this._handleEffectChoice(msg));
    });

    // Announcement-card buttons, wired per client (loot-delivery.mjs:150).
    Hooks.on("renderChatMessageHTML", (message, html) => this._wireCard(message, html));

    console.log(`${MODULE_ID} | Downtime session initialized.`);
  },

  // ── Persistence ───────────────────────────────────────────────────────────

  /** Re-read from the setting. Cheap; call before any read-modify-write. */
  _read() {
    this._state = normalizeSession(game.settings.get(MODULE_ID, SETTING_KEY));
    return this._state;
  },

  /**
   * Persist, then nudge. GM-only — players cannot write world settings, which
   * is precisely why every player action arrives over the socket instead.
   */
  async _commit(next) {
    if (!game.user.isGM) return false;
    this._state = normalizeSession(next);
    await game.settings.set(MODULE_ID, SETTING_KEY, this._state);
    game.socket.emit(SOCKET, { action: ACTIONS.SYNC });
    Hooks.callAll(HOOK_CHANGED, this._state);
    return true;
  },

  _reject(userId, reason) {
    if (userId && userId !== game.user.id) game.socket.emit(SOCKET, { action: ACTIONS.REJECT, userId, reason });
    else ui.notifications.warn(reason);
  },

  // ── Content access ────────────────────────────────────────────────────────

  /** Unlocked outcome text for the session's book. */
  storedFor(slug) {
    const record = (game.settings.get(MODULE_ID, CONTENT_KEY) ?? {})[slug];
    if (!record) return { ok: false, slots: {} };
    try {
      const read = readStored(record);
      return { ok: !!read?.ok, slots: read?.slots ?? {} };
    } catch { return { ok: false, slots: {} }; }
  },

  /** Locate {activity, slot} in the skeleton. */
  findSlot(slotKey) {
    for (const activity of DOWNTIME_SKELETON?.activities ?? []) {
      const slot = (activity.slots ?? []).find(s => s.key === slotKey);
      if (slot) return { activity, slot };
    }
    return null;
  },

  /**
   * THE AUTHORITATIVE CONTEXT. Everything a handler needs, recomputed from the
   * skeleton + settings + live actor. Nothing here comes from a payload except
   * the two ids used to look things up.
   */
  async context(actorId, slotKey, { choiceAbility } = {}) {
    const state = this._read();
    if (!state.active) return { ok: false, error: "No downtime session is running." };

    const actor = game.actors.get(actorId);
    if (!actor || actor.type !== "Player") return { ok: false, error: "That character no longer exists." };

    const found = this.findSlot(slotKey);
    if (!found) return { ok: false, error: "That downtime activity is not in the skeleton." };
    const { activity, slot } = found;

    const stored = this.storedFor(state.source);
    const text = stored.slots?.[slot.key] ?? "";
    if (!text) return { ok: false, error: `"${slot.label}" is not unlocked for this book.` };

    const facts = await classFacts(actor);
    const flag = downtimeFlag(actor);
    const casterList = facts.casterList === "ambiguous"
      ? (flag.casterList ?? "arcane")
      : facts.casterList;

    if (!slotAllowed(activity, slot, { facts, casterList })) {
      return { ok: false, error: `${actor.name} can't take "${slot.label}".` };
    }

    const level = Number(actor.system?.level?.value ?? 0);
    return {
      ok: true, state, actor, activity, slot, facts, flag, casterList, level,
      outcomeText: text,
      dc: effDC(slot, flag.steps),
      cost: costFor(state.source, slot, level),
      check: modForCheck(activity, slot, actor, { facts, choiceAbility }),
    };
  },

  // ── GM mutators (direct clicks — deliberately NOT activeGM-gated) ─────────

  async start(sourceSlug) {
    if (!game.user.isGM) return null;
    const stored = this.storedFor(sourceSlug);
    if (!stored.ok) { ui.notifications.warn("That book isn't unlocked yet — import it first."); return null; }

    const next = { ...defaultSession(), active: true, source: sourceSlug, phase: "select" };
    const msg = await this._postAnnouncement(sourceSlug);
    next.announcementId = msg?.id ?? null;
    await this._commit(next);
    return next;
  },

  async setPhase(phase) {
    if (!game.user.isGM) return false;
    const state = this._read();
    if (!state.active) return false;
    return this._commit({ ...state, phase: phase === "roll" ? "roll" : "select" });
  },

  async end() {
    if (!game.user.isGM) return false;
    const state = this._read();
    if (state.announcementId) await this._supersedeCard(state.announcementId);
    return this._commit(defaultSession());
  },

  /** GM sets or clears a pick on a player's behalf (absent player). */
  async gmSetPick(actorId, slotKey, opts = {}) {
    if (!game.user.isGM) return false;
    if (!slotKey) {
      const state = this._read();
      const picks = { ...state.picks };
      delete picks[actorId];
      return this._commit({ ...state, picks });
    }
    return this._applyPick({ actorId, slotKey, ...opts, userId: game.user.id });
  },

  // ── Socket handlers (activeGM-gated by the dispatcher above) ─────────────

  async _handlePick(payload) {
    const { actorId, userId } = payload ?? {};
    const actor = game.actors.get(actorId);
    // Ownership: the requesting user must actually own the character.
    const user = game.users.get(userId);
    if (!actor || !user || !actor.testUserPermission(user, "OWNER")) {
      return this._reject(userId, "You don't own that character.");
    }
    return this._applyPick(payload);
  },

  async _applyPick({ actorId, slotKey, ability, advantage, userId }) {
    const state = this._read();
    if (state.phase !== "select") return this._reject(userId, "Picks are locked — the GM has already unlocked the dice.");
    if (state.results?.[actorId]) return this._reject(userId, "That character already rolled this session.");

    const ctx = await this.context(actorId, slotKey, { choiceAbility: ability });
    if (!ctx.ok) return this._reject(userId, ctx.error);

    // AUTHORITATIVE affordability gate on SELECTION. The client blocks the
    // button and refuses the click, but the GM re-reads the actor here and
    // decides for real — a forged or stale pick must not stick. Nothing has
    // been written at this point, so returning leaves the session untouched.
    // No GM override by design: adding coin to the sheet is the escape hatch.
    const money = affordability(ctx.actor, ctx.state.source, ctx.slot, ctx.level);
    if (!money.affordable) {
      return this._reject(
        userId,
        `"${ctx.slot.label}" costs ${money.cost} gp per attempt and ${ctx.actor.name} is `
        + `${money.shortfallText} short — pick something else, or get the coin first.`,
      );
    }

    // Only keep an ability choice the check actually offers.
    const legalAbility = ctx.activity.check?.kind === "choice"
      && (ctx.activity.check.abilities ?? []).includes(ability) ? ability : null;

    const picks = {
      ...state.picks,
      [actorId]: {
        slotKey,
        ...(legalAbility ? { ability: legalAbility } : {}),
        ...(ctx.casterList ? { casterList: ctx.casterList } : {}),
        advantage: advMode(advantage).key,
      },
    };
    return this._commit({ ...state, picks });
  },

  /**
   * A player rolled. The TOTAL is read off the ChatMessage document, never the
   * payload — a crafted message can name a roll it doesn't own, so we also
   * check the message actually belongs to that user and carries a roll.
   */
  async _handleRolled(payload) {
    const { actorId, slotKey, messageId, userId } = payload ?? {};
    const state = this._read();
    if (!state.active) return;
    if (state.phase !== "roll") return this._reject(userId, "Rolls aren't unlocked yet.");
    if (state.results?.[actorId]) return this._reject(userId, "That character already rolled.");

    const pick = state.picks?.[actorId];
    if (!pick || pick.slotKey !== slotKey) return this._reject(userId, "That doesn't match your locked pick.");

    const message = game.messages.get(messageId);
    const roll = message?.rolls?.[0];
    if (!message || !roll) return this._reject(userId, "Couldn't find that roll.");
    if (userId && message.author?.id && message.author.id !== userId) {
      return this._reject(userId, "That roll isn't yours.");
    }
    const total = Number(roll.total);
    if (!Number.isFinite(total)) return this._reject(userId, "That roll has no total.");

    const ctx = await this.context(actorId, slotKey, { choiceAbility: pick.ability });
    if (!ctx.ok) return this._reject(userId, ctx.error);

    return this._settle(ctx, { total, messageId, userId });
  },

  /**
   * Charge, judge, walk the ladder, then plan the effect. Shared by the player
   * flow and the GM's roll-for-absent-player control.
   */
  async _settle(ctx, { total, messageId, userId }) {
    const { actor, activity, slot, flag, dc, cost } = ctx;
    const state = this._read();

    // RAW: the fee is per attempt, win or lose. Charge BEFORE judging.
    let paid = 0;
    if (cost > 0) {
      const price = { gp: cost, sp: 0, cp: 0 };
      // Last line of defence. The player's client already checked this before
      // it rolled, but coins can move in between (a purchase, another attempt,
      // the GM editing the sheet), so the authoritative side checks again.
      //
      // NOTHING has been written at this point — no coins, no flags, no
      // session state — and returning here leaves the pick in place, so the
      // character can retry once they can pay. The dice already in chat are
      // orphaned; the message says so rather than leaving the player guessing
      // why a real-looking roll produced no outcome.
      if (!canAfford(actor.system.coins, price)) {
        const short = affordability(actor, state.source, slot, ctx.level);
        return this._reject(
          userId,
          `The fee couldn't be paid — that roll didn't count. "${slot.label}" costs ${cost} gp`
          + `${short.shortfallText ? ` and ${actor.name} is ${short.shortfallText} short` : ""}.`
          + " Your pick is still set; roll again once you can pay.",
        );
      }
      const remaining = spendFromPurse(actor.system.coins, toCopper(price));
      await actor.update({
        "system.coins.gp": remaining.gp,
        "system.coins.sp": remaining.sp,
        "system.coins.cp": remaining.cp,
      });
      paid = cost;
      SessionRecap.logPurchase({ player: actor.name, item: `Downtime: ${slot.label}`, qty: 1, price });
    }

    const success = total >= dc;

    // Success clears the ladder; failure walks it one rung down.
    const steps = { ...flag.steps };
    if (success) steps[slot.key] = 0;
    else {
      try { steps[slot.key] = Number(nextStepsOnFailure(slot, stepsFor(slot, flag.steps))) || 0; }
      catch { steps[slot.key] = stepsFor(slot, flag.steps); }
    }
    await actor.setFlag(MODULE_ID, DOWNTIME_FLAG, { ...flag, steps });
    const nextDC = success ? slot.dc : effDC(slot, steps);

    const result = {
      slotKey: slot.key, activityKey: activity.key, total, dc,
      success, cost: paid, messageId: messageId ?? null, nextDC,
    };

    // Effect planning. A missing/misbehaving effects module degrades to a
    // GM-adjudication note rather than breaking the roll.
    if (success) {
      let plan = null;
      try { plan = await effectPlanFor(slot.key, actor); }
      catch (err) {
        console.warn(`${MODULE_ID} | downtime: effectPlanFor failed for "${slot.key}"`, err);
      }
      if (plan?.kind === "choice") {
        result.effect = {
          pending: true,
          choiceType: plan.choiceType ?? null,
          freeText: !!plan.freeText,
          prompt: plan.prompt ?? "Choose one:",
          // Keep the option rows WHOLE. They carry more than {id,label}:
          // `disabled`+`reason` (rendered greyed, never hidden) and, for a
          // spell trade, the `gain` list of legal same-tier replacements. An
          // earlier version mapped these down to {id,label} and silently broke
          // both the greying and the trade's second step.
          options: (plan.options ?? []).map(o => ({
            id: String(o.id),
            label: String(o.label),
            disabled: !!o.disabled,
            reason: o.reason ?? null,
            ...(Array.isArray(o.gain) ? {
              gain: o.gain.map(g => ({
                uuid: String(g.uuid ?? g.id ?? ""),
                label: String(g.label ?? g.name ?? ""),
              })),
            } : {}),
          })),
        };
      } else if (plan?.kind === "auto") {
        result.effect = await this._applyEffect(actor, slot, null);
      } else {
        result.effect = { summary: plan?.prompt ?? "Resolve this one with your GM.", narrative: true };
      }
    }

    const results = { ...state.results, [actor.id]: result };
    await this._commit({ ...state, results });
    await this._postResult(ctx, result);

    // Log AFTER the result is committed and the card is posted, so a broken
    // logger can only lose a log line — never a paid roll.
    await recordDowntimeSafe({
      actorId: actor.id,
      actorName: actor.name,
      player: game.users.get(userId)?.name ?? null,
      sourceSlug: state.source,
      slotKey: slot.key,
      slotLabel: slot.label,
      activityKey: activity.key,
      activityName: activity.name,
      total, dc, success,
      costGp: paid,
      effectSummary: result.effect?.pending ? null : (result.effect?.summary ?? null),
      gmRolled: !!game.users.get(userId)?.isGM,
      timestamp: new Date().toISOString(),
    });
    return result;
  },

  async _applyEffect(actor, slot, choice) {
    try {
      const out = await applyDowntimeEffect({ actor, slotKey: slot.key, choice });
      if (out?.ok) return { summary: out.summary ?? "Applied." };
      return { summary: out?.error ?? "Couldn't apply that automatically — resolve with your GM.", narrative: true };
    } catch (err) {
      console.warn(`${MODULE_ID} | downtime: applyDowntimeEffect failed for "${slot.key}"`, err);
      return { summary: "Couldn't apply that automatically — resolve with your GM.", narrative: true };
    }
  },

  async _handleEffectChoice(payload) {
    const { actorId, slotKey, choice, userId } = payload ?? {};
    const state = this._read();
    const result = state.results?.[actorId];
    if (!result || result.slotKey !== slotKey) return this._reject(userId, "No pending downtime effect for that character.");
    if (!result.effect?.pending) return this._reject(userId, "That effect was already resolved.");

    const actor = game.actors.get(actorId);
    const user = game.users.get(userId);
    if (!actor) return this._reject(userId, "That character no longer exists.");
    if (user && !game.users.get(userId)?.isGM && !actor.testUserPermission(user, "OWNER")) {
      return this._reject(userId, "You don't own that character.");
    }
    // The id must be one the plan actually offered, and not one it greyed out.
    const wantedId = String(choice?.id ?? choice ?? "");
    const opt = (result.effect.options ?? []).find(o => o.id === wantedId);
    if (!opt) return this._reject(userId, "That isn't one of the offered options.");
    if (opt.disabled) return this._reject(userId, opt.reason ?? "That option isn't available.");

    const found = this.findSlot(slotKey);
    if (!found) return this._reject(userId, "That activity is no longer in the skeleton.");

    /**
     * downtime-effects reads `choice?.id`, `choice?.gain`, `choice?.name` … —
     * every handler expects an OBJECT, never a bare id string. Hand it the
     * whole option row plus whatever second-step selection came with the
     * payload (the spell trade's replacement uuid), so the handler sees the
     * same data effectPlanFor published.
     */
    const gainUuid = String(choice?.gainSpellUuid ?? "");
    if (Array.isArray(opt.gain) && opt.gain.length) {
      if (!gainUuid) return this._reject(userId, "Pick the replacement spell as well.");
      if (!opt.gain.some(g => g.uuid === gainUuid)) {
        return this._reject(userId, "That replacement isn't offered for the spell you gave up.");
      }
    }
    const choiceObj = { ...opt, ...(gainUuid ? { gainSpellUuid: gainUuid } : {}) };

    const applied = await this._applyEffect(actor, found.slot, choiceObj);
    const fresh = this._read();
    const results = { ...fresh.results, [actorId]: { ...fresh.results[actorId], effect: applied } };
    await this._commit({ ...fresh, results });
    await this._postEffectNote(actor, found.slot, applied);
    return applied;
  },

  // ── Chat surfaces ─────────────────────────────────────────────────────────

  async _postAnnouncement(sourceSlug) {
    const label = SOURCES?.[sourceSlug]?.label ?? sourceSlug;
    const content = `
      <div class="sde-downtime-card sde-dt-announce">
        <header class="sde-dt-head"><i class="fas fa-mug-hot"></i> Downtime</header>
        <p class="sde-dt-line">The party has time between crawls. Pick one activity for your character.</p>
        <p class="sde-dt-line sde-dt-book">${esc(label)}</p>
        <button type="button" class="sde-dt-open-btn"><i class="fas fa-mug-hot"></i> Open Downtime</button>
        <footer class="sde-dt-foot">Luck tokens cannot be spent on downtime checks.</footer>
      </div>`;
    return ChatMessage.create({
      content,
      speaker: { alias: "Downtime" },
      flags: { [MODULE_ID]: { downtimeAnnounce: true, source: sourceSlug } },
    });
  },

  /** Gray the announcement so a stale card can't reopen a finished session. */
  async _supersedeCard(messageId) {
    const msg = game.messages.get(messageId);
    if (!msg) return;
    try {
      await msg.update({ [`flags.${MODULE_ID}.superseded`]: true });
    } catch (err) {
      console.warn(`${MODULE_ID} | downtime: couldn't supersede announcement`, err);
    }
  },

  async _postResult(ctx, result) {
    const { actor, activity, slot, outcomeText } = ctx;
    const costLine = result.cost > 0
      ? `<div class="sde-dt-line"><i class="fas fa-coins"></i> Paid ${result.cost} gp (per attempt, win or lose)</div>` : "";
    const effectLine = result.effect?.pending
      ? `<div class="sde-dt-line"><i class="fas fa-hourglass-half"></i> Waiting on a choice…</div>`
      : (result.effect?.summary ? `<div class="sde-dt-line"><i class="fas fa-wand-sparkles"></i> ${esc(result.effect.summary)}</div>` : "");
    const body = result.success
      ? `<div class="sde-dt-outcome">${esc(outcomeText)}</div>${effectLine}`
      : `<div class="sde-dt-line">Next attempt on this activity is <strong>DC ${result.nextDC}</strong>.</div>`;
    const content = `
      <div class="sde-downtime-card ${result.success ? "sde-dt-success" : "sde-dt-failure"}">
        <header class="sde-dt-head">
          <i class="fas fa-mug-hot"></i> ${esc(activity.name)}
          <span class="sde-dt-slot">${esc(slot.label)}</span>
        </header>
        <div class="sde-dt-check">${esc(actor.name)}</div>
        <div class="sde-dt-total">
          <span class="sde-dt-num">${result.total}</span>
          <span class="sde-dt-vs">vs DC ${result.dc}</span>
          <span class="sde-dt-verdict">${result.success ? "SUCCESS" : "FAILURE"}</span>
        </div>
        ${costLine}${body}
        <footer class="sde-dt-foot">Luck tokens cannot be spent on downtime checks.</footer>
      </div>`;
    return ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor }),
      flags: { [MODULE_ID]: { downtimeResult: true, slotKey: slot.key } },
    });
  },

  async _postEffectNote(actor, slot, applied) {
    return ChatMessage.create({
      content: `<div class="sde-downtime-card">
        <header class="sde-dt-head"><i class="fas fa-wand-sparkles"></i> ${esc(slot.label)}</header>
        <div class="sde-dt-line">${esc(applied.summary ?? "")}</div>
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
      flags: { [MODULE_ID]: { downtimeEffect: true, slotKey: slot.key } },
    });
  },

  /**
   * Per-client card wiring. GM-only controls are REMOVED from the DOM on player
   * clients rather than merely hidden, and the session is re-checked at click
   * time so a stale card can't reopen a closed session (loot-delivery.mjs:150,
   * merchant-shop.mjs:149-172).
   */
  _wireCard(message, html) {
    const flags = message.flags?.[MODULE_ID];
    if (!flags?.downtimeAnnounce) return;
    const btn = html.querySelector(".sde-dt-open-btn");
    if (!btn) return;

    if (flags.superseded) {
      btn.disabled = true;
      btn.style.opacity = "0.5";
      btn.innerHTML = `<i class="fas fa-ban"></i> Downtime ended`;
      return;
    }
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      // Re-check live state, not the state the card was rendered with.
      if (!this.active) { ui.notifications.warn("That downtime session has ended."); return; }
      const { DowntimeApp } = await import("./downtime-app.mjs");
      DowntimeApp.open();
    });
  },
};
