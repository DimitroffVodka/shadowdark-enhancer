/**
 * G3 — class automation-readiness reports.
 *
 * This is the pure half of the readiness boundary.  It accepts a captured
 * class snapshot plus the table/talent evidence supplied by the adapter and
 * returns ordinary data.  It deliberately does not repair a class, resolve a
 * Foundry UUID, open a modal, or choose a class by name.  G2 and G4 can use the
 * same report whether their input came from Foundry or from a fixture.
 *
 * The per-class result is the stable consumer contract:
 *
 *   { classId, name, source, eligible, blockers, warnings }
 *
 * Blockers and warnings both carry `{ code, message, evidence }`.  Evidence is
 * copied into deterministic plain data so a report remains useful as an
 * importer defect queue after the source document changes.
 */
import { classGateBlockers } from "../importer/char-content/class-quality-gate.mjs";
import {
  CHOICE_SPECS,
  UNSUPPORTED_CODES,
  choosableEffects,
  choiceSpecFor,
  deriveClassIdiom,
} from "./class-idiom.mjs";

export const CLASS_READINESS_VERSION = 1;

export const READINESS_SEVERITIES = Object.freeze(["blocker", "warning"]);

/** Stable issue codes consumed by G2/G4 and the Forge & Loot UI. */
export const READINESS_CODES = Object.freeze({
  QUALITY_GATE: "quality-gate",
  TALENT_TABLE_MISSING: "talent-table-missing",
  TALENT_TABLE_UNRESOLVED: "talent-table-unresolved",
  TALENT_TABLE_INVALID: "talent-table-invalid",
  TALENT_TABLE_NOT_TILED: "talent-table-not-tiled",
  TALENT_ROW_UNWIRED: "talent-row-unwired",
  TALENT_ROW_CLASSIFIER_ERROR: "talent-row-classifier-error",
  MISSING_HIT_DIE: "missing-hit-die",
  INVALID_HIT_DIE: "invalid-hit-die",
  CASTER_SENTINEL: "caster-sentinel",
  MISSING_CASTING_ABILITY: "missing-casting-ability",
  SPELL_GRID_MISSING: "spell-grid-missing",
  SPELL_GRID_INCOMPLETE: "spell-grid-incomplete",
  SPELL_GRID_INVALID: "spell-grid-invalid",
  UNSUPPORTED_CHOICE: "unsupported-choice",
  EMPTY_CHOICE_OPTION_SET: "empty-choice-option-set",
  MISSING_CHOICE_METADATA: "missing-choice-metadata",
  UNKNOWN_CHOICE_CODE: "unknown-choice-code",
  IDIOM_THIN: "idiom-thin",
});

/** G6a failures mapped to the concrete G3 blocker that explains them. */
export const G6A_UNSUPPORTED_TO_READINESS = Object.freeze({
  "no-matching-spec": READINESS_CODES.UNSUPPORTED_CHOICE,
  "empty-option-set": READINESS_CODES.EMPTY_CHOICE_OPTION_SET,
  "missing-metadata": READINESS_CODES.MISSING_CHOICE_METADATA,
});

// Public aliases make the mapping discoverable without introducing a second
// vocabulary.  Consumers should use G6A_UNSUPPORTED_TO_READINESS.
export const UNSUPPORTED_CODE_TO_BLOCKER = G6A_UNSUPPORTED_TO_READINESS;
export const DEFAULT_DEFECT_QUEUE_LIMIT = 64;

const OWN = Object.prototype.hasOwnProperty;

function isObject(value) {
  return !!value && typeof value === "object";
}

function valuesOf(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return [...value.values()];
  if (value?.contents && Array.isArray(value.contents)) return [...value.contents];
  if (value == null) return [];
  if (isObject(value)) return Object.values(value);
  return [value];
}

/** Copy only deterministic, JSON-shaped evidence; never retain a document. */
function stableEvidence(value, seen = new Set()) {
  if (value == null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return String(value);
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (!isObject(value)) return String(value);
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry) => stableEvidence(entry, seen));
    seen.delete(value);
    return result;
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    let entry;
    try { entry = stableEvidence(value[key], seen); } catch (_err) { entry = "[unreadable]"; }
    if (entry !== undefined) result[key] = entry;
  }
  seen.delete(value);
  return result;
}

function compareText(a, b) {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}

function documentOf(value) {
  if (!isObject(value)) return {};
  if (isObject(value.classItem)) return documentOf(value.classItem);
  if (isObject(value.item) && (value.item.system || value.item.type)) return value.item;
  if (isObject(value.document) && (value.document.system || value.document.type)) return value.document;
  return value;
}

function nameOf(value) {
  if (!isObject(value)) return String(value ?? "").trim();
  return String(value.name ?? value.label ?? value.title ?? "").trim();
}

function identityOf(value) {
  if (!isObject(value)) return String(value ?? "").trim();
  return String(value.classId ?? value.uuid ?? value.id ?? value._id ?? nameOf(value)).trim();
}

function normalizeSource(value) {
  const source = isObject(value)
    ? String(value.key ?? value.id ?? value.source ?? value.title ?? value.label ?? "").trim()
    : String(value ?? "").trim();
  if (!source) return "unknown";
  if (/^core(?:\s+rulebook)?$/i.test(source)) return "core";
  if (/^(?:importer(?:-managed)?|managed(?:-classes)?|suite)$/i.test(source)) return "importer-managed";
  return source;
}

function snapshotOf(input) {
  const snapshot = isObject(input) ? input : {};
  const item = documentOf(snapshot);
  const system = item.system ?? snapshot.system ?? {};
  return { snapshot, item, system };
}

function field(snapshot, item, ...keys) {
  for (const key of keys) {
    if (snapshot[key] !== undefined) return snapshot[key];
    if (item[key] !== undefined) return item[key];
  }
  return undefined;
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function rangeOf(row) {
  if (!isObject(row)) return null;
  const range = Array.isArray(row.range) ? row.range : null;
  const lo = Number(row.lo ?? row.from ?? row.min ?? range?.[0]);
  const hi = Number(row.hi ?? row.to ?? row.max ?? range?.[1] ?? row.lo ?? row.from ?? row.min ?? range?.[0]);
  if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
  return { lo, hi };
}

function rangeLabel(row, index = null) {
  const range = rangeOf(row);
  if (range) return range.lo === range.hi ? String(range.lo) : `${range.lo}-${range.hi}`;
  return index == null ? "unknown" : `row ${index + 1}`;
}

function rowReferences(row) {
  const references = [row?.documentUuid, row?.documentUUID, row?.documentId,
    ...valuesOf(row?.documentUuids), ...valuesOf(row?.documentIds)];
  for (const result of valuesOf(row?.results)) {
    references.push(result?.documentUuid, result?.documentUUID, result?.documentId,
      result?.document, result?.doc, result?.item, result?.talent);
  }
  return references.filter((reference) => reference != null && String(reference).trim() !== "");
}

function rowChoiceSignal(row) {
  return row?.kind === "choice" || valuesOf(row?.options).length > 1
    || String(row?.type ?? "").toLowerCase() === "document" || rowReferences(row).length > 0;
}

function rowLabel(row) {
  return String(row?.text ?? row?.name ?? row?.description ?? "").trim();
}

/**
 * Collapse Foundry's same-range document results into the logical choice row
 * the importer classifier consumes.  A class table represents "Choose 1" as
 * one text result plus one document result per option, so treating each
 * embedded result as an independent range would falsely report an overlap.
 * Ordinary same-range text rows without choice/document evidence remain
 * separate and therefore still fail the tiling check.
 */
export function normalizeTalentRows(rows = []) {
  const input = valuesOf(rows).filter(isObject);
  const buckets = new Map();
  const order = [];
  input.forEach((row, index) => {
    const range = rangeOf(row);
    if (!range) {
      order.push({ index, rows: [row], range: null });
      return;
    }
    const key = `${range.lo}:${range.hi}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { index, rows: [], range };
      buckets.set(key, bucket);
      order.push(bucket);
    }
    bucket.rows.push(row);
  });
  return order.sort((a, b) => a.index - b.index).flatMap((bucket) => {
    if (!bucket.range || bucket.rows.length === 1 || !bucket.rows.some(rowChoiceSignal)) return bucket.rows;
    const first = bucket.rows[0];
    const options = [];
    const references = [];
    for (const row of bucket.rows) {
      const rowOptions = row.kind === "choice" ? valuesOf(row.options) : [rowLabel(row)];
      for (const option of rowOptions) {
        const label = isObject(option) ? option.text ?? option.name ?? option.label : option;
        if (String(label ?? "").trim() && !/^choose\s+1$/i.test(String(label).trim())) options.push(label);
      }
      references.push(...rowReferences(row));
    }
    return [{
      ...first,
      kind: "choice",
      options: [...new Set(options.map((option) => String(option).trim()).filter(Boolean))],
      documentUuids: [...new Set(references.map((reference) => referenceKey(reference)
        || String(reference).trim()).filter(Boolean))],
      results: bucket.rows,
      text: options.join(" or ") || rowLabel(first),
    }];
  });
}

export const collapseTalentRows = normalizeTalentRows;

function parseDie(formula) {
  const match = String(formula ?? "").trim().match(/^(\d*)d(\d+)$/i);
  if (!match) return null;
  const count = Number(match[1] || 1);
  const sides = Number(match[2]);
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(sides) || sides < 1) return null;
  return { count, sides, min: count, max: count * sides };
}

function tableReference(snapshot, item, system) {
  const explicit = field(snapshot, item, "talentTable", "talentTableResolved", "classTalentTableResolved");
  if (isObject(explicit)) return { value: explicit, reference: field(snapshot, item, "talentTableRef") ?? system.classTalentTable };
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== "") {
    return { value: null, reference: explicit };
  }
  if (isObject(system.classTalentTable)) return { value: system.classTalentTable, reference: system.classTalentTable.uuid ?? null };
  if (hasValue(system.classTalentTable)) return { value: null, reference: system.classTalentTable };
  // A pure fixture may use `classTalentTable` at the snapshot root.
  if (isObject(snapshot.classTalentTable)) return { value: snapshot.classTalentTable, reference: snapshot.classTalentTable.uuid ?? null };
  if (hasValue(snapshot.classTalentTable)) return { value: null, reference: snapshot.classTalentTable };
  return { value: null, reference: null };
}

function tableRows(table, snapshot) {
  const supplied = field(snapshot, snapshot, "talentRows", "rows");
  if (supplied !== undefined) return normalizeTalentRows(supplied);
  return normalizeTalentRows(table?.rows ?? table?.results);
}

function normalizedRows(rows) {
  return rows.map((row, index) => {
    const range = rangeOf(row);
    return {
      row,
      index,
      range,
      label: rangeLabel(row, index),
      text: String(row?.text ?? row?.name ?? row?.description ?? "").trim(),
    };
  });
}

function classifyTable(formula, rows) {
  const parsed = parseDie(formula);
  const result = { parsed, rows: normalizedRows(rows), issues: [] };
  if (!parsed) {
    result.issues.push({ kind: "invalid-formula", formula: String(formula ?? "") });
    return result;
  }
  if (parsed.min !== 2 || parsed.max !== 12) {
    result.issues.push({ kind: "bounds", formula, actual: [parsed.min, parsed.max], expected: [2, 12] });
  }
  const valid = result.rows.filter((entry) => !!entry.range);
  for (const entry of result.rows) {
    if (!entry.range) {
      result.issues.push({ kind: "invalid-row", index: entry.index, row: entry.label, text: entry.text });
      continue;
    }
    if (entry.range.lo < 2 || entry.range.hi > 12 || entry.range.lo > entry.range.hi) {
      result.issues.push({ kind: "out-of-bounds", index: entry.index, row: entry.label,
        range: [entry.range.lo, entry.range.hi], expected: [2, 12] });
    }
  }
  const sorted = [...valid].sort((a, b) => a.range.lo - b.range.lo || a.range.hi - b.range.hi || a.index - b.index);
  if (!sorted.length) result.issues.push({ kind: "empty", expected: [2, 12] });
  let expected = 2;
  for (const entry of sorted) {
    if (entry.range.lo < expected) {
      result.issues.push({ kind: "overlap", row: entry.label, range: [entry.range.lo, entry.range.hi], expectedNext: expected });
    } else if (entry.range.lo > expected) {
      result.issues.push({ kind: "gap", row: entry.label, missing: [expected, entry.range.lo - 1] });
    }
    expected = Math.max(expected, entry.range.hi + 1);
  }
  if (expected <= 12) result.issues.push({ kind: "gap", missing: [expected, 12] });
  result.sorted = sorted;
  return result;
}

function talentWiringFor(snapshot, row, index) {
  const supplied = snapshot.talentWiring ?? snapshot.talentRowWiring ?? snapshot.rowClassifications;
  if (Array.isArray(supplied)) return supplied[index] ?? row?.wiring ?? row?.classification ?? row;
  if (isObject(supplied)) {
    const byIndex = supplied[index] ?? supplied[String(index)];
    if (byIndex !== undefined) return byIndex;
    const key = rangeLabel(row, index);
    if (supplied[key] !== undefined) return supplied[key];
  }
  return row?.wiring ?? row?.classification ?? row;
}

function wiringVia(value) {
  if (!isObject(value)) return null;
  const via = value.via;
  return via == null || String(via).trim() === "" ? null : String(via).trim();
}

function docsFromSnapshot(snapshot) {
  const source = snapshot.talentDocs ?? snapshot.talents ?? snapshot.reachableTalentDocs
    ?? snapshot.talentDocuments ?? snapshot.talentDocsById;
  return valuesOf(source).filter(isObject);
}

function referenceKey(value) {
  if (!isObject(value)) return String(value ?? "").trim();
  return String(value.uuid ?? value.id ?? value._id ?? value.documentUuid ?? value.documentId ?? "").trim();
}

function reachableDocs(snapshot, rows, docs) {
  const byRef = new Map();
  for (const doc of docs) {
    for (const key of [referenceKey(doc), doc.name]) if (key) byRef.set(String(key).toLowerCase(), doc);
  }
  const refs = [];
  for (const row of rows) {
    for (const value of [...rowReferences(row), row?.document, row?.doc, row?.item, row?.talent]) {
      const key = referenceKey(value) || (typeof value === "string" ? value.trim() : "");
      if (key) refs.push(key.toLowerCase());
    }
  }
  const found = refs.map((key) => byRef.get(key)).filter(Boolean);
  return found.length ? [...new Set(found)] : docs;
}

function effectName(effect) {
  return String(effect?.name ?? effect?.effectName ?? effect?.label ?? "").trim();
}

function choiceEffects(snapshot, rows, docs) {
  const found = [];
  const seen = new Set();
  const add = (effect, source, index = null) => {
    if (!isObject(effect)) return;
    const key = `${source}:${index ?? ""}:${effectName(effect)}:${JSON.stringify(stableEvidence(effect.changes ?? effect.system?.changes ?? []))}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ effect, source, index });
  };
  for (const [index, doc] of reachableDocs(snapshot, rows, docs).entries())
    for (const effect of choosableEffects(doc)) add(effect, "talent", index);
  for (const [index, effect] of valuesOf(snapshot.choiceEffects ?? snapshot.choosableEffects).entries())
    add(effect, "choice-effects", index);
  for (const [rowIndex, row] of rows.entries()) {
    for (const effect of valuesOf(row?.choiceEffects ?? row?.choosableEffects ?? row?.effects))
      if (valuesOf(effect?.changes ?? effect?.system?.changes).some((change) =>
        String(change?.key ?? "").includes("REPLACEME")))
        add(effect, "talent-row", rowIndex);
  }
  return found;
}

function unsupportedResults(value, source = "choice-results", out = [], seen = new Set()) {
  if (value == null || typeof value === "function" || typeof value === "symbol") return out;
  if (typeof value !== "object") return out;
  if (seen.has(value)) return out;
  seen.add(value);
  if (isObject(value.unsupported)) {
    out.push({ source, unsupported: value.unsupported });
    // Evidence is retained on the record but not recursively searched as a
    // result; otherwise an evidence example can be reported as a new defect.
    for (const [key, entry] of Object.entries(value)) if (key !== "unsupported") unsupportedResults(entry, source, out, seen);
    return out;
  }
  for (const [key, entry] of Object.entries(value)) unsupportedResults(entry, `${source}.${key}`, out, seen);
  return out;
}

function unsupportedCodeRecord(entry) {
  const unsupported = entry?.unsupported ?? entry ?? {};
  const code = String(unsupported.code ?? "").trim();
  return {
    code: code || READINESS_CODES.UNKNOWN_CHOICE_CODE,
    evidence: unsupported.evidence ?? entry?.evidence ?? {},
    source: entry?.source ?? "choice-results",
  };
}

function choiceBlockerCode(g6aCode) {
  return G6A_UNSUPPORTED_TO_READINESS[g6aCode] ?? READINESS_CODES.UNKNOWN_CHOICE_CODE;
}

function choiceMessage(g6aCode, evidence) {
  const kind = evidence?.kind ? ` for ${evidence.kind}` : "";
  if (g6aCode === "no-matching-spec") return `A reachable REPLACEME effect${kind} has no supported G6a choice specification.`;
  if (g6aCode === "empty-option-set") return `G6a could not resolve a reachable choice${kind}: its legal option set is empty.`;
  if (g6aCode === "missing-metadata") return `G6a could not resolve a reachable choice${kind}: required choice metadata is missing.`;
  return `G6a returned unsupported choice code ${g6aCode || "(missing)"}${kind}; unattended generation cannot resolve it.`;
}

function spellcastingInfo(snapshot, item, system) {
  const spellcasting = system.spellcasting ?? field(snapshot, item, "spellcasting") ?? null;
  const grid = spellcasting?.spellsknown ?? field(snapshot, item, "spellsknown", "spellGrid");
  const hasGrid = spellcasting != null && OWN.call(spellcasting, "spellsknown") || grid !== undefined;
  const hasNonEmptyGrid = Array.isArray(grid)
    ? grid.length > 0
    : isObject(grid) && Object.keys(grid).length > 0;
  const sentinel = String(spellcasting?.class ?? "").trim() === "__not_spellcaster__";
  const ability = String(spellcasting?.ability ?? field(snapshot, item, "castingAbility") ?? "").trim();
  const declared = snapshot.isCaster === true || (!sentinel && (ability !== "" || spellcasting?.class !== undefined || hasGrid));
  const malformedSentinel = sentinel && (snapshot.isCaster === true || ability !== "" || hasNonEmptyGrid);
  return { spellcasting, grid, hasGrid, hasNonEmptyGrid, sentinel, ability, declared, malformedSentinel };
}

function gridRow(grid, level) {
  if (Array.isArray(grid)) {
    const keyed = grid.find((entry) => isObject(entry) && Number(entry.level) === level);
    if (keyed) return keyed.tiers ?? keyed.values ?? keyed;
    const direct = grid[level - 1];
    return direct;
  }
  if (!isObject(grid)) return undefined;
  return grid[String(level)] ?? grid[level];
}

function gridCell(row, tier) {
  if (Array.isArray(row)) return row[tier - 1];
  if (!isObject(row)) return undefined;
  if (OWN.call(row, String(tier))) return row[String(tier)];
  return OWN.call(row, tier) ? row[tier] : undefined;
}

function validQuota(value) {
  if (value === null) return true;
  if (typeof value === "string" && value.trim() === "") return false;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0;
}

function classHitDie(snapshot, item, system) {
  return field(snapshot, item, "hitDie", "hitPoints")
    ?? system.advancement?.hitDie
    ?? system.hitDie
    ?? system.hitPoints;
}

function reportIssue(code, message, evidence) {
  return { code, message, evidence: stableEvidence(evidence ?? {}) };
}

function issueEvidence(snapshot, item, details = {}) {
  return {
    classId: identityOf(snapshot) || identityOf(item),
    className: nameOf(item) || nameOf(snapshot),
    ...details,
  };
}

function reportIdentity(snapshot, item) {
  return identityOf(snapshot) || identityOf(item) || nameOf(item) || "unknown-class";
}

/**
 * Assess one class.  The adapter should provide `talentTable` and
 * `talentWiring`; pure callers can provide the same evidence as fixture data.
 */
export function assessClassReadiness(input = {}, options = {}) {
  // Evidence is normally carried on the candidate snapshot.  Accepting it in
  // the second argument as well keeps the pure seam convenient for adapters
  // that keep source metadata and resolved documents in separate objects;
  // explicit candidate fields always win.
  const supplied = isObject(options) && isObject(input) ? { ...options, ...input } : input;
  const { snapshot, item, system } = snapshotOf(supplied);
  const classId = reportIdentity(snapshot, item);
  const name = nameOf(item) || nameOf(snapshot) || classId;
  const source = normalizeSource(snapshot.source ?? item.source ?? item.flags?.source);
  const blockers = [];
  const warnings = [];
  const addBlocker = (code, message, evidence) => blockers.push(reportIssue(code, message, issueEvidence(snapshot, item, evidence)));
  const addWarning = (code, message, evidence) => warnings.push(reportIssue(code, message, issueEvidence(snapshot, item, evidence)));

  // Existing parser gate diagnostics remain authoritative.  G3 adds machine
  // codes while preserving each original message verbatim in evidence.
  const gateWarnings = classGateBlockers(snapshot.warnings ?? item.warnings ?? []);
  gateWarnings.forEach((message, index) => addBlocker(
    READINESS_CODES.QUALITY_GATE,
    message,
    { warning: message, warningIndex: index, gate: "classGateBlockers" },
  ));

  const tableInfo = tableReference(snapshot, item, system);
  let rows = [];
  if (!tableInfo.value) {
    addBlocker(
      tableInfo.reference ? READINESS_CODES.TALENT_TABLE_UNRESOLVED : READINESS_CODES.TALENT_TABLE_MISSING,
      tableInfo.reference
        ? `The class talent table reference ${String(tableInfo.reference)} does not resolve to a table snapshot.`
        : "The class has no class talent table; unattended advancement cannot roll its level-up talent.",
      { field: "system.classTalentTable", reference: tableInfo.reference ?? null },
    );
  } else {
    rows = tableRows(tableInfo.value, snapshot);
    const formula = tableInfo.value.formula ?? tableInfo.value.rollFormula ?? snapshot.talentFormula ?? "";
    const tableCheck = classifyTable(formula, rows);
    const formulaIssue = tableCheck.issues.find((issue) => issue.kind === "invalid-formula" || issue.kind === "bounds");
    if (formulaIssue) {
      addBlocker(
        READINESS_CODES.TALENT_TABLE_INVALID,
        formulaIssue.kind === "invalid-formula"
          ? `The class talent table formula "${String(formula || "(missing)")}" is not a valid dice formula.`
          : `The class talent table formula "${formula}" covers ${formulaIssue.actual.join("–")}, not the required 2–12 range.`,
        { field: "system.classTalentTable.formula", formula, expectedRange: [2, 12], issue: formulaIssue },
      );
    }
    const tilingIssues = tableCheck.issues.filter((issue) => !["invalid-formula", "bounds"].includes(issue.kind));
    if (tilingIssues.length) {
      addBlocker(
        READINESS_CODES.TALENT_TABLE_NOT_TILED,
        `The class talent table rows do not tile the required 2–12 range: ${tilingIssues.map((issue) => issue.row ?? issue.kind).join(", ")}.`,
        {
          field: "system.classTalentTable.results",
          formula,
          expectedRange: [2, 12],
          rows: tableCheck.rows.map((entry) => ({ range: entry.range ? [entry.range.lo, entry.range.hi] : null, text: entry.text })),
          issues: tilingIssues,
        },
      );
    }
  }

  const classifierError = snapshot.talentClassifierError ?? snapshot.classifierError;
  if (classifierError) addBlocker(
    READINESS_CODES.TALENT_ROW_CLASSIFIER_ERROR,
    `The talent-row via classifier failed: ${String(classifierError.message ?? classifierError)}.`,
    { classifier: "classifyTalentRows", error: String(classifierError.message ?? classifierError) },
  );
  if (rows.length) {
    rows.forEach((row, index) => {
      const classification = talentWiringFor(snapshot, row, index);
      const via = wiringVia(classification);
      if (via === null) addBlocker(
        READINESS_CODES.TALENT_ROW_UNWIRED,
        `Talent table row ${rangeLabel(row, index)} has via:null; its outcome is not mechanically wired for unattended advancement.`,
        { row: rangeLabel(row, index), rowIndex: index, via: null, classification: classification ?? null,
          classifier: "classifyTalentRows" },
      );
    });
  }

  const docs = docsFromSnapshot(snapshot);
  const effects = choiceEffects(snapshot, rows, docs);
  const choiceSeen = new Set();
  const addChoiceBlocker = (g6aCode, evidence) => {
    const normalizedCode = String(g6aCode ?? "").trim() || READINESS_CODES.UNKNOWN_CHOICE_CODE;
    const detail = { g6aCode: normalizedCode, ...evidence };
    const key = `${normalizedCode}:${detail.effectName ?? ""}:${detail.kind ?? ""}:${detail.source ?? ""}`;
    if (choiceSeen.has(key)) return;
    choiceSeen.add(key);
    const code = choiceBlockerCode(normalizedCode);
    addBlocker(code, choiceMessage(normalizedCode, detail), detail);
  };
  for (const entry of effects) {
    const effect = entry.effect;
    const name = effectName(effect);
    if (!choiceSpecFor(name)) addChoiceBlocker("no-matching-spec", {
      kind: "REPLACEME effect", effectName: name || null, source: entry.source,
      effectIndex: entry.index, evidence: "CHOICE_SPECS",
    });
  }
  const directResults = [
    ...unsupportedResults(snapshot.choiceResults ?? snapshot.resolvedChoices ?? snapshot.choices),
    ...valuesOf(snapshot.unsupportedChoices ?? snapshot.unsupportedChoiceCodes ?? snapshot.modalCodes)
      .map((entry) => ({ source: "explicit-choice-evidence", unsupported: isObject(entry) ? entry : { code: entry } })),
  ];
  for (const entry of directResults) {
    const record = unsupportedCodeRecord(entry);
    addChoiceBlocker(record.code, {
      kind: "G6a resolver result", source: record.source,
      evidence: record.evidence,
    });
  }

  const idiom = snapshot.idiom ?? deriveClassIdiom(item, { talents: docs, rows });
  if (idiom?.idiomThin === true) addWarning(
    READINESS_CODES.IDIOM_THIN,
    "The derived class idiom is thin; the deterministic G6a fallbacks remain available, so this class is still eligible.",
    { idiomThin: true, priority: idiom.priority ?? [], weights: idiom.weights ?? {}, signals: idiom.signals ?? [] },
  );

  const hitDie = classHitDie(snapshot, item, system);
  if (!hasValue(hitDie)) addBlocker(
    READINESS_CODES.MISSING_HIT_DIE,
    "Required advancement metadata is missing: the class has no hit die.",
    { field: "system.hitPoints", value: null },
  );
  else if (!/^(?:1)?d\d+(?:\s+per\s+level)?$/i.test(String(hitDie).trim())) addBlocker(
    READINESS_CODES.INVALID_HIT_DIE,
    `Required advancement metadata is invalid: hit die "${String(hitDie)}" is not a usable die formula.`,
    { field: "system.hitPoints", value: hitDie },
  );

  const caster = spellcastingInfo(snapshot, item, system);
  if (caster.malformedSentinel) addBlocker(
    READINESS_CODES.CASTER_SENTINEL,
    "The class carries spellcasting metadata but is marked __not_spellcaster__; unattended generation cannot treat it as a caster.",
    { field: "system.spellcasting.class", value: "__not_spellcaster__", ability: caster.ability,
      hasSpellGrid: caster.hasGrid },
  );
  if (caster.declared && !caster.sentinel) {
    if (!caster.ability) addBlocker(
      READINESS_CODES.MISSING_CASTING_ABILITY,
      "The class is a caster but system.spellcasting.ability is missing.",
      { field: "system.spellcasting.ability", value: null },
    );
    if (!caster.hasGrid || !isObject(caster.grid) && !Array.isArray(caster.grid) || !Object.keys(caster.grid ?? {}).length) {
      addBlocker(
        READINESS_CODES.SPELL_GRID_MISSING,
        "The caster has no level-1–6 system.spellcasting.spellsknown grid.",
        { field: "system.spellcasting.spellsknown", requiredLevels: [1, 2, 3, 4, 5, 6] },
      );
    } else {
      for (let level = 1; level <= 6; level++) {
        const row = gridRow(caster.grid, level);
        if (row === undefined || row === null) {
          addBlocker(
            READINESS_CODES.SPELL_GRID_INCOMPLETE,
            `The caster spell grid is missing level ${level}.`,
            { field: `system.spellcasting.spellsknown.${level}`, level, requiredTiers: [1, 2, 3, 4, 5] },
          );
          continue;
        }
        for (let tier = 1; tier <= 5; tier++) {
          const value = gridCell(row, tier);
          const hasTier = Array.isArray(row) ? tier - 1 < row.length : OWN.call(row, String(tier)) || OWN.call(row, tier);
          if (!hasTier) addBlocker(
            READINESS_CODES.SPELL_GRID_INCOMPLETE,
            `The caster spell grid is missing level ${level}, tier ${tier}.`,
            { field: `system.spellcasting.spellsknown.${level}.${tier}`, level, tier, value: null },
          );
          else if (!validQuota(value)) addBlocker(
            READINESS_CODES.SPELL_GRID_INVALID,
            `The caster spell grid has an invalid quota at level ${level}, tier ${tier}.`,
            { field: `system.spellcasting.spellsknown.${level}.${tier}`, level, tier, value },
          );
        }
      }
    }
  }

  return {
    classId,
    name,
    source,
    eligible: blockers.length === 0,
    blockers: stableEvidence(blockers),
    warnings: stableEvidence(warnings),
  };
}

export const validateClassReadiness = assessClassReadiness;
export const classReadiness = assessClassReadiness;

function compareRecords(a, b) {
  return compareText(a.source, b.source) || compareText(a.name, b.name) || compareText(a.classId, b.classId);
}

/**
 * Assess every supplied candidate and retain a bounded, deterministic defect
 * queue.  This function performs no source deduplication: G2 owns Core-wins
 * same-name selection, while G3 must show evidence for both candidates.
 */
export function buildClassReadinessReport(candidates = [], options = {}) {
  const input = Array.isArray(candidates) ? candidates
    : (candidates?.classes ?? candidates?.candidates ?? []);
  const records = input.map((candidate) => assessClassReadiness(candidate, options.classOptions ?? options));
  records.sort(compareRecords);
  const eligible = records.filter((record) => record.eligible);
  const excluded = records.filter((record) => !record.eligible);
  const defects = [];
  for (const record of records) {
    for (const issue of record.blockers ?? []) defects.push({
      classId: record.classId, name: record.name, source: record.source,
      severity: "blocker", ...issue,
    });
    for (const issue of record.warnings ?? []) defects.push({
      classId: record.classId, name: record.name, source: record.source,
      severity: "warning", ...issue,
    });
  }
  const requestedLimit = options.defectQueueLimit ?? options.maxDefects ?? DEFAULT_DEFECT_QUEUE_LIMIT;
  const defectQueueLimit = Number.isInteger(Number(requestedLimit)) && Number(requestedLimit) >= 0
    ? Number(requestedLimit) : DEFAULT_DEFECT_QUEUE_LIMIT;
  const defectQueue = stableEvidence(defects.slice(0, defectQueueLimit));
  return {
    version: CLASS_READINESS_VERSION,
    classes: stableEvidence(records),
    eligible: stableEvidence(eligible),
    excluded: stableEvidence(excluded),
    defectQueue,
    defectQueueLimit,
    defectQueueTotal: defects.length,
    defectQueueTruncated: defects.length > defectQueueLimit,
    ...(options.sources ? { sources: stableEvidence(options.sources) } : {}),
  };
}

export const classReadinessReport = buildClassReadinessReport;

/** Return the G6a vocabulary this report validates, for adapter diagnostics. */
export function supportedChoiceVocabulary() {
  return {
    specs: stableEvidence(CHOICE_SPECS),
    unsupportedCodes: [...UNSUPPORTED_CODES],
    mappings: stableEvidence(G6A_UNSUPPORTED_TO_READINESS),
  };
}
