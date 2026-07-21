/**
 * Shadowdark Enhancer — Structural Mechanical Adapters
 *
 * PURE, browser-compatible (no node: imports, no Foundry globals). This is the
 * SOLE authority for what mechanics an imported Generator/Make-It-Weird result
 * is allowed to produce. Authority = `manifestId` + exact result range. Mechanics
 * are NEVER inferred broadly from arbitrary result prose.
 *
 * The registry ships only GENERIC, prose-free operation facts (stat deltas,
 * generic attack shapes with damage/range parameters, movement modes,
 * spellcasting configuration, or an explicit GM-adjudication). It carries NO
 * imported source prose and NO deprecated string ids. The historical
 * `mutation-data.mjs` is used only as implementation evidence for those generic
 * facts; the display name/description of every generated item comes from the
 * GM's WORLD-LOCAL imported result text, never from this file.
 *
 * Strict parameter parsing (dice, power-level delta) is permitted ONLY inside a
 * structurally-declared slot that requests it, and any ambiguity fails CLOSED to
 * GM adjudication.
 *
 * Re-keying map (historical category → current imported structural identity):
 *   Make It Weird (core-monster-mutations)  mutation-1 = Physical Form (d12)
 *                                           mutation-2 = Combat        (d12)
 *                                           mutation-3 = Mind & Magic  (d12)
 *   Monster Generator (core-monster-generator)
 *                                           combat   = Power-Level slot (anchored parser)
 *                                           quality  = GM-adjudicated (no entry)
 *                                           strength = Strengths (d20)
 *                                           weakness = Weaknesses (d20)
 */

/* -------------------------------------------------------------------------- */
/*  Strict parameter parsers (only ever called inside an authorized slot).     */
/* -------------------------------------------------------------------------- */

/**
 * Flatten arbitrary imported result text to SAFE PLAIN TEXT for the draft: strip
 * any HTML tags, decode a conservative set of entities, collapse whitespace. The
 * draft contract is plain text; HTML wrapping/escaping happens only at the
 * draftToActorData persistence boundary.
 * @param {*} input
 * @returns {string}
 */
export function plainText(input) {
  let s = String(input ?? "");
  if (!s) return "";
  s = s.replace(/<[^>]*>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'");
  return s.replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
}

/**
 * Extract EXACTLY ONE dice expression from text. Returns the normalized
 * expression (e.g. "2d6") or null when there are zero or more than one — a
 * requesting slot must fail closed on that null.
 * @param {*} text
 * @returns {string|null}
 */
export function parseExactlyOneDice(text) {
  const matches = String(text ?? "").match(/\b\d+d\d+\b/gi);
  if (!matches || matches.length !== 1) return null;
  return matches[0].toLowerCase();
}

/**
 * Anchored power-level parser: extract a SIGNED level delta only when it is
 * adjacent to a level/PL/power anchor. A bare number elsewhere in the prose is
 * NOT authority — returns null (fail closed).
 * @param {*} text
 * @returns {number|null}
 */
export function parsePowerLevelDelta(text) {
  const norm = String(text ?? "").replace(/[‒–—―−]/g, "-");
  const m =
    norm.match(/([+-]\s*\d+)\s*(?:to\s+)?(?:levels?|lvls?|pl|power)\b/i) ||
    norm.match(/\b(?:levels?|lvls?|pl|power)\D{0,6}?([+-]\s*\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/\s+/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Leading display name derived from WORLD-LOCAL result text: the first clause,
 * capped, with a structural fallback (the column label). Never registry prose.
 * @param {*} text
 * @param {string} fallback
 * @returns {string}
 */
export function deriveDisplayName(text, fallback = "Imported Trait") {
  const s = plainText(text);
  if (!s) return fallback || "Imported Trait";
  const clause = s.split(/[.;:—(]|,\s|\s-\s/)[0].trim().replace(/[.,;:]+$/, "");
  const capped = clause.length > 48 ? clause.slice(0, 48).trim() : clause;
  return capped || fallback || "Imported Trait";
}

/* -------------------------------------------------------------------------- */
/*  Registry (prose-free generic operation specs).                             */
/* -------------------------------------------------------------------------- */

// Terse op-spec builders — each returns a prose-free spec op.
const F  = () => ({ op: "feature" });
const AC = (delta) => ({ op: "delta", path: "ac", delta });
const LV = (delta) => ({ op: "delta", path: "level", delta });
const INT = (min) => ({ op: "setMin", path: "abilities.int", min });
const ATK = (damage, ranges = ["close"]) => ({ op: "attack", attackType: "NPC Attack", damage, ranges });
const SPEC = () => ({ op: "attack", attackType: "NPC Special Attack" });
const MOVE = (token) => ({ op: "movement", token });
const CAST = (ability = "int") => ({ op: "spellcasting", ability });

/** Build a `{ manifestId → { rows:[{range,ops}] } }` slot from a 1-based op list. */
function slot(opLists) {
  return { rows: opLists.map((ops, i) => ({ range: [i + 1, i + 1], ops })) };
}

/**
 * The structural mechanical registry. Keyed by the exact child manifestId. Each
 * slot's rows are keyed by exact die-face range. The Combat slot carries no rows
 * — it is a power-level slot resolved by the anchored parser. The Quality slot
 * is intentionally ABSENT (explicitly GM-adjudicated).
 */
export const MECH_ADAPTERS = {
  // ─── Make It Weird — Physical Form (d12) ───────────────────────────────
  "core-monster-mutations:mutation-1": slot([
    [F()],                       // 1
    [MOVE("swim")],              // 2
    [F()],                       // 3
    [AC(2)],                     // 4
    [F()],                       // 5
    [ATK("1d6", ["close", "near"])], // 6
    [F()],                       // 7
    [MOVE("double near")],       // 8
    [ATK("1d6", ["near"])],      // 9
    [F()],                       // 10
    [MOVE("burrow")],            // 11
    [MOVE("fly")],               // 12
  ]),
  // ─── Make It Weird — Combat (d12) ──────────────────────────────────────
  "core-monster-mutations:mutation-2": slot([
    [F()],                       // 1
    [SPEC()],                    // 2
    [F()],                       // 3
    [F()],                       // 4
    [AC(2)],                     // 5
    [LV(2)],                     // 6
    [F()],                       // 7
    [ATK("1d8", ["close"])],     // 8
    [MOVE("fast (double movement)")], // 9
    [F()],                       // 10
    [F()],                       // 11
    [ATK("1d6", ["close"])],     // 12
  ]),
  // ─── Make It Weird — Mind & Magic (d12) ────────────────────────────────
  "core-monster-mutations:mutation-3": slot([
    [F()],                       // 1
    [CAST("int")],               // 2
    [F()],                       // 3
    [SPEC()],                    // 4
    [ATK("1d8", ["near"])],      // 5
    [MOVE("teleport (near)")],   // 6
    [ATK("1d4", ["close"])],     // 7
    [INT(4), F()],               // 8
    [F()],                       // 9
    [ATK("1d6", ["close"])],     // 10
    [F()],                       // 11
    [F()],                       // 12
  ]),

  // ─── Monster Generator — Combat: power-level slot (anchored parser) ─────
  "core-monster-generator:combat": { pl: true },

  // ─── Monster Generator — Strengths (d20) ───────────────────────────────
  "core-monster-generator:strength": slot([
    [F()],                       // 1
    [F()],                       // 2
    [F()],                       // 3
    [ATK("1d10", ["close"])],    // 4
    [ATK("1d6", ["close"])],     // 5
    [SPEC()],                    // 6
    [F()],                       // 7
    [ATK("1d6", ["far"])],       // 8
    [INT(3), F()],               // 9
    [ATK("1d8", ["close"])],     // 10
    [ATK("1d8", ["near"])],      // 11
    [F()],                       // 12
    [SPEC()],                    // 13
    [ATK("1d12", ["close"])],    // 14
    [F()],                       // 15
    [SPEC()],                    // 16
    [F()],                       // 17
    [ATK("2d6", ["close"])],     // 18
    [SPEC()],                    // 19
    [F()],                       // 20
  ]),
  // ─── Monster Generator — Weaknesses (d20) — all rules-bearing Features ──
  "core-monster-generator:weakness": slot(
    Array.from({ length: 20 }, () => [F()]),
  ),
};

/* -------------------------------------------------------------------------- */
/*  Lookup + resolution.                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Return the raw prose-free spec for a result's manifestId + exact range, or
 * null when the slot is unregistered / GM-adjudicated / a power-level slot.
 * @param {string} manifestId
 * @param {[number,number]|number} range
 * @param {object} [adapters]
 * @returns {{range:[number,number], ops:object[]}|null}
 */
export function getAdapterSpec(manifestId, range, adapters = MECH_ADAPTERS) {
  const s = adapters?.[manifestId];
  if (!s || !Array.isArray(s.rows)) return null;
  const requested = Array.isArray(range) ? range.map(Number) : [Number(range), Number(range)];
  if (requested.length !== 2 || requested.some((n) => !Number.isFinite(n))) return null;
  const entry = s.rows.find((r) =>
    Number(r.range[0]) === requested[0] && Number(r.range[1]) === requested[1]);
  return entry ? { range: entry.range, ops: entry.ops } : null;
}

const MECHANICAL_KINDS = new Set([
  "delta-number", "set-if-unchanged", "add-action", "append-movement-token", "configure-spellcasting",
]);

/** Classify a resolved op list into an application mode/badge. */
function classifyMode(ops) {
  if (ops.some((o) => o.kind === "gm-adjudicated")) return "gm";
  const mech = ops.some((o) => MECHANICAL_KINDS.has(o.kind));
  const feat = ops.some((o) => o.kind === "add-feature");
  if (mech && feat) return "mixed";
  return "automated";
}

/** A generated NPC Feature op sourced from world-local result text. */
function featureOp(result) {
  return {
    kind: "add-feature",
    item: { name: deriveDisplayName(result.text, result.columnLabel), description: plainText(result.text) },
  };
}

/** A GM-adjudicated result: still captures world text as a Feature, mode "gm". */
function gmResult(result) {
  return {
    mode: "gm",
    ops: [{
      kind: "gm-adjudicated",
      item: { name: deriveDisplayName(result.text, result.columnLabel), description: plainText(result.text) },
    }],
  };
}

/**
 * Resolve a resolved-shape result to concrete plan operations under structural
 * authority. Item ops carry WORLD-LOCAL display text; generic params come from
 * the registry / authorized parsers. Any parse failure fails CLOSED to GM.
 * @param {object} result  adapter-shape result ({manifestId, range, text, columnLabel, ...})
 * @param {{adapters?:object}} [opts]
 * @returns {{mode:"automated"|"mixed"|"gm", ops:object[]}}
 */
export function resolveAdapterOps(result, { adapters = MECH_ADAPTERS } = {}) {
  const slotDef = adapters?.[result?.manifestId];

  // Combat power-level slot — anchored parser is the only authority.
  if (slotDef?.pl) {
    const delta = parsePowerLevelDelta(result.text);
    if (delta === null || delta === 0) return gmResult(result);
    return { mode: "automated", ops: [{ kind: "delta-number", path: "level", delta }] };
  }

  const spec = getAdapterSpec(result?.manifestId, result?.range, adapters);
  if (!spec) return gmResult(result);

  const ops = [];
  for (const s of spec.ops) {
    switch (s.op) {
      case "feature":
        ops.push(featureOp(result));
        break;
      case "delta":
        ops.push({ kind: "delta-number", path: s.path, delta: s.delta });
        break;
      case "setMin":
        ops.push({ kind: "set-if-unchanged", path: s.path, min: s.min });
        break;
      case "movement":
        ops.push({ kind: "append-movement-token", token: s.token });
        ops.push(featureOp(result));
        break;
      case "spellcasting":
        ops.push({ kind: "configure-spellcasting", ability: s.ability });
        ops.push(featureOp(result));
        break;
      case "attack": {
        let damage = s.damage;
        if (damage === "parse") {
          damage = parseExactlyOneDice(result.text);
          if (!damage) return gmResult(result); // fail closed
        }
        const item = {
          name: deriveDisplayName(result.text, result.columnLabel),
          type: s.attackType,
          num: s.num ?? 1,
          bonus: s.bonus ?? 0,
          description: plainText(result.text),
        };
        if (s.attackType === "NPC Attack") {
          item.damage = damage || "1d6";
          item.ranges = s.ranges ?? ["close"];
        }
        ops.push({ kind: "add-action", item });
        break;
      }
      case "gm":
        return gmResult(result);
      default:
        break;
    }
  }
  if (!ops.length) return gmResult(result);
  return { mode: classifyMode(ops), ops };
}
