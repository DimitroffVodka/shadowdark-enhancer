import { createSeededRng, pickSeeded, randomInt } from "./forge-loot-rng.mjs";
import { selectEligibleRivalClasses } from "./rival-class-table.mjs";
import { advanceMemberPlan } from "./advancement-engine.mjs";
import {
  CHOICE_SPECS,
  choosableEffects,
  resolveChoosableEffects,
  resolveClassChoices,
} from "./class-idiom.mjs";
import {
  requireSupportingTable,
  resolveSupportingTableCatalog,
  resolveSupportingTableRole,
} from "./supporting-tables.mjs";
import { immutable } from "./forge-loot-core.mjs";
import { columnSlug, formulaFromDie } from "../importer/tables/table-manifest.mjs";
import { abilityMod, ABILITY_ORDER, STAT_METHODS } from "../char-builder/constants.mjs";

const FORMULA = /^(\d+)d(\d+)$/;

function rowsOf(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === "function") return [...value.values()];
  if (typeof value[Symbol.iterator] === "function") return [...value];
  return [];
}

function rowName(row) {
  for (const value of [row?.name, row?.description, row?.text]) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function errorMessage(code, role, evidence) {
  const subject = role ?? "Rival party";
  const messages = {
    "party-formula-invalid": `${subject} has an invalid die formula (${evidence.formula ?? "missing"}).`,
    "party-draw-invalid": `${subject} could not be rolled because its seeded random draw is invalid.`,
    "party-rows-empty": `${subject} has no result rows.`,
    "party-row-range-invalid": `${subject} has an invalid result range.`,
    "party-uncovered-roll": `${subject} does not cover rolled result ${evidence.roll}.`,
    "party-ambiguous-roll": `${subject} has more than one result for rolled result ${evidence.roll}.`,
    "party-role-not-ready": `${subject} is missing or could not be resolved.`,
    "party-value-blank": `${subject} returned a blank result.`,
    "party-language-pool-short": `${subject} does not contain enough distinct languages to fill every required choice.`,
  };
  return messages[code] ?? `${subject} could not be assembled (${code}).`;
}

function plannerError(code, role, evidence = {}) {
  return Object.assign(new Error(errorMessage(code, role, evidence)), {
    code,
    role: role ?? null,
    ...evidence,
  });
}

function tableResultUuid(row) {
  for (const value of [row?.documentUuid, row?._source?.documentUuid]) {
    const uuid = String(value ?? "").trim();
    if (uuid) return uuid;
  }
  return null;
}

function cloneValue(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  const copy = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  for (const [key, entry] of Object.entries(value)) copy[key] = cloneValue(entry, seen);
  return copy;
}

function refusal(code, role, message, report) {
  return {
    ok: false,
    code,
    role: role ?? null,
    message,
    report: cloneValue(report),
  };
}

export function preflightParty(report) {
  if (!report || typeof report !== "object"
    || !Array.isArray(report.classes) || !Array.isArray(report.sources)) {
    return refusal(
      "party-report-invalid",
      "class readiness",
      "The class readiness report is unavailable or malformed.",
      report,
    );
  }
  for (const source of ["core", "importer-managed"]) {
    const row = report.sources.find((entry) => entry?.source === source);
    if (!row || row.present !== true || row.error) {
      return refusal(
        "party-source-health-invalid",
        source,
        `The required ${source} class source is absent or could not be read.`,
        report,
      );
    }
  }
  const winners = selectEligibleRivalClasses(report);
  if (!winners.length) {
    return refusal(
      "party-no-eligible-classes",
      "Rival Crawler classes",
      "No eligible class is available for unattended Rival Crawler generation.",
      report,
    );
  }
  return { ok: true, winners };
}

export function projectTableRows(state) {
  const descriptor = state?.descriptor ?? state;
  const table = state?.table ?? descriptor?.table ?? descriptor;
  return {
    ready: state?.ready ?? true,
    manifestId: state?.manifestId ?? descriptor?.manifestId ?? null,
    name: String(table?.name ?? descriptor?.name ?? ""),
    formula: formulaFromDie(table?.formula ?? descriptor?.formula ?? descriptor?.die) ?? null,
    uuid: table?.uuid ?? descriptor?.uuid ?? null,
    rows: rowsOf(table?.results ?? descriptor?.results).map((row) => ({
      id: row?.id ?? row?._id ?? null,
      name: rowName(row),
      type: row?.type ?? null,
      weight: row?.weight ?? null,
      range: Array.isArray(row?.range) ? [row.range[0], row.range[1]] : [row?.range, row?.range],
      documentUuid: tableResultUuid(row),
    })),
  };
}

function parseFormula(value, role) {
  const match = FORMULA.exec(String(value ?? "").trim().toLowerCase());
  const count = Number(match?.[1]);
  const faces = Number(match?.[2]);
  if (!match || !Number.isSafeInteger(count) || !Number.isSafeInteger(faces)
    || count < 1 || faces < 1) {
    throw plannerError("party-formula-invalid", role, { formula: value ?? null });
  }
  return { count, faces, domain: [count, count * faces] };
}

function guardedSample(rng, role) {
  if (typeof rng !== "function") throw plannerError("party-draw-invalid", role, { sample: null });
  const sample = rng();
  if (typeof sample !== "number" || !Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw plannerError("party-draw-invalid", role, { sample });
  }
  return sample;
}

function rollFormula(formula, rng, role) {
  const normalized = formulaFromDie(formula);
  const { count, faces } = parseFormula(normalized, role);
  const dice = [];
  for (let die = 0; die < count; die += 1) {
    const sample = guardedSample(rng, role);
    dice.push(1 + randomInt(() => sample, faces));
  }
  return { formula: normalized, dice, total: dice.reduce((sum, value) => sum + value, 0) };
}

function rollAbilityPool(methodKey, rng) {
  const method = STAT_METHODS[methodKey] ?? STAT_METHODS["3d6-reroll"];
  const rolls = ABILITY_ORDER.map(() => {
    if (method.formula === "4d6kh3") {
      const dice = rollFormula("4d6", rng, "ability scores").dice;
      const kept = [...dice].sort((left, right) => right - left).slice(0, 3);
      return { formula: method.formula, dice, kept, total: kept.reduce((sum, die) => sum + die, 0) };
    }
    return rollFormula(method.formula, rng, "ability scores");
  });
  return { method: methodKey in STAT_METHODS ? methodKey : "3d6-reroll", rolls, scores: rolls.map((roll) => roll.total) };
}

export function pickStrict(projection, rng, { role = "supporting table" } = {}) {
  const { count, faces, domain } = parseFormula(projection?.formula, role);
  const rows = Array.isArray(projection?.rows) ? projection.rows : [];
  if (!rows.length) throw plannerError("party-rows-empty", role);
  for (const [rowIndex, row] of rows.entries()) {
    const [low, high] = row?.range ?? [];
    if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high)
      || low > high || low < domain[0] || high > domain[1]) {
      throw plannerError("party-row-range-invalid", role, {
        rowIndex,
        range: [low, high],
        domain,
      });
    }
  }

  let roll = 0;
  for (let die = 0; die < count; die += 1) {
    const sample = guardedSample(rng, role);
    roll += 1 + randomInt(() => sample, faces);
  }
  const covering = rows.filter((row) => roll >= row.range[0] && roll <= row.range[1]);
  if (!covering.length) throw plannerError("party-uncovered-roll", role, { roll, domain });
  if (covering.length > 1) {
    throw plannerError("party-ambiguous-roll", role, {
      roll,
      covering: covering.map((row) => row.id),
    });
  }
  return { ...covering[0], roll, tableUuid: projection.uuid, manifestId: projection.manifestId };
}

function sourceEntry(collection, sourceId) {
  if (!sourceId) return null;
  if (collection instanceof Map) return collection.get(sourceId) ?? null;
  return collection?.[sourceId] ?? null;
}

function entryData(entry, sourceId = null) {
  const data = cloneValue(entry?.data ?? entry);
  if (!data || typeof data !== "object") return null;
  const identity = String(entry?.sourceId ?? sourceId ?? data.uuid ?? data.id ?? data._id ?? "").trim();
  if (identity && !data.uuid && !data.id && !data._id) data.uuid = identity;
  return data;
}

function entriesOf(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return [...value.values()];
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function candidates(value) {
  return entriesOf(value).map((entry) => {
    const data = entryData(entry);
    const identity = String(entry?.sourceId ?? entry?.uuid ?? entry?.id ?? entry?._id ?? "").trim();
    if (data && identity && !data.uuid) data.uuid = identity;
    return data;
  }).filter(Boolean);
}

function choicePoolsFor(source) {
  const pools = source?.choicePools ?? {};
  return Object.fromEntries(CHOICE_SPECS.map((spec) => [spec.key, candidates(
    pools[spec.key] ?? pools[`${spec.key}s`] ?? pools[`${spec.key}Options`],
  )]));
}

function sourceIdFor(source, value) {
  const identity = String(value?.sourceId ?? value?.uuid ?? value?.id ?? value?._id ?? "");
  if (identity && sourceEntry(source.itemsById, identity)) return identity;
  for (const [sourceId, entry] of Object.entries(source.itemsById ?? {})) {
    const data = entry?.data ?? entry;
    if (data?.name === value?.name) return sourceId;
  }
  return identity || null;
}

function selectedLevelOneTalent(source, idiom, rng) {
  const tableId = source.classTalentTableId
    ?? source.levelOne?.talentTableId
    ?? source.classItem?.data?.system?.classTalentTable
    ?? source.classItem?.system?.classTalentTable;
  const table = sourceEntry(source.tablesById, tableId);
  if (!table) throw plannerError("party-class-source-missing", "class talent table", { tableId });
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const picked = pickStrict({
    formula: table.formula,
    uuid: table.sourceId ?? tableId,
    rows: rows.map((row, index) => ({ id: index, range: row.range })),
  }, rng, { role: "class talent table" });
  const row = rows[picked.id];
  const optionIds = Array.isArray(row?.optionIds) ? row.optionIds : [];
  const options = optionIds.map((sourceId) => entryData(sourceEntry(source.itemsById, sourceId), sourceId)).filter(Boolean);
  if (!options.length) throw plannerError("party-class-talent-unresolved", "class talent table", { tableId, roll: picked.roll });
  const result = resolveClassChoices({ idiom, talentOptions: options, rng }).talent;
  if (result?.unsupported || !result?.value) {
    throw plannerError("party-choice-unresolved", "level-one class talent", { result });
  }
  return { sourceId: sourceIdFor(source, result.value), data: result.value, roll: picked.roll };
}

function replacementToken(value) {
  const explicit = value?.system?.slug ?? value?.slug ?? value?.key;
  const text = String(explicit ?? value?.name ?? "").trim().toLowerCase();
  return text.replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function materializeChoices(data, source, idiom, knownSpells, rng) {
  if (!choosableEffects(data).length) return cloneValue(data);
  const pools = choicePoolsFor(source);
  const resolved = resolveChoosableEffects(data, {
    idiom,
    classItem: entryData(source.classItem),
    optionsBySpec: pools,
    knownSpells,
    rng,
  });
  if (resolved?.unsupported || !Array.isArray(resolved?.value)) {
    throw plannerError("party-choice-unresolved", data?.name ?? "embedded item", { result: resolved });
  }
  const output = cloneValue(data);
  const originals = choosableEffects(data);
  for (const [index, entry] of resolved.value.entries()) {
    if (entry?.result?.unsupported || !entry?.result?.value) {
      throw plannerError("party-choice-unresolved", data?.name ?? "embedded item", { result: entry?.result });
    }
    const token = replacementToken(entry.result.value);
    if (!token) throw plannerError("party-choice-unresolved", data?.name ?? "embedded item", { reason: "blank choice token" });
    const effectIndex = (data.effects ?? []).indexOf(originals[index]);
    const effect = output.effects?.[effectIndex];
    const changes = Array.isArray(effect?.changes) ? effect.changes : effect?.system?.changes;
    for (const change of changes ?? []) change.key = String(change.key ?? "").replaceAll("REPLACEME", token);
  }
  if (JSON.stringify(output).includes("REPLACEME")) {
    throw plannerError("party-choice-unresolved", data?.name ?? "embedded item", { reason: "replacement remains" });
  }
  return output;
}

function ancestryTalentEntries(ancestry, source, idiom, rng) {
  const ids = Array.isArray(ancestry?.data?.system?.talents) ? ancestry.data.system.talents : [];
  const count = Number(ancestry?.data?.system?.talentChoiceCount ?? ids.length);
  const available = ids.map((sourceId) => ({
    sourceId,
    data: entryData(sourceEntry(ancestry.itemsById, sourceId) ?? sourceEntry(source.itemsById, sourceId), sourceId),
  })).filter((entry) => entry.data);
  if (available.length <= count) return available;
  const remaining = [...available];
  const selected = [];
  while (selected.length < count && remaining.length) {
    const result = resolveClassChoices({
      idiom,
      talentOptions: remaining.map((entry) => entry.data),
      rng: () => guardedSample(rng, "ancestry talent choice"),
    }).talent;
    if (!result?.value) break;
    const index = remaining.findIndex((entry) => entry.data.uuid === result.value.uuid || entry.data.name === result.value.name);
    selected.push(remaining.splice(Math.max(0, index), 1)[0]);
  }
  return selected;
}

function hpModifiers(items) {
  const result = { bonus: 0, advantage: false };
  for (const item of items) {
    for (const effect of item?.data?.effects ?? []) {
      if (effect?.disabled === true) continue;
      for (const change of effect?.changes ?? effect?.system?.changes ?? []) {
        if (change.key === "system.attributes.hp.max") result.bonus += Number(change.value) || 0;
        if (change.key === "system.roll.hp.advantage"
          && change.value !== false && String(change.value) !== "0") result.advantage = true;
      }
    }
  }
  return result;
}

function languageIdentity(value) {
  return String(value?.sourceId ?? value?.data?.uuid ?? value?.uuid
    ?? value?.data?.id ?? value?.id ?? value?.data?._id ?? value?._id ?? "").trim();
}

function drawDistinct(pool, count, rng, role, excluded) {
  const remaining = [...new Map(pool.map((entry) => [languageIdentity(entry), entry]))]
    .filter(([identity]) => identity && !excluded.has(identity));
  if (remaining.length < count) {
    throw plannerError("party-language-pool-short", role, { required: count, available: remaining.length });
  }
  const selected = [];
  while (selected.length < count) {
    const picked = pickSeeded(() => guardedSample(rng, role), remaining);
    const index = remaining.indexOf(picked);
    const [identity] = remaining.splice(index, 1)[0];
    selected.push(identity);
    excluded.add(identity);
  }
  return selected;
}

function languageIds(ancestry, classData, common, rng) {
  const ancestryLanguages = ancestry?.data?.system?.languages ?? {};
  const classLanguages = classData?.system?.languages ?? {};
  const fixed = [...new Set([
    ...(ancestryLanguages.fixed ?? []),
    ...(classLanguages.fixed ?? []),
  ].map((entry) => String(entry).trim()).filter(Boolean))];
  const selected = new Set(fixed);
  const commonCount = Number(ancestryLanguages.common ?? 0) + Number(classLanguages.common ?? 0);
  const rareCount = Number(ancestryLanguages.rare ?? 0) + Number(classLanguages.rare ?? 0);
  const selectCount = Number(ancestryLanguages.select ?? 0) + Number(classLanguages.select ?? 0);
  const selectOptions = [...new Set([
    ...(ancestryLanguages.selectOptions ?? []),
    ...(classLanguages.selectOptions ?? []),
  ].map((entry) => String(entry).trim()).filter(Boolean))].map((sourceId) => ({ sourceId }));
  return [
    ...fixed,
    ...drawDistinct(common?.commonLanguages ?? [], commonCount, rng, "common languages", selected),
    ...drawDistinct(common?.rareLanguages ?? [], rareCount, rng, "rare languages", selected),
    ...drawDistinct(selectOptions, selectCount, rng, "selected languages", selected),
  ];
}

function quotasAtLevelOne(classData) {
  return classData?.system?.spellcasting?.spellsknown?.[1]
    ?? classData?.system?.spellcasting?.spellsknown?.["1"]
    ?? null;
}

function toCoins(cp) {
  const value = Math.max(0, Math.floor(Number(cp) || 0));
  return { gp: Math.floor(value / 100), sp: Math.floor((value % 100) / 10), cp: value % 10 };
}

export function assembleMemberPlan({ member, shared, sourceSnapshot, rng } = {}) {
  try {
    const classId = String(member?.class?.classId ?? "").trim();
    const ancestryId = String(member?.ancestry?.documentUuid ?? "").trim();
    const source = sourceSnapshot?.classesById?.[classId];
    const ancestry = sourceSnapshot?.ancestriesById?.[ancestryId];
    if (!source) throw plannerError("party-class-source-missing", member?.class?.name ?? classId, { classId });
    if (!ancestry) throw plannerError("party-ancestry-source-missing", member?.ancestry?.name ?? ancestryId, { ancestryId });

    const classData = entryData(source.classItem, classId);
    const idiom = source.idiom;
    const choiceRng = () => guardedSample(rng, "class choices");
    const statMethod = String(sourceSnapshot?.generation?.statMethod ?? "3d6-reroll");
    const abilityPool = rollAbilityPool(statMethod, rng);
    const talent = selectedLevelOneTalent(source, idiom, choiceRng);
    const fixedStartingGold = Math.max(0, Number(sourceSnapshot?.generation?.startingGold) || 0);
    const goldRoll = fixedStartingGold > 0 ? null : rollFormula("2d6", rng, "starting gold");
    const startingGoldCp = fixedStartingGold > 0 ? fixedStartingGold * 100 : goldRoll.total * 500;
    const alignment = String(shared?.alignment ?? "").trim().toLowerCase();
    const spellPool = candidates(source.spellPool).filter((spell) => {
      const spellAlignment = String(spell?.flags?.["shadowdark-extras"]?.alignment ?? "")
        .trim().toLowerCase();
      return !spellAlignment || spellAlignment === alignment;
    });
    const common = sourceSnapshot.common ?? {};
    const patronRequired = classData.system?.patron?.required === true;
    const choices = resolveClassChoices({
      classItem: classData,
      idiom,
      scores: abilityPool.scores,
      method: abilityPool.method,
      talentOptions: [talent.data],
      weaponOptions: choicePoolsFor(source).weapon,
      armorOptions: choicePoolsFor(source).armor,
      spellOptions: choicePoolsFor(source).spell,
      knownSpells: [],
      spells: spellPool,
      quotas: quotasAtLevelOne(classData),
      ...(patronRequired ? { patrons: candidates(common.patrons) } : {}),
      deities: candidates(common.deities),
      alignment: shared?.alignment,
      gear: candidates(source.levelOne?.gear),
      budgetCp: startingGoldCp,
      rng: choiceRng,
    });
    if (choices.stats?.unsupported || !choices.stats?.value) {
      throw plannerError("party-choice-unresolved", "ability scores", { result: choices.stats });
    }
    if (patronRequired && (choices.patron?.unsupported || !choices.patron?.value)) {
      throw plannerError("party-choice-unresolved", `${classData.name} patron`, { result: choices.patron });
    }
    const levelOneQuotas = quotasAtLevelOne(classData);
    const unmetSpellQuotas = choices.spells?.signals?.flatMap((signal) => signal?.unmet ?? []) ?? [];
    if (levelOneQuotas && (choices.spells?.unsupported
      || !Array.isArray(choices.spells?.value) || unmetSpellQuotas.length)) {
      throw plannerError("party-choice-unresolved", `${classData.name} spells`, {
        result: choices.spells,
      });
    }
    if (choices.loadout?.unsupported || !Array.isArray(choices.loadout?.value)) {
      throw plannerError("party-choice-unresolved", `${classData.name} gear`, {
        result: choices.loadout,
      });
    }

    const ancestryItems = ancestryTalentEntries(ancestry, source, idiom, rng);
    const fixedIds = [
      ...(source.levelOne?.fixedItemIds ?? classData.system?.talents ?? []),
      ...(source.levelOne?.classAbilityIds ?? classData.system?.classAbilities ?? []),
      ...(source.levelOne?.grantedItemIds ?? []),
    ];
    const embedded = [
      ...ancestryItems,
      ...fixedIds.map((sourceId) => ({ sourceId, data: entryData(sourceEntry(source.itemsById, sourceId), sourceId) })),
      { sourceId: talent.sourceId, data: cloneValue(talent.data) },
    ].filter((entry) => entry.sourceId && entry.data);
    for (const spell of choices.spells?.value ?? []) {
      const sourceId = sourceIdFor(source, spell);
      embedded.push({ sourceId, data: spell });
    }
    for (const gear of choices.loadout?.value ?? []) {
      const sourceId = sourceIdFor(source, gear) ?? String(gear.uuid ?? gear.name);
      embedded.push({ sourceId, data: gear });
    }

    const knownSpellIds = (choices.spells?.value ?? []).map((spell) => sourceIdFor(source, spell)).filter(Boolean);
    const materialized = embedded.map((entry) => ({
      sourceId: entry.sourceId,
      data: materializeChoices(entry.data, source, idiom, choices.spells?.value ?? [], choiceRng),
    }));
    const modifiers = hpModifiers(materialized);
    const hpFormula = formulaFromDie(classData.system?.hitPoints);
    const hpShape = parseFormula(hpFormula, "level-one hit points");
    const maximizeHp = sourceSnapshot?.generation?.maxLevelOneHp === true;
    const firstHpRoll = maximizeHp ? null : rollFormula(hpFormula, rng, "level-one hit points");
    const secondHpRoll = !maximizeHp && modifiers.advantage
      ? rollFormula(hpFormula, rng, "level-one hit points")
      : null;
    const firstHp = maximizeHp ? hpShape.domain[1] : firstHpRoll.total;
    const secondHp = secondHpRoll?.total ?? firstHp;
    const con = abilityMod(choices.stats.value.con) ?? 0;
    const baseHp = Math.max(1, Math.max(firstHp, secondHp) + con);
    const hpValue = baseHp + modifiers.bonus;
    const patron = choices.patron?.value;
    const deity = choices.deity?.value;
    const backgrounds = entriesOf(sourceSnapshot.common?.backgrounds);
    const background = backgrounds.length
      ? pickSeeded(() => guardedSample(rng, "background"), backgrounds)
      : null;
    const languages = languageIds(ancestry, classData, common, rng);
    const classReference = String(source.classItem?.sourceId ?? classId).trim();
    const actorData = {
      name: String(member?.name ?? "Rival Crawler"),
      type: "Player",
      system: {
        abilities: Object.fromEntries(ABILITY_ORDER.map((ability) => [ability, { value: choices.stats.value[ability] }])),
        level: { value: 1, xp: 0 },
        alignment: String(shared?.alignment ?? "neutral").toLowerCase(),
        ancestry: ancestryId,
        class: classReference,
        background: String(background?.sourceId ?? background?.uuid ?? ""),
        deity: String(deity?.uuid ?? deity?.sourceId ?? ""),
        patron: String(patron?.uuid ?? patron?.sourceId ?? ""),
        coins: toCoins(startingGoldCp - (choices.loadout?.signals?.[0]?.spentCp ?? 0)),
        attributes: { hp: { value: hpValue, max: baseHp } },
        languages,
        luck: { remaining: 0, available: false },
      },
    };
    const levelOnePlan = {
      actorData,
      items: materialized,
      knownSpellIds,
      seenByTable: { [source.classTalentTableId]: [talent.sourceId] },
    };
    const advanced = advanceMemberPlan({
      levelOnePlan,
      targetLevel: member.targetLevel,
      source,
      rng: () => guardedSample(rng, "advancement"),
    });
    if (advanced.status !== "complete") {
      return {
        ok: false,
        code: advanced.code,
        role: member?.class?.name ?? classId,
        message: `${member?.class?.name ?? classId} could not be advanced: ${advanced.code}.`,
        evidence: advanced,
      };
    }
    return {
      ok: true,
      member: {
        ...cloneValue(member),
        actorData: advanced.actorData,
        advancement: advanced.history,
        generation: {
          abilityScores: {
            method: abilityPool.method,
            rolls: abilityPool.rolls,
            assignment: cloneValue(choices.stats.signals ?? []),
          },
          classTalent: { tableId: source.classTalentTableId, roll: talent.roll, sourceId: talent.sourceId },
          startingGold: {
            fixedGp: fixedStartingGold > 0 ? fixedStartingGold : null,
            roll: goldRoll,
            totalCp: startingGoldCp,
          },
          levelOneHp: {
            maximized: maximizeHp,
            rolls: [firstHpRoll, secondHpRoll].filter(Boolean),
            kept: Math.max(firstHp, secondHp),
            constitutionModifier: con,
            ancestryBonus: modifiers.bonus,
            total: hpValue,
          },
          languages,
          choices: cloneValue(choices),
        },
        warnings: [...cloneValue(member?.class?.warnings ?? []), ...advanced.warnings],
        sourceRefs: advanced.sourceRefs,
      },
    };
  } catch (error) {
    if (error?.code?.startsWith("party-")) {
      return {
        ok: false,
        code: error.code,
        role: error.role,
        message: error.message,
        evidence: cloneValue(error),
      };
    }
    throw error;
  }
}

function requiredRole(catalog, role, options = {}) {
  const state = resolveSupportingTableRole(role, { catalog, ...options });
  if (state?.ready) return state;
  try {
    requireSupportingTable(role, { catalog, ...options });
  } catch (error) {
    throw plannerError("party-role-not-ready", role, {
      diagnostics: cloneValue(state?.diagnostics ?? []),
      reason: String(error?.message ?? error),
    });
  }
  throw plannerError("party-role-not-ready", role);
}

function requiredFamilyChild(catalog, familyRole, columnKey, logicalRole) {
  const family = catalog?.roles?.[familyRole];
  const child = family?.children?.find((entry) => entry.columnKey === columnKey);
  if (!child?.ready) {
    throw plannerError("party-role-not-ready", logicalRole, {
      diagnostics: cloneValue(child?.diagnostics ?? family?.diagnostics ?? []),
    });
  }
  return child;
}

function pickedValue(state, rng, role) {
  const selected = pickStrict(projectTableRows(state), rng, { role });
  const value = String(selected.name ?? "").trim();
  if (!value) throw plannerError("party-value-blank", role, { roll: selected.roll });
  return { ...selected, name: value };
}

function blockedResult(seed, sourceSnapshot, diagnostic, { disabled = true } = {}) {
  return {
    generator: "rival",
    seed: String(seed ?? ""),
    preview: null,
    sourceSnapshot: immutable(sourceSnapshot ?? null),
    blocked: true,
    disabled,
    missing: [{
      code: diagnostic.code,
      message: diagnostic.message,
      evidence: {
        role: diagnostic.role ?? null,
        report: cloneValue(diagnostic.report ?? null),
        details: cloneValue(diagnostic.evidence ?? null),
      },
    }],
    exclusions: [],
    warnings: [],
  };
}

function previewView(preview) {
  const sharedRows = [
    ["Party Name", preview.shared.partyName],
    ["Alignment", preview.shared.alignment],
    ["Renown", preview.shared.renown],
    ["Secret", preview.shared.secret],
    ["Wealth", preview.shared.wealth],
    ["Signature Tactics", preview.shared.signatureTactics],
  ].map(([label, value]) => ({ label, value }));
  return {
    title: preview.shared.partyName,
    summary: `${preview.members.length} Rival Crawlers — nothing is written until approval.`,
    sections: [{ title: "Shared party traits", rows: sharedRows }],
    members: preview.members.map((member) => ({
      name: member.name,
      detail: `${member.ancestry.name} ${member.class.name}, level ${member.targetLevel}`,
    })),
  };
}

export function planRivalParty({ seed, sourceSnapshot, rng = createSeededRng(seed) } = {}) {
  const preflight = preflightParty(sourceSnapshot?.readinessReport);
  if (!preflight.ok) return blockedResult(seed, sourceSnapshot, preflight);
  try {
    const catalog = resolveSupportingTableCatalog(
      sourceSnapshot?.supporting?.descriptors ?? [],
      { systemDescriptors: sourceSnapshot?.supporting?.systemDescriptors ?? [] },
    );
    const partySizeRoll = rollFormula("1d4", rng, "party size");
    const size = partySizeRoll.total + 1;
    const alignmentRoll = pickedValue(requiredRole(catalog, "alignment"), rng, "alignment");
    const alignment = alignmentRoll.name.toLowerCase();
    const alignmentOnly = { alignment };
    const members = [];
    for (let index = 0; index < size; index += 1) {
      const ancestry = pickedValue(requiredRole(catalog, "ancestry"), rng, "ancestry");
      const ancestryUuid = String(ancestry.documentUuid ?? "").trim();
      if (!ancestryUuid) {
        throw plannerError("party-ancestry-uuid-missing", "ancestry", {
          memberIndex: index,
          ancestry: ancestry.name,
        });
      }
      const nameRole = `npc-name-by-ancestry:${columnSlug(ancestry.name)}`;
      const nameRoll = pickedValue(requiredRole(catalog, "npc-name-by-ancestry", {
        ancestry: ancestry.name,
      }), rng, nameRole);
      const name = nameRoll.name;
      const classSample = guardedSample(rng, "Rival Crawler classes");
      const winner = pickSeeded(
        () => classSample,
        preflight.winners,
      );
      const targetLevelRoll = rollFormula("1d6", rng, `${name} target level`);
      const targetLevel = targetLevelRoll.total;
      const member = {
        index,
        name,
        targetLevel,
        ancestry: {
          name: ancestry.name,
          documentUuid: ancestryUuid,
          tableUuid: ancestry.tableUuid,
          roll: ancestry.roll,
        },
        class: {
          classId: winner.classId,
          name: winner.name,
          source: winner.source,
          warnings: cloneValue(winner.warnings ?? []),
        },
        rolls: {
          ancestry,
          name: nameRoll,
          class: {
            sample: classSample,
            selectedIndex: preflight.winners.indexOf(winner),
            poolSize: preflight.winners.length,
          },
          targetLevel: targetLevelRoll,
        },
      };
      const assembled = assembleMemberPlan({ member, shared: alignmentOnly, sourceSnapshot, rng });
      if (!assembled.ok) return blockedResult(seed, sourceSnapshot, assembled, { disabled: false });
      members.push(assembled.member);
    }
    const renownRoll = pickedValue(requiredRole(catalog, "renown"), rng, "renown");
    const secretRoll = pickedValue(requiredRole(catalog, "secret"), rng, "secret");
    const wealthRoll = pickedValue(requiredRole(catalog, "rival-wealth"), rng, "rival-wealth");
    const name1Roll = pickedValue(
      requiredFamilyChild(catalog, "party-name", "name-1", "party-name:name-1"),
      rng,
      "party-name:name-1",
    );
    const name2Roll = pickedValue(
      requiredFamilyChild(catalog, "party-name", "name-2", "party-name:name-2"),
      rng,
      "party-name:name-2",
    );
    const tacticsRole = `signature-tactics:${columnSlug(alignment)}`;
    const tacticsRoll = pickedValue(requiredRole(catalog, tacticsRole), rng, tacticsRole);
    const shared = {
      alignment,
      partyName: `${name1Roll.name} ${name2Roll.name}`.replace(/\s+/g, " ").trim(),
      renown: renownRoll.name,
      secret: secretRoll.name,
      wealth: wealthRoll.name,
      signatureTactics: tacticsRoll.name,
      rolls: {
        partySize: partySizeRoll,
        alignment: alignmentRoll,
        renown: renownRoll,
        secret: secretRoll,
        wealth: wealthRoll,
        partyName: { first: name1Roll, second: name2Roll },
        signatureTactics: tacticsRoll,
      },
    };
    const preview = immutable({
      seed: String(seed ?? ""),
      shared,
      members,
    });
    return {
      generator: "rival",
      seed: String(seed ?? ""),
      preview,
      sourceSnapshot: immutable(sourceSnapshot),
      view: immutable(previewView(preview)),
      blocked: false,
      disabled: false,
      missing: [],
      exclusions: cloneValue(sourceSnapshot.readinessReport?.excluded ?? []),
      warnings: members.flatMap((member) => cloneValue(member.warnings ?? [])),
    };
  } catch (error) {
    if (error?.code?.startsWith("party-")) {
      return blockedResult(seed, sourceSnapshot, {
        code: error.code,
        role: error.role,
        message: error.message,
        evidence: error,
      });
    }
    throw error;
  }
}
