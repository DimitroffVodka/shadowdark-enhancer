/**
 * Generic class idiom and choice policy for the Forge & Loot generators.
 *
 * This module is deliberately a deep, pure boundary.  It accepts ordinary
 * snapshots of class, talent, spell, deity, patron, and gear documents and
 * returns new data; it never reads a global, resolves an id, rolls a dialog,
 * or mutates one of the supplied objects.  The Foundry adapter can therefore
 * translate its own documents into these snapshots while G3/G6b/G7 can use
 * exactly the same policy in Node tests.
 *
 * The policy follows the approved Forge & Loot design (§8): metadata-derived
 * ability gravity, legal filtering before ranking, stable tie breaks, and a
 * deterministic injected-rng choice where the available metadata has no
 * principled optimization axis. G4 owns the PRNG implementation.
 */

export const ABILITY_ORDER = Object.freeze([
  "str", "dex", "con", "int", "wis", "cha",
]);

const ABILITY_ALIASES = Object.freeze({
  strength: "str", str: "str",
  dexterity: "dex", dex: "dex",
  constitution: "con", con: "con",
  intelligence: "int", int: "int",
  wisdom: "wis", wis: "wis",
  charisma: "cha", cha: "cha",
});

/** The supported REPLACEME effect families from the character builder. */
export const CHOICE_SPECS = Object.freeze([
  Object.freeze({
    key: "weapon",
    names: Object.freeze(["Weapon Mastery", "Increased Weapon Damage Die", "Trusty Gear"]),
  }),
  Object.freeze({ key: "armor", names: Object.freeze(["Armor Mastery"]) }),
  Object.freeze({ key: "spell", names: Object.freeze(["Spellcasting Advantage on Spell"]) }),
]);

/** Stable machine-readable failures shared by G3/G6b/G7 consumers. */
export const UNSUPPORTED_CODES = Object.freeze([
  "no-matching-spec",
  "empty-option-set",
  "missing-metadata",
]);

const [NO_MATCHING_SPEC, EMPTY_OPTION_SET, MISSING_METADATA] = UNSUPPORTED_CODES;

const DEFAULT_STAT_CAP = 18;
const DEFAULT_CON_FLOOR = 1;
const FRONTLINE_ARMOR_AC = 13;

function asArray(value) {
  return Array.isArray(value) ? value : (value == null ? [] : [value]);
}

function isObject(value) {
  return !!value && typeof value === "object";
}

function classDocument(value) {
  if (!isObject(value)) return {};
  return value.item && isObject(value.item) ? value.item : value;
}

function systemOf(value) {
  return classDocument(value).system ?? {};
}

function nameOf(value) {
  if (!isObject(value)) return String(value ?? "").trim();
  return String(value?.name ?? value?.label ?? value?.title ?? "").trim();
}

function identityOf(value) {
  if (!isObject(value)) return String(value ?? "").trim();
  return String(value?.uuid ?? value?.id ?? value?._id ?? nameOf(value)).trim();
}

function normalizedIdentity(value) {
  return identityOf(value).toLowerCase();
}

function normalizedName(value) {
  return nameOf(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Normalize an ability key, display name, effect path, or formula token. */
export function normalizeAbility(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const direct = raw.replace(/[^a-z]/g, "");
  if (ABILITY_ALIASES[direct]) return ABILITY_ALIASES[direct];
  const hit = raw.match(/\b(strength|dexterity|constitution|intelligence|wisdom|charisma|str|dex|con|int|wis|cha)\b/);
  return hit ? ABILITY_ALIASES[hit[1]] : null;
}

/** Return ability tokens in canonical order, without duplicate references. */
export function extractAbilities(value) {
  const raw = String(value ?? "").toLowerCase();
  if (!raw) return [];
  const found = new Set();
  const token = /\b(strength|dexterity|constitution|intelligence|wisdom|charisma|str|dex|con|int|wis|cha)\b/g;
  let match;
  while ((match = token.exec(raw))) found.add(ABILITY_ALIASES[match[1]]);
  return ABILITY_ORDER.filter((ability) => found.has(ability));
}

function abilityPriority(idiom) {
  const supplied = asArray(idiom?.priority).map(normalizeAbility).filter(Boolean);
  return [...new Set([...supplied, ...ABILITY_ORDER])];
}

function isIdiom(value) {
  return isObject(value) && (Array.isArray(value.priority) || isObject(value.weights));
}

function abilityWeights(idiom) {
  const weights = Object.fromEntries(ABILITY_ORDER.map((ability) => [ability, 0]));
  for (const ability of ABILITY_ORDER) {
    const n = Number(idiom?.weights?.[ability]);
    if (Number.isFinite(n)) weights[ability] = n;
  }
  return weights;
}

function candidateDocument(candidate) {
  if (!isObject(candidate)) return {};
  if (candidate.item && isObject(candidate.item)) return candidate.item;
  if (candidate.document && isObject(candidate.document)) return candidate.document;
  if (candidate.doc && isObject(candidate.doc)) return candidate.doc;
  return candidate;
}

function candidateName(candidate) {
  return nameOf(candidateDocument(candidate)) || nameOf(candidate);
}

function candidateIdentity(candidate) {
  return identityOf(candidateDocument(candidate)) || identityOf(candidate);
}

function stableCandidateCompare(a, b) {
  const nameCompare = candidateName(a).localeCompare(candidateName(b));
  if (nameCompare) return nameCompare;
  return candidateIdentity(a).localeCompare(candidateIdentity(b));
}

function unsupported(code, evidence = {}) {
  const normalized = UNSUPPORTED_CODES.includes(code) ? code : MISSING_METADATA;
  return { unsupported: { code: normalized, evidence } };
}

function decision(value, signals = [], fallbackUsed = false) {
  return { value, signals, fallbackUsed: !!fallbackUsed };
}

function decisionSignal(source, explanation, details = {}) {
  return { source, explanation, ...details };
}

function rngPick(candidates, rng) {
  const list = asArray(candidates);
  if (!list.length) return { value: null, fallbackUsed: true, reason: "empty option set" };
  if (list.length === 1) return { value: list[0], fallbackUsed: false, reason: null };
  const injected = typeof rng === "function";
  let unit = injected ? Number(rng()) : 0;
  if (!Number.isFinite(unit)) unit = 0;
  unit = Math.max(0, Math.min(0.9999999999999999, unit));
  return {
    value: list[Math.floor(unit * list.length)],
    fallbackUsed: !injected,
    reason: injected ? null : "no rng supplied; used the first stable legal option",
  };
}

function isAvailable(value) {
  return value?.legal !== false && value?.available !== false && value?.valid !== false && value?.disabled !== true;
}

function legalCandidates(candidates, predicate = null) {
  return asArray(candidates).filter((candidate) => isAvailable(candidate)
    && (!predicate || predicate(candidate)));
}

function effectChanges(document) {
  const changes = [];
  for (const effect of asArray(document?.effects)) {
    // Foundry's normalized form stores the changes in `system.changes`, while
    // plain test/adaptor snapshots often use the legacy top-level field. They
    // are two representations of one effect, not two contributions.
    if (Array.isArray(effect?.changes)) changes.push(...effect.changes);
    else if (Array.isArray(effect?.system?.changes)) changes.push(...effect.system.changes);
  }
  return changes;
}

function looksLikeDocument(value) {
  return isObject(value) && (Array.isArray(value.effects)
    || value.documentName === "Item"
    || value.type === "Talent"
    || value.type === "Class Ability"
    || isObject(value.system) && ("description" in value.system || "talentClass" in value.system
      || "ability" in value.system));
}

/**
 * Flatten the document forms used by adapters and tests without walking effect
 * changes as if they were documents.  The result intentionally preserves
 * table order: that order is the documented fallback for an unscored choice.
 */
function collectTalentDocuments(input, out = [], seen = new Set()) {
  if (input == null) return out;
  if (looksLikeDocument(input)) {
    const key = identityOf(input) || `${nameOf(input)}:${out.length}`;
    if (!seen.has(key)) { seen.add(key); out.push(input); }
    return out;
  }
  if (Array.isArray(input)) {
    for (const value of input) collectTalentDocuments(value, out, seen);
    return out;
  }
  if (!isObject(input)) return out;
  for (const key of ["talents", "classTalents", "classAbilities", "documents", "docs", "items",
    "outcomes", "options", "talentDocs", "talentTable", "classTalentTable"]) {
    if (input[key] != null) collectTalentDocuments(input[key], out, seen);
  }
  // A UUID → document map has no semantic wrapper; visit values in insertion
  // order, which remains deterministic for a captured source snapshot.
  if (!out.length || Object.keys(input).some((key) => !["talents", "classTalents", "classAbilities",
    "documents", "docs", "items", "outcomes", "options", "talentDocs", "talentTable",
    "classTalentTable"].includes(key))) {
    for (const value of Object.values(input)) {
      if (value !== input) collectTalentDocuments(value, out, seen);
    }
  }
  return out;
}

function rowLike(value) {
  return isObject(value) && ("text" in value || "options" in value || "range" in value
    || "lo" in value || "hi" in value || "kind" in value);
}

function collectRows(input, out = [], seen = new Set()) {
  if (input == null) return out;
  if (Array.isArray(input)) {
    for (const value of input) collectRows(value, out, seen);
    return out;
  }
  if (!isObject(input)) return out;
  if (rowLike(input)) {
    const key = `${input.lo ?? input.range?.[0] ?? ""}:${input.hi ?? input.range?.[1] ?? ""}:${input.text ?? ""}`;
    if (!seen.has(key)) { seen.add(key); out.push(input); }
    return out;
  }
  for (const key of ["rows", "results", "talentTable", "classTalentTable", "table", "statChoices"]) {
    if (input[key] != null) collectRows(input[key], out, seen);
  }
  return out;
}

function rowText(row) {
  return [row?.text, row?.description, ...asArray(row?.options)]
    .filter((value) => value != null)
    .map((value) => isObject(value) ? (value.text ?? value.name ?? value.label ?? "") : String(value))
    .join(" ");
}

function rangeLabel(row) {
  const range = Array.isArray(row?.range) ? row.range : [row?.lo, row?.hi];
  const lo = Number(range[0]);
  const hi = Number(range[1] ?? range[0]);
  if (Number.isFinite(lo) && Number.isFinite(hi)) return lo === hi ? `${lo}` : `${lo}-${hi}`;
  return "table row";
}

function collectReferencedDocs(classItem, talentDocs) {
  const source = classDocument(classItem);
  const s = source.system ?? {};
  const docs = collectTalentDocuments([
    talentDocs,
    s.talentDocs,
    s.talents,
    s.classAbilities,
    s.classTalentTable,
    s.talentTable,
    s.classAbilitiesResolved,
    s.talentsResolved,
  ]);
  const byRef = new Map();
  for (const document of docs) {
    for (const key of [identityOf(document), document?._id, document?.uuid]) {
      if (key) byRef.set(String(key), document);
    }
  }
  const refs = [...asArray(s.talents), ...asArray(s.classAbilities)];
  const referenced = refs.map((ref) => byRef.get(String(ref))).filter(Boolean);
  // When an adapter already supplied the exact outcome docs, retaining all of
  // them is the useful and least surprising behavior. Referenced docs are put
  // first so a class's fixed ability metadata wins stable ties.
  const ordered = [...referenced, ...docs];
  const seen = new Set();
  return ordered.filter((document) => {
    const key = identityOf(document) || `${nameOf(document)}:${seen.size}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectWeaponDocs(classItem, talentDocs) {
  const s = systemOf(classItem);
  const all = [
    ...asArray(s.weapons), ...asArray(s.weaponDocs), ...asArray(s.weaponsResolved), ...asArray(s.weaponOptions),
    ...asArray(talentDocs?.weapons), ...asArray(talentDocs?.weaponDocs),
  ];
  return all.filter((value) => isObject(value));
}

function collectArmorDocs(classItem, talentDocs) {
  const s = systemOf(classItem);
  const all = [
    ...asArray(s.armor), ...asArray(s.armorDocs), ...asArray(s.armorResolved), ...asArray(s.armorOptions),
    ...asArray(talentDocs?.armor), ...asArray(talentDocs?.armorDocs),
  ];
  return all.filter((value) => isObject(value));
}

function attackModeForWeapon(weapon) {
  const s = candidateDocument(weapon)?.system ?? {};
  const type = String(s.type ?? s.weaponType ?? weapon?.attackMode ?? "").toLowerCase();
  if (type.includes("ranged")) return "ranged";
  if (type.includes("melee")) return "melee";
  const range = String(s.range ?? "").toLowerCase();
  if (range === "far" || range === "near") return "ranged";
  return null;
}

function armorAc(armor) {
  const s = candidateDocument(armor)?.system ?? {};
  const ac = s.ac ?? {};
  if (Number.isFinite(Number(ac))) return Number(ac);
  if (Number.isFinite(Number(s.acValue))) return Number(s.acValue);
  const base = Number(ac.base ?? ac.value ?? s.armorClass ?? 0);
  const modifier = Number(ac.modifier ?? 0);
  return (Number.isFinite(base) ? base : 0) + (Number.isFinite(modifier) ? modifier : 0);
}

function parseDie(value) {
  const text = String(value ?? "").trim().toLowerCase();
  const match = text.match(/^(\d+)?d(\d+)$/);
  if (!match) {
    const number = Number(text);
    return Number.isFinite(number) ? number : 0;
  }
  return Number(match[1] || 1) * (Number(match[2]) + 1) / 2;
}

function weaponDamage(weapon) {
  const s = candidateDocument(weapon)?.system ?? {};
  const damage = s.damage ?? {};
  const values = [
    damage.oneHanded, damage.twoHanded, damage.die, s.damageDie, s.damage,
  ].filter((value) => value != null && value !== "").map(parseDie);
  return values.length ? Math.max(...values) : 0;
}

function hitDieSides(classItem) {
  const s = systemOf(classItem);
  const value = s.hitDie ?? s.hitPoints ?? s.hp?.die ?? s.hitDieSize ?? "";
  const match = String(value).toLowerCase().match(/d(\d+)/);
  return match ? Number(match[1]) : 0;
}

function statChoiceAbilities(value) {
  if (isObject(value)) {
    const explicit = normalizeAbility(value.ability ?? value.key ?? value.stat);
    if (explicit) return [explicit];
    return extractAbilities(value.text ?? value.name ?? value.label ?? "");
  }
  return extractAbilities(value);
}

function signal(explanation, source, ability, contribution) {
  return { source, ability, contribution, explanation };
}

/**
 * Derive the six-ability priority vector from class metadata.
 *
 * The optional `talentDocs` argument may be an array, a UUID→document map, or
 * the adapter bundle `{ talents, classAbilities, rows }`. Rows may be parser
 * rows (`kind/options/text`) or simple `{ options }` records. No class-name
 * branch exists here: all gravity comes from the supplied fields.
 */
export function deriveClassIdiom(classItem = {}, talentDocs = []) {
  const source = classDocument(classItem);
  const s = source.system ?? {};
  const weights = Object.fromEntries(ABILITY_ORDER.map((ability) => [ability, 0]));
  const signals = [];
  const add = (ability, contribution, sourceName, explanation) => {
    const key = normalizeAbility(ability);
    const amount = Number(contribution);
    if (!key || !Number.isFinite(amount) || amount === 0) return;
    weights[key] += amount;
    signals.push(signal(explanation, sourceName, key, amount));
  };

  const casting = normalizeAbility(s.spellcasting?.ability);
  const caster = casting && s.spellcasting?.class !== "__not_spellcaster__";
  if (caster) add(casting, 20, "spellcasting.ability", `Casting ability ${casting.toUpperCase()} is the class's primary stat.`);

  const docs = collectReferencedDocs(source, talentDocs);
  for (const document of docs) {
    const documentName = candidateName(document) || "talent";
    const directAbilities = [document?.system?.ability, document?.system?.stat,
      document?.ability, document?.stat, document?.checkAbility]
      .flatMap((value) => normalizeAbility(value) ? [normalizeAbility(value)] : []);
    for (const ability of [...new Set(directAbilities)]) {
      add(ability, 4, "talent.ability", `${documentName} declares ${ability.toUpperCase()} as its check ability.`);
    }
    for (const change of effectChanges(document)) {
      const fields = [change?.key, change?.value, change?.path, change?.formula];
      const abilities = [...new Set(fields.flatMap(extractAbilities))];
      for (const ability of abilities) {
        add(ability, 4, "talent.effect", `${documentName} has an effect reference to ${ability.toUpperCase()}.`);
      }
    }
  }

  const rows = collectRows([
    s.classTalentTable, s.talentTable, s.statChoices,
    source.classTalentTable, source.talentTable, source.statChoices,
    talentDocs,
  ]);
  for (const row of rows) {
    const text = rowText(row);
    const options = asArray(row?.options).length ? asArray(row.options) : [text];
    const abilities = [...new Set(options.flatMap(statChoiceAbilities))];
    // Only rows that present a choice are stat-choice signals. A normal talent
    // sentence mentioning an ability is already represented by its effect.
    const choice = row?.kind === "choice" || options.length > 1
      || /\+\d+\s+(?:points?\s+)?to\s+[^.]+\bor\b/i.test(text)
      || /(?:choose|distribute)\b[^.]*\b(?:stat|ability)/i.test(text);
    if (!choice) continue;
    for (const ability of abilities) {
      add(ability, 2, "stat-choice", `${rangeLabel(row)} offers ${ability.toUpperCase()} in a stat choice.`);
    }
  }

  const weaponDocs = collectWeaponDocs(source, talentDocs);
  let meleeCount = 0;
  let rangedCount = 0;
  for (const weapon of weaponDocs) {
    const mode = attackModeForWeapon(weapon);
    if (mode === "melee") meleeCount += 1;
    if (mode === "ranged") rangedCount += 1;
  }
  const allWeapons = !!s.allWeapons;
  const allMelee = !!s.allMeleeWeapons;
  const allRanged = !!s.allRangedWeapons;
  if (allWeapons) {
    add("str", 1, "gear.weapons", "Broad weapon training supports Strength for melee and thrown attacks.");
    add("dex", 1, "gear.weapons", "Broad weapon training supports Dexterity for ranged attacks.");
  }
  if (allMelee || meleeCount > rangedCount && meleeCount > 0) {
    const amount = allMelee ? 3 : 2;
    add("str", amount, "gear.weapons", "The legal weapon breadth is melee-weighted.");
  }
  if (allRanged || rangedCount > meleeCount && rangedCount > 0) {
    const amount = allRanged ? 3 : 2;
    add("dex", amount, "gear.weapons", "The legal weapon breadth is ranged-weighted.");
  }

  const armorDocs = collectArmorDocs(source, talentDocs);
  const armorHeavy = !!s.allArmor || armorDocs.some((armor) => armorAc(armor) >= FRONTLINE_ARMOR_AC);
  if (s.allArmor) {
    add("str", 2, "gear.armor", "Broad armor training supports a frontline loadout.");
    add("con", 2, "gear.armor", "Broad armor training supports durable frontline play.");
  } else if (armorHeavy) {
    add("str", 1, "gear.armor", "The legal armor breadth includes frontline protection.");
    add("con", 1, "gear.armor", "The legal armor breadth includes durable protection.");
  } else if (asArray(s.armor).length) {
    add("con", 1, "gear.armor", "The class has legal armor and benefits from Constitution durability.");
  }

  const sides = hitDieSides(source);
  if (sides > 6) {
    const contribution = Math.max(1, Math.min(4, Math.round((sides - 6) / 2)));
    add("con", contribution, "hit-die", `A d${sides} hit die raises the durability signal.`);
  }
  add("con", DEFAULT_CON_FLOOR, "constitution-floor", "Every class keeps a Constitution floor for survival.");

  const priority = [...ABILITY_ORDER].sort((a, b) => {
    const delta = weights[b] - weights[a];
    return delta || ABILITY_ORDER.indexOf(a) - ABILITY_ORDER.indexOf(b);
  });
  const meleeSignal = allMelee || meleeCount > rangedCount && meleeCount > 0;
  const rangedSignal = allRanged || rangedCount > meleeCount && rangedCount > 0;
  const attackMode = meleeSignal && rangedSignal ? "mixed"
    : meleeSignal ? "melee" : rangedSignal ? "ranged"
      : meleeCount || rangedCount || allWeapons ? "mixed" : "none";
  const frontline = armorHeavy || attackMode === "melee";
  const meaningful = signals.some((entry) => entry.source !== "constitution-floor");
  return {
    priority,
    weights,
    signals,
    attackMode,
    frontline,
    caster: !!caster,
    idiomThin: !meaningful,
  };
}

export const deriveClassIdiomSignals = deriveClassIdiom;

/** Find the pure choice family for a builder effect name. */
export function choiceSpecFor(effectName) {
  const wanted = String(effectName ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return CHOICE_SPECS.find((spec) => spec.names.some((name) => name.toLowerCase() === wanted)) ?? null;
}

function replacementEffect(effect) {
  const changes = Array.isArray(effect?.changes) ? effect.changes : effect?.system?.changes;
  return asArray(changes).some((change) => String(change?.key ?? "").includes("REPLACEME"));
}

/** Return every REPLACEME effect, including multiple choices on one Talent. */
export function choosableEffects(document) {
  return asArray(document?.effects).filter(replacementEffect);
}

/** Whether a document contains the first supported REPLACEME family. */
export function choiceSpecForDocument(document) {
  const effect = choosableEffects(document)[0];
  return effect ? choiceSpecFor(effect.name) : null;
}

/**
 * Match the Character Builder's wording-sensitive talent-roll rule exactly.
 * The importer intentionally retains "two" in names, so do not broaden this
 * regex without coordinating a separate builder cleanup.
 */
export function talentRollCount(doc = {}) {
  const text = `${doc.name} ${String(doc.system?.description || "")}`.toLowerCase();
  return /\btwo\b|\b2\b/.test(text) ? 2 : 1;
}

function permitSet(value) {
  if (value instanceof Set) return new Set(value);
  return new Set(asArray(value).map((entry) => String(entry ?? "")).filter(Boolean));
}

function makePermitData(classItem, supplied = null) {
  const source = classDocument(classItem);
  const s = source.system ?? {};
  const existing = supplied && isObject(supplied) ? supplied : {};
  const classRef = existing.classItem ? classDocument(existing.classItem) : source;
  const classSystem = classRef.system ?? s;
  const names = (value) => {
    const uuids = new Set();
    const slugs = new Set();
    for (const entry of asArray(value)) {
      if (isObject(entry)) {
        if (entry.uuid || entry.id || entry._id) uuids.add(identityOf(entry));
        if (candidateName(entry)) slugs.add(slug(candidateName(entry)));
      } else {
        const text = String(entry ?? "");
        if (text) uuids.add(text);
        // Plain names are accepted alongside UUIDs; UUID matching still wins
        // for exact source identities. The final UUID segment is a useful
        // adapter fallback when a captured snapshot has no resolved name.
        if (!text.includes(".")) slugs.add(slug(text));
        else slugs.add(slug(text.split(".").pop()));
      }
    }
    return { uuids, slugs };
  };
  const weapons = names(classSystem.weapons);
  const armor = names(classSystem.armor);
  const suppliedWeaponUuids = Object.prototype.hasOwnProperty.call(existing, "wUuids");
  const suppliedWeaponSlugs = Object.prototype.hasOwnProperty.call(existing, "wSlugs");
  const suppliedArmorUuids = Object.prototype.hasOwnProperty.call(existing, "aUuids");
  const suppliedArmorSlugs = Object.prototype.hasOwnProperty.call(existing, "aSlugs");
  return {
    classItem: classRef,
    allWeapons: !!classSystem.allWeapons,
    allMeleeWeapons: !!classSystem.allMeleeWeapons,
    allRangedWeapons: !!classSystem.allRangedWeapons,
    allArmor: !!classSystem.allArmor,
    wUuids: permitSet(suppliedWeaponUuids ? existing.wUuids : weapons.uuids),
    wSlugs: permitSet(suppliedWeaponSlugs ? existing.wSlugs : weapons.slugs),
    aUuids: permitSet(suppliedArmorUuids ? existing.aUuids : armor.uuids),
    aSlugs: permitSet(suppliedArmorSlugs ? existing.aSlugs : armor.slugs),
  };
}

function itemType(item) {
  const document = candidateDocument(item);
  const type = String(document.type ?? document.system?.typeName ?? "").toLowerCase();
  if (type) return type;
  if (document.system?.baseWeapon || document.system?.damage) return "weapon";
  if (document.system?.baseArmor || document.system?.ac) return "armor";
  return "";
}

function itemWeaponMode(item) {
  const s = candidateDocument(item)?.system ?? {};
  return String(s.type ?? s.weaponType ?? "").toLowerCase();
}

/**
 * Structural equivalent of GearStep._classPermits.  The second argument may
 * be a class document or its cached `{ wUuids, wSlugs, aUuids, aSlugs }` data;
 * the third argument can provide the other form for adapter convenience.
 */
export function classPermits(item, classItemOrPermits = null, maybePermits = null) {
  const secondIsPermits = isObject(classItemOrPermits)
    && ("wUuids" in classItemOrPermits || "wSlugs" in classItemOrPermits
      || "aUuids" in classItemOrPermits || "aSlugs" in classItemOrPermits);
  const supplied = secondIsPermits ? classItemOrPermits : maybePermits;
  const classItem = secondIsPermits ? classItemOrPermits.classItem : classItemOrPermits;
  if (!classItem && !supplied) return true;
  const p = makePermitData(classItem, supplied);
  const document = candidateDocument(item);
  const type = itemType(document);
  const id = identityOf(document);
  const itemSlug = slug(candidateName(document));
  const s = document.system ?? {};
  if (type === "weapon") {
    if (p.allWeapons) return true;
    const mode = itemWeaponMode(document);
    if (p.allMeleeWeapons && mode === "melee") return true;
    if (p.allRangedWeapons && mode === "ranged") return true;
    return p.wUuids.has(id) || p.wSlugs.has(itemSlug)
      || (!!s.baseWeapon && p.wSlugs.has(slug(s.baseWeapon)));
  }
  if (type === "armor") {
    if (p.allArmor) return true;
    return p.aUuids.has(id) || p.aSlugs.has(itemSlug)
      || (!!s.baseArmor && p.aSlugs.has(slug(s.baseArmor)));
  }
  return true;
}

export const _classPermits = classPermits;
export const buildClassPermits = makePermitData;

function emptyOptionSet(kind, evidence = {}) {
  return unsupported(EMPTY_OPTION_SET, { kind, ...evidence });
}

function missingMetadata(kind, evidence = {}) {
  return unsupported(MISSING_METADATA, { kind, ...evidence });
}

/** Allocate an assign-style stat pool, or preserve fixed-order stat methods. */
export function resolveAbilityScores(first, second = null, third = null, fourth = null) {
  const config = Array.isArray(first)
    ? { scores: first, idiom: isIdiom(second) ? second : isIdiom(third) ? third : fourth?.idiom,
      method: isIdiom(second) ? third : second }
    : { ...first, idiom: first?.idiom ?? (isIdiom(second) ? second : null),
      method: first?.method ?? (isIdiom(second) ? third : second) };
  const scores = asArray(config.scores ?? config.pool ?? config.rolled)
    .map((score) => isObject(score) ? Number(score.total ?? score.value) : Number(score))
    .filter(Number.isFinite);
  if (!scores.length) return missingMetadata("ability-scores", { evidence: "scores/pool/rolled" });
  const priority = abilityPriority(config.idiom);
  const method = config.method;
  const assign = method === true || method === "assign" || method?.assign === true
    || String(method?.key ?? method ?? "").toLowerCase().includes("assign");
  const values = Object.fromEntries(ABILITY_ORDER.map((ability) => [ability, 0]));
  const assignment = Object.fromEntries(ABILITY_ORDER.map((ability) => [ability, null]));
  if (assign) {
    const ordered = scores.map((score, index) => ({ score, index }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    ordered.forEach((entry, index) => {
      const ability = priority[index];
      if (!ability) return;
      values[ability] = entry.score;
      assignment[ability] = entry.index;
    });
    return decision(values, [decisionSignal("ability-scores", `Assigned the rolled scores from highest to lowest in idiom priority: ${priority.join(", ")}.`, {
      method: "assign", assignment, pool: [...scores],
    })]);
  }
  scores.slice(0, ABILITY_ORDER.length).forEach((score, index) => { values[ABILITY_ORDER[index]] = score; });
  return decision(values, [decisionSignal("ability-scores", "The selected stat method is fixed-order, so scores stay STR through CHA.", {
    method: "fixed", assignment, pool: [...scores],
  })]);
}

export const resolveStats = resolveAbilityScores;
export const resolveAbilityAllocation = resolveAbilityScores;

function optionAbility(value) {
  if (isObject(value)) return normalizeAbility(value.ability ?? value.key ?? value.stat)
    ?? normalizeAbility(value.name ?? value.label ?? value.text);
  return normalizeAbility(value);
}

/** Resolve a `+N to one of …` row and distribute points around the cap. */
export function resolvePlusTwoChoice(first, second = null, third = null) {
  const config = Array.isArray(first) || typeof first === "string"
    ? { offered: asArray(first), idiom: second, current: third }
    : { ...first, idiom: first?.idiom ?? second };
  const priority = abilityPriority(config.idiom);
  let offered = asArray(config.offered ?? config.options ?? config.abilities)
    .flatMap((option) => {
      if (isObject(option) && (option.ability || option.key || option.stat)) {
        const explicit = optionAbility(option);
        return explicit ? [explicit] : [];
      }
      return statChoiceAbilities(option);
    });
  offered = [...new Set(offered)];
  const allText = [config.text, config.description].filter(Boolean).join(" ");
  if (!offered.length && /\b(?:any|one)\b/i.test(allText)) offered = [...ABILITY_ORDER];
  if (!offered.length) offered = [...ABILITY_ORDER];
  const ordered = priority.filter((ability) => offered.includes(ability));
  const selectedAbility = ordered[0] ?? offered[0] ?? ABILITY_ORDER[0];
  const amountMatch = String(config.amount ?? config.points ?? allText).match(/\+(\d+)/);
  const amount = Math.max(0, Number(config.amount ?? config.points ?? amountMatch?.[1] ?? 2) || 0);
  const cap = Number(config.cap ?? config.max ?? DEFAULT_STAT_CAP);
  const values = Object.fromEntries(ABILITY_ORDER.map((ability) => [ability,
    Number(config.current?.[ability] ?? config.values?.[ability] ?? config.scores?.[ability] ?? 0) || 0]));
  const allocation = Object.fromEntries(ABILITY_ORDER.map((ability) => [ability, 0]));
  let spent = 0;
  for (let point = 0; point < amount; point++) {
    const target = priority.find((ability) => offered.includes(ability) && values[ability] < cap);
    if (!target) break;
    values[target] += 1;
    allocation[target] += 1;
    spent += 1;
  }
  const fallback = !config.offered && !config.options && !config.abilities
    || !ordered.length || spent < amount;
  const reasons = [];
  if (!config.offered && !config.options && !config.abilities) reasons.push("no offered list; used the canonical ability set");
  if (spent < amount) reasons.push(`the ${cap} cap left ${amount - spent} point${amount - spent === 1 ? "" : "s"} unassigned`);
  return decision(selectedAbility, [decisionSignal("plus-two", `Preferred ${selectedAbility.toUpperCase()} from the offered abilities; distributed ${spent}/${amount} point${amount === 1 ? "" : "s"} within the ${cap} cap.`, {
    offered, amount, spent, allocation, values, cap, reason: reasons.length ? reasons.join("; ") : null,
  })], fallback);
}

export const resolveStatChoice = resolvePlusTwoChoice;
export const resolveAbilityChoice = resolvePlusTwoChoice;
export const resolvePlusTwo = resolvePlusTwoChoice;

function optionAbilities(option) {
  const document = candidateDocument(option);
  const explicit = asArray(option?.affectedAbilities ?? document?.affectedAbilities)
    .flatMap((value) => normalizeAbility(value) ? [normalizeAbility(value)] : extractAbilities(value));
  const changes = effectChanges(document);
  return [...new Set([...explicit, ...changes.flatMap((change) => [change?.key, change?.value].flatMap(extractAbilities))])]
    .filter((ability) => ABILITY_ORDER.includes(ability));
}

function optionAttackModes(option) {
  const document = candidateDocument(option);
  const explicit = String(option?.attackMode ?? option?.mode ?? document?.attackMode ?? "").toLowerCase();
  const modes = new Set();
  if (explicit.includes("melee")) modes.add("melee");
  if (explicit.includes("ranged")) modes.add("ranged");
  for (const change of effectChanges(document)) {
    const text = `${change?.key ?? ""} ${change?.value ?? ""}`.toLowerCase();
    if (text.includes("melee")) modes.add("melee");
    if (text.includes("ranged")) modes.add("ranged");
  }
  return modes;
}

/** Score a choose-one Talent by its mechanical effect metadata. */
export function resolveTalentChoice(first, second = null, third = null) {
  const config = Array.isArray(first)
    ? { options: first, idiom: second, isLegal: third }
    : { ...first, idiom: first?.idiom ?? second };
  const idiom = config.idiom ?? {};
  const weights = abilityWeights(idiom);
  const mode = idiom.attackMode;
  const legal = legalCandidates(config.options ?? config.candidates ?? config.legalOptions,
    typeof config.isLegal === "function" ? config.isLegal : null);
  if (!legal.length) return emptyOptionSet("talent", { evidence: "options/candidates/legalOptions" });
  const scored = legal.map((option, index) => {
    const abilities = optionAbilities(option);
    const modes = optionAttackModes(option);
    const abilityScore = abilities.reduce((total, ability) => total + (weights[ability] || 0), 0);
    const attackScore = mode === "mixed" && modes.size ? 2 : mode && modes.has(mode) ? 5 : 0;
    return { option, index, abilities, modes: [...modes], score: abilityScore + attackScore };
  });
  const meaningful = scored.some((entry) => entry.score > 0);
  const best = [...scored].sort((a, b) => b.score - a.score
    || a.index - b.index)[0];
  const fallback = !meaningful;
  return decision(best.option, [decisionSignal("talent", meaningful
    ? `Selected ${candidateName(best.option) || "the Talent"} from its affected abilities and attack mode.`
    : `No Talent metadata distinguished the options; kept the first legal table-order option (${candidateName(best.option) || "unnamed"}).`, {
    score: best.score,
    scores: scored.map((entry) => ({ option: entry.option, score: entry.score })),
    affectedAbilities: best.abilities,
    attackModes: best.modes,
    reason: fallback ? "no option exposed affected abilities or attack mode" : null,
  })], fallback);
}

export const resolveTalent = resolveTalentChoice;
export const resolveChooseOneTalent = resolveTalentChoice;

function normalizeChoiceConfig(first, second, third, fourth) {
  if (Array.isArray(first)) {
    if (isObject(second) && second.priority) return { options: first, idiom: second, classItem: third, extra: fourth };
    if (isObject(second) && second.system) return { options: first, classItem: second, idiom: third, extra: fourth };
    return { options: first, idiom: third?.priority ? third : null, classItem: second, extra: fourth };
  }
  return { ...first, options: first?.options ?? first?.candidates ?? first?.items ?? first?.weapons
    ?? first?.baseWeapons ?? first?.armor ?? first?.baseArmor ?? first?.spells,
    idiom: first?.idiom ?? (isIdiom(second) ? second : null),
    classItem: first?.classItem ?? first?.class ?? (isObject(second) && second.system ? second : null) };
}

/** Resolve a supported weapon REPLACEME choice against class legality. */
export function resolveWeaponChoice(first, second = null, third = null, fourth = null) {
  const config = normalizeChoiceConfig(first, second, third, fourth);
  const idiom = config.idiom ?? {};
  const legal = legalCandidates(config.options, (candidate) => classPermits(candidate, config.classItem, config.permits)
    && (typeof config.isLegal !== "function" || config.isLegal(candidate)));
  if (!legal.length) return emptyOptionSet("weapon", { evidence: "class-permitted options" });
  const mode = idiom.attackMode;
  const matching = mode === "melee" || mode === "ranged"
    ? legal.filter((candidate) => attackModeForWeapon(candidate) === mode) : [];
  const pool = matching.length ? matching : legal;
  const best = [...pool].sort((a, b) => weaponDamage(b) - weaponDamage(a)
    || candidateName(a).localeCompare(candidateName(b))
    || candidateIdentity(a).localeCompare(candidateIdentity(b)))[0];
  const fallback = !!(mode === "melee" || mode === "ranged") && !matching.length;
  return decision(best, [decisionSignal("weapon", fallback
    ? `No legal ${mode} weapon was available; selected the highest-damage legal weapon (${candidateName(best)}).`
    : `Selected the highest-damage legal ${mode === "mixed" || !mode ? "" : `${mode} `}weapon (${candidateName(best)}).`, {
    damage: weaponDamage(best), attackMode: attackModeForWeapon(best), legalOptions: legal,
    reason: fallback ? `no legal ${mode} weapon; ranked all legal weapons by damage` : null,
  })], fallback);
}

export const resolveWeaponMastery = resolveWeaponChoice;
export const resolveMasteryChoice = resolveWeaponChoice;

/** Resolve Armor Mastery by legal AC, with stable name tie-break. */
export function resolveArmorChoice(first, second = null, third = null, fourth = null) {
  const config = normalizeChoiceConfig(first, second, third, fourth);
  const legal = legalCandidates(config.options, (candidate) => classPermits(candidate, config.classItem, config.permits)
    && (typeof config.isLegal !== "function" || config.isLegal(candidate)));
  if (!legal.length) return emptyOptionSet("armor", { evidence: "class-permitted options" });
  const best = [...legal].sort((a, b) => armorAc(b) - armorAc(a)
    || candidateName(a).localeCompare(candidateName(b))
    || candidateIdentity(a).localeCompare(candidateIdentity(b)))[0];
  return decision(best, [decisionSignal("armor", `Selected the highest-AC legal armor (${candidateName(best)}).`, {
    armorClass: armorAc(best), legalOptions: legal,
  })]);
}

export const resolveArmorMastery = resolveArmorChoice;

function tierOf(spell) {
  const value = candidateDocument(spell)?.system?.tier ?? spell?.tier;
  const tier = Number(value);
  return Number.isFinite(tier) ? tier : 0;
}

function durationType(spell) {
  const value = candidateDocument(spell)?.system?.duration ?? spell?.duration;
  if (typeof value === "string") return value.toLowerCase();
  return String(value?.type ?? "").toLowerCase();
}

function durationRank(spell) {
  const type = durationType(spell);
  const order = {
    focus: 8, permanent: 7, days: 6, hours: 5, minutes: 4,
    rounds: 3, turns: 2, instant: 1,
  };
  return order[type] ?? 0;
}

function rangeRank(spell) {
  const value = candidateDocument(spell)?.system?.range ?? spell?.range;
  const text = String(value ?? "").toLowerCase();
  const order = { self: 0, close: 1, near: 2, far: 3, sight: 4, unlimited: 5 };
  if (Number.isFinite(Number(value))) return Number(value);
  return order[text] ?? 0;
}

/** Prefer a known high-tier spell when a spellcasting advantage asks for one. */
export function resolveSpellcastingAdvantage(first, second = null, third = null) {
  const config = Array.isArray(first) ? { options: first, known: second, idiom: third }
    : { ...first, options: first?.options ?? first?.spells ?? first?.candidates };
  const legal = legalCandidates(config.options, typeof config.isLegal === "function" ? config.isLegal : null);
  if (!legal.length) return emptyOptionSet("spellcasting-advantage", { evidence: "options/spells/candidates" });
  const known = asArray(config.known ?? config.knownSpells ?? config.characterSpells);
  const knownKeys = new Set(known.map((spell) => normalizedIdentity(spell) || normalizedName(spell)));
  const knownLegal = knownKeys.size
    ? legal.filter((spell) => knownKeys.has(normalizedIdentity(spell)) || knownKeys.has(normalizedName(spell))) : [];
  const pool = knownLegal.length ? knownLegal : legal;
  const best = [...pool].sort((a, b) => tierOf(b) - tierOf(a)
    || candidateName(a).localeCompare(candidateName(b))
    || candidateIdentity(a).localeCompare(candidateIdentity(b)))[0];
  const fallback = !knownLegal.length;
  return decision(best, [decisionSignal("spellcasting-advantage", fallback
    ? `No known legal spell matched; selected the highest-tier legal spell (${candidateName(best)}).`
    : `Selected the highest-tier known spell (${candidateName(best)}).`, {
    tier: tierOf(best), known: knownLegal.length > 0,
    reason: fallback ? "no known legal spell matched; used the highest-tier legal spell" : null,
    legalOptions: legal,
  })], fallback);
}

export const resolveSpellAdvantage = resolveSpellcastingAdvantage;

function quotasOf(value, level = null) {
  const source = value?.spellcasting?.spellsknown ?? value?.spellsknown ?? value?.quotas ?? value;
  if (!isObject(source)) return {};
  if (Array.isArray(source)) {
    const row = level == null ? source[0] : source.find((entry) => Number(entry.level) === Number(level));
    if (!row) return {};
    if (Array.isArray(row.tiers)) return Object.fromEntries(row.tiers.map((count, index) => [String(index + 1), count]));
    return isObject(row.tiers) ? row.tiers : {};
  }
  // Class documents store a level→tier grid (`spellsknown[level][tier]`). A
  // resolver call normally supplies `level`; accepting the first nested row
  // keeps a captured level-1 parser fixture convenient as well.
  const nested = level != null ? source[String(level)] : source["1"];
  if (isObject(nested)) return nested;
  if (Object.values(source).some((entry) => isObject(entry))) {
    const first = Object.values(source).find((entry) => isObject(entry));
    if (first) return first;
  }
  return source;
}

/** Fill every per-tier spell quota using deterministic metadata ordering. */
export function resolveSpellSelection(first, second = null, third = null) {
  const config = Array.isArray(first)
    ? { spells: first, quotas: second, ...isObject(third) ? third : {} }
    : { ...first, spells: first?.spells ?? first?.options ?? first?.candidates };
  const quotas = quotasOf(config.quotas ?? config.spellsknown ?? config.spellcasting, config.level);
  const legal = legalCandidates(config.spells, typeof config.isLegal === "function" ? config.isLegal : null);
  if (!legal.length) return emptyOptionSet("spell-selection", { evidence: "spells/options/candidates" });
  if (!Object.keys(quotas).length) return missingMetadata("spell-selection", { evidence: "quotas/spellsknown" });
  const tiers = new Map();
  for (const spell of legal) {
    const tier = tierOf(spell);
    if (!tiers.has(tier)) tiers.set(tier, []);
    tiers.get(tier).push(spell);
  }
  const selected = [];
  const byTier = {};
  const unmet = [];
  const tierKeys = Object.keys(quotas).map(Number).filter(Number.isFinite).sort((a, b) => b - a);
  for (const tier of tierKeys) {
    const rawQuota = quotas[String(tier)] ?? quotas[tier];
    const quota = typeof rawQuota === "object" ? Number(rawQuota.count ?? rawQuota.value ?? 0) : Number(rawQuota);
    if (!Number.isFinite(quota) || quota <= 0) { byTier[tier] = []; continue; }
    const candidates = [...(tiers.get(tier) ?? [])].sort((a, b) => durationRank(b) - durationRank(a)
      || rangeRank(b) - rangeRank(a)
      || candidateName(a).localeCompare(candidateName(b))
      || candidateIdentity(a).localeCompare(candidateIdentity(b)));
    const picks = candidates.slice(0, quota);
    byTier[tier] = picks;
    selected.push(...picks);
    if (picks.length < quota) unmet.push({ tier, requested: quota, available: picks.length });
  }
  const fallback = unmet.length > 0;
  const reason = unmet.length
    ? `spell quota unavailable for tier${unmet.length === 1 ? "" : "s"} ${unmet.map((e) => e.tier).join(", ")}` : null;
  return decision(selected, [decisionSignal("spell-selection", fallback
    ? `Filled deterministic spell choices where possible; ${reason}.`
    : "Filled every spell tier quota by tier, duration, range, and name.", {
    byTier, quotas, unmet, reason,
  })], fallback);
}

export const resolveSpells = resolveSpellSelection;
export const resolveSpellChoices = resolveSpellSelection;

function stablePool(candidates) {
  return [...candidates].sort(stableCandidateCompare);
}

/** Uniform choice over legal patrons using the adapter-injected plain rng. */
export function resolvePatron(first, second = null) {
  const config = Array.isArray(first) ? { patrons: first, rng: second }
    : { ...first, patrons: first?.patrons ?? first?.options ?? first?.candidates };
  const legal = legalCandidates(config.patrons, typeof config.isLegal === "function" ? config.isLegal : null);
  if (!legal.length) return emptyOptionSet("patron", { evidence: "patrons/options/candidates" });
  const pool = stablePool(legal);
  const picked = rngPick(pool, config.rng);
  return decision(picked.value, [decisionSignal("patron", `Selected one legal patron from the injected-rng pool (${candidateName(picked.value)}).`, {
    candidates: pool, rngInjected: typeof config.rng === "function", reason: picked.reason,
  })], picked.fallbackUsed);
}

function fixedDeityOf(classItem, config) {
  return config?.fixedDeity ?? config?.fixedDeityUuid
    ?? systemOf(classItem)?.fixedDeity
    ?? classDocument(classItem)?.flags?.["shadowdark-enhancer"]?.fixedDeity
    ?? classDocument(classItem)?.flags?.shadowdarkEnhancer?.fixedDeity
    ?? null;
}

/** Pinned deity first; then shared-alignment pool; then all legal deities. */
export function resolveDeity(first, second = null, third = null, fourth = null) {
  const config = Array.isArray(first) ? { deities: first, classItem: second, alignment: third, rng: fourth }
    : { ...first, deities: first?.deities ?? first?.options ?? first?.candidates };
  const legal = legalCandidates(config.deities, typeof config.isLegal === "function" ? config.isLegal : null);
  if (!legal.length) return emptyOptionSet("deity", { evidence: "deities/options/candidates" });
  const fixed = fixedDeityOf(config.classItem ?? config.class, config);
  const pinnedKey = String(fixed ?? "").toLowerCase();
  const pinned = legal.find((deity) => identityOf(deity).toLowerCase() === pinnedKey);
  if (fixed && pinned) return decision(pinned, [decisionSignal("deity", `Used the class-pinned deity (${candidateName(pinned)}).`, {
    pinned: true, alignment: null, rngInjected: false,
  })]);
  const alignment = String(config.alignment ?? config.sharedAlignment ?? config.partyAlignment ?? "").trim().toLowerCase();
  const matching = alignment ? legal.filter((deity) => String(candidateDocument(deity)?.system?.alignment
    ?? deity?.alignment ?? "").toLowerCase() === alignment) : [];
  const pool = stablePool(matching.length ? matching : legal);
  const picked = rngPick(pool, config.rng);
  const fallback = !!alignment && !matching.length || !!fixed && !pinned;
  const reason = fixed && !pinned ? "pinned deity was not in the legal pool"
    : alignment && !matching.length ? `no legal deity matched shared alignment ${alignment}` : null;
  return decision(picked.value, [decisionSignal("deity", matching.length
    ? `Selected a deity matching shared alignment ${alignment} through the injected rng (${candidateName(picked.value)}).`
    : `No matching deity metadata was available; selected from all legal deities (${candidateName(picked.value)}).`, {
    pinned: false, alignment, candidates: pool, rngInjected: typeof config.rng === "function",
    reason: [reason, picked.reason].filter(Boolean).join("; ") || null,
  })], fallback || picked.fallbackUsed);
}

function costCp(item) {
  const s = candidateDocument(item)?.system ?? {};
  const cost = item?.costCp ?? s.costCp ?? s.cost;
  if (Number.isFinite(Number(cost))) return Number(cost);
  if (!isObject(cost)) return 0;
  return (Number(cost.gp) || 0) * 100 + (Number(cost.sp) || 0) * 10 + (Number(cost.cp) || 0);
}

function slotsUsed(item) {
  const s = candidateDocument(item)?.system?.slots ?? {};
  return Number(item?.slots ?? s.slots_used ?? 0) || 0;
}

function grantedItem(item, grantedRefs) {
  if (item?.granted === true || item?.system?.granted === true) return true;
  const id = identityOf(item);
  return grantedRefs.has(id) || grantedRefs.has(String(item?.uuid ?? ""));
}

function gearKind(item) {
  const type = itemType(item);
  if (type === "weapon") return "weapon";
  if (type === "armor") return "armor";
  return "basic";
}

/**
 * Select granted gear and a small idiomatic purchased loadout.  The default
 * purchase policy chooses one armor and one primary weapon; callers that need
 * a fuller starter kit can pass `fillBasics: true`, retaining book order for
 * every fallback/basic purchase.
 */
export function resolveLoadout(first, second = null, third = null, fourth = null) {
  const config = Array.isArray(first)
    ? { gear: first, classItem: second, idiom: third, budgetCp: fourth }
    : { ...first, gear: first?.gear ?? first?.items ?? first?.options ?? first?.candidates };
  const allGear = asArray(config.gear);
  if (!allGear.length) return emptyOptionSet("loadout", { evidence: "gear/items/options/candidates" });
  const refs = new Set([
    ...asArray(config.grantedItems),
    ...asArray(systemOf(config.classItem ?? config.class)?.grantedItems),
    ...asArray(classDocument(config.classItem ?? config.class)?.flags?.["shadowdark-enhancer"]?.grantedItems),
  ].map((value) => isObject(value) ? identityOf(value) : String(value ?? "")).filter(Boolean));
  const granted = allGear.filter((item) => grantedItem(item, refs));
  const legal = legalCandidates(allGear.filter((item) => !grantedItem(item, refs)),
    (item) => classPermits(item, config.classItem, config.permits)
      && (typeof config.isLegal !== "function" || config.isLegal(item)));
  let remaining = Number(config.budgetCp ?? config.goldCp ?? config.startingGoldCp);
  if (!Number.isFinite(remaining)) {
    const gold = config.gold ?? config.coins;
    remaining = isObject(gold) ? (Number(gold.gp) || 0) * 100 + (Number(gold.sp) || 0) * 10 + (Number(gold.cp) || 0)
      : Number.isFinite(Number(gold)) ? Number(gold) * 100 : Number.POSITIVE_INFINITY;
  }
  const slotLimit = Number(config.slotLimit);
  let slots = granted.reduce((sum, item) => sum + slotsUsed(item), 0);
  const purchased = [];
  const pickedIds = new Set(granted.map(identityOf));
  const fallbacks = [];
  const canBuy = (item) => costCp(item) <= remaining
    && (!Number.isFinite(slotLimit) || slots + slotsUsed(item) <= slotLimit);
  const add = (item, reason = null) => {
    const id = identityOf(item);
    if (!item || pickedIds.has(id) || !canBuy(item)) return false;
    pickedIds.add(id);
    purchased.push(item);
    remaining -= costCp(item);
    slots += slotsUsed(item);
    if (reason) fallbacks.push(reason);
    return true;
  };
  const armor = legal.filter((item) => gearKind(item) === "armor");
  const weapons = legal.filter((item) => gearKind(item) === "weapon");
  const mode = config.idiom?.attackMode;
  const frontline = config.idiom?.frontline ?? (!!systemOf(config.classItem ?? config.class).allArmor
    || mode === "melee");
  if (frontline && armor.length) {
    const affordableArmor = armor.filter(canBuy).sort((a, b) => armorAc(b) - armorAc(a)
      || candidateName(a).localeCompare(candidateName(b)));
    if (affordableArmor.length) add(affordableArmor[0]);
    else fallbacks.push("no preferred armor was affordable; retained legal book-order fallback");
  } else if (frontline) {
    fallbacks.push("no legal armor was supplied for the frontline idiom");
  }
  if (weapons.length) {
    const matching = mode === "melee" || mode === "ranged"
      ? weapons.filter((item) => attackModeForWeapon(item) === mode) : [];
    const pool = matching.length ? matching : weapons;
    const affordableWeapons = pool.filter(canBuy).sort((a, b) => weaponDamage(b) - weaponDamage(a)
      || candidateName(a).localeCompare(candidateName(b)));
    if (affordableWeapons.length) add(affordableWeapons[0]);
    else fallbacks.push("no preferred weapon was affordable; retained legal book-order fallback");
  } else {
    fallbacks.push("no legal primary weapon was supplied");
  }
  // A missing preferred item should never strand the generator. The first
  // affordable legal entry is the explicit book-order fallback.
  const needsFallback = (frontline && !purchased.some((item) => gearKind(item) === "armor"))
    || !purchased.some((item) => gearKind(item) === "weapon");
  if (needsFallback) {
    const fallback = legal.find((item) => canBuy(item));
    if (fallback && add(fallback, "preferred role unavailable; selected the first affordable legal gear in book order")) { /* recorded */ }
  }
  if (config.fillBasics) {
    for (const item of legal) if (gearKind(item) === "basic") add(item);
  }
  const items = [...granted, ...purchased];
  const fallback = fallbacks.length > 0;
  return decision(items, [decisionSignal("loadout", fallback
    ? `Embedded ${granted.length} granted item${granted.length === 1 ? "" : "s"} and used legal loadout fallbacks where needed.`
    : `Embedded ${granted.length} granted item${granted.length === 1 ? "" : "s"} and bought an idiomatic legal armor/weapon loadout.`, {
    granted, purchased, legalOptions: legal, spentCp: items.filter((item) => !grantedItem(item, refs))
      .reduce((sum, item) => sum + costCp(item), 0),
    remainingCp: remaining, slotsUsed: slots, slotLimit: Number.isFinite(slotLimit) ? slotLimit : null,
    fallbacks,
  })], fallback);
}

export const resolveGearLoadout = resolveLoadout;

export const resolvePatronChoice = resolvePatron;
export const resolveDeityChoice = resolveDeity;
export const resolveArmor = resolveArmorChoice;
export const resolveWeapon = resolveWeaponChoice;
export const resolveSpell = resolveSpellSelection;

/** Dispatch a supported REPLACEME family without importing builder code. */
export function resolveChoice(specOrEffect, config = {}) {
  const spec = typeof specOrEffect === "string"
    ? choiceSpecFor(specOrEffect) : specOrEffect?.key ? specOrEffect : choiceSpecFor(specOrEffect?.name);
  switch (spec?.key) {
    case "weapon": return resolveWeaponChoice(config);
    case "armor": return resolveArmorChoice(config);
    case "spell": return resolveSpellcastingAdvantage(config);
    default: return unsupported(NO_MATCHING_SPEC, {
      effectName: typeof specOrEffect === "string" ? specOrEffect : specOrEffect?.name ?? null,
      evidence: "CHOICE_SPECS",
    });
  }
}

/**
 * Resolve every REPLACEME effect on a Talent snapshot.  The Character Builder
 * intentionally remains first-effect-only; this pure seam keeps all effects
 * visible so a later consumer can decide how to present or commit them.
 */
export function resolveChoosableEffects(document, config = {}) {
  const effects = choosableEffects(document);
  if (!effects.length) return missingMetadata("choosable-effects", { evidence: "REPLACEME effect" });
  const values = [];
  const signals = [];
  let fallbackUsed = false;
  for (const [index, effect] of effects.entries()) {
    const spec = choiceSpecFor(effect.name);
    if (!spec) {
      const unsupportedResult = unsupported(NO_MATCHING_SPEC, {
        effectIndex: index,
        effectName: effect.name ?? null,
        evidence: "REPLACEME effect name",
      });
      values.push({ effect, spec: null, result: unsupportedResult });
      signals.push(decisionSignal("choosable-effect", `Effect ${index + 1} has no matching choice specification.`, {
        effectIndex: index, effectName: effect.name ?? null, unsupported: unsupportedResult.unsupported,
      }));
      fallbackUsed = true;
      continue;
    }
    const options = config.optionsBySpec?.[spec.key] ?? config[`${spec.key}Options`] ?? config.options;
    const resolved = resolveChoice(spec, { ...config, options, rng: config.rng });
    values.push({ effect, spec: spec.key, result: resolved });
    if (resolved.unsupported) fallbackUsed = true;
    else fallbackUsed ||= resolved.fallbackUsed;
    signals.push(decisionSignal("choosable-effect", `Resolved ${spec.key} choice for ${effect.name ?? "unnamed effect"}.`, {
      effectIndex: index, effectName: effect.name ?? null, spec: spec.key,
    }));
  }
  return decision(values, signals, fallbackUsed);
}

export const resolveAllChoosableEffects = resolveChoosableEffects;

/**
 * Convenience aggregate for a level-1 planner.  It intentionally only calls
 * the G6a policies; advancement, dialogs, and persistence remain elsewhere.
 */
export function resolveClassChoices(config = {}) {
  const idiom = config.idiom ?? deriveClassIdiom(config.classItem ?? config.class, config.talentDocs ?? []);
  return {
    idiom,
    stats: config.scores || config.pool ? resolveAbilityScores({ scores: config.scores ?? config.pool, idiom, method: config.method, rng: config.rng }) : null,
    plusTwo: config.plusTwo ? resolvePlusTwoChoice({ ...config.plusTwo, idiom, rng: config.rng }) : null,
    talent: config.talentOptions ? resolveTalentChoice({ options: config.talentOptions, idiom, rng: config.rng }) : null,
    weapon: config.weaponOptions ? resolveWeaponChoice({ options: config.weaponOptions, classItem: config.classItem ?? config.class, idiom, rng: config.rng }) : null,
    armor: config.armorOptions ? resolveArmorChoice({ options: config.armorOptions, classItem: config.classItem ?? config.class, rng: config.rng }) : null,
    spellAdvantage: config.spellOptions ? resolveSpellcastingAdvantage({ options: config.spellOptions, known: config.knownSpells, rng: config.rng }) : null,
    spells: config.spells && config.quotas ? resolveSpellSelection({ spells: config.spells, quotas: config.quotas, rng: config.rng }) : null,
    patron: config.patrons ? resolvePatron({ patrons: config.patrons, rng: config.rng }) : null,
    deity: config.deities ? resolveDeity({ deities: config.deities, classItem: config.classItem ?? config.class, alignment: config.alignment, rng: config.rng }) : null,
    loadout: config.gear ? resolveLoadout({ gear: config.gear, classItem: config.classItem ?? config.class, idiom, budgetCp: config.budgetCp, rng: config.rng }) : null,
  };
}
