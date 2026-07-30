/**
 * Shadowdark Enhancer — Carousing feed core (pure, node-testable).
 *
 * Shadowdark Extras owns carousing; this module only MIRRORS its results into
 * the Session Recap. Everything here reads a plain SDX session object and holds
 * no Foundry globals, so both of SDX's result shapes stay regression-testable
 * outside Foundry — the same arrangement downtime-log-core.mjs and
 * renown-core.mjs have with their own features.
 *
 * SDX keeps the whole live carouse in ONE journal flag — the hidden
 * `__sdx_carousing_sync__` entry's `flags["shadowdark-extras"].carousingSession`
 * — shaped:
 *
 *   { phase, logId, logMeta: { date, tierDescription, tierCost, costPerPerson },
 *     results: { [participantId]: result } }
 *
 * `participantId` is a Foundry **user id** when a player dropped their own
 * character onto the overlay, or `"actor-<actorId>"` when the GM added one.
 * Resolving either needs Foundry, so the caller passes a resolver.
 *
 * A result comes in one of two shapes, one per SDX carousing mode:
 *
 *   original  { roll, diceRoll, bonus, description, benefit,
 *               applied?: { at, summary, actorName } }
 *   expanded  { outcomeRoll, diceRoll, bonus, xp,
 *               benefits: [{ description, finalRoll, renownDelta, … }],
 *               mishaps:  [{ … }],
 *               noteApplied?: { at, actorName } }
 *
 * Mode is detected off the payload, NOT off SDX's `carousingMode` setting: a
 * carouse rolled before the GM flipped that setting has to keep reading
 * correctly. This mirrors `normalizeCarousingLogResults` in SDX's CarousingSD.mjs,
 * which shapes the journal table the GM already sees — that function is the
 * reference for anything ambiguous here.
 */

/** Fallback character label, matching SDX's own log table. */
const UNKNOWN = "?";

/** Expanded mode is the one that carries benefit/mishap ARRAYS. */
export function isExpandedResult(result) {
  return Array.isArray(result?.benefits) || Array.isArray(result?.mishaps);
}

/** Coerce to a finite number, else 0. Blank strings must not read as 0-valued. */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** One benefit/mishap roll, reduced to what the recap shows. */
function outcomeEntry(entry) {
  return {
    text: String(entry?.description ?? "").trim(),
    roll: entry?.finalRoll ?? "",
    renownDelta: num(entry?.renownDelta),
  };
}

/**
 * Turn one SDX result into a recap row.
 *
 * `resolveParticipant(participantId)` returns `{ player, actorName }` and may
 * return blanks; the name SDX froze onto the result at apply time wins over a
 * live lookup, because a GM who clears the overlay's actor drops erases what the
 * live lookup reads from.
 */
function normalizeResult(participantId, result, resolveParticipant) {
  const resolved = resolveParticipant?.(participantId) ?? {};
  const expanded = isExpandedResult(result);
  // Original mode has at most one benefit and no mishaps: its outcome row
  // carries a single `benefit` string beside the description.
  //
  // `renownDelta: 0` here is "not known", NOT "no renown happened". Expanded mode
  // stores a structured `renownDelta` per roll; original mode stores none — SDX
  // re-derives it from the outcome TEXT at apply time (`parseOutcomeEffects` in
  // its CarousingSD.mjs) and keeps only the localized phrase in
  // `applied.summary`. Re-deriving it here would mean reimplementing SDX's parser
  // and risking a number that disagrees with the one it actually applied, so this
  // deliberately reports nothing rather than guessing. The renown is NOT lost to
  // the reader: it shows in the `applied` summary line, and — since SDX routes
  // the change through `Renown.award` — as its own tagged row in the recap's
  // Renown section and the character's permanent ledger. Only the per-carouse
  // AGGREGATE in `carousingSubtotal` cannot include it. Do not "fix" this by
  // inventing a delta; see the test that pins it.
  const benefits = expanded
    ? (result.benefits ?? []).map(outcomeEntry).filter((b) => b.text)
    : [String(result?.benefit ?? "").trim()].filter(Boolean)
      .map((text) => ({ text, roll: "", renownDelta: 0 }));
  const mishaps = expanded
    ? (result.mishaps ?? []).map(outcomeEntry).filter((m) => m.text)
    : [];

  return {
    participantId,
    player: resolved.player || "GM",
    actorName: result?.applied?.actorName || result?.noteApplied?.actorName
      || resolved.actorName || UNKNOWN,
    mode: expanded ? "expanded" : "original",
    // The outcome die: SDX names it `outcomeRoll` in expanded mode, `roll` in
    // original. Both are the d8 total AFTER the tier bonus and GM modifier.
    roll: expanded ? (result.outcomeRoll ?? "") : (result?.roll ?? ""),
    xp: expanded ? num(result.xp) : 0,
    // Expanded mode's headline IS the XP; original mode's is the outcome text.
    outcome: expanded ? `${num(result.xp)} XP` : String(result?.description ?? "").trim(),
    benefits,
    mishaps,
    renownDelta: [...benefits, ...mishaps].reduce((sum, e) => sum + e.renownDelta, 0),
    applied: String(result?.applied?.summary ?? "").trim(),
    // Expanded results apply themselves as they are rolled; original ones wait
    // for the GM's Apply button, so "pending" is a real state there only.
    appliedState: expanded ? "automatic" : (result?.applied ? "applied" : "pending"),
  };
}

/**
 * Normalize a whole SDX carousing session into one recap-ready carouse, or
 * `null` when there is nothing worth logging yet.
 *
 * A session is loggable once SDX has stamped it with a `logId` — which it does
 * in the same breath as writing the results — and it still holds results. The
 * `logId` doubles as the upsert key, so re-normalizing after the GM applies an
 * outcome updates the captured carouse instead of appending a second one.
 */
export function normalizeCarousingSession(session, resolveParticipant) {
  const results = session?.results;
  if (!session?.logId || !results || Object.keys(results).length === 0) return null;

  const entries = Object.entries(results)
    .map(([participantId, result]) => normalizeResult(participantId, result, resolveParticipant));
  if (entries.length === 0) return null;

  const meta = session.logMeta ?? {};
  return {
    logId: session.logId,
    // SDX formats this with the GM client's own locale when the carouse is
    // rolled. Kept verbatim rather than re-derived: it is the label the GM
    // already reads on the page in SDX's Carousing Log journal.
    date: String(meta.date ?? ""),
    tierDescription: String(meta.tierDescription ?? "").trim(),
    tierCost: num(meta.tierCost),
    costPerPerson: num(meta.costPerPerson),
    mode: entries.some((e) => e.mode === "expanded") ? "expanded" : "original",
    entries,
  };
}

/**
 * One-line phrasing for a carouser, shared by the recap window and the Discord
 * export so both read alike — the same job `recapRow` does for downtime and
 * renown.
 */
export function recapRow(entry) {
  const parts = [];
  if (entry?.roll !== "" && entry?.roll != null) parts.push(`d8 ${entry.roll}`);
  if (entry?.outcome) parts.push(entry.outcome);
  const name = entry?.actorName || UNKNOWN;
  return parts.length > 0 ? `${name} — ${parts.join(" · ")}` : name;
}

/** `+2` / `-1` / `0`, so a renown delta always carries its sign. */
export function signedDelta(n) {
  const v = num(n);
  return v > 0 ? `+${v}` : String(v);
}

/**
 * Group-header subtotal for one carouse, e.g.
 * `4 carousers · 18 XP · 5 benefits · 3 mishaps · renown +2`.
 * Only the parts that actually happened are included.
 */
export function carousingSubtotal(entries = []) {
  const count = entries.length;
  const parts = [`${count} carouser${count === 1 ? "" : "s"}`];

  const xp = entries.reduce((s, e) => s + num(e.xp), 0);
  if (xp > 0) parts.push(`${xp} XP`);

  const benefits = entries.reduce((s, e) => s + (e.benefits?.length ?? 0), 0);
  if (benefits > 0) parts.push(`${benefits} benefit${benefits === 1 ? "" : "s"}`);

  const mishaps = entries.reduce((s, e) => s + (e.mishaps?.length ?? 0), 0);
  if (mishaps > 0) parts.push(`${mishaps} mishap${mishaps === 1 ? "" : "s"}`);

  const renown = entries.reduce((s, e) => s + num(e.renownDelta), 0);
  if (renown !== 0) parts.push(`renown ${signedDelta(renown)}`);

  const pending = entries.filter((e) => e.appliedState === "pending").length;
  if (pending > 0) parts.push(`${pending} not applied`);

  return parts.join(" · ");
}

/**
 * The tier line, e.g. `A worthy night of drinking — 300 gp total, 100 gp each`.
 * Empty when SDX recorded no tier metadata (an older captured carouse).
 */
export function tierLine(carouse) {
  const bits = [];
  if (carouse?.tierDescription) bits.push(carouse.tierDescription);
  const cost = num(carouse?.tierCost);
  if (cost > 0) {
    const each = num(carouse?.costPerPerson);
    bits.push(each > 0 ? `${cost} gp total, ${each} gp each` : `${cost} gp total`);
  }
  return bits.join(" — ");
}
