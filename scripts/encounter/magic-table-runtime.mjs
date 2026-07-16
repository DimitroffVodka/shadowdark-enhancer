/**
 * Shadowdark Enhancer — Magic Item Table Runtime Adapter (Phase 1).
 *
 * The Magic Item Forge can drive its Weapon / Armor recipes (and independent
 * Benefit / Curse / personality-detail riders) off the GM's OWN imported Core
 * Rulebook magic-item tables — read from the managed `sde-tables` compendium —
 * exactly the way the Monster Creator reads the imported monster-generator
 * matrices. Nothing here ships book prose: only manifest identities, formulas,
 * expected counts, and page numbers.
 *
 * This module is the boundary between those live RollTables and the Forge UI /
 * apply layer. Almost everything is pure and Foundry-free (identity,
 * range-aware validation, sanitization, set-state assembly, selection
 * resolution, bundle matching, provenance) so it is unit-testable with invented
 * fixtures. Only `catalog()` / `resolveResultRefs()` touch Foundry, and they do
 * so exclusively through `findSuitePack("sde-tables")` — never `game.tables`,
 * never name matching.
 *
 * DESIGN CONTRACT (intentionally NOT coupled to monster-table-runtime.mjs):
 *   - Child identities are the manifest entry ids themselves (e.g.
 *     "core-weapon-type"), stamped at `flags.shadowdark-enhancer.manifestId`
 *     when the table is imported. Magic recipes bundle SEPARATE single-column
 *     tables (unlike the monster matrix, which is one grid split into columns),
 *     so each child carries its own die/domain/count.
 *   - Validation is RANGE-AWARE: the formula fixes an integer domain
 *     (1d20→1..20, 1d16→1..16, 1d12→1..12, 2d6→2..12) that the imported result
 *     ranges must cover completely, without gaps or overlaps. The number of
 *     result ROWS need not equal the domain cardinality (a book table with
 *     ranged rows has fewer rows than faces); the EXACT expected row count is
 *     asserted separately from `manifest.rows`.
 *   - A set unlocks only when EVERY child resolves to exactly one valid table.
 *     Incomplete / ambiguous / invalid children are diagnostic-only, with
 *     precedence ambiguous > invalid > partial > locked.
 *   - Imported results are consumed CONSERVATIVELY. Only a whole-result numeric
 *     +N (0..3) from a *bonus* table is ever mechanized (in magic-forge.mjs);
 *     everything else is escaped descriptive text. Provenance stores stable
 *     references ONLY — never result text/name/summaries.
 */

import { MODULE_ID } from "../module-id.mjs";
import { findById, formulaFromDie } from "./table-manifest.mjs";
import { escapeHtml } from "./pdf-text-utils.mjs";
import { findSuitePack } from "./compendium-suite.mjs";

/* -------------------------------------------------------------------------- */
/*  Formula domain + child roles (pure).                                      */
/* -------------------------------------------------------------------------- */

/**
 * Integer inclusive domain for a die formula "MdN" → [M, M*N].
 *   1d20 → [1,20]   1d16 → [1,16]   1d12 → [1,12]   2d6 → [2,12]
 * Returns null for anything that isn't a plain single-die-group formula.
 * @param {string} formula
 * @returns {[number, number]|null}
 */
export function formulaDomain(formula) {
  const m = String(formula ?? "").trim().toLowerCase().match(/^(\d+)d(\d+)$/);
  if (!m) return null;
  const count = Number(m[1]);
  const faces = Number(m[2]);
  if (!count || !faces) return null;
  return [count, count * faces];
}

/**
 * Generic apply-role for a child table, derived from its manifest id suffix.
 * "type" is a display hint only (the GM still picks a real base); "bonus" is the
 * sole mechanizable role; everything else is descriptive text.
 * @param {string} manifestId
 * @returns {"type"|"bonus"|"feature"|"benefit"|"curse"|"virtue"|"flaw"|"trait"|"detail"}
 */
export function roleFromChildId(manifestId) {
  const id = String(manifestId ?? "");
  if (id.endsWith("-type")) return "type";
  if (id.endsWith("-bonus")) return "bonus";
  if (id.endsWith("-feature")) return "feature";
  if (id.endsWith("-benefit")) return "benefit";
  if (id.endsWith("-curse")) return "curse";
  if (id === "core-item-virtue") return "virtue";
  if (id === "core-item-flaw") return "flaw";
  if (id === "core-personality-trait") return "trait";
  return "detail";
}

/** True when a role's selected result carries a mechanized effect (never prose). */
export function roleIsMechanical(role) {
  return role === "bonus";
}

/** True when a role is a display hint only (GM still chooses a real base). */
export function roleIsHint(role) {
  return role === "type";
}

/* -------------------------------------------------------------------------- */
/*  Set definitions — derived from the manifest, not hand-duplicated content.  */
/* -------------------------------------------------------------------------- */

/** Build a child requirement from a manifest entry id. */
function _childDef(manifestId) {
  const entry = findById(manifestId);
  if (!entry) throw new Error(`magic-table-runtime: manifest entry "${manifestId}" missing`);
  const formula = formulaFromDie(entry.die);
  if (!formula) throw new Error(`magic-table-runtime: entry "${manifestId}" has no plain die formula`);
  const domain = formulaDomain(formula);
  if (!domain) throw new Error(`magic-table-runtime: entry "${manifestId}" formula "${formula}" has no domain`);
  return {
    manifestId,
    label: entry.name,           // bibliographic table title (permitted metadata)
    page: entry.page ?? null,
    formula,                     // normalized "1d20" / "2d6" / …
    domain,                      // [lo, hi]
    expectedCount: entry.rows ?? null,
    role: roleFromChildId(manifestId),
  };
}

/** Assemble a set def from its spec (children by manifest id). */
function _setDef(spec) {
  const children = spec.children.map(_childDef);
  const pages = [...new Set(children.map((c) => c.page).filter((p) => p != null))];
  return {
    key: spec.key,
    label: spec.label,           // generic set label (permitted metadata)
    kind: spec.kind,             // "weapon" | "armor" | "any"
    role: spec.role,             // "base" | "benefit" | "curse" | "personality"
    perTable: !!spec.perTable,   // import children individually (never a bundle)
    children,
    pages,
    page: pages[0] ?? null,
  };
}

/**
 * The Phase-1 sets. Keys are the stable UI/API ids; labels are generic set
 * titles. Base recipes bundle several single-column tables from one page and
 * import all-or-nothing; rider sets (benefit/curse) are single tables and
 * import independently; the personality-detail set is `perTable` because two of
 * its children (Virtue / Flaw) share a formula AND row count, so they can only
 * be disambiguated by manifest identity — never structurally.
 */
const _SET_SPECS = [
  { key: "magic-weapon-base",    label: "Magic Weapon",       kind: "weapon", role: "base",
    children: ["core-weapon-type", "core-weapon-bonus", "core-weapon-feature"] },
  { key: "magic-weapon-benefit", label: "Weapon Benefit",     kind: "weapon", role: "benefit",
    children: ["core-weapon-benefit"] },
  { key: "magic-weapon-curse",   label: "Weapon Curse",       kind: "weapon", role: "curse",
    children: ["core-weapon-curse"] },
  { key: "magic-armor-base",     label: "Magic Armor",        kind: "armor",  role: "base",
    children: ["core-armor-type", "core-armor-bonus", "core-armor-feature"] },
  { key: "magic-armor-benefit",  label: "Armor Benefit",      kind: "armor",  role: "benefit",
    children: ["core-armor-benefit"] },
  { key: "magic-armor-curse",    label: "Armor Curse",        kind: "armor",  role: "curse",
    children: ["core-armor-curse"] },
  { key: "magic-personality-detail", label: "Personality Detail", kind: "any", role: "personality",
    perTable: true, children: ["core-item-virtue", "core-item-flaw", "core-personality-trait"] },
];

export const MAGIC_SET_DEFS = Object.fromEntries(_SET_SPECS.map((s) => [s.key, _setDef(s)]));

/** Stable ordered set keys. */
export const MAGIC_SET_KEYS = _SET_SPECS.map((s) => s.key);

/** Every child manifest id across all sets, de-duplicated in stable order. */
export const CHILD_IDS = [
  ...new Set(Object.values(MAGIC_SET_DEFS).flatMap((d) => d.children.map((c) => c.manifestId))),
];

/** The source-PDF registry key + book title driving the hub Open PDF / Grab. */
export const CORE_PDF_SOURCE_KEY = "CORE";
const CORE_BOOK = "Shadowdark RPG";

/* -------------------------------------------------------------------------- */
/*  Import seeds (pure) — route through the canonical Importer Hub UI.         */
/* -------------------------------------------------------------------------- */

/** Seed for a single child table (rider sets + per-table personality). */
export function buildChildSeed(manifestId) {
  const entry = findById(manifestId);
  if (!entry) throw new Error(`magic-table-runtime: manifest entry "${manifestId}" missing`);
  return {
    name:        entry.name,
    die:         entry.die,
    page:        entry.page,
    formula:     formulaFromDie(entry.die),
    rows:        entry.rows ?? null,
    category:    entry.category || null,
    folderLabel: entry.sub || entry.category || null,
    manifestId:  entry.id,
    src:         CORE_PDF_SOURCE_KEY,
    book:        CORE_BOOK,
  };
}

/**
 * Seed for a whole set. Base recipes carry a `magicSet` marker + the full child
 * expectation list so the hub's bundle path can parse every expected table and
 * commit all-or-nothing. Single-table sets fall through to a child seed.
 * @param {string} setKey
 * @returns {object}
 */
export function buildSetSeed(setKey) {
  const def = MAGIC_SET_DEFS[setKey];
  if (!def) throw new Error(`Unknown magic-table set: ${setKey}`);
  if (def.children.length === 1) {
    return { ...buildChildSeed(def.children[0].manifestId), magicSet: setKey, magicRole: def.role };
  }
  const first = findById(def.children[0].manifestId);
  return {
    magicSet:    setKey,
    magicRole:   def.role,
    perTable:    def.perTable,
    // Banner shows the BUNDLE label (e.g. "Magic Weapon"), not just the first
    // child table — the whole page is parsed, not one section.
    name:        def.label,
    page:        def.page,
    pages:       def.pages,
    category:    first?.category || null,
    folderLabel: first?.sub || first?.category || null,
    children:    def.children.map((c) => ({
      manifestId:    c.manifestId,
      name:          c.label,
      die:           findById(c.manifestId)?.die ?? null,
      formula:       c.formula,
      page:          c.page,
      expectedCount: c.expectedCount,
      domain:        [...c.domain],
      role:          c.role,
    })),
    src:  CORE_PDF_SOURCE_KEY,
    book: CORE_BOOK,
  };
}

/* -------------------------------------------------------------------------- */
/*  Text sanitization (adapter boundary — decoupled copy).                     */
/* -------------------------------------------------------------------------- */

/**
 * Normalize arbitrary imported result text to SAFE PLAIN TEXT: strip HTML tags,
 * decode the handful of entities book text realistically carries, collapse
 * whitespace. Re-escaped again before it is ever persisted / shown
 * (`featureDescriptionHtml`).
 * @param {*} input
 * @returns {string}
 */
export function toPlainText(input) {
  let s = String(input ?? "");
  if (!s) return "";
  s = s.replace(/<[^>]*>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return ""; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ""; }
    });
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Escaped, safe HTML for a persisted description line — flattened to plain text
 * then HTML-escaped, so a payload like `<img onerror>` becomes inert.
 * @param {string} text
 * @returns {string}
 */
export function featureDescriptionHtml(text) {
  const s = toPlainText(text);
  return s ? `<p>${escapeHtml(s)}</p>` : "";
}

/* -------------------------------------------------------------------------- */
/*  Child-table validation (range-aware, pure).                                */
/* -------------------------------------------------------------------------- */

/** Read raw result text from a descriptor row (tolerant of field naming). */
function _rawText(r) {
  if (r == null) return "";
  return r.text ?? r.name ?? r.description ?? "";
}

/**
 * Validate one child-table descriptor against a child's expectations.
 *
 * A descriptor is `{ manifestId?, formula, results: [{id, range, text}] }` where
 * `range` is `[min, max]`. Checks: exact (normalized) formula; exact expected
 * row count when known; every result id present + stable; non-empty safe text;
 * every range integer + in-domain; sorted, gapless, non-overlapping, COMPLETE
 * coverage of the formula domain.
 *
 * @param {object} descriptor
 * @param {{expectedFormula:string, domain:[number,number], expectedCount:(number|null)}} expect
 * @returns {{valid:boolean, errors:string[], results:Array<{id, min, max, text}>}}
 */
export function validateChildTable(descriptor, { expectedFormula, domain, expectedCount }) {
  const errors = [];
  const rawResults = Array.isArray(descriptor?.results) ? descriptor.results : [];
  const formula = String(descriptor?.formula ?? "").trim().toLowerCase();
  const [lo, hi] = Array.isArray(domain) ? domain : [NaN, NaN];

  if (formula !== String(expectedFormula).toLowerCase()) {
    errors.push(`Formula "${formula || "(none)"}" is not ${expectedFormula}.`);
  }

  const results = rawResults
    .map((r) => {
      const range = Array.isArray(r?.range) ? r.range : [r?.range, r?.range];
      const min = Number(range[0]);
      const max = Number(range[1] ?? range[0]);
      return { id: r?.id ?? r?._id ?? null, min, max, text: toPlainText(_rawText(r)) };
    })
    .sort((a, b) => (a.min - b.min) || (a.max - b.max));

  if (expectedCount != null && results.length !== expectedCount) {
    errors.push(`Expected ${expectedCount} results, found ${results.length}.`);
  }

  const missingIds = results.filter((r) => r.id == null || String(r.id).trim() === "").length;
  if (missingIds) errors.push(`${missingIds} result(s) have no stable id.`);

  const emptyCount = results.filter((r) => !r.text).length;
  if (emptyCount) errors.push(`${emptyCount} result(s) have no text.`);

  // Exact, gapless, non-overlapping, in-domain coverage of [lo, hi].
  let cursor = lo;
  let coverageOk = true;
  for (const r of results) {
    if (!Number.isInteger(r.min) || !Number.isInteger(r.max) || r.max < r.min) { coverageOk = false; break; }
    if (r.min < lo || r.max > hi) { coverageOk = false; break; }
    if (r.min !== cursor) { coverageOk = false; break; }
    cursor = r.max + 1;
  }
  if (!coverageOk || cursor !== hi + 1) {
    errors.push(`Result ranges do not cleanly cover ${lo}..${hi}.`);
  }

  return { valid: errors.length === 0, errors, results };
}

/* -------------------------------------------------------------------------- */
/*  Set-state assembly (pure).                                                 */
/* -------------------------------------------------------------------------- */

/** Resolve overall set state from per-child diagnostics (precedence baked in). */
function _resolveState(reqs) {
  if (reqs.every((c) => c.count === 1 && c.valid)) return "ready";
  if (reqs.some((c) => c.count > 1)) return "ambiguous";
  if (reqs.some((c) => c.count === 1 && !c.valid)) return "invalid";
  if (reqs.some((c) => c.count === 1)) return "partial";
  return "locked";
}

/** Build actionable diagnostics for a non-ready set (empty when ready). */
function _diagnose(def, reqs, state) {
  const out = [];
  const missing = reqs.filter((c) => c.count === 0).map((c) => c.label);
  const dupes   = reqs.filter((c) => c.count > 1).map((c) => c.label);
  const broken  = reqs.filter((c) => c.count === 1 && !c.valid);
  const pageStr = def.pages.length > 1 ? `pp.${def.pages.join("/")}` : `p.${def.page}`;

  switch (state) {
    case "locked":
      out.push({
        code: "locked",
        message: `Not imported. Open the Core Rulebook PDF (${pageStr}) and import the “${def.label}” table${def.children.length > 1 ? "s" : ""} via the Importer Hub.`,
      });
      break;
    case "partial":
      out.push({
        code: "partial",
        message: `${reqs.length - missing.length}/${reqs.length} table(s) imported. Missing: ${missing.join(", ")}. Import the rest of the “${def.label}” set.`,
      });
      break;
    case "ambiguous":
      out.push({
        code: "ambiguous",
        message: `Duplicate imported tables for: ${dupes.join(", ")}. Remove extras from sde-tables so exactly one table carries each flag.`,
      });
      break;
    case "invalid":
      for (const c of broken) {
        out.push({ code: "invalid", message: `Table “${c.label}” failed validation: ${c.errors.join(" ")}` });
      }
      break;
    default:
      break;
  }
  return out;
}

/**
 * Build one set's live state from an array of table descriptors (any that carry
 * a manifestId; the def filters to its own children). Pure.
 * @param {object} def  a MAGIC_SET_DEFS entry
 * @param {Array<object>} descriptors  ({manifestId, formula, results, uuid})
 * @returns {object} set state
 */
export function buildSetState(def, descriptors) {
  const all = Array.isArray(descriptors) ? descriptors : [];
  const requirements = def.children.map((child) => {
    const candidates = all.filter((t) => t?.manifestId === child.manifestId);
    const count = candidates.length;
    let valid = false;
    let errors = [];
    let results = [];
    const tableUuid = count ? (candidates[0].uuid ?? null) : null;
    let resultCount = 0;

    if (count === 1) {
      const v = validateChildTable(candidates[0], {
        expectedFormula: child.formula,
        domain: child.domain,
        expectedCount: child.expectedCount,
      });
      valid = v.valid;
      errors = v.errors;
      resultCount = v.results.length;
      if (valid) {
        results = v.results.map((nr) => ({
          manifestId:  child.manifestId,
          tableUuid:   candidates[0].uuid ?? null,
          resultId:    nr.id,
          range:       [nr.min, nr.max],
          role:        child.role,
          label:       child.label,
          text:        nr.text,
        }));
      }
    } else if (count > 1) {
      errors = [`${count} tables carry this table's flag — ambiguous.`];
    }

    return {
      manifestId:  child.manifestId,
      label:       child.label,
      role:        child.role,
      formula:     child.formula,
      domain:      [...child.domain],
      expectedCount: child.expectedCount,
      page:        child.page,
      count,
      present:     count > 0,
      valid,
      errors,
      tableUuid,
      resultCount,
      results,
    };
  });

  const state = _resolveState(requirements);
  return {
    key:        def.key,
    label:      def.label,
    kind:       def.kind,
    role:       def.role,
    perTable:   def.perTable,
    pages:      [...def.pages],
    page:       def.page,
    requirements,
    state,
    ready:      state === "ready",
    diagnostics: _diagnose(def, requirements, state),
  };
}

/** Build every set's state from a flat descriptor list. Pure. */
export function buildSetStates(descriptors) {
  const out = {};
  for (const key of MAGIC_SET_KEYS) out[key] = buildSetState(MAGIC_SET_DEFS[key], descriptors);
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Bundle matching (pure) — the base-recipe all-or-nothing import gate.        */
/* -------------------------------------------------------------------------- */

/** Structural fit: same normalized formula AND same row count (no id needed). */
function _structuralFit(draft, child) {
  const f = String(draft?.formula ?? "").trim().toLowerCase();
  if (f !== child.formula.toLowerCase()) return false;
  const n = Array.isArray(draft?.results) ? draft.results.length : -1;
  return child.expectedCount == null ? n > 0 : n === child.expectedCount;
}

/**
 * Match a set's parsed drafts to its children and validate ALL of them.
 * Returns `{ok:true, payloads}` only when every child resolves to exactly one
 * valid draft; otherwise `{ok:false, errors, payloads:[]}` — the caller must
 * then create NOTHING (all-or-nothing atomicity).
 *
 * A `perTable` set (Virtue/Flaw share a formula+count and cannot be told apart
 * structurally) is never bundle-matched — this returns a hard error so the
 * caller falls back to per-table import.
 *
 * @param {object} def  a MAGIC_SET_DEFS entry
 * @param {Array<object>} drafts  parsed table drafts ({manifestId?, formula, results, name})
 * @returns {{ok:boolean, errors?:object[], payloads:object[]}}
 */
export function matchBundleTables(def, drafts) {
  if (!def || !Array.isArray(def.children)) {
    return { ok: false, errors: [{ code: "invalid", message: "Unknown set." }], payloads: [] };
  }
  if (def.perTable) {
    return { ok: false, errors: [{ code: "per-table", message: `The “${def.label}” set must be imported one table at a time.` }], payloads: [] };
  }
  const list = Array.isArray(drafts) ? drafts : [];
  const errors = [];
  const payloads = [];
  const used = new Set();

  for (const child of def.children) {
    // Prefer an exact manifestId stamp; fall back to a unique structural fit.
    let candidates = list.map((d, i) => ({ d, i }))
      .filter(({ d, i }) => !used.has(i) && d?.manifestId === child.manifestId);
    if (candidates.length === 0) {
      candidates = list.map((d, i) => ({ d, i }))
        .filter(({ d, i }) => !used.has(i) && !d?.manifestId && _structuralFit(d, child));
    }

    if (candidates.length === 0) {
      errors.push({ code: "missing", childId: child.manifestId, message: `Missing the “${child.label}” table (${child.formula}).` });
      continue;
    }
    if (candidates.length > 1) {
      candidates.forEach((c) => used.add(c.i));
      errors.push({ code: "duplicate", childId: child.manifestId, message: `${candidates.length} tables match “${child.label}” — ambiguous.` });
      continue;
    }

    const { d, i } = candidates[0];
    used.add(i);
    const v = validateChildTable(d, { expectedFormula: child.formula, domain: child.domain, expectedCount: child.expectedCount });
    if (!v.valid) {
      errors.push({ code: "invalid", childId: child.manifestId, message: `“${child.label}” failed validation: ${v.errors.join(" ")}` });
      continue;
    }
    payloads.push({
      childId:    child.manifestId,
      manifestId: child.manifestId,
      name:       child.label,
      formula:    child.formula,
      role:       child.role,
      sourceIndex: i,            // index of the matched draft in the input array
      results:    v.results,
    });
  }

  const ok = errors.length === 0 && payloads.length === def.children.length;
  return ok ? { ok: true, payloads } : { ok: false, errors, payloads: [] };
}

/* -------------------------------------------------------------------------- */
/*  Selection resolution + reference guard (pure).                             */
/* -------------------------------------------------------------------------- */

/** Stable dedup/lookup key for a resolved result or a stored reference. */
export function refKey(refOrResult) {
  return `${refOrResult?.tableUuid ?? ""}::${refOrResult?.resultId ?? ""}`;
}

/** Flatten every ready child's results across a set-states object. */
function _allResults(states) {
  const out = [];
  for (const set of Object.values(states)) {
    for (const req of set.requirements) out.push(...req.results);
  }
  return out;
}

/**
 * Partition stored selection references against the live catalog into still-live
 * results and stale references (table replaced/deleted or result gone). Pure.
 * @param {object} states  buildSetStates() output
 * @param {Array<{tableUuid, resultId}>} refs
 * @returns {{live: object[], stale: object[]}}
 */
export function resolveSelection(states, refs) {
  const byKey = new Map(_allResults(states).map((r) => [refKey(r), r]));
  const live = [];
  const stale = [];
  for (const ref of refs ?? []) {
    const hit = byKey.get(refKey(ref));
    if (hit) live.push(hit); else stale.push(ref);
  }
  return { live, stale };
}

/**
 * Assert the caller passed validated imported-result references (not raw prose
 * or bare strings). Throws BEFORE any persistence.
 * @param {Array} refs
 * @returns {Array} refs (unchanged) when valid
 */
export function assertResultRefs(refs) {
  if (!Array.isArray(refs) || refs.length === 0) {
    throw new Error("No imported results selected — select at least one rolled/selected result.");
  }
  for (const ref of refs) {
    if (typeof ref === "string") {
      throw new Error(`Invalid result reference "${ref}". Pass validated { manifestId, tableUuid, resultId } references, not raw strings.`);
    }
    if (!ref || typeof ref !== "object" || !ref.manifestId || !ref.tableUuid || !ref.resultId) {
      throw new Error("Invalid imported-result reference — expected { manifestId, tableUuid, resultId }.");
    }
  }
  return refs;
}

/**
 * Resolve stored references to live results by reading the live catalog. Throws
 * clearly on any stale/invalid reference (fail-closed before persistence).
 * @param {Array} refs
 * @returns {Promise<object[]>} resolved live results (adapter shape)
 */
export async function resolveResultRefs(refs) {
  assertResultRefs(refs);
  const states = await catalog();
  const { live, stale } = resolveSelection(states, refs);
  if (stale.length) {
    const names = stale.map((s) => `${s.manifestId ?? "?"}/${s.resultId ?? "?"}`).join(", ");
    throw new Error(`Imported result(s) no longer available (table changed or deleted): ${names}`);
  }
  return live;
}

/* -------------------------------------------------------------------------- */
/*  Provenance v2 (refs only — no prose).                                      */
/* -------------------------------------------------------------------------- */

/** Reference-only shape for one resolved result (never text/name/summary). */
export function forgeRef(result) {
  return {
    manifestId: result?.manifestId ?? null,
    tableUuid:  result?.tableUuid ?? null,
    resultId:   result?.resultId ?? null,
    range:      Array.isArray(result?.range) ? [...result.range] : null,
  };
}

/**
 * Version-2 forge provenance: stable references + automation summary ONLY (no
 * source prose). Stored under `flags.shadowdark-enhancer.forge`.
 * @param {{recipe?:*, results?:object[], automation?:object[], nonAutomated?:boolean}} [opts]
 * @returns {object}
 */
export function buildForgeProvenance({ recipe = null, results = [], automation = [], nonAutomated = false } = {}) {
  return {
    version: 2,
    recipe,
    refs: (results ?? []).map(forgeRef),
    automation: Array.isArray(automation) ? automation : [],
    nonAutomated: !!nonAutomated,
  };
}

/* -------------------------------------------------------------------------- */
/*  Live loader (Foundry-bound — the only impure surface).                     */
/* -------------------------------------------------------------------------- */

/** Convert a live RollTable document into a validation descriptor. */
function _toDescriptor(doc) {
  const manifestId =
    (typeof doc.getFlag === "function" ? doc.getFlag(MODULE_ID, "manifestId") : null) ??
    doc.flags?.[MODULE_ID]?.manifestId ??
    null;
  const results = [...(doc.results ?? [])].map((r) => ({
    id:    r.id ?? r._id ?? null,
    range: Array.isArray(r.range) ? [...r.range] : [r.range, r.range],
    text:  r.name ?? r.description ?? r.text ?? "",
  }));
  return { uuid: doc.uuid, manifestId, formula: doc.formula ?? "", results };
}

/**
 * Read the managed sde-tables pack and return descriptors for every table that
 * carries one of the magic child manifestIds. Reads FULL documents (results are
 * required); never touches game.tables and never matches by name.
 * @returns {Promise<object[]>}
 */
export async function loadManagedDescriptors() {
  const pack = findSuitePack("sde-tables");
  if (!pack) return [];
  const wanted = new Set(CHILD_IDS);
  let docs;
  try {
    docs = await pack.getDocuments();
  } catch (err) {
    console.warn(`${MODULE_ID} | magic-table-runtime: failed reading sde-tables`, err);
    return [];
  }
  return docs.map(_toDescriptor).filter((d) => wanted.has(d.manifestId));
}

/**
 * Live catalog: the current locked/partial/ready/ambiguous/invalid state and
 * dynamic results for every Phase-1 set. Async (reads the managed pack).
 * @returns {Promise<Record<string, object>>}
 */
export async function catalog() {
  return buildSetStates(await loadManagedDescriptors());
}
