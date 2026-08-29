/**
 * Downtime unlock parser — matches the bullets of a user-pasted downtime page
 * onto the shipped skeleton slots. The pasted text is the user's own book copy;
 * it never enters the repo, only a world setting.
 *
 * Deterministic per-source recipe, in the spirit of table-shapes.mjs: pinned
 * expectations, warnings on mismatch, no silent guessing. A bullet that does
 * not resolve is reported verbatim; it is never force-fitted onto a slot.
 *
 * Pure: no Foundry globals, no Date, no Math.random. Node-testable directly.
 */

import {
  ACTIVITY_BY_HEADER,
  ALL_SLOTS,
  EXPECTED_SLOT_COUNT,
  PHASE2_ELIGIBLE,
  SLOTS_BY_SEGMENT,
  SOURCES,
  isPaid,
  slotMatcher,
} from "./downtime-skeleton.mjs";

const BULLET_RE = /^[•*-]?\s*DC\s+(\d{1,2})(\*?)\s*:\s*(.*)$/i;

/* ── Sub-heading matchers ───────────────────────────────────────────────────
 * These decide which SEGMENT a bullet lands in, and a segment that never opens
 * takes its whole activity down with it: every bullet resolves to nothing, the
 * slots stay empty, and the window drops an activity that has no rows.
 *
 * That failure is lopsided. Spiritualism and Skulduggery need only their
 * ALL-CAPS header plus a check line, so they survive nearly any paste; martial
 * training and magical research each need a SUB-heading as well. Which is why
 * an otherwise complete paste could come back holding exactly Spiritualism and
 * Skulduggery, with no error to explain it — the strictness below was the whole
 * difference. Reported live, 2026-08-29.
 *
 * So each matcher now tolerates the punctuation a real page (or a PDF copy of
 * one) actually carries — a trailing colon, a missing period — while still
 * refusing to swallow a wrapped line of outcome text.
 */

/** Trailing punctuation a printed sub-heading may carry. */
const TRAILING_PUNCT = String.raw`\s*[.:;]?\s*`;

const CHECK_RE = new RegExp(String.raw`^(STR|DEX|CON|INT|WIS|CHA)\s+Check${TRAILING_PUNCT}$`, "i");
const CASTER_RE = new RegExp(String.raw`^(INT|WIS)\s+or\s+CHA\s+Spellcasters?${TRAILING_PUNCT}$`, "i");

/**
 * The books print tier and check on one line ("d4. INT, STR, or DEX Check"), so
 * this must not look ahead for a separate check line.
 *
 * Two shapes, because making the period optional on its own would let a wrapped
 * bullet open a tier — "New weapon (d6 max)" can easily wrap onto a line
 * starting `d6`. So: the tier token followed by punctuation, OR a period-less
 * line that names its own check.
 *
 * "Punctuation" here is a period or a colon ONLY. A dash cannot join that set:
 * a wrapped outcome line reaches the parser as "d6-max weapon, and drill with
 * it." or "d6 - the heaviest blade you can lift.", and either one opening a
 * tier moves every following bullet into the wrong one — silently, which is
 * the exact failure this guard exists to prevent. A page that really does
 * separate with a dash still opens its tier through the second shape, because
 * a genuine tier heading names its check on the same line.
 */
const TIER_RE = /^(d4|d6|d8\+?)(?:\s*[.:]|\s+\S[^\n]*\bcheck\s*[.:]?\s*$)/i;

const PAGE_RE = /^\d{1,4}$/;

/** Join continuation lines, re-gluing a word broken across a line by a hyphen. */
function joinParts(parts) {
  let out = "";
  for (const p of parts) {
    if (!out) out = p;
    else if (/[a-z]-$/.test(out) && /^[a-z]/.test(p)) out += p;
    else out += ` ${p}`;
  }
  return out.replace(/\s+/g, " ").trim();
}

function tierKey(raw) {
  const t = raw.toLowerCase();
  return t.startsWith("d8") ? "d8plus" : t;
}

/**
 * @param {string} text Raw paste from the user's book page.
 * @param {{source: string}} opts Source slug: "cs6" or "western-reaches".
 * @returns {{filled: object, unmatchedBullets: object[], unfilledSlots: string[], warnings: object[]}}
 */
export function parseDowntimeText(text, { source } = {}) {
  const src = SOURCES[source];
  if (!src) throw new Error(`parseDowntimeText: unknown source slug "${source}"`);

  const raw = String(text ?? "");
  const warnings = [];
  const bullets = [];
  const state = { activity: null, group: null, tier: null, list: null };
  const bulletsByActivity = new Map();
  const bulletsBySegment = new Map();
  const seenActivities = [];
  let open = null;

  const segmentId = () => {
    switch (state.activity) {
      case null: return null;
      case "skulduggery": return state.group ? `skulduggery.${state.group}` : null;
      case "martialTraining": return state.tier ? `martialTraining.${state.tier}` : null;
      case "magicalResearch": return state.list ? `magicalResearch.${state.list}` : null;
      default: return state.activity;
    }
  };

  const closeBullet = () => {
    if (!open) return;
    const parts = open.parts;
    delete open.parts;
    open.text = joinParts(parts);
    bullets.push(open);
    open = null;
  };

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();

    const bullet = line.match(BULLET_RE);
    if (bullet) {
      closeBullet();
      const seg = segmentId();
      open = {
        index: bullets.length,
        dc: Number(bullet[1]),
        star: bullet[2] === "*",
        segmentId: seg,
        activityKey: state.activity,
        parts: bullet[3] ? [bullet[3].trim()] : [],
      };
      if (state.activity) bulletsByActivity.set(state.activity, (bulletsByActivity.get(state.activity) || 0) + 1);
      if (seg) bulletsBySegment.set(seg, (bulletsBySegment.get(seg) || 0) + 1);
      continue;
    }

    const activityKey = ACTIVITY_BY_HEADER[line.toUpperCase()];
    if (activityKey) {
      closeBullet();
      state.activity = activityKey;
      state.group = null;
      state.tier = null;
      state.list = null;
      if (!seenActivities.includes(activityKey)) seenActivities.push(activityKey);
      continue;
    }

    const check = line.match(CHECK_RE);
    if (check) {
      closeBullet();
      const ability = check[1].toLowerCase();
      if (state.activity === "skulduggery") {
        state.group = ability === "cha" || ability === "dex" ? ability : null;
      }
      continue;
    }

    const tier = line.match(TIER_RE);
    if (tier) {
      closeBullet();
      state.tier = tierKey(tier[1]);
      continue;
    }

    const caster = line.match(CASTER_RE);
    if (caster) {
      closeBullet();
      state.list = caster[1].toLowerCase() === "int" ? "arcane" : "divine";
      continue;
    }

    if (PAGE_RE.test(line)) {
      closeBullet();
      continue;
    }

    if (!line) {
      closeBullet();
      continue;
    }

    if (open) open.parts.push(line);
    // else: descriptive flavor between headers — discarded, never stored.
  }
  closeBullet();

  // --- corruption signature -------------------------------------------------
  let interleaveSuspected = false;
  for (const [seg, count] of bulletsBySegment) {
    const slots = SLOTS_BY_SEGMENT.get(seg);
    if (slots && count > slots.length) {
      warnings.push({ code: "segment-overflow", segmentId: seg, bullets: count, slots: slots.length });
      interleaveSuspected = true;
    }
  }
  for (const activityKey of seenActivities) {
    if (!bulletsByActivity.get(activityKey)) {
      warnings.push({ code: "orphan-segment", activity: activityKey });
      interleaveSuspected = true;
    }
  }

  // --- matching -------------------------------------------------------------
  const filledMap = new Map();
  const filledBy = new Map();
  const leftovers = [];
  const rescued = new Set();

  const fill = (entry, bullet, phase) => {
    filledMap.set(entry.slot.key, bullet.text);
    filledBy.set(entry.slot.key, bullet.index);
    const paid = isPaid(entry.slot, source);
    if (bullet.star !== paid) {
      warnings.push({
        code: "asterisk-mismatch",
        slot: entry.slot.key,
        bulletStar: bullet.star,
        skeletonPaid: paid,
        source,
        bulletIndex: bullet.index,
      });
    }
    if (phase === 2) {
      warnings.push({ code: "phase2-fill", slot: entry.slot.key, fromSegment: bullet.segmentId, bulletIndex: bullet.index });
      rescued.add(bullet.index);
    }
  };

  // Phase 1 — segment-scoped DC + keyword match.
  for (const bullet of bullets) {
    const slots = bullet.segmentId ? SLOTS_BY_SEGMENT.get(bullet.segmentId) : null;
    if (!slots) {
      const code = bullet.activityKey ? "unresolved-segment" : "missing-activity-header";
      warnings.push({ code, phase: 1, activity: bullet.activityKey, dc: bullet.dc, bulletIndex: bullet.index });
      leftovers.push({ bullet, reason: code });
      continue;
    }
    const candidates = slots.filter((e) => e.slot.dc === bullet.dc && slotMatcher(e.slot).test(bullet.text));
    if (!candidates.length) {
      const dcExists = slots.some((e) => e.slot.dc === bullet.dc);
      const code = dcExists ? "keyword-miss" : "dc-not-in-segment";
      warnings.push({ code, phase: 1, segmentId: bullet.segmentId, dc: bullet.dc, bulletIndex: bullet.index });
      leftovers.push({ bullet, reason: code });
      continue;
    }
    const free = candidates.filter((e) => !filledMap.has(e.slot.key));
    if (free.length === 1) {
      fill(free[0], bullet, 1);
    } else if (!free.length) {
      warnings.push({
        code: "duplicate-fill",
        phase: 1,
        slot: candidates[0].slot.key,
        keptBulletIndex: filledBy.get(candidates[0].slot.key),
        bulletIndex: bullet.index,
      });
      leftovers.push({ bullet, reason: "duplicate-fill" });
    } else {
      warnings.push({
        code: "ambiguous-match",
        phase: 1,
        segmentId: bullet.segmentId,
        candidates: free.map((e) => e.slot.key),
        bulletIndex: bullet.index,
      });
      leftovers.push({ bullet, reason: "ambiguous-match" });
    }
  }

  // Phase 2 — interleave rescue. Only on a corruption signature, only against
  // globally unique slots, and never against martial tiers.
  if (interleaveSuspected) {
    for (const item of leftovers) {
      const { bullet } = item;
      const candidates = ALL_SLOTS.filter(
        (e) =>
          PHASE2_ELIGIBLE.has(e.slot.key) &&
          !filledMap.has(e.slot.key) &&
          e.slot.dc === bullet.dc &&
          slotMatcher(e.slot).test(bullet.text),
      );
      if (candidates.length === 1) fill(candidates[0], bullet, 2);
      else if (candidates.length > 1) {
        warnings.push({
          code: "ambiguous-match",
          phase: 2,
          candidates: candidates.map((e) => e.slot.key),
          bulletIndex: bullet.index,
        });
      }
    }
  }

  // --- reporting ------------------------------------------------------------
  const unmatchedBullets = leftovers
    .filter((item) => !rescued.has(item.bullet.index))
    .map(({ bullet, reason }) => ({
      dc: bullet.dc,
      paid: bullet.star,
      text: bullet.text,
      segmentId: bullet.segmentId,
      reason,
    }));

  const kept = warnings.filter((w) => !(w.phase === 1 && rescued.has(w.bulletIndex)));

  const lower = raw.toLowerCase();
  if (lower.includes(src.otherAuthority.toLowerCase()) && !lower.includes(src.authorityLabel.toLowerCase())) {
    kept.push({ code: "authority-mismatch", expected: src.authorityLabel, found: src.otherAuthority, source });
  }

  const filled = {};
  const unfilledSlots = [];
  for (const { slot } of ALL_SLOTS) {
    if (filledMap.has(slot.key)) filled[slot.key] = filledMap.get(slot.key);
    else unfilledSlots.push(slot.key);
  }
  if (Object.keys(filled).length < EXPECTED_SLOT_COUNT) {
    kept.push({ code: "incomplete-unlock", filled: Object.keys(filled).length, expected: EXPECTED_SLOT_COUNT });
  }

  return { filled, unmatchedBullets, unfilledSlots, warnings: kept };
}
