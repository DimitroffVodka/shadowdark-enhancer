/**
 * Shadowdark Enhancer — what the GM corrected, kept as evidence (pure, Foundry-free).
 *
 * Patrick, reviewing a classified map: "It is getting a lot of them wrong that
 * were not flagged for review either." That is a threshold question, and until
 * now it could not be answered: the moment a cell is corrected, the
 * classifier's guess and its margin are overwritten and the evidence is gone.
 *
 * So every time a cell the CLASSIFIER tagged is looked at and judged — on a
 * review sheet or by clicking it on the map overlay — the verdict is recorded
 * on the scene, beside the tags:
 *
 *   { version: 1,
 *     fixes: { "1403": "forest>swamp|1.42?" },   was > now | margin, ? = it was flagged
 *     seen:  { "14": "3/42" } }                   margin band ×10 → wrong / judged
 *
 * The per-cell fixes are the interesting half (they are also the classifier's
 * next examples). The counts are the half that answers the question: they stay
 * a few dozen numbers however much of the map is reviewed, and they say what
 * share of the mistakes the current review margin actually catches and what
 * margin would catch most of them. ponytail: bands of 0.1; finer bands if a
 * map ever needs a threshold to two decimals.
 */

export const FIXES_FLAG = "hexTagFixes";
export const FIXES_VERSION = 1;
/**
 * The margin below which an automatic cell goes to the review queue. It lived as
 * a literal 1.3 in three places (nextSheet, the tagger's count, the overlay's
 * ring); it is one stored number now, because the evidence below is what should
 * set it and a suggestion with no lever is no use.
 */
export const DEFAULT_REVIEW_MARGIN = 1.3;
/** Margins at or above this share one band; the classifier is confident well past it. */
export const TOP_BAND = 3;

/**
 * Margin → band key: 1.42 → "14", anything from TOP_BAND up → "30". The key is
 * the band in tenths and NOT "1.4", because Foundry expands dotted keys into
 * nested objects on the way to the database, and a flag written as { "1.4": … }
 * comes back as { 1: { 4: … } }.
 */
export function bandOf(margin) {
  const m = Number.isFinite(margin) ? Math.max(0, Math.min(margin, TOP_BAND)) : 0;
  return String(Math.floor(m * 10));
}

/** Band key → the margin at its bottom edge: "14" → 1.4. */
export function bandMargin(key) {
  return Number(key) / 10;
}

export function emptyLog() {
  return { version: FIXES_VERSION, margin: DEFAULT_REVIEW_MARGIN, fixes: new Map(), seen: new Map() };
}

/** Flag object → log. Tolerates a missing or foreign flag. */
export function decodeFixes(flag) {
  const log = emptyLog();
  if (!flag || typeof flag !== "object") return log;
  if (Number.isFinite(flag.margin) && flag.margin > 0) log.margin = Number(flag.margin);
  for (const [num, raw] of Object.entries(flag.fixes ?? {})) {
    const [tags, tail = ""] = String(raw).split("|");
    const [was, now] = tags.split(">");
    if (!was || !now) continue;
    const review = tail.endsWith("?");
    const margin = Number(review ? tail.slice(0, -1) : tail);
    log.fixes.set(String(parseInt(num, 10)), { was, now, margin: Number.isFinite(margin) ? margin : undefined, review });
  }
  for (const [band, raw] of Object.entries(flag.seen ?? {})) {
    const [bad, total] = String(raw).split("/").map(Number);
    if (!Number.isFinite(total) || total <= 0) continue;
    log.seen.set(band, { bad: Number.isFinite(bad) ? bad : 0, total });
  }
  return log;
}

/** Log → flag object. */
export function encodeFixes(log) {
  const fixes = {}, seen = {};
  for (const [num, f] of log.fixes) fixes[num] = `${f.was}>${f.now}|${Number.isFinite(f.margin) ? f.margin.toFixed(2) : "0.00"}${f.review ? "?" : ""}`;
  for (const [band, s] of log.seen) seen[band] = `${s.bad}/${s.total}`;
  return { version: FIXES_VERSION, margin: log.margin ?? DEFAULT_REVIEW_MARGIN, fixes, seen };
}

/** Two cells agree when the terrain and the overlays both do. */
export function sameTags(a, b) {
  if (a?.terrain !== b?.terrain) return false;
  const x = [...(a?.overlays ?? [])].sort(), y = [...(b?.overlays ?? [])].sort();
  return x.length === y.length && x.every((t, i) => t === y[i]);
}

/**
 * Record a pass of judgements. Only cells the CLASSIFIER had tagged count: a
 * cell the GM tagged by hand is not evidence about the classifier, and an
 * untagged cell was never a guess. Leaving a guess alone is a verdict too —
 * that is the denominator.
 * @param {object} log
 * @param {Array<{num:number|string, before:object|null, after:object|null}>} transitions
 * @returns {{judged:number, wrong:number}}
 */
export function recordEdits(log, transitions) {
  let judged = 0, wrong = 0;
  for (const { num, before, after } of transitions ?? []) {
    if (before?.source !== "auto" || !before.terrain) continue;
    judged++;
    const band = bandOf(before.margin);
    const row = log.seen.get(band) ?? { bad: 0, total: 0 };
    row.total++;
    if (!sameTags(before, after)) {
      row.bad++;
      wrong++;
      log.fixes.set(String(parseInt(num, 10)), {
        was: [before.terrain, ...(before.overlays ?? [])].join(";"),
        now: after?.terrain ? [after.terrain, ...(after.overlays ?? [])].join(";") : "(cleared)",
        margin: before.margin, review: !!before.review,
      });
    }
    log.seen.set(band, row);
  }
  return { judged, wrong };
}

/**
 * Take back the verdicts on these cells — an undone brush stroke never happened,
 * and leaving its corrections in would teach the threshold from an edit the GM
 * withdrew. The band counts come down with the fixes.
 * @returns {number} how many verdicts were withdrawn
 */
export function withdrawEdits(log, nums) {
  let n = 0;
  for (const raw of nums ?? []) {
    const key = String(parseInt(raw, 10));
    const fix = log.fixes.get(key);
    if (!fix) continue;
    const row = log.seen.get(bandOf(fix.margin));
    if (row) {
      row.bad = Math.max(0, row.bad - 1);
      row.total = Math.max(0, row.total - 1);
      if (!row.total) log.seen.delete(bandOf(fix.margin)); else log.seen.set(bandOf(fix.margin), row);
    }
    log.fixes.delete(key);
    n++;
  }
  return n;
}

/**
 * What the evidence says about the review threshold.
 * @param {object} log
 * @param {{margin?:number, target?:number}} [opts] margin = the threshold in use,
 *   target = the share of mistakes worth catching
 * @returns {{judged:number, wrong:number, accuracy:number|null, caught:number|null,
 *   suggested:number|null, bands:Array<{band:number, bad:number, total:number}>}}
 *   accuracy and caught are percentages; suggested is null when the current
 *   margin already catches the target, or when there is nothing to go on
 */
export function accuracyReport(log, { margin = log?.margin ?? DEFAULT_REVIEW_MARGIN, target = 0.9 } = {}) {
  const bands = [...log.seen.entries()]
    .map(([band, s]) => ({ band: bandMargin(band), bad: s.bad, total: s.total }))
    .filter((b) => Number.isFinite(b.band))
    .sort((a, b) => a.band - b.band);
  const judged = bands.reduce((n, b) => n + b.total, 0);
  const wrong = bands.reduce((n, b) => n + b.bad, 0);
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
  // A band's cells all have margins in [band, band + 0.1), so a threshold of
  // band + 0.1 flags the whole band.
  const under = (t) => bands.filter((b) => b.band + 0.1 <= t + 1e-9).reduce((n, b) => n + b.bad, 0);
  const caught = pct(under(margin), wrong);
  let suggested = null;
  if (wrong && (caught ?? 0) < target * 100) {
    let acc = 0;
    for (const b of bands) {
      acc += b.bad;
      if (acc >= target * wrong) { suggested = Math.round((b.band + 0.1) * 10) / 10; break; }
    }
  }
  // Under this, the classifier is not being asked the wrong QUESTION, it is
  // working from the wrong examples, and no threshold fixes that — but the
  // corrections themselves are the examples it needs.
  const accuracy = pct(judged - wrong, judged);
  const retag = wrong >= 20 && accuracy !== null && accuracy < 50;
  return { judged, wrong, accuracy, caught, suggested, retag, bands };
}

/** Scene flag holding what the module alone made of the map, before any review. */
export const BASELINE_FLAG = "hexBaseline";

/**
 * The initial scan, frozen.
 *
 * Once the map has been classified, what the module produced on its own is
 * written down and never touched again. Every correction after that overwrites
 * the working tags, so without this there is no way to ask the only question
 * that matters for the module itself: how much of this did it get right before
 * anybody helped it?
 *
 * Patrick, asking for exactly this: "we load the image, it does initial scan,
 * but before I make any manual review, we get those values. As the base value
 * from the initial scan."
 *
 * The answer is not available on the day it is recorded — it needs the GM's
 * review to score against — which is why it has to be kept rather than
 * computed. Verify a map at leisure and the baseline says, retrospectively,
 * what a first-time user got on it.
 */
export function encodeBaseline(cells, { at = Date.now(), from = "classify" } = {}) {
  const out = {};
  // Only the hexes the module GUESSED. A cell the GM had already answered — a
  // legend card's core carries the name they gave it — is not the module's work
  // and would score itself right by construction: the first cut of this counted
  // 1485 of them and reported 98.5%.
  for (const [num, c] of cells) if (c?.terrain && c.source === "auto") out[num] = [c.terrain, ...(c.overlays ?? [])].join(";");
  return { version: FIXES_VERSION, at, from, cells: out };
}

/** Flag object → { at, from, cells: Map<num, {terrain, overlays}> }. */
export function decodeBaseline(flag) {
  const cells = new Map();
  if (!flag || typeof flag !== "object") return { at: null, from: null, cells };
  for (const [num, raw] of Object.entries(flag.cells ?? {})) {
    const tags = String(raw).split(";").filter(Boolean);
    if (tags.length) cells.set(String(parseInt(num, 10)), { terrain: tags[0], overlays: tags.slice(1) });
  }
  return { at: flag.at ?? null, from: flag.from ?? null, cells };
}

/**
 * How the initial scan did, judged by whatever the GM has checked since.
 *
 * Only hexes the GM has tagged by hand count: those are the ones with an
 * answer. A hex nobody has looked at says nothing about anybody.
 * @param {{cells:Map<string,{terrain:string}>}} baseline
 * @param {Map<string, {terrain:string, source?:string}>} current  the tag store's cells
 */
export function baselineReport(baseline, current) {
  let checked = 0, right = 0;
  const confusion = new Map();
  for (const [num, cell] of current) {
    if (cell?.source === "auto" || !cell?.terrain) continue;
    const was = baseline.cells.get(num)?.terrain;
    if (!was) continue;
    checked++;
    if (was === cell.terrain) right++;
    else confusion.set(`${cell.terrain} → ${was}`, (confusion.get(`${cell.terrain} → ${was}`) ?? 0) + 1);
  }
  return {
    checked, right, at: baseline.at, from: baseline.from,
    accuracy: checked ? Math.round((right / checked) * 1000) / 10 : null,
    worst: [...confusion].sort((a, b) => b[1] - a[1]).slice(0, 6),
  };
}
