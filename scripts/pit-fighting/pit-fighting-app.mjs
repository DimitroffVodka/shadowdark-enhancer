/**
 * Pit Fighting — the bout roller (Cursed Scroll 2, pgs 20–24).
 *
 * Sets a bout up in the book's own order: roll a Venue, roll Stakes against the
 * party's average level, settle a danger level, draw the foe from the encounter
 * table that danger selects, and check the Twist. Then record the outcome, draw
 * the prize and award the fame.
 *
 * WHAT THIS FILE DOES NOT CONTAIN: any of the readable content. Venue
 * descriptions, twist details, what a tier is fought for and the foes themselves
 * are read out of the RollTables the GM imports from their own book. If a table
 * is missing, the window says which one and offers the importer — it does not
 * substitute text of its own. The mechanics half is pit-fighting-core.mjs, which
 * is Foundry-free and node-tested.
 *
 * THE TWIST IS SECRET. The book has the GM check it during set-up and reveal it
 * mid-bout, so it is rolled with the rest and held back until the GM presses
 * Reveal — nothing about it reaches chat before that.
 *
 * EXECUTION CONTEXT: GM-only, like the rest of the Forge & Loot tools. The renown
 * award goes through `Renown.award`, which is itself the single write path and
 * hands off to the active GM when this client is not it.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";
import { Renown } from "../renown/renown.mjs";
import {
  DANGER_LEVELS,
  STAKES_TIERS,
  TWIST_BANDS,
  VENUE_ROWS,
  averagePartyLevel,
  buildBout,
  suggestedRenown,
} from "./pit-fighting-core.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The three set-up tables, by the name the importer gives them. */
const SETUP_TABLES = { venue: "Venue", twist: "Twist" };

/* ────────────────────────────────────────────────────────────────────────── */
/* Table access                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Find an imported table by its book name.
 *
 * Tolerates the suite's `Source - Name` prefix: collision-prone tables are filed
 * as e.g. "Cursed Scroll #2 - Venue", and "Venue" is exactly the kind of name
 * that collides, so an exact match alone would miss the table that is actually
 * there. World tables are searched after the pack so a GM's own copy wins only
 * when the pack has none.
 *
 * @param {string} name
 * @returns {Promise<RollTable|null>}
 */
export async function findBoutTable(name) {
  const wanted = String(name ?? "").trim();
  if (!wanted) return null;

  const matches = (n) => n === wanted || n.endsWith(` - ${wanted}`);

  const pack = findSuitePack("sde-tables");
  if (pack) {
    // The index carries names, so this costs no document loads.
    const index = pack.index?.size ? pack.index : await pack.getIndex();
    const hit = index.find((e) => matches(String(e.name ?? "")));
    if (hit) return pack.getDocument(hit._id);
  }

  return game.tables?.find((t) => matches(String(t.name ?? ""))) ?? null;
}

/**
 * A mean trimmed to one decimal, without a trailing ".0".
 *
 * The average party level of levels 1/2/2 is 1.6666666666666667, and putting
 * that in the window is noise — one decimal is all it takes to show WHY the APL
 * rounded to what it did.
 */
function _oneDecimal(n) {
  const r = Math.round(Number(n) * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Roll a formula and return the integer total. */
async function _total(formula) {
  const roll = await new Roll(formula).evaluate();
  return Math.trunc(Number(roll.total) || 0);
}

/**
 * The text a TableResult shows.
 *
 * `name` first, then `description`: v14 maps a legacy `text` field onto
 * `description`, and reading `_source.text` still fires the deprecation getter —
 * so neither is touched here.
 */
function _resultText(result) {
  return String(result?.name || result?.description || "").trim();
}

/**
 * What a table yields for a total the caller already rolled — used for Venue and
 * Twist, whose row is chosen by the 2d6 total rather than by a fresh draw.
 *
 * Falls back to filtering the results by range when `getResultsForRoll` is
 * absent, so an older table document still reads.
 */
async function _rowFor(table, total) {
  if (!table) return "";
  let results = [];
  if (typeof table.getResultsForRoll === "function") {
    results = (await table.getResultsForRoll(total)) ?? [];
  }
  if (!results.length) {
    results = (table.results?.contents ?? [...(table.results ?? [])]).filter((r) => {
      const [lo, hi] = r.range ?? [];
      return Number.isFinite(lo) && Number.isFinite(hi) && total >= lo && total <= hi;
    });
  }
  return results.map(_resultText).filter(Boolean).join(" ");
}

/**
 * Draw one random row, without posting the system's own card.
 *
 * The encounter tables are three columns joined by " | ", and the book leaves a
 * cell empty with an em dash when a bout has no second creature or no
 * complication. Printing those through gives "Soldier | — | —", which is three
 * columns of nothing said out loud — so empty cells are dropped from the line.
 */
async function _drawOne(table) {
  if (!table) return "";
  const draw = await table.draw({ displayChat: false });
  const text = _resultText(draw?.results?.[0]);
  if (!text.includes("|")) return text;
  return text.split("|").map((c) => c.trim())
    .filter((c) => c && !/^[-–—]+$/.test(c))
    .join(" | ");
}

/* ────────────────────────────────────────────────────────────────────────── */
/* The public surface                                                         */
/* ────────────────────────────────────────────────────────────────────────── */

export const PitFighting = {

  /** The party: Player actors with a player owner, name-sorted. */
  party() {
    return game.actors
      .filter((a) => a.type === "Player" && a.hasPlayerOwner)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  /** Open the roller (GM only). */
  open() {
    return PitFightingApp.open();
  },

  /**
   * The party's average level, which the stakes roll is made against.
   *
   * The WHOLE party, not the fighters — and that is what makes the book's order
   * possible. CS2 has you roll Venue and Stakes for an available bout, share the
   * danger and the foe, and only THEN have the fighters accept or decline. The
   * first cut of this window asked who was entering first, which is a fight
   * nobody has described yet. "Groups of PCs use their Average Party Level (APL)
   * for stakes rolls" is a property of the party, so the offer needs no fighters.
   */
  partyApl() {
    return averagePartyLevel(this.party().map((a) => a.system?.level?.value));
  },

  /**
   * Assemble a bout. Every die may be supplied instead of rolled, because the GM
   * is allowed to CHOOSE the venue, the stakes or the twist rather than roll it —
   * a chosen value arrives here as the lowest total in that band, so one code
   * path covers both and `buildBout` needs no notion of "chosen".
   *
   * Fighters are deliberately not a parameter: they accept or decline AFTER this.
   *
   * @param {object} args
   * @param {string}  [args.danger]       GM override, else the suggestion
   * @param {boolean} [args.group]        group bout (the GM sets the offer's size)
   * @param {number}  [args.venueTotal]   supply to skip the 2d6
   * @param {number}  [args.stakesTotal]  supply to skip APL + 1d6
   * @param {number}  [args.twistTotal]   supply to skip the 2d6
   * @param {number}  [args.twistSub]     supply to skip the twist's own 1d4
   * @returns {Promise<object>} the bout, plus the drawn text and any missing tables
   */
  async setUpBout({
    danger = null, group = false,
    venueTotal = null, stakesTotal = null, twistTotal = null, twistSub = null,
  } = {}) {
    const { apl, mean, counted } = this.partyApl();

    const venue = venueTotal ?? await _total("2d6");
    const stakes = stakesTotal ?? (apl + await _total("1d6"));
    const twist = twistTotal ?? await _total("2d6");

    const bout = buildBout({
      venueTotal: venue, stakesTotal: stakes, apl, twistTotal: twist, danger, group,
    });

    // The extra-danger twist needs its own die before it means anything.
    const sub = bout.twist?.subRoll
      ? (twistSub ?? await _total(bout.twist.subRoll))
      : null;

    const text = await this._drawFor(bout);

    return { bout, aplDetail: { apl, mean, counted }, twistSub: sub, ...text };
  },

  /**
   * Read the three pieces of text a bout needs out of the imported tables, and
   * report by name any table that isn't there. Nothing is invented in its place:
   * a missing Venue table leaves the venue blank and names itself in the window.
   */
  async _drawFor(bout) {
    const missing = [];

    const venueTable = await findBoutTable(SETUP_TABLES.venue);
    if (!venueTable) missing.push(SETUP_TABLES.venue);

    const twistTable = await findBoutTable(SETUP_TABLES.twist);
    if (!twistTable) missing.push(SETUP_TABLES.twist);

    const foeName = bout.encounterTable;
    const foeTable = await findBoutTable(foeName);
    if (!foeTable) missing.push(foeName);

    return {
      venueText: await _rowFor(venueTable, bout.venue.total),
      twistText: bout.twist ? await _rowFor(twistTable, bout.twist.total) : "",
      foeText: await _drawOne(foeTable),
      missing,
    };
  },

  /**
   * The pickable options behind the "or choose" half of each roll.
   *
   * Each option carries the LOW total of its band, which is what gets fed back
   * into `setUpBout` — so choosing and rolling arrive by the same path. Venue and
   * twist options also carry the row's imported text, because "choose the venue"
   * is meaningless as a list of dice ranges.
   */
  async bandOptions() {
    const venueTable = await findBoutTable(SETUP_TABLES.venue);
    const twistTable = await findBoutTable(SETUP_TABLES.twist);
    const range = (b) => (b.min === b.max ? `${b.min}` : `${b.min}–${b.max}`);

    const venue = [];
    for (const r of VENUE_ROWS) {
      venue.push({ row: r.row, total: r.min, range: range(r), text: await _rowFor(venueTable, r.min) });
    }

    const twist = [];
    for (const b of TWIST_BANDS) {
      twist.push({ key: b.key, total: b.min, range: range(b), text: await _rowFor(twistTable, b.min) });
    }

    return {
      venue,
      twist,
      stakes: STAKES_TIERS.map((t) => ({ key: t.key, label: t.label, total: t.min })),
    };
  },

  /** Draw the prize for a bout's stakes tier. */
  async drawPrize(stakesTable) {
    const table = await findBoutTable(stakesTable);
    if (!table) return { text: "", missing: stakesTable };
    return { text: await _drawOne(table), missing: null };
  },

  /**
   * Award the bout's fame. One `Renown.award` per fighter, each logged and
   * announced by that single write path rather than by this file.
   *
   * @returns {Promise<Array<{name:string, ok:boolean, error?:string}>>}
   */
  async awardFame({ fighterIds = [], delta = 0, reason = "" } = {}) {
    const out = [];
    for (const id of fighterIds) {
      const actor = game.actors?.get(id);
      if (!actor) continue;
      const res = await Renown.award({
        actor, delta, reason: reason || "Pit fighting", source: "pit-fighting",
      });
      out.push({ name: actor.name, ok: !!res?.ok, error: res?.error });
    }
    return out;
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/* The window                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

export class PitFightingApp extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "sde-pit-fighting",
    tag: "form",
    window: { title: "Pit Fighting", icon: "fas fa-hand-fist", resizable: true },
    position: { width: 520, height: "auto" },
    actions: {
      rollVenue: PitFightingApp.prototype._onRollVenue,
      rollStakes: PitFightingApp.prototype._onRollStakes,
      rollTwist: PitFightingApp.prototype._onRollTwist,
      rollOffer: PitFightingApp.prototype._onRollOffer,
      toggleSize: PitFightingApp.prototype._onToggleSize,
      drawFoe: PitFightingApp.prototype._onDrawFoe,
      revealTwist: PitFightingApp.prototype._onRevealTwist,
      accept: PitFightingApp.prototype._onAccept,
      decline: PitFightingApp.prototype._onDecline,
      rollPrize: PitFightingApp.prototype._onRollPrize,
      setOutcome: PitFightingApp.prototype._onSetOutcome,
      applyResults: PitFightingApp.prototype._onApplyResults,
      openImporter: PitFightingApp.prototype._onOpenImporter,
      clearBout: PitFightingApp.prototype._onClearBout,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/pit-fighting.hbs` },
  };

  static _instance = null;

  static open() {
    if (!game.user?.isGM) {
      ui.notifications?.warn("Only a GM can run a pit fight.");
      return null;
    }
    if (!this._instance) this._instance = new PitFightingApp();
    if (!this._instance.rendered) this._instance.render(true);
    else { this._instance.bringToFront(); this._instance.render(); }
    return this._instance;
  }

  constructor(options = {}) {
    super(options);
    this._resetOffer();
  }

  /**
   * The bout is built up one die at a time, in the book's order, because each
   * step is rollable OR choosable and the GM may redo any of them before the
   * fighters have committed. `null` means "not settled yet", which is what gates
   * the later stages of the window.
   */
  _resetOffer() {
    /** @type {number|null} 2d6, or the low end of a chosen venue band */
    this._venueTotal = null;
    /** @type {number|null} APL + 1d6, or the low end of a chosen tier */
    this._stakesTotal = null;
    /** @type {number|null} 2d6, or the low end of a chosen twist band */
    this._twistTotal = null;
    /** @type {number|null} the twist's own 1d4, when its band calls for one */
    this._twistSub = null;
    /** A group bout draws from the group encounter tables. The GM's call. */
    this._group = false;
    /** GM override for the danger level; null follows the suggestion. */
    this._danger = null;
    /** @type {object|null} derived from the four above by `_refresh` */
    this._setUp = null;

    this._twistRevealed = false;
    /** @type {true|false|null} null until the fighters answer the offer */
    this._accepted = null;
    /** @type {Set<string>} who stepped up; empty until the offer is accepted */
    this._fighters = new Set();

    this._prize = "";
    /** @type {"win"|"loss"|null} */
    this._outcome = null;
    this._renownDelta = 0;
    this._applied = false;
  }

  /** True once there is something a fighter could actually say yes to. */
  get _hasOffer() {
    return this._venueTotal !== null && this._stakesTotal !== null;
  }

  async close(options = {}) {
    PitFightingApp._instance = null;
    return super.close(options);
  }

  async _prepareContext() {
    const party = PitFighting.party();
    const apl = PitFighting.partyApl();
    const options = await PitFighting.bandOptions();

    const setUp = this._setUp;
    const bout = setUp?.bout ?? null;

    return {
      // ── Stage gating ────────────────────────────────────────────
      hasParty: party.length > 0,
      hasVenue: this._venueTotal !== null,
      hasStakes: this._stakesTotal !== null,
      hasOffer: this._hasOffer,
      accepted: this._accepted === true,
      declined: this._accepted === false,
      undecided: this._hasOffer && this._accepted === null,

      // ── The offer ───────────────────────────────────────────────
      // The APL is shown BEFORE anything is rolled, so the GM can see what the
      // stakes will be rolled against.
      apl: apl.apl,
      aplRounded: apl.counted > 0 && apl.mean !== apl.apl,
      aplMeanText: _oneDecimal(apl.mean),
      partySize: apl.counted,

      venueOptions: options.venue.map((o) => ({ ...o, selected: o.total === this._venueTotal })),
      stakesOptions: options.stakes.map((o) => ({
        ...o, selected: bout ? o.key === bout.stakes.rolledKey : false,
      })),
      twistOptions: options.twist.map((o) => ({
        ...o, selected: bout?.twist ? o.key === bout.twist.key : false,
      })),
      dangerOptions: DANGER_LEVELS.map((d) => ({
        key: d.key, label: d.label,
        selected: bout ? d.key === bout.danger.key : false,
      })),

      group: this._group,
      sizeLabel: this._group ? "Group bout" : "Solo bout",

      bout,
      venueText: setUp?.venueText ?? "",
      foeText: setUp?.foeText ?? "",

      // ── The twist ───────────────────────────────────────────────
      hasTwist: !!bout?.twist,
      twistText: setUp?.twistText ?? "",
      twistSub: setUp?.twistSub ?? null,
      twistRevealed: this._twistRevealed,
      twistIsNone: bout?.twist?.effect === "none",

      missing: setUp?.missing ?? [],
      hasMissing: !!setUp?.missing?.length,

      // ── Who accepted ────────────────────────────────────────────
      party: party.map((a) => ({
        id: a.id,
        name: a.name,
        level: a.system?.level?.value ?? null,
        renown: Renown.valueOf(a),
        checked: this._fighters.has(a.id),
      })),
      fighterCount: this._fighters.size,

      // ── The result ──────────────────────────────────────────────
      prize: this._prize,
      outcome: this._outcome,
      isWin: this._outcome === "win",
      isLoss: this._outcome === "loss",
      renownDelta: this._renownDelta,
      applied: this._applied,
      canApply: this._accepted === true && !!this._outcome && !this._applied
        && this._fighters.size > 0,
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;

    // Fighter checkboxes: edit in place, no re-render, so a click does not
    // scroll the window back to the top mid-selection.
    for (const box of root.querySelectorAll("[data-fighter]")) {
      box.addEventListener("change", (ev) => {
        const id = ev.currentTarget.dataset.fighter;
        if (ev.currentTarget.checked) this._fighters.add(id);
        else this._fighters.delete(id);
        const count = root.querySelector("[data-fighter-count]");
        if (count) count.textContent = String(this._fighters.size);
        // Accept is rendered disabled at zero fighters, and this handler edits in
        // place without re-rendering — so it has to move the button itself or
        // ticking a name leaves Accept dead.
        const accept = root.querySelector('[data-action="accept"]');
        if (accept) accept.disabled = this._fighters.size === 0;
      });
    }

    // The "or choose" half of every roll. Each option carries the LOW total of
    // its band, so a pick reaches `setUpBout` by exactly the path a roll does.
    const pick = (sel, apply) =>
      root.querySelector(sel)?.addEventListener("change", async (ev) => {
        const total = Number(ev.currentTarget.value);
        if (Number.isFinite(total)) apply(total);
        await this._refresh();
      });

    pick("[data-venue-select]", (t) => { this._venueTotal = t; });
    pick("[data-stakes-select]", (t) => { this._stakesTotal = t; });
    pick("[data-twist-select]", (t) => { this._twistTotal = t; this._twistSub = null; });

    // Danger decides which encounter table applies, so the foe is redrawn.
    root.querySelector("[data-danger-select]")?.addEventListener("change", async (ev) => {
      this._danger = ev.currentTarget.value || null;
      await this._refresh();
    });

    root.querySelector("[data-renown-delta]")?.addEventListener("change", (ev) => {
      const n = Math.trunc(Number(ev.currentTarget.value));
      this._renownDelta = Number.isFinite(n) ? n : 0;
    });
  }

  /**
   * Rebuild the bout from whatever is settled so far, then re-render.
   *
   * One place turns state into a bout, so every roll, pick and toggle goes
   * through here. It does nothing until BOTH a venue and stakes exist — before
   * that there is no offer to put in front of anybody.
   */
  async _refresh() {
    if (!this._hasOffer) { this.render(); return; }
    this._setUp = await PitFighting.setUpBout({
      danger: this._danger,
      group: this._group,
      venueTotal: this._venueTotal,
      stakesTotal: this._stakesTotal,
      twistTotal: this._twistTotal,
      twistSub: this._twistSub,
    });
    // Pin the twist and its detail die so later refreshes cannot reroll them.
    this._twistTotal = this._setUp.bout.twist?.total ?? this._twistTotal;
    this._twistSub = this._setUp.twistSub;
    this.render();
  }

  async _onRollVenue() {
    this._venueTotal = await _total("2d6");
    await this._refresh();
  }

  async _onRollStakes() {
    this._stakesTotal = PitFighting.partyApl().apl + await _total("1d6");
    await this._refresh();
  }

  async _onRollTwist() {
    this._twistTotal = await _total("2d6");
    this._twistSub = null;            // a new twist gets a new detail die
    this._twistRevealed = false;
    await this._refresh();
  }

  /** Roll the whole offer at once — venue, stakes, and the secret twist. */
  async _onRollOffer() {
    this._venueTotal = await _total("2d6");
    this._stakesTotal = PitFighting.partyApl().apl + await _total("1d6");
    this._twistTotal = await _total("2d6");
    this._twistSub = null;
    this._twistRevealed = false;
    await this._refresh();
  }

  /** Solo or group. It decides which encounter table the foe is drawn from. */
  async _onToggleSize() {
    this._group = !this._group;
    await this._refresh();
  }

  /** Redraw just the foe, leaving every die where it is. */
  async _onDrawFoe() {
    if (!this._setUp) return;
    const text = await PitFighting._drawFor(this._setUp.bout);
    this._setUp = { ...this._setUp, ...text };
    this.render();
  }

  async _onAccept() {
    if (!this._fighters.size) {
      ui.notifications?.warn("Tick who steps up first.");
      return;
    }
    this._accepted = true;
    this._renownDelta = 0;
    this.render();
  }

  /**
   * Declining is an answer, not a cancel. CS2 notes that fighters who break
   * their word risk losing future offers, so it is recorded rather than
   * swallowed — the offer stays on screen with the refusal against it.
   */
  _onDecline() {
    this._accepted = false;
    this._fighters.clear();
    this.render();
  }

  _onClearBout() {
    this._resetOffer();
    this.render();
  }

  /** Reveal the twist to the table — the first time it reaches chat. */
  async _onRevealTwist() {
    const setUp = this._setUp;
    if (!setUp?.bout?.twist) return;

    this._twistRevealed = true;
    const sub = setUp.twistSub;
    const body = setUp.twistText || "(the Twist table is not imported)";

    await ChatMessage.create({
      user: game.user.id,
      content: `
        <div class="sde-pit-card">
          <header class="sde-pit-card-head"><i class="fas fa-bolt"></i> A Twist</header>
          <div class="sde-pit-card-body">${esc(body)}${sub ? ` <em>(1d4: ${sub})</em>` : ""}</div>
        </div>`,
    });
    this.render();
  }

  async _onRollPrize() {
    const table = this._setUp?.bout?.stakes?.table;
    if (!table) return;
    const { text, missing } = await PitFighting.drawPrize(table);
    if (missing) {
      ui.notifications?.warn(`The "${missing}" table is not imported yet.`);
      return;
    }
    this._prize = text;
    this.render();
  }

  _onSetOutcome(event, target) {
    this._outcome = target?.dataset?.outcome === "win" ? "win" : "loss";
    this._renownDelta = suggestedRenown(this._outcome);
    this.render();
  }

  async _onApplyResults() {
    const setUp = this._setUp;
    if (!setUp || !this._outcome) return;

    const reason = `Pit fight — ${setUp.bout.stakes.label} stakes (${this._outcome === "win" ? "won" : "lost"})`;
    const results = this._renownDelta === 0
      ? []
      : await PitFighting.awardFame({
        fighterIds: [...this._fighters],
        delta: this._renownDelta,
        reason,
      });

    const awarded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);

    if (failed.length) {
      // Carry the reason through. `Renown.award` refuses for real causes — a
      // stale primary-GM tab is the common one — and "it failed" alone leaves
      // the GM with nothing to act on.
      const why = failed.find((f) => f.error)?.error ?? "";
      ui.notifications?.warn(
        `Renown could not be applied for ${failed.map((f) => f.name).join(", ")}.${why ? ` ${why}` : ""}`,
      );
    }

    await this._postBoutCard({ reason, awarded, failed });

    // Only lock Apply when nothing failed. A refused award has to stay
    // retryable once whatever refused it is sorted out, and a card that says
    // "Applied" over a character whose renown never moved is a lie.
    this._applied = failed.length === 0;
    this.render();
  }

  /**
   * One summary card. The renown changes announce themselves through
   * `Renown.award`, so this card does not repeat the numbers — it records the
   * bout: where, for what, against whom, and how it ended.
   */
  async _postBoutCard({ reason, awarded = [], failed = [] }) {
    const setUp = this._setUp;
    const bout = setUp.bout;
    const rows = [
      setUp.venueText && `<div><strong>Venue:</strong> ${esc(setUp.venueText)}</div>`,
      `<div><strong>Stakes:</strong> ${esc(bout.stakes.label)}${bout.stakes.raised ? " <em>(raised by the twist)</em>" : ""}</div>`,
      `<div><strong>Danger:</strong> ${esc(bout.danger.label)}</div>`,
      setUp.foeText && `<div><strong>Foe:</strong> ${esc(setUp.foeText)}</div>`,
      this._prize && `<div><strong>Prize:</strong> ${esc(this._prize)}</div>`,
      // Only characters whose renown actually moved. Listing a name here is a
      // claim that it landed, and the award can legitimately refuse.
      awarded.length && `<div><strong>Fame:</strong> ${esc(awarded.map((r) => r.name).join(", "))}</div>`,
      failed.length && `<div class="sde-pit-card-warn"><strong>Renown not applied:</strong> ${esc(failed.map((r) => r.name).join(", "))}</div>`,
    ].filter(Boolean).join("");

    return ChatMessage.create({
      user: game.user.id,
      content: `
        <div class="sde-pit-card ${this._outcome === "win" ? "sde-pit-win" : "sde-pit-loss"}">
          <header class="sde-pit-card-head">
            <i class="fas fa-hand-fist"></i> ${esc(reason)}
          </header>
          <div class="sde-pit-card-body">${rows}</div>
        </div>`,
    });
  }

  async _onOpenImporter() {
    // The hub is the front door for every import; land on the paste view.
    game.shadowdarkEnhancer?.tables?.openHub?.("import");
  }
}
