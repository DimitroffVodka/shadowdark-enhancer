/**
 * Pure advancement of a generated level-one member through level six.
 *
 * The caller supplies complete plain snapshots and one random stream.  This
 * module owns no persistence, lookup, normalization, or UI behavior.  G6a is
 * the only policy used for talent and spell choices; this module only applies
 * those decisions to a cloned plan.
 */

import {
  resolveChoosableEffects,
  resolveSpellSelection,
  resolveTalentChoice,
  talentRollCount,
} from "./class-idiom.mjs";

export const ADVANCEMENT_STATUSES = Object.freeze(["complete", "failed"]);

export const ADVANCEMENT_FAILURE_CODES = Object.freeze([
  "invalid-level-one-plan",
  "invalid-target-level",
  "invalid-roll-formula",
  "missing-source",
  "uncovered-roll",
  "unsupported-choice",
  "spell-quota-unmet",
]);

export const ADVANCEMENT_WARNING_CODES = Object.freeze([
  "resolver-fallback",
  "duplicate-reroll",
  "duplicate-cap",
  "recursion-cap",
]);

const FAILURE = Object.freeze({
  INVALID_PLAN: "invalid-level-one-plan",
  INVALID_TARGET: "invalid-target-level",
  INVALID_FORMULA: "invalid-roll-formula",
  MISSING_SOURCE: "missing-source",
  UNCOVERED: "uncovered-roll",
  UNSUPPORTED: "unsupported-choice",
  SPELL_QUOTA: "spell-quota-unmet",
});

const WARNING = Object.freeze({
  FALLBACK: "resolver-fallback",
  DUPLICATE_REROLL: "duplicate-reroll",
  DUPLICATE_CAP: "duplicate-cap",
  RECURSION_CAP: "recursion-cap",
});

const MAX_FOLLOWUP_DEPTH = 4;
const MAX_DUPLICATE_ATTEMPTS = 3;
const INTERNAL_ID = "__advancementSourceId";

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function cloneValue(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Set) return new Set([...value].map((entry) => cloneValue(entry, seen)));
  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [key, entry] of value) copy.set(cloneValue(key, seen), cloneValue(entry, seen));
    return copy;
  }
  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    for (const entry of value) copy.push(cloneValue(entry, seen));
    return copy;
  }
  const copy = {};
  seen.set(value, copy);
  for (const [key, entry] of Object.entries(value)) copy[key] = cloneValue(entry, seen);
  return copy;
}

function own(value, key) {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function dataOf(value) {
  return isObject(value?.data) ? value.data : value;
}

function idOf(value, fallback = "") {
  if (typeof value === "string") return value;
  if (!isObject(value)) return String(fallback ?? "");
  return String(value.sourceId ?? value.uuid ?? value.id ?? value._id ?? fallback ?? "");
}

function nameOf(value) {
  if (!isObject(value)) return String(value ?? "");
  const data = dataOf(value);
  return String(data.name ?? value.name ?? data.label ?? value.label ?? "");
}

function entriesOf(value) {
  if (Array.isArray(value)) return value;
  if (!isObject(value)) return [];
  if (own(value, "sourceId") || own(value, "data") || own(value, "uuid") || own(value, "name")) return [value];
  return Object.values(value);
}

function keyedEntries(value) {
  if (Array.isArray(value)) return value.map((entry) => ({ entry, key: null }));
  if (value instanceof Map) return [...value.entries()].map(([key, entry]) => ({ entry, key }));
  if (!isObject(value)) return [];
  if (own(value, "sourceId") || own(value, "data") || own(value, "uuid") || own(value, "name")) {
    return [{ entry: value, key: null }];
  }
  return Object.entries(value).map(([key, entry]) => ({ entry, key }));
}

function lookupEntry(collection, wantedId) {
  const id = String(wantedId ?? "");
  if (!id) return null;
  if (collection instanceof Map) {
    const direct = collection.get(id);
    if (direct !== undefined) return { sourceId: String(direct?.sourceId ?? id), value: direct };
    for (const entry of collection.values()) if (idOf(entry) === id) return { sourceId: id, value: entry };
    return null;
  }
  if (isObject(collection) && own(collection, id)) {
    const direct = collection[id];
    return { sourceId: String(direct?.sourceId ?? id), value: direct };
  }
  for (const entry of entriesOf(collection)) {
    if (idOf(entry) === id) return { sourceId: String(entry?.sourceId ?? id), value: entry };
  }
  return null;
}

function itemSnapshot(source, wantedId) {
  const found = lookupEntry(source?.itemsById, wantedId);
  if (!found || !isObject(dataOf(found.value))) return null;
  return {
    sourceId: String(found.sourceId || wantedId),
    data: dataOf(found.value),
    followupTableId: found.value?.followupTableId ?? dataOf(found.value)?.followupTableId ?? null,
  };
}

function tableSnapshot(source, wantedId) {
  const found = lookupEntry(source?.tablesById, wantedId);
  if (!found || !isObject(dataOf(found.value))) return null;
  const table = dataOf(found.value);
  return {
    sourceId: String(table.sourceId ?? found.sourceId ?? wantedId),
    formula: table.formula,
    rows: table.rows,
    dedupe: table.dedupe === true,
  };
}

function parseFormula(formula) {
  const text = String(formula ?? "").trim();
  const match = text.match(/^(\d*)\s*d\s*(\d+)$/i);
  if (!match) return null;
  const count = Number(match[1] || 1);
  const sides = Number(match[2]);
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(sides) || count < 1 || sides < 1) return null;
  return { count, sides, formula: text };
}

function unitToDie(unit, sides) {
  const number = Number(unit);
  if (!Number.isFinite(number)) return null;
  const bounded = Math.max(0, Math.min(0.9999999999999999, number));
  return Math.floor(bounded * sides) + 1;
}

function rollFormula(formula, rng) {
  const parsed = parseFormula(formula);
  if (!parsed) return { ok: false, code: FAILURE.INVALID_FORMULA, evidence: { formula } };
  const dice = [];
  for (let index = 0; index < parsed.count; index++) {
    let sample;
    try {
      sample = rng();
    } catch (error) {
      return {
        ok: false,
        code: FAILURE.UNCOVERED,
        evidence: { formula: parsed.formula, die: index + 1, reason: "rng-threw", message: String(error?.message ?? error) },
      };
    }
    const die = unitToDie(sample, parsed.sides);
    if (die === null) {
      return {
        ok: false,
        code: FAILURE.UNCOVERED,
        evidence: { formula: parsed.formula, die: index + 1, reason: "rng-returned-nonfinite" },
      };
    }
    dice.push(die);
  }
  return { ok: true, formula: parsed.formula, dice, total: dice.reduce((sum, die) => sum + die, 0) };
}

function validRange(range) {
  return Array.isArray(range) && range.length === 2
    && Number.isSafeInteger(Number(range[0]))
    && Number.isSafeInteger(Number(range[1]))
    && Number(range[0]) <= Number(range[1]);
}

function rowsForTotal(table, total) {
  if (!Array.isArray(table?.rows)) return null;
  const covering = [];
  for (const [rowIndex, row] of table.rows.entries()) {
    if (!validRange(row?.range)) return { invalid: true, rowIndex, range: row?.range };
    const low = Number(row.range[0]);
    const high = Number(row.range[1]);
    if (total >= low && total <= high) {
      if (!Array.isArray(row.optionIds) || !row.optionIds.length) {
        return { invalid: true, rowIndex, range: row.range, reason: "empty-option-ids" };
      }
      covering.push({
        rowIndex,
        range: [low, high],
        optionIds: row.optionIds.map((id) => String(id ?? "")),
      });
    }
  }
  if (covering.length > 1) {
    return {
      invalid: true,
      reason: "overlapping-rows",
      rows: covering.map(({ rowIndex, range }) => ({ rowIndex, range })),
    };
  }
  return { optionIds: covering[0]?.optionIds ?? [] };
}

function replacementEntries(value) {
  return asArray(value?.effects).flatMap((effect, effectIndex) => {
    const changes = Array.isArray(effect?.changes)
      ? effect.changes
      : Array.isArray(effect?.system?.changes) ? effect.system.changes : [];
    return changes.some((change) => String(change?.key ?? "").includes("REPLACEME"))
      ? [{ effect, effectIndex, changes }] : [];
  });
}

function replacementToken(value) {
  if (typeof value === "string") return value;
  if (!isObject(value)) return "";
  const data = dataOf(value);
  const explicit = data.slug ?? value.slug ?? data.key ?? value.key;
  if (explicit != null && String(explicit).trim()) return String(explicit).trim();
  const name = nameOf(value).trim().toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return name;
}

function candidate(value, sourceId = "") {
  const data = cloneValue(dataOf(value));
  if (!isObject(data)) return null;
  Object.defineProperty(data, INTERNAL_ID, {
    configurable: true,
    enumerable: false,
    value: String(sourceId || idOf(value)),
  });
  if (!data.uuid && !data.id && !data._id && sourceId) data.uuid = String(sourceId);
  return data;
}

function candidateId(value, fallback = "") {
  if (!isObject(value)) return String(value ?? fallback ?? "");
  return String(value[INTERNAL_ID] ?? value.sourceId ?? value.uuid ?? value.id ?? value._id ?? fallback ?? "");
}

function choicePool(source, spec) {
  const pools = source?.choicePools;
  const aliases = {
    weapon: ["weapon", "weapons", "weaponOptions"],
    armor: ["armor", "armors", "armorOptions"],
    spell: ["spell", "spells", "spellOptions"],
  };
  let raw;
  for (const key of aliases[spec] ?? [spec]) {
    if (isObject(pools) && own(pools, key)) { raw = pools[key]; break; }
  }
  if (raw == null && spec === "spell") raw = source?.spellPool;
  return keyedEntries(raw).map(({ entry, key }) => {
    if (typeof entry === "string") {
      const found = itemSnapshot(source, entry);
      return found ? candidate(found.data, found.sourceId) : candidate({ name: entry }, entry);
    }
    const sourceId = String(entry?.sourceId ?? key ?? dataOf(entry)?.uuid ?? dataOf(entry)?.id ?? dataOf(entry)?._id ?? "");
    return candidate(entry, sourceId);
  }).filter(Boolean);
}

function spellPool(source) {
  return keyedEntries(source?.spellPool).map(({ entry, key }, index) => {
    const data = dataOf(entry);
    const sourceId = String(entry?.sourceId ?? key ?? data?.uuid ?? data?.id ?? data?._id ?? `spell-${index}`);
    return { sourceId, data, candidate: candidate(data, sourceId) };
  }).filter((entry) => entry.sourceId && entry.candidate);
}

function classData(source) {
  return dataOf(source?.classItem);
}

function isCaster(source) {
  const spellcasting = classData(source)?.system?.spellcasting;
  return !!spellcasting
    && String(spellcasting.class ?? "") !== "__not_spellcaster__"
    && String(spellcasting.ability ?? "") !== "";
}

function spellGrid(source) {
  const system = classData(source)?.system ?? {};
  return system.spellcasting?.spellsknown ?? system.spellsknown ?? null;
}

function gridRow(grid, level) {
  if (Array.isArray(grid)) {
    const explicit = grid.find((row) => Number(row?.level) === level);
    if (explicit) return explicit.tiers ?? explicit;
    const indexed = grid[level - 1] ?? grid[level];
    if (isObject(indexed) || Array.isArray(indexed)) return indexed.tiers ?? indexed;
    return null;
  }
  if (!isObject(grid)) return null;
  const row = grid[String(level)] ?? grid[level];
  if (isObject(row) || Array.isArray(row)) return row.tiers ?? row;
  return null;
}

function quotaValue(row, tier) {
  if (Array.isArray(row)) {
    const value = row.length > 5 ? row[tier] : row[tier - 1];
    return value == null ? 0 : Number(isObject(value) ? value.count ?? value.value ?? 0 : value);
  }
  if (!isObject(row)) return null;
  const value = row[String(tier)] ?? row[tier];
  if (value == null) return 0;
  if (isObject(value)) return Number(value.count ?? value.value ?? 0);
  return Number(value);
}

function hasReplacement(value) {
  return replacementEntries(value).length > 0;
}

function activeHpAdvantage(items, actorData) {
  const values = [
    ...asArray(actorData?.effects),
    ...asArray(items).flatMap((entry) => asArray(dataOf(entry)?.effects)),
  ];
  return values.some((effect) => {
    if (effect?.disabled === true) return false;
    const changes = Array.isArray(effect?.changes)
      ? effect.changes
      : Array.isArray(effect?.system?.changes) ? effect.system.changes : [];
    return changes.some((change) => String(change?.key ?? "") === "system.roll.hp.advantage"
      && change?.value !== false
      && String(change?.value ?? "true").toLowerCase() !== "false"
      && String(change?.value ?? "true") !== "0");
  });
}

function sourceShape(source) {
  return isObject(source)
    && isObject(source.classItem)
    && (isObject(source.tablesById) || source.tablesById instanceof Map)
    && (isObject(source.itemsById) || source.itemsById instanceof Map)
    && (Array.isArray(source.spellPool) || isObject(source.spellPool) || source.spellPool instanceof Map);
}

function levelOneShape(plan) {
  if (!isObject(plan) || !isObject(plan.actorData) || own(plan.actorData, "items")
    || !Array.isArray(plan.items) || !Array.isArray(plan.knownSpellIds)
    || (!isObject(plan.seenByTable) && !(plan.seenByTable instanceof Map))) return false;
  const level = plan.actorData?.system?.level;
  const actorLevel = isObject(level) ? level.value : level;
  if (Number(actorLevel) !== 1) return false;
  const hp = plan.actorData?.system?.attributes?.hp;
  if (!isObject(hp) || !Number.isFinite(Number(hp.max)) || !Number.isFinite(Number(hp.value))) return false;
  return plan.items.every((entry) => isObject(entry) && String(entry.sourceId ?? "")
    && isObject(entry.data));
}

function addWarning(state, code, details = {}) {
  const warning = { code, ...cloneValue(details) };
  state.warnings.push(warning);
  if (state.levelRecord) state.levelRecord.warnings.push(cloneValue(warning));
}

function failure(state, code, level, stage, evidence) {
  if (state.levelRecord && state.levelRecord.status === "in-progress") {
    state.levelRecord.status = "failed";
    state.levelRecord.failure = { code, stage, evidence: cloneValue(evidence) };
    state.history.push(state.levelRecord);
    state.levelRecord = null;
  }
  return {
    status: "failed",
    code,
    level,
    stage,
    evidence: cloneValue(evidence),
    history: cloneValue(state.history),
    warnings: cloneValue(state.warnings),
  };
}

function completeLevel(state) {
  if (state.levelRecord) {
    state.levelRecord.status = "complete";
    state.levelRecord.knownSpellIds = [...state.knownSpellIds];
    state.history.push(state.levelRecord);
    state.levelRecord = null;
  }
}

function sourceRef(state, value) {
  const id = String(value ?? "");
  if (id && !state.sourceRefs.includes(id)) state.sourceRefs.push(id);
}

function seedSeen(plan, source) {
  const seen = new Map();
  const input = plan.seenByTable instanceof Map ? [...plan.seenByTable.entries()] : Object.entries(plan.seenByTable);
  for (const [tableId, values] of input) {
    const entries = values instanceof Set ? [...values] : asArray(values);
    const set = new Set(entries.map((value) => String(value ?? "")).filter(Boolean));
    seen.set(String(tableId), set);
  }
  for (const tableId of seen.keys()) {
    const table = tableSnapshot(source, tableId);
    if (table?.sourceId && table.sourceId !== tableId) {
      const existing = seen.get(table.sourceId) ?? new Set();
      for (const value of seen.get(tableId)) existing.add(value);
      seen.set(table.sourceId, existing);
    }
  }
  return seen;
}

function seenFor(state, table) {
  const current = state.seen.get(table.sourceId) ?? new Set();
  state.seen.set(table.sourceId, current);
  return current;
}

function classTableId(source) {
  return source?.classTalentTableId ?? null;
}

function setActorLevel(actorData, level) {
  if (isObject(actorData?.system?.level)) actorData.system.level.value = level;
  else actorData.system.level = level;
}

function optionsFor(source, ids) {
  const options = [];
  for (const sourceId of ids) {
    if (!sourceId) return { ok: false, code: FAILURE.MISSING_SOURCE, evidence: { sourceId, reason: "empty-option-id" } };
    const item = itemSnapshot(source, sourceId);
    if (!item) return { ok: false, code: FAILURE.MISSING_SOURCE, evidence: { sourceId } };
    const option = candidate(item.data, item.sourceId);
    if (!option) return { ok: false, code: FAILURE.MISSING_SOURCE, evidence: { sourceId } };
    options.push({ sourceId: item.sourceId, option, item });
  }
  return { ok: true, options };
}

function resolveTalent(source, ids, state, level, tableId) {
  const available = optionsFor(source, ids);
  if (!available.ok) return available;
  const resolved = resolveTalentChoice({
    options: available.options.map((entry) => entry.option),
    idiom: source.idiom,
  });
  if (resolved?.unsupported) {
    return {
      ok: false,
      code: FAILURE.UNSUPPORTED,
      evidence: { tableId, sourceIds: ids, unsupported: resolved.unsupported },
    };
  }
  if (!resolved || !isObject(resolved) || !resolved.value) {
    return { ok: false, code: FAILURE.UNSUPPORTED, evidence: { tableId, sourceIds: ids, result: resolved } };
  }
  if (resolved.fallbackUsed) addWarning(state, WARNING.FALLBACK, { level, tableId, kind: "talent" });
  const selectedId = candidateId(resolved.value);
  const selected = available.options.find((entry) => entry.sourceId === selectedId)
    ?? available.options.find((entry) => entry.option === resolved.value);
  if (!selected) return { ok: false, code: FAILURE.MISSING_SOURCE, evidence: { tableId, sourceId: selectedId } };
  return { ok: true, item: selected.item, selectedId };
}

function rollTalentFromTable(state, tableId, level, stage = "talent-table") {
  const table = tableSnapshot(state.source, tableId);
  if (!table) return { ok: false, code: FAILURE.MISSING_SOURCE, stage, evidence: { tableId } };
  sourceRef(state, table.sourceId);
  const seen = seenFor(state, table);
  const attempts = [];
  for (let attempt = 1; attempt <= MAX_DUPLICATE_ATTEMPTS; attempt++) {
    const rolled = rollFormula(table.formula, state.rng);
    if (!rolled.ok) return { ...rolled, stage, evidence: { tableId, ...rolled.evidence }, attempts };
    const rows = rowsForTotal(table, rolled.total);
    if (!rows || rows.invalid) {
      return {
        ok: false,
        code: FAILURE.UNCOVERED,
        stage,
        evidence: {
          tableId,
          total: rolled.total,
          range: rows?.range,
          rowIndex: rows?.rowIndex,
          ...(rows?.rows ? { rows: rows.rows } : {}),
          reason: rows?.reason ?? "no-covering-row",
        },
        attempts: [...attempts, { attempt, total: rolled.total, dice: rolled.dice }],
      };
    }
    if (!rows.optionIds.length) {
      return {
        ok: false,
        code: FAILURE.UNCOVERED,
        stage,
        evidence: { tableId, total: rolled.total, reason: "no-covering-row" },
        attempts: [...attempts, { attempt, total: rolled.total, dice: rolled.dice }],
      };
    }
    const choice = resolveTalent(state.source, rows.optionIds, state, level, table.sourceId);
    if (!choice.ok) return { ...choice, stage, attempts: [...attempts, { attempt, total: rolled.total, dice: rolled.dice }] };
    const duplicate = table.dedupe && seen.has(choice.selectedId);
    const attemptRecord = {
      attempt,
      total: rolled.total,
      dice: rolled.dice,
      sourceId: choice.selectedId,
      duplicate,
    };
    attempts.push(attemptRecord);
    if (duplicate && attempt < MAX_DUPLICATE_ATTEMPTS) {
      addWarning(state, WARNING.DUPLICATE_REROLL, {
        level, tableId: table.sourceId, attempt, sourceId: choice.selectedId,
      });
      continue;
    }
    if (duplicate) {
      addWarning(state, WARNING.DUPLICATE_CAP, {
        level, tableId: table.sourceId, attempts: MAX_DUPLICATE_ATTEMPTS, sourceId: choice.selectedId,
      });
    }
    seen.add(choice.selectedId);
    return { ok: true, item: choice.item, selectedId: choice.selectedId, attempts, tableId: table.sourceId };
  }
  return { ok: false, code: FAILURE.UNCOVERED, stage, evidence: { tableId }, attempts };
}

function applyResolvedEffects(data, source, state, level, stage) {
  const entries = replacementEntries(data);
  if (!entries.length) return { ok: true, data };
  const optionsBySpec = {
    weapon: choicePool(source, "weapon"),
    armor: choicePool(source, "armor"),
    spell: choicePool(source, "spell"),
  };
  const known = spellPool(source)
    .filter((entry) => state.knownSpellIds.has(entry.sourceId))
    .map((entry) => entry.candidate);
  const resolved = resolveChoosableEffects(data, {
    idiom: source.idiom,
    classItem: classData(source),
    optionsBySpec,
    knownSpells: known,
    rng: state.rng,
  });
  if (resolved?.unsupported) {
    return { ok: false, code: FAILURE.UNSUPPORTED, stage, evidence: { level, result: resolved } };
  }
  const values = resolved?.value;
  if (!Array.isArray(values) || values.length !== entries.length) {
    return { ok: false, code: FAILURE.UNSUPPORTED, stage, evidence: { level, result: resolved } };
  }
  const output = cloneValue(data);
  for (const [index, entry] of values.entries()) {
    const nested = entry?.result;
    if (nested?.unsupported) {
      return {
        ok: false,
        code: FAILURE.UNSUPPORTED,
        stage,
        evidence: { level, effectIndex: index, unsupported: nested.unsupported, result: nested },
      };
    }
    if (!nested || !nested.value) {
      return { ok: false, code: FAILURE.UNSUPPORTED, stage, evidence: { level, effectIndex: index, result: nested } };
    }
    if (nested.fallbackUsed) addWarning(state, WARNING.FALLBACK, { level, kind: "effect", effectIndex: index });
    const chosenSourceId = nested.value?.[INTERNAL_ID] ?? nested.value?.sourceId
      ?? nested.value?.uuid ?? nested.value?.id ?? nested.value?._id;
    if (chosenSourceId) sourceRef(state, chosenSourceId);
    const token = replacementToken(nested.value);
    if (!token) {
      return { ok: false, code: FAILURE.UNSUPPORTED, stage, evidence: { level, effectIndex: index, result: nested, reason: "choice-token-missing" } };
    }
    const target = output.effects?.[entries[index].effectIndex];
    if (!target) return { ok: false, code: FAILURE.UNSUPPORTED, stage, evidence: { level, effectIndex: index, reason: "effect-missing" } };
    if (Array.isArray(target.changes)) {
      for (const change of target.changes) change.key = String(change.key ?? "").replaceAll("REPLACEME", token);
    } else if (Array.isArray(target.system?.changes)) {
      for (const change of target.system.changes) change.key = String(change.key ?? "").replaceAll("REPLACEME", token);
    }
  }
  if (hasReplacement(output)) {
    return { ok: false, code: FAILURE.UNSUPPORTED, stage, evidence: { level, reason: "replacement-remains" } };
  }
  return { ok: true, data: output };
}

function addTalent(state, item, sourceId, level, depth, tableId, attempts) {
  const data = cloneValue(item.data);
  if (!isObject(data.system)) data.system = {};
  data.system.level = level;
  const effects = applyResolvedEffects(data, state.source, state, level, "talent-choice");
  if (!effects.ok) return effects;
  state.items.push(effects.data);
  sourceRef(state, sourceId);
  state.levelRecord.talents.push({
    sourceId,
    tableId,
    depth,
    attempts: cloneValue(attempts),
  });
  return { ok: true, data: effects.data };
}

function expandTalent(state, item, sourceId, level, depth, tableId, attempts) {
  const added = addTalent(state, item, sourceId, level, depth, tableId, attempts);
  if (!added.ok) return added;
  const followupTableId = item.followupTableId ?? dataOf(item.data)?.followupTableId ?? null;
  if (!followupTableId) return { ok: true };
  const count = talentRollCount(item.data);
  if (depth >= MAX_FOLLOWUP_DEPTH) {
    addWarning(state, WARNING.RECURSION_CAP, {
      level, tableId: followupTableId, sourceId, depth, suppressed: count,
    });
    const record = state.levelRecord.talents[state.levelRecord.talents.length - 1];
    record.recursion = { cap: true, suppressed: count };
    return { ok: true };
  }
  for (let index = 0; index < count; index++) {
    const rolled = rollTalentFromTable(state, followupTableId, level, "talent-followup");
    if (!rolled.ok) return rolled;
    const child = expandTalent(state, rolled.item, rolled.selectedId, level, depth + 1, rolled.tableId, rolled.attempts);
    if (!child.ok) return child;
  }
  return { ok: true };
}

function rollHp(state, level) {
  const formula = classData(state.source)?.system?.hitPoints;
  if (formula == null || String(formula).trim() === "") {
    return { ok: false, code: FAILURE.MISSING_SOURCE, stage: "hp", evidence: { level, reason: "hit-points-missing" } };
  }
  const advantage = activeHpAdvantage(state.items, state.actorData);
  const first = rollFormula(formula, state.rng);
  if (!first.ok) return { ...first, stage: "hp", evidence: { level, ...first.evidence } };
  const rolls = [first];
  if (advantage) {
    const second = rollFormula(formula, state.rng);
    if (!second.ok) return { ...second, stage: "hp", evidence: { level, ...second.evidence } };
    rolls.push(second);
  }
  const kept = Math.max(...rolls.map((entry) => entry.total));
  const hp = state.actorData.system.attributes.hp;
  hp.max = Number(hp.max) + kept;
  hp.value = Number(hp.value) + kept;
  return {
    ok: true,
    formula: first.formula,
    advantage,
    rolls: rolls.map((entry) => entry.total),
    dice: rolls.map((entry) => entry.dice),
    kept,
  };
}

function advanceSpells(state, level) {
  if (!isCaster(state.source)) return { ok: true, selected: [], requested: {} };
  const grid = spellGrid(state.source);
  if (!grid) return { ok: false, code: FAILURE.MISSING_SOURCE, stage: "spell-grid", evidence: { level, reason: "spellsknown-missing" } };
  const previous = gridRow(grid, level - 1);
  const target = gridRow(grid, level);
  if (!previous || !target) {
    return { ok: false, code: FAILURE.MISSING_SOURCE, stage: "spell-grid", evidence: { level, previous: !!previous, target: !!target } };
  }
  const requested = {};
  for (let tier = 1; tier <= 5; tier++) {
    const before = quotaValue(previous, tier);
    const after = quotaValue(target, tier);
    if (!Number.isFinite(before) || !Number.isFinite(after) || before < 0 || after < 0 || after < before) {
      return { ok: false, code: FAILURE.SPELL_QUOTA, stage: "spell-grid", evidence: { level, tier, before, after } };
    }
    const delta = after - before;
    if (delta > 0) requested[String(tier)] = delta;
  }
  const pool = [];
  const seenPool = new Set();
  for (const entry of spellPool(state.source)) {
    if (seenPool.has(entry.sourceId) || state.knownSpellIds.has(entry.sourceId)) continue;
    seenPool.add(entry.sourceId);
    pool.push(entry);
  }
  if (!Object.keys(requested).length) return { ok: true, selected: [], requested };
  const resolved = resolveSpellSelection({
    spells: pool.map((entry) => entry.candidate),
    quotas: requested,
  });
  if (resolved?.unsupported) {
    return {
      ok: false,
      code: FAILURE.SPELL_QUOTA,
      stage: "spell-selection",
      evidence: { level, requested, unsupported: resolved.unsupported },
    };
  }
  const chosen = asArray(resolved?.value).map((value) => {
    const sourceId = candidateId(value);
    return pool.find((entry) => entry.sourceId === sourceId) ?? null;
  });
  if (chosen.some((entry) => !entry)) {
    return { ok: false, code: FAILURE.MISSING_SOURCE, stage: "spell-selection", evidence: { level, requested } };
  }
  const selected = chosen.map((entry) => entry.sourceId);
  const accepted = [];
  const acceptedByTier = {};
  for (const entry of chosen) {
    const data = cloneValue(entry.data);
    const resolved = hasReplacement(data)
      ? applyResolvedEffects(data, state.source, state, level, "spell-choice")
      : { ok: true, data };
    if (!resolved.ok) {
      return {
        ...resolved,
        requested,
        selected: [...accepted],
        byTier: { ...acceptedByTier },
      };
    }
    state.items.push(resolved.data);
    state.knownSpellIds.add(entry.sourceId);
    sourceRef(state, entry.sourceId);
    accepted.push(entry.sourceId);
    const acceptedTier = Number(entry.data?.tier ?? entry.data?.system?.tier ?? 0);
    acceptedByTier[String(acceptedTier)] = (acceptedByTier[String(acceptedTier)] ?? 0) + 1;
  }
  const byTier = {};
  for (const entry of chosen) {
    const tier = Number(entry.data?.tier ?? entry.data?.system?.tier ?? 0);
    byTier[String(tier)] = (byTier[String(tier)] ?? 0) + 1;
  }
  const unmet = Object.entries(requested)
    .map(([tier, count]) => ({ tier: Number(tier), requested: count, selected: byTier[tier] ?? 0 }))
    .filter((entry) => entry.selected < entry.requested);
  if (unmet.length || resolved?.fallbackUsed) {
    return {
      ok: false,
      code: FAILURE.SPELL_QUOTA,
      stage: "spell-selection",
      requested,
      selected,
      byTier,
      evidence: { level, requested, selected, unmet, signals: resolved?.signals ?? [] },
    };
  }
  return { ok: true, selected, requested, byTier };
}

function initialState(levelOnePlan, source, rng) {
  const actorData = cloneValue(levelOnePlan.actorData);
  const items = levelOnePlan.items.map((entry) => cloneValue(entry.data));
  const knownSpellIds = new Set(levelOnePlan.knownSpellIds.map((entry) => idOf(entry)).filter(Boolean));
  const state = {
    actorData,
    items,
    knownSpellIds,
    source,
    rng,
    seen: seedSeen(levelOnePlan, source),
    history: [],
    warnings: [],
    sourceRefs: [],
    levelRecord: null,
  };
  for (const entry of levelOnePlan.items) sourceRef(state, entry.sourceId);
  for (const entry of levelOnePlan.knownSpellIds) sourceRef(state, idOf(entry));
  const classId = idOf(source.classItem);
  if (classId) sourceRef(state, classId);
  return state;
}

/**
 * Advance one complete level-one plan through a target level in [1, 6].
 *
 * @param {{levelOnePlan: object, targetLevel: number, source: object, rng: Function}} input
 * @returns {object} A complete plan or a tagged diagnostic failure.
 */
export function advanceMemberPlan({ levelOnePlan, targetLevel, source, rng } = {}) {
  if (typeof targetLevel !== "number" || !Number.isSafeInteger(targetLevel)
    || targetLevel < 1 || targetLevel > 6) {
    return {
      status: "failed",
      code: FAILURE.INVALID_TARGET,
      level: targetLevel,
      stage: "input",
      evidence: { targetLevel, supported: [1, 6] },
      history: [],
      warnings: [],
    };
  }
  const target = targetLevel;
  if (!levelOneShape(levelOnePlan)) {
    return {
      status: "failed",
      code: FAILURE.INVALID_PLAN,
      level: 1,
      stage: "input",
      evidence: { required: "levelOnePlan={actorData,items,knownSpellIds,seenByTable}" },
      history: [],
      warnings: [],
    };
  }
  if (!sourceShape(source)) {
    return {
      status: "failed",
      code: FAILURE.MISSING_SOURCE,
      level: target > 1 ? 2 : 1,
      stage: "input",
      evidence: { required: "source={classItem,tablesById,itemsById,spellPool}" },
      history: [],
      warnings: [],
    };
  }
  if (target === 1) {
    const state = initialState(levelOnePlan, source, rng);
    state.actorData.items = state.items;
    return {
      status: "complete",
      actorData: state.actorData,
      history: [],
      warnings: state.warnings,
      sourceRefs: state.sourceRefs,
    };
  }
  if (typeof rng !== "function") {
    return {
      status: "failed",
      code: FAILURE.UNCOVERED,
      level: target > 1 ? 2 : 1,
      stage: "randomness",
      evidence: { reason: "injected-rng-required" },
      history: [],
      warnings: [],
    };
  }
  const state = initialState(levelOnePlan, source, rng);

  for (const [index, item] of state.items.entries()) {
    if (!hasReplacement(item)) continue;
    const resolved = applyResolvedEffects(item, source, state, 1, "level-one-choice");
    if (!resolved.ok) return failure(state, resolved.code, 1, resolved.stage, resolved.evidence);
    state.items[index] = resolved.data;
  }

  for (let level = 2; level <= target; level++) {
    state.levelRecord = {
      level,
      status: "in-progress",
      hp: null,
      talents: [],
      spells: null,
      warnings: [],
    };
    const hp = rollHp(state, level);
    if (!hp.ok) return failure(state, hp.code, level, hp.stage, hp.evidence);
    state.levelRecord.hp = hp;

    if (level === 3 || level === 5) {
      const tableId = classTableId(source);
      if (!tableId) return failure(state, FAILURE.MISSING_SOURCE, level, "talent-table", { reason: "class-talent-table-missing" });
      const rolled = rollTalentFromTable(state, tableId, level);
      if (!rolled.ok) return failure(state, rolled.code, level, rolled.stage, rolled.evidence);
      const talent = expandTalent(state, rolled.item, rolled.selectedId, level, 0, rolled.tableId, rolled.attempts);
      if (!talent.ok) return failure(state, talent.code, level, talent.stage ?? "talent", talent.evidence);
    }

    const spells = advanceSpells(state, level);
    state.levelRecord.spells = spells.ok
      ? { requested: spells.requested, selected: spells.selected, byTier: spells.byTier ?? {} }
      : { requested: spells.requested ?? {}, selected: spells.selected ?? [], byTier: spells.byTier ?? {} };
    if (!spells.ok) return failure(state, spells.code, level, spells.stage, spells.evidence);

    const unresolvedIndex = state.items.findIndex((entry) => hasReplacement(entry));
    if (unresolvedIndex >= 0) {
      return failure(state, FAILURE.UNSUPPORTED, level, "materialize", {
        level, itemIndex: unresolvedIndex, reason: "replacement-remains",
      });
    }

    setActorLevel(state.actorData, level);
    completeLevel(state);
  }

  state.actorData.items = state.items;
  return {
    status: "complete",
    actorData: state.actorData,
    history: state.history,
    warnings: state.warnings,
    sourceRefs: state.sourceRefs,
  };
}
