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
import { relayToGM } from "../shared/gm-relay.mjs";
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
  MARTIAL_TIER_LABELS,
  CASTER_LIST_LABELS,
} from "./downtime-session.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Per-actor state lives under one dot-free flag key. */
const DOWNTIME_FLAG = "downtime";

/** Fills "…needs a reload before X can land" when a relay can't be delivered. */
const DOWNTIME_RELAY_LABEL = "downtime actions";

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
    classes: ["shadowdark", "sde-downtime"],
    window: { title: "Downtime", icon: "fas fa-mug-hot", resizable: true },
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
      // Session flow — players
      pickSlot:        DowntimeApp.prototype._onPickSlot,
      rollPick:        DowntimeApp.prototype._onRollPick,
      chooseEffect:    DowntimeApp.prototype._onChooseEffect,
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
      ui.notifications.warn("There's no downtime session running right now.");
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
      renown: Number(actor?.system?.renown ?? 0),
      advModes: ADV_MODES.map(m => ({
        ...m,
        selected: m.key === (myPick?.advantage ?? this._advantage),
      })),
      activities,
      hasSteps: Object.values(flag.steps).some(v => Number(v) > 0),
      result: this._result,

      // ── Session ──
      session: inSession ? {
        phase: sess.phase,
        locked: sess.phase === "roll",
        sourceLabel: SOURCES?.[sess.source]?.label ?? sess.source,
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
   * Whether the Roll button is live, and if not, why.
   *
   * An unaffordable fee disables the button and states the shortfall, rather
   * than letting the click through to a roll the GM will refuse — the same
   * greyed-plus-reason treatment the effect-choice options use.
   */
  _rollState({ actor, inSession, phase, myPick, myResult, level, source }) {
    const base = !!(inSession && phase === "roll" && myPick && !myResult);
    if (!base || !actor) return { canRoll: base, rollBlockedReason: null };
    const found = slotByKey(myPick.slotKey);
    if (!found) return { canRoll: false, rollBlockedReason: "That activity is no longer available." };
    const money = affordability(actor, source, found.slot, level);
    if (money.affordable) return { canRoll: true, rollBlockedReason: null };
    return {
      canRoll: false,
      rollBlockedReason:
        `Costs ${money.cost} gp per attempt — you're ${money.shortfallText} short.`,
    };
  }

  /** A pick rendered for the "you chose X" strip. */
  _pickView(pick) {
    const found = slotByKey(pick.slotKey);
    return {
      slotKey: pick.slotKey,
      label: found?.slot?.label ?? pick.slotKey,
      activityName: found?.activity?.name ?? "",
      advantage: advMode(pick.advantage).label,
      advKey: advMode(pick.advantage).key,
    };
  }

  /** A settled result, plus the pending-choice picker when one is owed. */
  _resultView(result) {
    const found = slotByKey(result.slotKey);
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
        prompt: result.effect.prompt ?? "Choose one:",
        options: result.effect.options ?? [],
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
        pickLabel: pick ? (slotByKey(pick.slotKey)?.slot?.label ?? pick.slotKey) : null,
        advantage: pick ? advMode(pick.advantage).label : null,
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
      const tiers = gate.tiers ?? Object.values(gate.map ?? {});
      const detected = facts.martialTier ?? null;
      const viewing = tiers.includes(this._martialTier) ? this._martialTier : detected;
      if (!detected) {
        // Never guess a tier: show them all, dead, and say why.
        gateNote = `Showing every tier — ${facts.classError ?? "couldn't read class hit die"}.`;
        gateBlocked = true;
      }
      tierPicker = {
        options: [...new Set(tiers)].map(t => ({
          key: t,
          label: MARTIAL_TIER_LABELS[t] ?? t,
          selected: t === viewing,
          detected: t === detected,
        })),
      };
      const shown = viewing ?? detected;
      const tierSlots = allSlots.filter(s => !s.tier || s.tier === shown);
      // Legality comes from the SAME slotAllowed() the GM validates picks with,
      // asked about a representative row of the tier on display — so the button
      // state and the server's answer can't drift. A GM may train any tier.
      const tierLegal = tierSlots.length
        ? slotAllowed(activity, tierSlots[0], { facts, casterList: activeCasterList })
        : false;
      buckets = [{
        key: shown,
        label: null,
        enabled: !gateBlocked && (!!game.user.isGM || tierLegal),
        reason: (!gateBlocked && !game.user.isGM && !tierLegal)
          ? `${actor?.name ?? "This character"} trains at ${MARTIAL_TIER_LABELS[detected] ?? detected}.`
          : null,
        slots: tierSlots,
      }];
    } else if (gate?.kind === "spellcaster") {
      if (!actor?.system?.isSpellCaster) return null;
      const lists = gate.lists ?? ["arcane", "divine"];
      if (!activeCasterList || activeCasterList === "ambiguous") {
        gateNote = "Couldn't tell which spell list this caster uses.";
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
            ? `${actor?.name ?? "This character"} casts from the ${activeCasterList} list.`
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
          ?? (tooPoor ? `Costs ${money.cost} gp per attempt — you're ${money.shortfallText} short.` : null),
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
    if (check.kind === "choice") return (check.abilities ?? []).map(one).join(" or ");
    if (check.kind === "grouped") {
      return (check.groups ?? [])
        .map(g => (g.abilities ?? []).map(one).join("/"))
        .join(" · ");
    }
    if (check.kind === "spellcasting") {
      if (!facts.castingAbility) return "spellcasting ability unknown";
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
      if (setting?.key === `${MODULE_ID}.downtimeContent` && this.rendered) this.render();
    });
    // Session changes arrive as a payload-free nudge → DowntimeSession re-reads
    // the setting and fires this hook. Every open window (GM's and each
    // player's) re-renders off the same authoritative state.
    this._sessionHookId = Hooks.on(DowntimeSession.HOOK_CHANGED, () => {
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

    on("[data-field='source']", "change", (e) => {
      this._sourceSlug = e.target.value;
      this._result = null;
      this.render();
    });
    on("[data-field='actor']", "change", (e) => {
      this._actorId = e.target.value;
      this._choiceAbility = null;
      this._result = null;
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
    on("[data-field='renownTarget']", "change", (e) => {
      if (this._result) this._result.targetActorId = e.target.value;
    });
  }

  // ─── Attempt ──────────────────────────────────────────────────────────────

  async _onAttempt(event, target) {
    const slotKey = target?.dataset?.slotKey;
    const activityKey = target?.dataset?.activityKey;
    const actor = this._actor();
    if (!actor) return ui.notifications.warn("Pick a character first.");

    const found = this._lookupSlot(activityKey, slotKey);
    if (!found) return ui.notifications.warn("That downtime slot is no longer in the skeleton.");
    const { activity, slot } = found;

    const stored = this._stored(this._sourceSlug);
    const outcomeText = stored.slots?.[slot.key] ?? "";
    if (!outcomeText) {
      return ui.notifications.warn(`"${slot.label}" has no unlocked text — unlock ${this._sourceSlug} first.`);
    }

    // The GM is bound by the fee too — running the attempt for a character who
    // can't pay would charge coins they don't have. The escape hatch is the
    // character sheet, not an override here.
    {
      const money = affordability(actor, this._sourceSlug, slot,
        Number(actor.system?.level?.value ?? 0));
      if (!money.affordable) {
        return ui.notifications.warn(
          `${actor.name} can't afford the ${money.cost} gp fee for "${slot.label}" `
          + `(${money.shortfallText} short) — add coin to the sheet first.`,
        );
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
        return ui.notifications.warn(`${actor.name} can't afford ${cost} gp for "${slot.label}".`);
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

    const { ability, mod } = this._modFor(activity, slot, actor);
    const mode = ADV_MODES.find(m => m.key === this._advantage) ?? ADV_MODES[1];
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
      flavor: `<strong>${esc(activity.name)} — ${esc(slot.label)} (DC ${dc})</strong>`,
      content: this._cardHtml({
        activity, slot, actor, ability, mod, mode, total, dc, success,
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

  /** The ability + modifier this slot's check rolls against. */
  _modFor(activity, slot, actor) {
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
  _cardHtml({ activity, slot, actor, ability, mod, mode, total, dc, success, cost, outcomeText, nextDC }) {
    const abilityLabel = ability ? String(ability).toUpperCase() : "—";
    const modeNote = mode.key === "normal" ? "" : ` · ${esc(mode.label)}`;
    const costLine = cost > 0
      ? `<div class="sde-dt-line"><i class="fas fa-coins"></i> Paid ${cost} gp (per attempt, win or lose)</div>`
      : "";
    const body = success
      ? `<div class="sde-dt-outcome">${esc(outcomeText)}</div>`
      : `<div class="sde-dt-line">Next attempt on this activity is <strong>DC ${nextDC}</strong>.</div>`;
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
          <span class="sde-dt-vs">vs DC ${dc}</span>
          <span class="sde-dt-verdict">${success ? "SUCCESS" : "FAILURE"}</span>
        </div>
        ${costLine}
        ${body}
        <footer class="sde-dt-foot">Luck tokens cannot be spent on downtime checks.</footer>
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
    if (!actor) return ui.notifications.warn("Pick a character to receive the rumor.");
    await this._bumpRenown(actor, sign);
    r.applied = true;
    this.render();
  }

  async _bumpRenown(actor, delta) {
    const next = Number(actor.system?.renown ?? 0) + delta;
    await actor.update({ "system.renown": next });
    ui.notifications.info(`${actor.name}: renown ${signed(delta)} → ${next}.`);
  }

  async _onApplyXp() {
    const r = this._result;
    const actor = this._actor();
    if (!r || !actor || r.xpDelta == null) return;
    const delta = Number(r.xpDelta) || 0;
    const next = Number(actor.system?.level?.xp ?? 0) + delta;
    await actor.update({ "system.level.xp": next });
    ui.notifications.info(`${actor.name}: ${signed(delta)} XP → ${next}.`);
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
      ui.notifications.warn("Only the GM can clear downtime DC progress.");
      return;
    }
    const actor = this._actor();
    if (!actor) return;
    const flag = this._downtimeFlag(actor);
    await this._writeFlag(actor, { ...flag, steps: {} });
    ui.notifications.info(`Cleared downtime DC progress for ${actor.name}.`);
    this.render();
  }

  // ─── Session flow — player side ───────────────────────────────────────────

  /**
   * Declare a pick. Players emit; a GM driving their own window applies it
   * directly (they are already the authority — no round trip).
   *
   * The payload carries ONLY ids plus the declared ability/advantage. The GM
   * recomputes DC, cost and gating in DowntimeSession.context().
   */
  async _onPickSlot(event, target) {
    const actor = this._actor();
    if (!actor) return ui.notifications.warn("Pick a character first.");
    const slotKey = target?.dataset?.slotKey;
    if (!slotKey) return;
    if (DowntimeSession.phase !== "select") {
      return ui.notifications.warn("Picks are locked — the GM has unlocked the dice.");
    }
    // Same gate as the button state, re-read live — a force-enabled button must
    // not get a pick past. The GM validates this again on arrival.
    const found = slotByKey(slotKey);
    if (found) {
      const money = affordability(actor, DowntimeSession.source, found.slot,
        Number(actor.system?.level?.value ?? 0));
      if (!money.affordable) {
        return ui.notifications.warn(
          `"${found.slot.label}" costs ${money.cost} gp per attempt and ${actor.name} is `
          + `${money.shortfallText} short — you can't choose it.`,
        );
      }
    }
    const payload = {
      action: ACTIONS.PICK,
      actorId: actor.id,
      slotKey,
      ability: this._choiceAbility ?? null,
      advantage: this._advantage,
      userId: game.user.id,
    };
    if (game.user.isGM) await DowntimeSession._applyPick(payload);
    else if (!await relayToGM(payload, { label: DOWNTIME_RELAY_LABEL })) return;
    this.render();
  }

  /**
   * THE PLAYER PRESSES THE DIE. The roll runs on this client so the dice — and
   * Dice So Nice, if they have it — are theirs. Only the message id travels;
   * the GM reads the total back off the ChatMessage document.
   */
  async _onRollPick() {
    const actor = this._actor();
    if (!actor) return;
    const sess = DowntimeSession;
    if (sess.phase !== "roll") return ui.notifications.warn("The GM hasn't unlocked the dice yet.");
    const pick = sess.pickFor(actor.id);
    if (!pick) return ui.notifications.warn("You haven't chosen an activity.");
    if (sess.resultFor(actor.id)) return ui.notifications.warn("You've already rolled this session.");

    const found = slotByKey(pick.slotKey);
    if (!found) return ui.notifications.warn("That activity is no longer available.");

    // PAY BEFORE YOU ROLL. RAW charges per attempt, so an unaffordable attempt
    // isn't an attempt at all — bail out BEFORE the dice exist. Rolling first
    // and letting the GM refuse produced real dice in chat with no outcome,
    // which reads as the feature being broken. Coins are re-read live here, not
    // taken from the render context, so a stale window can't sneak a roll past.
    const money = affordability(actor, DowntimeSession.source, found.slot,
      Number(actor.system?.level?.value ?? 0));
    if (!money.affordable) {
      return ui.notifications.warn(
        `"${found.slot.label}" costs ${money.cost} gp per attempt and ${actor.name} is `
        + `${money.shortfallText} short — no fee, no roll.`,
      );
    }

    const facts = await classFacts(actor);
    const { ability, mod } = modForCheck(found.activity, found.slot, actor, {
      facts, choiceAbility: pick.ability,
    });
    const mode = advMode(pick.advantage);
    const formula = `${mode.dice} ${mod < 0 ? "-" : "+"} ${Math.abs(mod)}`;
    const flag = downtimeFlag(actor);
    const dc = effDC(found.slot, flag.steps);

    const roll = await new Roll(formula).evaluate();
    const msg = await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<strong>${esc(found.activity.name)} — ${esc(found.slot.label)} (DC ${dc})</strong>`
        + `<br><span class="sde-dt-check">${ability ? String(ability).toUpperCase() : "—"} ${signed(mod)}`
        + `${mode.key === "normal" ? "" : ` · ${esc(mode.label)}`}</span>`,
      flags: { [MODULE_ID]: { downtimeRoll: true, slotKey: pick.slotKey } },
    });

    const payload = {
      action: ACTIONS.ROLLED,
      actorId: actor.id, slotKey: pick.slotKey,
      messageId: msg?.id, userId: game.user.id,
    };
    // The dice have already landed in chat by this point, so a blocked relay
    // still renders: the warning explains why the result panel stays empty,
    // and the GM can resolve this roll by hand from the message once reloaded.
    if (game.user.isGM) await DowntimeSession._enqueue(() => DowntimeSession._handleRolled(payload));
    else await relayToGM(payload, { label: DOWNTIME_RELAY_LABEL });
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
    const choice = { id, ...(gainSpellUuid ? { gainSpellUuid } : {}) };
    const payload = {
      action: ACTIONS.CHOICE,
      actorId: actor.id, slotKey: res.slotKey, choice, userId: game.user.id,
    };
    if (game.user.isGM) await DowntimeSession._enqueue(() => DowntimeSession._handleEffectChoice(payload));
    else if (!await relayToGM(payload, { label: DOWNTIME_RELAY_LABEL })) return;
    this.render();
  }

  // ─── Session flow — GM control panel ──────────────────────────────────────

  async _onStartSession() {
    if (!game.user.isGM) return;
    const slug = this._sourceSlug;
    if (!slug) return ui.notifications.warn("Pick a book first.");
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
    if (!pick) return ui.notifications.warn(`${actor.name} hasn't chosen an activity.`);
    if (DowntimeSession.phase !== "roll") return ui.notifications.warn("Unlock the dice first.");

    const found = slotByKey(pick.slotKey);
    if (!found) return;

    // Same pay-before-you-roll gate as the player path — rolling for an absent
    // player who can't cover the fee would produce the same orphaned dice.
    const money = affordability(actor, DowntimeSession.source, found.slot,
      Number(actor.system?.level?.value ?? 0));
    if (!money.affordable) {
      return ui.notifications.warn(
        `${actor.name} can't cover the ${money.cost} gp fee for "${found.slot.label}" `
        + `(${money.shortfallText} short) — add coin to the sheet first.`,
      );
    }

    const facts = await classFacts(actor);
    const { mod } = modForCheck(found.activity, found.slot, actor, { facts, choiceAbility: pick.ability });
    const mode = advMode(pick.advantage);
    const roll = await new Roll(`${mode.dice} ${mod < 0 ? "-" : "+"} ${Math.abs(mod)}`).evaluate();
    const msg = await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<strong>${esc(found.activity.name)} — ${esc(found.slot.label)}</strong> <em>(rolled by the GM)</em>`,
      flags: { [MODULE_ID]: { downtimeRoll: true, slotKey: pick.slotKey } },
    });
    await DowntimeSession._enqueue(() => DowntimeSession._handleRolled({
      action: ACTIONS.ROLLED, actorId, slotKey: pick.slotKey,
      messageId: msg?.id, userId: game.user.id,
    }));
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
      return ui.notifications.error("The Importer Hub isn't available in this build.");
    }
    // Remember which book the GM was after, so the refresh lands on it.
    this._sourceSlug = slug;
    return hub.openHub("import", { downtimeSource: slug });
  }
}
