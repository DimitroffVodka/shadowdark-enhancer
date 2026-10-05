/**
 * Shadowdark Enhancer — Downtime window.
 *
 * One GM-facing window for the between-crawls downtime activities: pick a
 * source book, pick a character, attempt an activity's slot, pay its cost, roll
 * the check, and read the unlocked outcome.
 *
 * SHIPS NO BOOK CONTENT, AND SHOWS NONE BEFORE IT IS UNLOCKED. The module
 * bundles a SKELETON (activity names, slot labels, DCs, costs, mechanical
 * deltas — see downtime-skeleton.mjs) but that outline is itself a reading of
 * the book's tables, so a LOCKED source renders nothing at all: no sections, no
 * slot labels, no DCs, no costs. Just a card naming the book and its pages, and
 * a button that hands off to the Importer Hub. Greying out a full mechanical
 * outline would imply we already hold the copyrighted material; we don't, and
 * the UI shouldn't suggest otherwise.
 *
 * Unlocking happens in the Importer Hub, not here — this window is a consumer
 * of the `downtimeContent` world setting, never its author. It subscribes to
 * `updateSetting` so a hub-side commit refreshes an open window.
 *
 * Rules notes baked into the flow:
 *   • Cost is paid PER ATTEMPT, success or not (RAW) — so the purse is debited
 *     BEFORE the die is rolled, never after.
 *   • A failed attempt walks the DC one rung down the ladder for the NEXT
 *     attempt on that slot; a success resets it. Progress lives per-actor in
 *     flags[MODULE_ID].downtime.steps.
 *   • Luck tokens can't be spent on downtime checks — every card says so.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { canAfford, spendFromPurse, toCopper } from "../shared/coins.mjs";
import { SessionRecap } from "../session-recap/session-recap.mjs";
import { queryActiveGM } from "../shared/gm-relay.mjs";
import { Renown } from "../renown/renown.mjs";
import { renownBand, renownValue } from "../renown/renown-core.mjs";
import { SETTLEMENT_KINDS } from "../rules-data/rules-data-core.mjs";
import {
  SOURCES,
  DOWNTIME_SKELETON,
  EXPECTED_SLOT_COUNT,
} from "./downtime-skeleton.mjs";
import {
  effectiveDC,
  nextStepsOnFailure,
  martialTierForHitDie,
  casterListForAbility,
  readStored,
  slotByKey,
} from "./downtime-core.mjs";
import {
  DowntimeSession,
  ACTIONS,
  DOWNTIME_QUERY,
  ROLL_FLAG,
  ADV_MODES,
  advMode,
  abilityMod,
  bestOf,
  classFacts,
  downtimeFlag,
  slotAllowed,
  modForCheck,
  effDC,
  costFor,
  affordability,
  clampSteps,
  abilityChipFor,
  recordDowntimeSafe,
  CASTER_LIST_LABELS,
  martialTierBuckets,
  foundFor,
} from "./downtime-session.mjs";
import { recruitActivity, recruitKey, recruitSlot } from "./downtime-recruit-core.mjs";
import { withLibrary } from "../bastion/bastion-library.mjs";
import {
  SETTLEMENT_SETTING, checkRecruit, commandedWarbands, recruitView, recruitWarband,
} from "./downtime-recruit.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Per-actor state lives under one dot-free flag key. */
const DOWNTIME_FLAG = "downtime";

/** Fills "…needs a reload before X can land" when a relay can't be delivered. */
const DOWNTIME_RELAY_LABEL = "SDE.downtime.relayLabel";

/** One string from `languages/en.json`; the key when no i18n is mounted. */
const L = (key, data) => {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
};

// ADV_MODES / advMode now live in downtime-session.mjs so the player's window,
// the GM's window and the GM-side validator all read the same dice formulas.

/** Render a modifier the way a stat block does. */
function signed(n) {
  const v = Number(n) || 0;
  return v < 0 ? String(v) : `+${v}`;
}

export class DowntimeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-downtime",
    // Deliberately NOT tag:"form" — every control is an action button or a
    // change-wired select, and an ApplicationV2 whose root is a <form> invites
    // the nested-form trap that silently broke the boat sheet.
    tag: "div",
    classes: ["shadowdark", "sde-downtime", "sde-ui"],
    window: { title: "SDE.downtime.title", icon: "fas fa-mug-hot", resizable: true },
    position: { width: 720, height: "auto" },
    actions: {
      attempt:         DowntimeApp.prototype._onAttempt,
      clearSteps:      DowntimeApp.prototype._onClearSteps,
      adjustStep:      DowntimeApp.prototype._onAdjustStep,
      unlockViaImporter: DowntimeApp.prototype._onUnlockViaImporter,
      applyRenown:     DowntimeApp.prototype._onApplyRenown,
      applyRenownSign: DowntimeApp.prototype._onApplyRenownSigned,
      applyXp:         DowntimeApp.prototype._onApplyXp,
      setCasterList:   DowntimeApp.prototype._onSetCasterList,
      dismissResult:   DowntimeApp.prototype._onDismissResult,
      // Recruit a warband (#205): the GM's solo attempt, and the link to a warband's sheet (retraining is there).
      recruit:         DowntimeApp.prototype._onRecruit,
      openWarband:     DowntimeApp.prototype._onOpenWarband,
      // Session flow — players
      pickSlot:        DowntimeApp.prototype._onPickSlot,
      rollPick:        DowntimeApp.prototype._onRollPick,
      chooseEffect:    DowntimeApp.prototype._onChooseEffect,
      submitFreeText:  DowntimeApp.prototype._onSubmitFreeText,
      // Session flow — GM control panel
      startSession:    DowntimeApp.prototype._onStartSession,
      lockRolls:       DowntimeApp.prototype._onLockRolls,
      releaseRolls:    DowntimeApp.prototype._onReleaseRolls,
      endSession:      DowntimeApp.prototype._onEndSession,
      gmClearPick:     DowntimeApp.prototype._onGmClearPick,
      gmRollFor:       DowntimeApp.prototype._onGmRollFor,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/downtime.hbs` },
  };

  // ─── Singleton ────────────────────────────────────────────────────────────

  static _instance = null;

  /**
   * GMs may always open it (solo mode runs the whole flow themselves). Players
   * may open it only while a session is running — outside one there is nothing
   * for them to do and the window would just expose the party's sheets.
   */
  static open() {
    if (!game.user.isGM && !DowntimeSession.active) {
      ui.notifications.warn(L("SDE.downtime.notify.noSession"));
      return null;
    }
    if (!this._instance) this._instance = new DowntimeApp();
    if (!this._instance.rendered) this._instance.render(true);
    else { this._instance.bringToFront(); this._instance.render(); }
    return this._instance;
  }

  // ─── Instance state ───────────────────────────────────────────────────────

  /** Selected source slug; null until _prepareContext picks a default. */
  _sourceSlug = null;
  /** Selected actor id. */
  _actorId = null;
  /** "adv" | "normal" | "dis" — applies to the NEXT attempt only. */
  _advantage = "normal";
  /** Per-attempt ability for `choice` checks (martial training). */
  _choiceAbility = null;
  /**
   * Martial-training tier the user is LOOKING at. null = follow the character's
   * detected hit die. A GM may attempt any tier; a player may browse them all
   * but only their own tier's controls enable (and slotAllowed still refuses
   * the rest server-side).
   */
  _martialTier = null;
  /** Last attempt outcome rendered in the result area, or null. */
  _result = null;

  /**
   * A player's view of the warbands on offer, asked of the GM (they can't see the world's or the pack's
   * warbands): `{actorId, view, stale}`. Kept while it is asked again, so the list doesn't flicker.
   */
  _offers = null;

  /**
   * Casting ability resolved by the last _classFacts() pass. getClass() is
   * async and an action handler shouldn't re-await it mid-attempt, so the
   * render that drew the button leaves the answer here.
   */
  _cachedCastingAbility = null;

  /** Hook ids for the settings / session / coin subscriptions (see _onFirstRender). */
  _updateHookId = null;
  _sessionHookId = null;
  _actorHookId = null;

  // ─── Setting access ───────────────────────────────────────────────────────

  _content() {
    return game.settings.get(MODULE_ID, "downtimeContent") ?? {};
  }

  /** Stored unlock for a slug, run through readStored. Never throws. */
  _stored(slug) {
    const record = this._content()?.[slug];
    if (!record) return { ok: false, stale: false, slots: {}, droppedKeys: [] };
    try {
      const read = readStored(record);
      return {
        ok: !!read?.ok,
        stale: !!read?.stale,
        slots: read?.slots ?? {},
        droppedKeys: read?.droppedKeys ?? [],
      };
    } catch (err) {
      console.warn(`${MODULE_ID} | downtime: unreadable unlock record for "${slug}"`, err);
      return { ok: false, stale: false, slots: {}, droppedKeys: [] };
    }
  }

  // ─── Actor helpers ────────────────────────────────────────────────────────

  /**
   * Player-type actors, matching how party-xp enumerates the party.
   *
   * On a PLAYER client this narrows to characters they actually own. Without
   * the isOwner filter a player's window would list every party member they
   * have limited visibility on — and downtime shows sheet-derived numbers
   * (coins, renown, modifiers) that aren't theirs to read.
   */
  _playerActors() {
    const all = game.actors.filter(a => a.type === "Player" && a.hasPlayerOwner);
    return game.user.isGM ? all : all.filter(a => a.isOwner);
  }

  /** True when this window is being driven by a player, not the GM. */
  get isPlayerMode() { return !game.user.isGM; }

  /** The live session, re-read each render. */
  get session() { return DowntimeSession; }

  _actor() {
    if (!this._actorId) return null;
    return game.actors.get(this._actorId) ?? null;
  }

  /** Whole per-actor downtime blob (steps + caster list choice). */
  _downtimeFlag(actor) {
    const raw = actor?.getFlag(MODULE_ID, DOWNTIME_FLAG);
    return {
      steps: { ...(raw?.steps ?? {}) },
      ...(raw?.casterList ? { casterList: raw.casterList } : {}),
    };
  }

  /** Write the whole cloned blob back — keys are slot keys, dot-free by design. */
  async _writeFlag(actor, next) {
    return actor.setFlag(MODULE_ID, DOWNTIME_FLAG, next);
  }

  // Resolution delegates. These MUST stay thin wrappers over the shared
  // downtime-session exports: the GM validates a pick with the same functions
  // this window renders it with, so a player can never be shown one DC or cost
  // and charged another.
  _mod(actor, key) { return abilityMod(actor, key); }
  _bestOf(actor, keys) { return bestOf(actor, keys); }

  /**
   * Resolve the actor's class once per render: the hit-die tier that gates
   * martial training and the spell list that gates magical research.
   * Never guesses — an unreadable class yields nulls and the UI says so.
   */
  async _classFacts(actor) {
    const facts = {
      hitDie: null, martialTier: null,
      castingAbility: null, casterList: null,
      classError: null,
    };
    if (!actor) return facts;
    let classItem = null;
    try {
      classItem = await actor.system?.getClass?.();
    } catch (err) {
      console.warn(`${MODULE_ID} | downtime: getClass() failed`, err);
      facts.classError = L("SDE.downtime.classError.loadFailed");
      return facts;
    }
    if (!classItem) {
      facts.classError = L("SDE.downtime.classError.noClass");
      return facts;
    }
    facts.hitDie = classItem.system?.hitPoints ?? null;
    facts.martialTier = facts.hitDie ? (martialTierForHitDie(facts.hitDie) ?? null) : null;
    if (!facts.martialTier) facts.classError = L("SDE.downtime.classError.noHitDie");
    facts.castingAbility = classItem.system?.spellcasting?.ability ?? null;
    facts.casterList = facts.castingAbility
      ? (casterListForAbility(facts.castingAbility) ?? null)
      : null;
    return facts;
  }

  // ─── Context ──────────────────────────────────────────────────────────────

  async _prepareContext() {
    // Western Reaches leads (user call: newer and broader than CS6) — it lists
    // first and wins the default whenever it is unlocked.
    const PREFERRED = "western-reaches";
    const slugs = Object.keys(SOURCES ?? {})
      .sort((a, b) => (a === PREFERRED ? -1 : b === PREFERRED ? 1 : 0));

    // A running session PINS the book — everyone at the table is doing downtime
    // out of the same one, and a player must not be able to shop a different
    // book's activities mid-session.
    if (DowntimeSession.active && DowntimeSession.source) {
      this._sourceSlug = DowntimeSession.source;
    } else if (!this._sourceSlug || !slugs.includes(this._sourceSlug)) {
      // Otherwise default to the first UNLOCKED book, else the first known one.
      this._sourceSlug = slugs.find(s => this._stored(s).ok) ?? slugs[0] ?? null;
    }

    const sources = slugs.map(slug => {
      const def = SOURCES[slug];
      const stored = this._stored(slug);
      return {
        slug,
        label: def?.label ?? slug,
        pages: def?.pages ?? "",
        authorityLabel: def?.authorityLabel ?? "",
        unlocked: stored.ok,
        stale: stored.stale,
        selected: slug === this._sourceSlug,
      };
    });

    const actors = this._playerActors();
    if (!this._actorId || !actors.some(a => a.id === this._actorId)) {
      this._actorId = actors[0]?.id ?? null;
    }
    const actor = this._actor();
    const facts = await this._classFacts(actor);
    this._cachedCastingAbility = facts.castingAbility;
    const flag = this._downtimeFlag(actor);
    const stored = this._sourceSlug ? this._stored(this._sourceSlug) : { ok: false, stale: false, slots: {} };
    const level = Number(actor?.system?.level?.value ?? 0);

    // CHA casters are ambiguous by the book; let the GM pin the list and
    // remember the choice on the actor.
    const casterAmbiguous = facts.casterList === "ambiguous";
    const activeCasterList = casterAmbiguous
      ? (flag.casterList ?? "arcane")
      : facts.casterList;

    // The skeleton is only ever shaped for an UNLOCKED source. A locked book
    // yields no activities at all — no labels, no DCs, no costs — because the
    // outline itself is a reading of the book's tables.
    const activities = stored.ok
      ? (DOWNTIME_SKELETON?.activities ?? []).map(activity =>
        this._activityContext(activity, {
          actor, facts, flag, stored, level, activeCasterList, casterAmbiguous,
        }),
      ).filter(Boolean)
      : [];

    // Partial unlock: report HOW MANY entries are missing, never WHICH — the
    // missing slots' labels are exactly what we must not reveal.
    const unlockedCount = Object.keys(stored.slots ?? {}).length;
    const missingCount = stored.ok ? Math.max(0, (EXPECTED_SLOT_COUNT ?? 0) - unlockedCount) : 0;

    const sess = DowntimeSession;
    const inSession = sess.active;
    const myPick = actor ? sess.pickFor(actor.id) : null;
    const myResult = actor ? sess.resultFor(actor.id) : null;
    const band = renownBand(actor?.system?.renown);

    return {
      // Which of the three faces this window is wearing.
      mode: !inSession ? "solo" : (this.isPlayerMode ? "player" : "gmSession"),
      isPlayer: this.isPlayerMode,
      inSession,
      soloMode: !inSession,

      hasSources: sources.length > 0,
      sources,
      lockedSources: this.isPlayerMode ? [] : sources.filter(s => !s.unlocked),
      staleSources: this.isPlayerMode ? [] : sources.filter(s => s.unlocked && s.stale),
      anyUnlocked: sources.some(s => s.unlocked),
      unlockedSources: sources.filter(s => s.unlocked),
      sourceLabel: sources.find(s => s.selected)?.label ?? "",
      sourceUnlocked: stored.ok,
      selectedSourceLocked: !stored.ok,
      selectedSource: sources.find(s => s.selected) ?? null,
      missingCount,
      isPartial: missingCount > 0,
      actors: actors.map(a => ({ id: a.id, name: a.name, selected: a.id === this._actorId })),
      hasActors: actors.length > 0,
      actorName: actor?.name ?? "",
      actorLevel: level,
      coins: actor?.system?.coins ?? { gp: 0, sp: 0, cp: 0 },
      // Renown, with the band it lands in. The purse strip is the only place
      // renown is already on screen, so the band and its meaning go here rather
      // than in a window of their own.
      renown: renownValue(actor?.system?.renown),
      renownBand: band.label,
      renownBandNote: band.note,
      renownBonus: band.bonus ? signed(band.bonus) : "",
      advModes: ADV_MODES.map(m => ({
        ...m,
        label: L(m.label),
        long: L(m.long),
        selected: m.key === (myPick?.advantage ?? this._advantage),
      })),
      activities,
      recruit: actor && sources.some(s => s.unlocked)
        ? await this._recruitContext(actor, { inSession, sess, myPick, myResult })
        : null,
      hasSteps: Object.values(flag.steps).some(v => Number(v) > 0),
      result: this._result,

      // ── Session ──
      session: inSession ? {
        phase: sess.phase,
        locked: sess.phase === "roll",
        sourceLabel: SOURCES?.[sess.source]?.label ?? sess.source,
        days: sess.days,
        pickCount: Object.keys(sess.picks).length,
        resultCount: Object.keys(sess.results).length,
      } : null,
      myPick: myPick ? this._pickView(myPick) : null,
      myResult: myResult ? this._resultView(myResult) : null,
      ...this._rollState({ actor, inSession, phase: sess.phase, myPick, myResult, level, source: sess.source }),
      overview: (inSession && !this.isPlayerMode) ? this._overview() : null,
    };
  }

  /**
   * The Recruit a warband section (#205): the settlement and what it supplies, the warbands this character
   * may try, and the ones they already command (their sheets are where retraining is). The GM works the
   * list out here; a player's is asked of the GM (see _offersFor).
   */
  async _recruitContext(actor, { inSession, sess, myPick, myResult }) {
    const activity = recruitActivity();
    const base = {
      name: activity.name,
      checkLabel: this._checkLabel(activity, { actor, facts: {}, activeCasterList: null }),
      statChip: abilityChipFor(activity, null),
      warbands: commandedWarbands(actor),
    };
    const view = game.user.isGM ? await recruitView(actor) : this._offersFor(actor);
    if (!view) return { ...base, loading: true };
    if (view.error) return { ...base, error: view.error };
    const { settlement } = view;
    return {
      ...base,
      settlementLine: settlement.line,
      // The GM's override: the party's hex, a settlement kind, or none.
      settlementOptions: game.user.isGM ? [
        { value: "", label: L("SDE.downtime.recruit.fromMap"), selected: !settlement.chosen },
        ...SETTLEMENT_KINDS.map(k => ({ value: k, label: L(`SDE.rulesData.settlement.${k}`), selected: settlement.chosen && settlement.kind === k })),
        { value: "none", label: L("SDE.downtime.recruit.noSettlement"), selected: settlement.chosen && settlement.kind === "none" },
      ] : null,
      blocked: view.blocked,
      none: !view.offers.length,
      offers: view.offers.map(o => {
        const key = recruitKey(o.id);
        return {
          ...o, key, inSession, statChip: base.statChip, chosen: !!myPick && myPick.slotKey === key,
          // The allowance is said once, above the list; a row says only what is its own.
          showReason: !!o.reason && !view.blocked,
          disabled: !!o.reason,
          pickDisabled: !!o.reason || sess.phase !== "select" || !!myResult,
        };
      }),
    };
  }

  /**
   * A player's offers: what was last asked of the GM, or nothing while the first answer is on its way.
   * Asking again when the character changes or something the list depends on does; the answer
   * re-renders the window, and the old list stays up until it comes.
   */
  _offersFor(actor) {
    const held = this._offers?.actorId === actor.id ? this._offers : null;
    if (!held || held.stale) this._askOffers(actor.id);
    return held?.view ?? null;
  }

  async _askOffers(actorId) {
    // Marked fresh at once, so the render that follows the answer doesn't ask again.
    const view = this._offers?.actorId === actorId ? this._offers.view : null;
    this._offers = { actorId, view, stale: false };
    const reply = await queryActiveGM(DOWNTIME_QUERY, { action: ACTIONS.OFFERS, actorId }, { label: L(DOWNTIME_RELAY_LABEL) });
    if (this._offers?.actorId !== actorId) return;
    this._offers = { actorId, view: reply?.ok ? reply : { error: reply?.error ?? "" }, stale: false };
    if (this.rendered) this.render();
  }

  /** What the list depends on has changed: ask again at the next render. */
  _staleOffers() {
    if (this._offers) this._offers.stale = true;
  }

  /**
   * Whether the Roll button is live, and if not, why.
   *
   * An unaffordable fee disables the button and states the shortfall, rather
   * than letting the click through to a roll the GM will refuse — the same
   * greyed-plus-reason treatment the effect-choice options use.
   */
  _rollState({ actor, inSession, phase, myPick, myResult, level, source }) {
    const base = !!(inSession && phase === "roll" && myPick && !myResult);
    if (!base || !actor) return { canRoll: base, rollBlockedReason: null };
    const found = foundFor(myPick);
    if (!found) return { canRoll: false, rollBlockedReason: L("SDE.downtime.error.activityGone") };
    const money = affordability(actor, source, found.slot, level);
    if (money.affordable) return { canRoll: true, rollBlockedReason: null };
    return {
      canRoll: false,
      rollBlockedReason:
        L("SDE.downtime.money.costsShort", { cost: money.cost, short: money.shortfallText }),
    };
  }

  /** A pick rendered for the "you chose X" strip. */
  _pickView(pick) {
    const found = foundFor(pick);
    return {
      slotKey: pick.slotKey,
      label: found?.slot?.label ?? pick.slotKey,
      activityName: found?.activity?.name ?? "",
      advantage: L(advMode(pick.advantage).label),
      advKey: advMode(pick.advantage).key,
    };
  }

  /** A settled result, plus the pending-choice picker when one is owed. */
  _resultView(result) {
    const found = foundFor(result);
    return {
      slotKey: result.slotKey,
      label: found?.slot?.label ?? result.slotKey,
      activityName: found?.activity?.name ?? "",
      total: result.total,
      dc: result.dc,
      success: !!result.success,
      cost: result.cost ?? 0,
      nextDC: result.nextDC,
      effectSummary: result.effect?.pending ? null : (result.effect?.summary ?? null),
      pendingChoice: result.effect?.pending ? {
        prompt: result.effect.prompt ?? L("SDE.downtime.chooseOne"),
        options: result.effect.options ?? [],
        // Martial training records a descriptive Talent, so the indexed gear
        // list is a shortlist rather than the rules. Dropping this flag here is
        // what used to strand a paid success whose weapon wasn't in a pack.
        freeText: !!result.effect.freeText,
      } : null,
    };
  }

  /** GM control panel: every party character and where they are in the flow. */
  _overview() {
    const sess = DowntimeSession;
    return this._playerActors().map(a => {
      const pick = sess.pickFor(a.id);
      const res = sess.resultFor(a.id);
      return {
        actorId: a.id,
        name: a.name,
        picked: !!pick,
        pickLabel: pick ? (foundFor(pick)?.slot?.label ?? pick.slotKey) : null,
        advantage: pick ? L(advMode(pick.advantage).label) : null,
        rolled: !!res,
        total: res?.total ?? null,
        dc: res?.dc ?? null,
        success: res?.success ?? null,
        awaitingChoice: !!res?.effect?.pending,
      };
    });
  }

  /** Shape one activity + its visible slots for the template. */
  _activityContext(activity, ctx) {
    const { actor, facts, flag, stored, level, activeCasterList, casterAmbiguous } = ctx;
    const gate = activity.gate ?? null;
    const allSlots = activity.slots ?? [];
    let gateNote = null;
    let gateBlocked = false;
    let choice = null;
    let tierPicker = null;

    /**
     * Slot buckets. Most activities are one unlabelled bucket. The two gated
     * ones split:
     *   • martial training → the tier the user is LOOKING at (dropdown)
     *   • magical research → BOTH caster lists as labelled subsections, the
     *     way the book prints them, with the inapplicable one disabled.
     * `enabled:false` means "visible, controls dead, reason shown" — never
     * hidden, so a player can read what the other half of the page offers.
     */
    let buckets = [{ key: null, label: null, enabled: true, reason: null, slots: allSlots }];

    if (gate?.kind === "hitDie") {
      // Delegated like every other resolution rule: the window renders the tier
      // gate from the same helper the GM validates a pick with. An unreadable
      // hit die yields all three tiers, dead — never an empty bucket, which
      // would drop the activity at the `!groups.length` check below.
      const tier = martialTierBuckets(activity, {
        facts,
        casterList: activeCasterList,
        isGM: !!game.user.isGM,
        viewingTier: this._martialTier,
        actorName: actor?.name ?? null,
      });
      ({ buckets, tierPicker, gateNote, gateBlocked } = tier);
    } else if (gate?.kind === "spellcaster") {
      if (!actor?.system?.isSpellCaster) return null;
      const lists = gate.lists ?? ["arcane", "divine"];
      if (!activeCasterList || activeCasterList === "ambiguous") {
        gateNote = L("SDE.downtime.gate.casterListUnknown");
        gateBlocked = true;
      }
      buckets = lists.map(list => {
        const listSlots = allSlots.filter(s => !s.list || s.list === list);
        // Same shared-legality rule as the tier buckets: ask slotAllowed about
        // a representative row, with the character's active list.
        const legal = listSlots.length
          ? slotAllowed(activity, listSlots[0], { facts, casterList: activeCasterList })
          : false;
        return {
          key: list,
          label: CASTER_LIST_LABELS[list] ?? list,
          enabled: !gateBlocked && legal,
          reason: (!gateBlocked && !legal)
            ? L("SDE.downtime.gate.castsFrom", {
              name: actor?.name ?? L("SDE.downtime.thisCharacter"), list: activeCasterList,
            })
            : null,
          slots: listSlots,
        };
      });
    }

    if (activity.check?.kind === "choice") {
      const abilities = activity.check.abilities ?? [];
      const best = this._bestOf(actor, abilities);
      const active = abilities.includes(this._choiceAbility) ? this._choiceAbility : best.ability;
      choice = {
        activityKey: activity.key,
        options: abilities.map(a => ({
          key: a,
          label: `${a.toUpperCase()} ${signed(this._mod(actor, a))}`,
          selected: a === active,
        })),
      };
    }

    // ONLY slots whose text the GM actually unlocked become rows. A slot with
    // no stored text is dropped entirely rather than greyed out: rendering its
    // label + DC would publish the very outline we don't ship.
    const sess = DowntimeSession;
    const inSession = sess.active;
    const myPick = actor ? sess.pickFor(actor.id) : null;
    const myResult = actor ? sess.resultFor(actor.id) : null;
    const isGM = !!game.user.isGM;

    const buildRow = (slot, bucket) => {
      const text = stored.slots?.[slot.key] ?? "";
      if (!text) return [];
      const steps = Number(flag.steps?.[slot.key] ?? 0);
      const dc = this._effectiveDC(slot, flag.steps);
      const cost = this._cost(slot, level);
      const dead = gateBlocked || !actor || !bucket.enabled;
      // You can't CHOOSE what you can't pay for. The fee is per attempt, so an
      // unaffordable activity is not an option at all — blocking it only at the
      // roll let a player commit to a plan they could never execute. Free slots
      // are never blocked. The roll-time guard stays too: coins move.
      const money = actor ? affordability(actor, this._sourceSlug, slot, level) : null;
      const tooPoor = !!money && !money.affordable;
      return [{
        key: slot.key,
        activityKey: activity.key,
        label: slot.label ?? slot.key,
        dc,
        baseDc: slot.dc,
        stepped: steps > 0 && dc !== slot.dc,
        // Per-row ability chip: the section header can't speak for skulduggery,
        // which mixes CHA and DEX rows in one activity.
        statChip: abilityChipFor(activity, slot),
        costLabel: cost > 0 ? `${cost} gp` : "",
        disabled: dead || tooPoor,
        // A gate reason (wrong tier / wrong list) outranks the money one: it is
        // the more fundamental block, and both can be true at once.
        rowReason: bucket.reason
          ?? (tooPoor ? L("SDE.downtime.money.costsShort", { cost: money.cost, short: money.shortfallText }) : null),
        unaffordable: tooPoor,
        outcome: text,
        inSession,
        chosen: !!myPick && myPick.slotKey === slot.key,
        pickDisabled: dead || tooPoor || sess.phase !== "select" || !!myResult,
        // Manual DC ladder control (GM only). Bounds mirror the automatic
        // walk: 0 .. ladderIndex(baseDc).
        steps,
        canStepDown: isGM && steps < clampSteps(slot, Number.MAX_SAFE_INTEGER),
        canStepUp: isGM && steps > 0,
      }];
    };

    const groups = buckets.map(b => ({
      key: b.key,
      label: b.label,
      enabled: b.enabled,
      reason: b.reason,
      slots: b.slots.flatMap(s => buildRow(s, b)),
    })).filter(g => g.slots.length);

    // An activity with nothing unlocked is not rendered at all.
    if (!groups.length) return null;

    return {
      key: activity.key,
      name: activity.name,
      checkLabel: this._checkLabel(activity, { actor, facts, activeCasterList }),
      gateNote,
      showStepper: isGM,
      tierPicker,
      casterToggle: gate?.kind === "spellcaster" && casterAmbiguous
        ? {
          arcane: activeCasterList === "arcane",
          divine: activeCasterList === "divine",
        }
        : null,
      choice,
      groups,
      multiGroup: groups.length > 1,
    };
  }

  /**
   * Manual DC ladder adjustment (GM only). `dcDelta` −1 lowers the DC (one more
   * step of credit), +1 raises it back. Clamped through the same bound the
   * automatic failure walk uses, so a hand-set value can never leave the ladder.
   */
  async _onAdjustStep(event, target) {
    if (!game.user.isGM) return;
    const actor = this._actor();
    const slotKey = target?.dataset?.slotKey;
    const dcDelta = Number(target?.dataset?.dcDelta) || 0;
    if (!actor || !slotKey || !dcDelta) return;
    const found = slotByKey(slotKey);
    if (!found) return;
    const flag = downtimeFlag(actor);
    const current = Number(flag.steps?.[slotKey] ?? 0);
    const next = clampSteps(found.slot, current + (dcDelta < 0 ? 1 : -1));
    if (next === current) return;
    await this._writeFlag(actor, { ...flag, steps: { ...flag.steps, [slotKey]: next } });
    this.render();
  }

  /** "WIS +2" / "CHA +1 or DEX +3" / "INT +2 (spellcasting)". */
  _checkLabel(activity, { actor, facts, activeCasterList }) {
    const check = activity.check ?? {};
    const one = (a) => `${String(a).toUpperCase()} ${signed(this._mod(actor, a))}`;
    if (check.kind === "ability") return (check.abilities ?? []).map(one).join(" / ");
    if (check.kind === "choice") return (check.abilities ?? []).map(one).join(` ${L("SDE.downtime.check.or")} `);
    if (check.kind === "grouped") {
      return (check.groups ?? [])
        .map(g => (g.abilities ?? []).map(one).join("/"))
        .join(" · ");
    }
    if (check.kind === "spellcasting") {
      if (!facts.castingAbility) return L("SDE.downtime.check.spellAbilityUnknown");
      const list = activeCasterList && activeCasterList !== "ambiguous" ? ` · ${activeCasterList}` : "";
      return `${one(facts.castingAbility)}${list}`;
    }
    return "";
  }

  /**
   * effectiveDC for a slot. The app carries progress as a MAP (that's the flag
   * shape); downtime-core takes a scalar step COUNT — index at the boundary,
   * here, so no call site has to remember which is which.
   */
  _effectiveDC(slot, steps) {
    try {
      const dc = effectiveDC(slot, this._stepsFor(slot, steps));
      return Number.isFinite(dc) ? dc : slot.dc;
    } catch (err) {
      console.warn(`${MODULE_ID} | downtime: effectiveDC failed for "${slot?.key}"`, err);
      return slot?.dc;
    }
  }

  /** Step count for one slot out of the per-actor steps map. */
  _stepsFor(slot, steps) {
    return Math.max(0, Number(steps?.[slot?.key] ?? 0) || 0);
  }

  _cost(slot, level) { return costFor(this._sourceSlug, slot, level); }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Kept out of _onRender so a re-render can't re-subscribe: the settings hook
   * itself triggers renders, and a duplicate subscription would compound.
   */
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this._updateHookId = Hooks.on("updateSetting", (setting) => {
      if (setting?.key === `${MODULE_ID}.${SETTLEMENT_SETTING}`) this._staleOffers();
      const ours = [`${MODULE_ID}.downtimeContent`, `${MODULE_ID}.${SETTLEMENT_SETTING}`, `${MODULE_ID}.rulesData`];
      if (ours.includes(setting?.key) && this.rendered) this.render();
    });
    // Session changes arrive as a payload-free nudge → DowntimeSession re-reads
    // the setting and fires this hook. Every open window (GM's and each
    // player's) re-renders off the same authoritative state.
    this._sessionHookId = Hooks.on(DowntimeSession.HOOK_CHANGED, () => {
      // A recruit made under the session changes what a character may take next.
      this._staleOffers();
      if (this.rendered) this.render();
    });
    // Coins decide whether Roll is live, so a purse change has to refresh the
    // button. Deliberately narrow: only the SELECTED actor, and only when the
    // update actually touched coins — a broad updateActor listener would
    // re-render this window on every HP tick in the party.
    this._actorHookId = Hooks.on("updateActor", (actor, changes) => {
      if (!this.rendered || actor?.id !== this._actorId) return;
      if (!foundry.utils.hasProperty(changes, "system.coins")) return;
      this.render();
    });
  }

  async close(options = {}) {
    if (this._updateHookId != null) {
      Hooks.off("updateSetting", this._updateHookId);
      this._updateHookId = null;
    }
    if (this._sessionHookId != null) {
      Hooks.off(DowntimeSession.HOOK_CHANGED, this._sessionHookId);
      this._sessionHookId = null;
    }
    if (this._actorHookId != null) {
      Hooks.off("updateActor", this._actorHookId);
      this._actorHookId = null;
    }
    if (DowntimeApp._instance === this) DowntimeApp._instance = null;
    return super.close(options);
  }

  /** Selects are change-wired; buttons go through the action map. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!root) return;

    const on = (sel, ev, fn) => root.querySelector(sel)?.addEventListener(ev, fn);

    // Accordions: the template opens the first one; after that the player's own open/closed choice survives re-renders.
    this._openActivities ??= null;
    for (const d of root.querySelectorAll("details[data-activity]")) {
      if (this._openActivities) d.open = this._openActivities.has(d.dataset.activity);
      d.addEventListener("toggle", () => {
        this._openActivities = new Set(
          [...root.querySelectorAll("details[data-activity][open]")].map(el => el.dataset.activity));
      });
    }

    on("[data-field='source']", "change", (e) => {
      this._sourceSlug = e.target.value;
      this._result = null;
      this.render();
    });
    on("[data-field='actor']", "change", (e) => {
      this._actorId = e.target.value;
      this._choiceAbility = null;
      this._result = null;
      this._offers = null;
      this.render();
    });
    on("[data-field='advantage']", "change", (e) => {
      this._advantage = e.target.value;
    });
    on("[data-field='choiceAbility']", "change", (e) => {
      this._choiceAbility = e.target.value;
      this.render();
    });
    on("[data-field='martialTier']", "change", (e) => {
      this._martialTier = e.target.value;
      this.render();
    });
    on("[data-field='settlement']", "change", (e) => {
      game.settings.set(MODULE_ID, SETTLEMENT_SETTING, e.target.value)
        .catch((err) => console.warn(`${MODULE_ID} | downtime: settlement`, err));
    });
    on("[data-field='renownTarget']", "change", (e) => {
      if (this._result) this._result.targetActorId = e.target.value;
    });
  }

  // ─── Attempt ──────────────────────────────────────────────────────────────

  async _onAttempt(event, target) {
    const slotKey = target?.dataset?.slotKey;
    const activityKey = target?.dataset?.activityKey;
    const actor = this._actor();
    if (!actor) return ui.notifications.warn(L("SDE.downtime.notify.pickCharacter"));

    const found = this._lookupSlot(activityKey, slotKey);
    if (!found) return ui.notifications.warn(L("SDE.downtime.notify.slotGone"));
    const { activity, slot } = found;

    const stored = this._stored(this._sourceSlug);
    const outcomeText = stored.slots?.[slot.key] ?? "";
    if (!outcomeText) {
      return ui.notifications.warn(L("SDE.downtime.notify.notUnlocked", { slot: slot.label, source: this._sourceSlug }));
    }

    // The GM is bound by the fee too — running the attempt for a character who
    // can't pay would charge coins they don't have. The escape hatch is the
    // character sheet, not an override here.
    {
      const money = affordability(actor, this._sourceSlug, slot,
        Number(actor.system?.level?.value ?? 0));
      if (!money.affordable) {
        return ui.notifications.warn(L("SDE.downtime.notify.cantAffordFee", {
          name: actor.name, cost: money.cost, slot: slot.label, short: money.shortfallText,
        }));
      }
    }

    const flag = this._downtimeFlag(actor);
    const level = Number(actor.system?.level?.value ?? 0);
    const dc = this._effectiveDC(slot, flag.steps);
    const cost = this._cost(slot, level);

    // RAW: the fee is paid per attempt, win or lose. Debit BEFORE the roll so a
    // failed check can never leave the character un-charged.
    if (cost > 0) {
      const price = { gp: cost, sp: 0, cp: 0 };
      if (!canAfford(actor.system.coins, price)) {
        return ui.notifications.warn(L("SDE.downtime.notify.cantAfford", { name: actor.name, cost, slot: slot.label }));
      }
      const remaining = spendFromPurse(actor.system.coins, toCopper(price));
      await actor.update({
        "system.coins.gp": remaining.gp,
        "system.coins.sp": remaining.sp,
        "system.coins.cp": remaining.cp,
      });
      // Mirror into the session recap (self-guards on an active session).
      SessionRecap.logPurchase({
        player: actor.name,
        item: `Downtime: ${slot.label}`,
        qty: 1,
        price,
      });
    }

    const { ability, mod, library } = this._modFor(activity, slot, actor);
    const modeDef = ADV_MODES.find(m => m.key === this._advantage) ?? ADV_MODES[1];
    const mode = { ...modeDef, label: L(modeDef.label) };
    const formula = `${mode.dice} ${mod < 0 ? "-" : "+"} ${Math.abs(mod)}`;
    const roll = await new Roll(formula).evaluate();
    const total = roll.total;
    const success = total >= dc;

    // Success clears the ladder progress; failure walks it one rung down.
    const steps = { ...flag.steps };
    if (success) steps[slot.key] = 0;
    else steps[slot.key] = Number(this._nextSteps(slot, flag.steps)) || 0;
    await this._writeFlag(actor, { ...flag, steps });

    const nextDC = success ? slot.dc : this._effectiveDC(slot, steps);

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<strong>${L("SDE.downtime.card.flavor", { activity: esc(activity.name), slot: esc(slot.label), dc })}</strong>`,
      content: this._cardHtml({
        activity, slot, actor, ability, mod, library, mode, total, dc, success,
        cost, outcomeText, nextDC,
      }),
      flags: { [MODULE_ID]: { downtimeCard: true, slotKey: slot.key } },
    });

    this._result = success
      ? {
        slotKey: slot.key,
        activityName: activity.name,
        label: slot.label,
        total, dc, success: true,
        outcome: outcomeText,
        // A signed slot (the rumor) carries renownDelta too, but its sign is
        // the table's call — offer the ±1 pair INSTEAD of a plain Apply, never
        // both, or the GM can bank the renown twice.
        renownDelta: slot.renownSigned ? null : (slot.renownDelta ?? null),
        renownSigned: !!slot.renownSigned,
        xpDelta: slot.xpDelta ?? null,
        targetActorId: this._actorId,
        targets: this._playerActors().map(a => ({
          id: a.id, name: a.name, selected: a.id === this._actorId,
        })),
        applied: false,
      }
      : {
        slotKey: slot.key,
        activityName: activity.name,
        label: slot.label,
        total, dc, success: false,
        nextDC,
        applied: false,
      };

    // GM solo attempts are resolutions too — same log, same shape. Guarded, so
    // a logger problem can't undo a paid attempt.
    await recordDowntimeSafe({
      actorId: actor.id,
      actorName: actor.name,
      player: game.user.name,
      sourceSlug: this._sourceSlug,
      slotKey: slot.key,
      slotLabel: slot.label,
      activityKey: activity.key,
      activityName: activity.name,
      total, dc, success,
      costGp: cost,
      // The solo path applies renown/XP from the result panel afterwards, so
      // there is no effect summary at resolution time.
      effectSummary: null,
      gmRolled: true,
      timestamp: new Date().toISOString(),
    });

    this.render();
  }

  /**
   * The GM's solo recruit (#205): the same check a session pick goes through, then the die, then the
   * warband on a success, logged like any attempt. A session's players recruit through their picks.
   */
  async _onRecruit(event, target) {
    if (!game.user.isGM) return;
    const actor = this._actor();
    if (!actor) return ui.notifications.warn(L("SDE.downtime.notify.pickCharacter"));
    const check = await checkRecruit(actor, target?.dataset?.warbandId);
    if (!check.ok) return ui.notifications.warn(check.error);
    const activity = recruitActivity();
    const slot = recruitSlot(check.offer);
    const { ability, mod } = this._modFor(activity, slot, actor);
    const modeDef = ADV_MODES.find(m => m.key === this._advantage) ?? ADV_MODES[1];
    const mode = { ...modeDef, label: L(modeDef.label) };
    const roll = await new Roll(`${mode.dice} ${mod < 0 ? "-" : "+"} ${Math.abs(mod)}`).evaluate();
    const { total } = roll;
    const dc = slot.dc;
    const success = total >= dc;
    let summary = "";
    if (success) {
      try {
        const out = await recruitWarband(actor, check.offer.id);
        summary = out.ok ? out.summary : out.error;
      } catch (err) {
        console.warn(`${MODULE_ID} | downtime: recruiting "${check.offer.name}" failed`, err);
        summary = L("SDE.downtime.effect.couldNotApply");
      }
    }
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<strong>${L("SDE.downtime.card.flavor", { activity: esc(activity.name), slot: esc(slot.label), dc })}</strong>`,
      content: this._cardHtml({
        activity, slot, actor, ability, mod, mode, total, dc, success, cost: 0, outcomeText: summary, nextDC: null,
      }),
      flags: { [MODULE_ID]: { downtimeCard: true, slotKey: slot.key } },
    });
    this._result = { slotKey: slot.key, activityName: activity.name, label: slot.label, total, dc, success, outcome: summary, applied: true };
    await recordDowntimeSafe({
      actorId: actor.id, actorName: actor.name, player: game.user.name,
      sourceSlug: this._sourceSlug, slotKey: slot.key, slotLabel: slot.label,
      activityKey: activity.key, activityName: activity.name,
      total, dc, success, costGp: 0, effectSummary: summary || null,
      gmRolled: true, timestamp: new Date().toISOString(),
    });
    this.render();
  }

  /** Open a warband's sheet: its Warband tab is where its upgrades are changed, which is retraining. */
  _onOpenWarband(event, target) {
    game.actors.get(target?.dataset?.warbandId)?.sheet?.render(true);
  }

  /** Find {activity, slot} without trusting the DOM's activity key alone. */
  _lookupSlot(activityKey, slotKey) {
    const activity = (DOWNTIME_SKELETON?.activities ?? []).find(a => a.key === activityKey);
    const slot = activity?.slots?.find(s => s.key === slotKey);
    if (activity && slot) return { activity, slot };
    try {
      const viaCore = slotByKey(slotKey);
      if (viaCore?.activity && viaCore?.slot) return viaCore;
    } catch (err) {
      console.warn(`${MODULE_ID} | downtime: slotByKey failed for "${slotKey}"`, err);
    }
    return null;
  }

  /** Next step count for this slot after a failure (map in, scalar out). */
  _nextSteps(slot, steps) {
    try {
      return nextStepsOnFailure(slot, this._stepsFor(slot, steps));
    } catch (err) {
      console.warn(`${MODULE_ID} | downtime: nextStepsOnFailure failed for "${slot?.key}"`, err);
      return 0;
    }
  }

  /** The ability + modifier this slot's check rolls against, with a Bastion Library's bonus on learning activities. */
  _modFor(activity, slot, actor) {
    return withLibrary(this._baseModFor(activity, slot, actor), activity, actor);
  }

  _baseModFor(activity, slot, actor) {
    const check = activity.check ?? {};
    if (check.kind === "ability") return this._bestOf(actor, check.abilities);
    if (check.kind === "choice") {
      const abilities = check.abilities ?? [];
      const picked = abilities.includes(this._choiceAbility)
        ? this._choiceAbility
        : this._bestOf(actor, abilities).ability;
      return { ability: picked, mod: this._mod(actor, picked) };
    }
    if (check.kind === "grouped") {
      const group = (check.groups ?? []).find(g => g.id === slot.group)
        ?? (check.groups ?? [])[0];
      return this._bestOf(actor, group?.abilities);
    }
    if (check.kind === "spellcasting") {
      // Resolved synchronously off the already-derived spellcasting data so the
      // attempt doesn't need a second async class load.
      const ability = this._castingAbilityOf(actor);
      return ability ? { ability, mod: this._mod(actor, ability) } : { ability: null, mod: 0 };
    }
    return { ability: null, mod: 0 };
  }

  /**
   * Casting ability without re-awaiting getClass(): the class item is already
   * in the actor's own items when it was granted by the builder; fall back to
   * the system's itemAbility override.
   */
  _castingAbilityOf(actor) {
    const override = actor?.system?.spellcasting?.itemAbility;
    if (override) return override;
    const classItem = actor?.items?.find(i => i.type === "Class" && i.system?.spellcasting?.ability);
    if (classItem) return classItem.system.spellcasting.ability;
    return this._cachedCastingAbility ?? null;
  }

  /** Chat card body. Every stored/pasted string is escaped here. */
  _cardHtml({ activity, slot, actor, ability, mod, library = 0, mode, total, dc, success, cost, outcomeText, nextDC }) {
    const abilityLabel = ability ? String(ability).toUpperCase() : "—";
    const modeNote = (mode.key === "normal" ? "" : ` · ${esc(mode.label)}`) + (library ? ` · ${L("SDE.bastion.library.note", { bonus: library })}` : "");
    const costLine = cost > 0
      ? `<div class="sde-dt-line"><i class="fas fa-coins"></i> ${L("SDE.downtime.card.paid", { cost })}</div>`
      : "";
    const body = success
      ? `<div class="sde-dt-outcome">${esc(outcomeText)}</div>`
      : (nextDC ? `<div class="sde-dt-line">${L("SDE.downtime.card.nextAttempt", { dc: nextDC })}</div>` : "");
    return `
      <div class="sde-downtime-card ${success ? "sde-dt-success" : "sde-dt-failure"}">
        <header class="sde-dt-head">
          <i class="fas fa-mug-hot"></i> ${esc(activity.name)}
          <span class="sde-dt-slot">${esc(slot.label)}</span>
        </header>
        <div class="sde-dt-check">
          ${esc(actor.name)} · ${abilityLabel} ${signed(mod)}${modeNote}
        </div>
        <div class="sde-dt-total">
          <span class="sde-dt-num">${total}</span>
          <span class="sde-dt-vs">${L("SDE.downtime.card.vsDc", { dc })}</span>
          <span class="sde-dt-verdict">${success ? L("SDE.downtime.card.success") : L("SDE.downtime.card.failure")}</span>
        </div>
        ${costLine}
        ${body}
        <footer class="sde-dt-foot">${L("SDE.downtime.card.noLuck")}</footer>
      </div>`;
  }

  // ─── Result-area follow-ups ───────────────────────────────────────────────

  async _onApplyRenown() {
    const r = this._result;
    const actor = this._actor();
    if (!r || !actor || r.renownDelta == null) return;
    await this._bumpRenown(actor, Number(r.renownDelta) || 0);
    r.applied = true;
    this.render();
  }

  async _onApplyRenownSigned(event, target) {
    const r = this._result;
    if (!r) return;
    const sign = target?.dataset?.sign === "-" ? -1 : 1;
    const actor = game.actors.get(r.targetActorId) ?? this._actor();
    if (!actor) return ui.notifications.warn(L("SDE.downtime.notify.pickRumorTarget"));
    await this._bumpRenown(actor, sign);
    r.applied = true;
    this.render();
  }

  /**
   * Solo-mode renown apply. Routed through renown.mjs's single write path so a
   * change made here is logged the same as one made by a session roll, a
   * level-up or the GM's own award dialog. `chat: false` — the downtime result
   * card is already on screen.
   */
  async _bumpRenown(actor, delta) {
    const result = await Renown.award({
      actor, delta, source: "downtime", chat: false,
      reason: "Downtime",
    });
    if (!result.ok) {
      ui.notifications.warn(result.error ?? L("SDE.downtime.renownFailed"));
      return;
    }
    ui.notifications.info(L("SDE.downtime.renownChanged", { name: actor.name, delta: signed(delta), after: result.after }));
  }

  async _onApplyXp() {
    const r = this._result;
    const actor = this._actor();
    if (!r || !actor || r.xpDelta == null) return;
    const delta = Number(r.xpDelta) || 0;
    const next = Number(actor.system?.level?.xp ?? 0) + delta;
    await actor.update({ "system.level.xp": next });
    ui.notifications.info(L("SDE.downtime.xpChanged", { name: actor.name, delta: signed(delta), next }));
    r.applied = true;
    this.render();
  }

  _onDismissResult() {
    this._result = null;
    this.render();
  }

  async _onSetCasterList(event, target) {
    const actor = this._actor();
    if (!actor) return;
    const list = target?.dataset?.list === "divine" ? "divine" : "arcane";
    const flag = this._downtimeFlag(actor);
    await this._writeFlag(actor, { ...flag, casterList: list });
    this.render();
  }

  /** GM utility: wipe the failed-attempt DC ladder for this character. */
  async _onClearSteps() {
    // GM-only, matching the per-slot steppers. The button is already hidden on
    // player windows; this guards a hand-fired action.
    if (!game.user.isGM) {
      ui.notifications.warn(L("SDE.downtime.notify.clearGmOnly"));
      return;
    }
    const actor = this._actor();
    if (!actor) return;
    const flag = this._downtimeFlag(actor);
    await this._writeFlag(actor, { ...flag, steps: {} });
    ui.notifications.info(L("SDE.downtime.notify.cleared", { name: actor.name }));
    this.render();
  }

  // ─── Session flow — player side ───────────────────────────────────────────

  /**
   * Send one player action to the GM and surface the verdict.
   *
   * A GM driving their own window is already the authority, so it runs the
   * handler in-process (passing their own User document as the requester — the
   * handler authorizes it exactly like anyone else's). A player goes over the
   * authenticated query channel, which carries their identity as the SERVER
   * sees it. Either way the reply is `{ok, error?}` and a refusal is shown.
   */
  async _sendDowntime(data) {
    // `handleQuery` does its own `_enqueue`, so this must NOT wrap it in
    // another one: the inner call would chain onto the outer's own promise and
    // wait for itself.
    const reply = game.user.isGM
      ? await DowntimeSession.handleQuery(data, game.user)
      : await queryActiveGM(DOWNTIME_QUERY, data, { label: L(DOWNTIME_RELAY_LABEL) });
    if (!reply?.ok && reply?.error) ui.notifications.warn(reply.error);
    return reply ?? { ok: false };
  }

  /**
   * Declare a pick. The payload carries ONLY ids plus the declared
   * ability/advantage — never an identity. The GM recomputes DC, cost and
   * gating in DowntimeSession.context() and derives the requester from the
   * authenticated query context.
   */
  async _onPickSlot(event, target) {
    const actor = this._actor();
    if (!actor) return ui.notifications.warn(L("SDE.downtime.notify.pickCharacter"));
    const slotKey = target?.dataset?.slotKey;
    if (!slotKey) return;
    if (DowntimeSession.phase !== "select") {
      return ui.notifications.warn(L("SDE.downtime.notify.picksLocked"));
    }
    // Same gate as the button state, re-read live — a force-enabled button must
    // not get a pick past. The GM validates this again on arrival.
    const found = slotByKey(slotKey);
    if (found) {
      const money = affordability(actor, DowntimeSession.source, found.slot,
        Number(actor.system?.level?.value ?? 0));
      if (!money.affordable) {
        return ui.notifications.warn(L("SDE.downtime.notify.cantChoose", {
          slot: found.slot.label, cost: money.cost, name: actor.name, short: money.shortfallText,
        }));
      }
    }
    await this._sendDowntime({
      action: ACTIONS.PICK,
      actorId: actor.id,
      slotKey,
      ability: this._choiceAbility ?? null,
      advantage: this._advantage,
    });
    this.render();
  }

  /**
   * THE PLAYER PRESSES THE DIE. The roll runs on this client so the dice — and
   * Dice So Nice, if they have it — are theirs. Only the message id travels;
   * the GM reads the total back off the ChatMessage document.
   *
   * The message is stamped with this attempt's capability
   * ({actorId, slotKey, nonce}) before it leaves. Without that stamp the GM has
   * no way to tell a downtime roll from any other d20 the player once made, and
   * a replayed message id settles the attempt — which is exactly what it used
   * to do.
   */
  async _onRollPick() {
    const actor = this._actor();
    if (!actor) return;
    const sess = DowntimeSession;
    if (sess.phase !== "roll") return ui.notifications.warn(L("SDE.downtime.notify.diceLocked"));
    const pick = sess.pickFor(actor.id);
    if (!pick) return ui.notifications.warn(L("SDE.downtime.error.noPick"));
    if (sess.resultFor(actor.id)) return ui.notifications.warn(L("SDE.downtime.notify.alreadyRolled"));
    if (!pick.nonce) {
      return ui.notifications.warn(L("SDE.downtime.notify.pickPredates"));
    }

    const found = foundFor(pick);
    if (!found) return ui.notifications.warn(L("SDE.downtime.error.activityGone"));

    // PAY BEFORE YOU ROLL. RAW charges per attempt, so an unaffordable attempt
    // isn't an attempt at all — bail out BEFORE the dice exist. Rolling first
    // and letting the GM refuse produced real dice in chat with no outcome,
    // which reads as the feature being broken. Coins are re-read live here, not
    // taken from the render context, so a stale window can't sneak a roll past.
    const money = affordability(actor, DowntimeSession.source, found.slot,
      Number(actor.system?.level?.value ?? 0));
    if (!money.affordable) {
      return ui.notifications.warn(L("SDE.downtime.notify.noFeeNoRoll", {
        slot: found.slot.label, cost: money.cost, name: actor.name, short: money.shortfallText,
      }));
    }

    const facts = await classFacts(actor);
    const { ability, mod, library } = modForCheck(found.activity, found.slot, actor, {
      facts, choiceAbility: pick.ability,
    });
    const mode = advMode(pick.advantage);
    const formula = `${mode.dice} ${mod < 0 ? "-" : "+"} ${Math.abs(mod)}`;
    const flag = downtimeFlag(actor);
    const dc = effDC(found.slot, flag.steps);

    const roll = await new Roll(formula).evaluate();
    const msg = await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<strong>${L("SDE.downtime.card.flavor", { activity: esc(found.activity.name), slot: esc(found.slot.label), dc })}</strong>`
        + `<br><span class="sde-dt-check">${ability ? String(ability).toUpperCase() : "—"} ${signed(mod)}`
        + `${mode.key === "normal" ? "" : ` · ${esc(L(mode.label))}`}${library ? ` · ${L("SDE.bastion.library.note", { bonus: library })}` : ""}</span>`,
      flags: {
        [MODULE_ID]: {
          [ROLL_FLAG]: { actorId: actor.id, slotKey: pick.slotKey, nonce: pick.nonce },
        },
      },
    });

    // The dice have already landed in chat by this point, so a blocked relay
    // still renders: the warning explains why the result panel stays empty,
    // and the GM can resolve this roll by hand from the message once reloaded.
    await this._sendDowntime({
      action: ACTIONS.ROLLED,
      actorId: actor.id, slotKey: pick.slotKey,
      messageId: msg?.id,
    });
    this.render();
  }

  /**
   * Resolve a pending effect choice (weapon, spell trade, potion, curse…).
   *
   * `choice` travels as an OBJECT — downtime-effects reads `choice?.id`,
   * `choice?.gain`, `choice?.name`. A spell trade needs a second selection
   * (which replacement), carried as `gainSpellUuid` off the same button.
   */
  async _onChooseEffect(event, target) {
    const actor = this._actor();
    const id = target?.dataset?.choice;
    if (!actor || !id) return;
    const res = DowntimeSession.resultFor(actor.id);
    if (!res?.effect?.pending) return;
    const gainSpellUuid = target?.dataset?.gain || null;
    await this._sendDowntime({
      action: ACTIONS.CHOICE,
      actorId: actor.id, slotKey: res.slotKey,
      choice: { id, ...(gainSpellUuid ? { gainSpellUuid } : {}) },
    });
    this.render();
  }

  /**
   * Resolve a pending choice with a TYPED name, for the martial-training slots
   * whose plan sets `freeText`. The preset buttons are a shortlist of what the
   * gear packs happen to hold; the book lets a character train with anything,
   * so a name that isn't in an index still has to be answerable.
   *
   * The name is only cleaned and length-checked for real on the GM's side —
   * this trim is so the button doesn't fire on an empty box.
   */
  async _onSubmitFreeText(event, target) {
    const actor = this._actor();
    if (!actor) return;
    const res = DowntimeSession.resultFor(actor.id);
    if (!res?.effect?.pending || !res.effect.freeText) return;
    const input = target?.closest(".sde-dt-choice-box")?.querySelector(".sde-dt-freetext-input");
    const name = String(input?.value ?? "").trim();
    if (!name) return ui.notifications.warn(L("SDE.downtime.error.typeName"));
    await this._sendDowntime({
      action: ACTIONS.CHOICE,
      actorId: actor.id, slotKey: res.slotKey,
      choice: { name },
    });
    this.render();
  }

  // ─── Session flow — GM control panel ──────────────────────────────────────

  async _onStartSession() {
    if (!game.user.isGM) return;
    const slug = this._sourceSlug;
    if (!slug) return ui.notifications.warn(L("SDE.downtime.notify.pickBook"));
    await DowntimeSession.start(slug);
    this.render();
  }

  async _onLockRolls()    { if (game.user.isGM) { await DowntimeSession.setPhase("roll");   this.render(); } }
  async _onReleaseRolls() { if (game.user.isGM) { await DowntimeSession.setPhase("select"); this.render(); } }

  async _onEndSession() {
    if (!game.user.isGM) return;
    await DowntimeSession.end();
    this._result = null;
    this.render();
  }

  async _onGmClearPick(event, target) {
    if (!game.user.isGM) return;
    const actorId = target?.dataset?.actorId;
    if (!actorId) return;
    await DowntimeSession.gmSetPick(actorId, null);
    this.render();
  }

  /** GM rolls on behalf of an absent player, using that character's own pick. */
  async _onGmRollFor(event, target) {
    if (!game.user.isGM) return;
    const actorId = target?.dataset?.actorId;
    const actor = game.actors.get(actorId);
    if (!actor) return;
    const pick = DowntimeSession.pickFor(actorId);
    if (!pick) return ui.notifications.warn(L("SDE.downtime.notify.noPickFor", { name: actor.name }));
    if (DowntimeSession.phase !== "roll") return ui.notifications.warn(L("SDE.downtime.notify.unlockDiceFirst"));
    if (!pick.nonce) {
      return ui.notifications.warn(L("SDE.downtime.notify.pickPredatesGm", { name: actor.name }));
    }

    const found = foundFor(pick);
    if (!found) return;

    // Same pay-before-you-roll gate as the player path — rolling for an absent
    // player who can't cover the fee would produce the same orphaned dice.
    const money = affordability(actor, DowntimeSession.source, found.slot,
      Number(actor.system?.level?.value ?? 0));
    if (!money.affordable) {
      return ui.notifications.warn(L("SDE.downtime.notify.cantCoverFee", {
        name: actor.name, cost: money.cost, slot: found.slot.label, short: money.shortfallText,
      }));
    }

    const facts = await classFacts(actor);
    const { mod } = modForCheck(found.activity, found.slot, actor, { facts, choiceAbility: pick.ability });
    const mode = advMode(pick.advantage);
    const roll = await new Roll(`${mode.dice} ${mod < 0 ? "-" : "+"} ${Math.abs(mod)}`).evaluate();
    const msg = await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<strong>${esc(found.activity.name)} — ${esc(found.slot.label)}</strong> <em>${L("SDE.downtime.card.rolledByGm")}</em>`,
      flags: {
        [MODULE_ID]: {
          [ROLL_FLAG]: { actorId, slotKey: pick.slotKey, nonce: pick.nonce },
        },
      },
    });
    // Same handler, same checks — the GM just happens to satisfy them by being
    // a GM. Nothing here is a privileged side door.
    await this._sendDowntime({
      action: ACTIONS.ROLLED, actorId, slotKey: pick.slotKey, messageId: msg?.id,
    });
    this.render();
  }

  // ─── Unlock hand-off ──────────────────────────────────────────────────────

  /**
   * Unlocking lives in the Importer Hub. This window never parses or writes
   * `downtimeContent` — it seeds the hub with the source the GM asked for and
   * waits for the `updateSetting` subscription in _onFirstRender to bring the
   * committed result back.
   */
  async _onUnlockViaImporter(event, target) {
    const slug = target?.dataset?.source ?? this._sourceSlug;
    const hub = game.shadowdarkEnhancer?.tables;
    if (!hub?.openHub) {
      return ui.notifications.error(L("SDE.downtime.notify.noHub"));
    }
    // Remember which book the GM was after, so the refresh lands on it.
    this._sourceSlug = slug;
    return hub.openHub("import", { downtimeSource: slug });
  }
}
