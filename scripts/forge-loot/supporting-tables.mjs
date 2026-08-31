/**
 * Shadowdark Enhancer — Forge & Loot supporting-table registry (G8).
 *
 * This module is the single logical-role vocabulary for the NPC and Rival
 * generators.  Definitions are derived from the table manifest, while the
 * live adapter reads only the managed Roll Tables pack and the stamped
 * `manifestId` + `source` flags.  It deliberately has no create/update path:
 * the Table Hub matrix importer remains the only way these tables enter a
 * world.
 *
 * The pure definitions and catalog assembly are Node-testable.  Foundry is
 * touched only by `loadManagedSupportingTables`, `loadSystemSupportingTables`,
 * and the async `catalog` convenience function.
 */

import { columnManifestId, columnSlug, findById, formulaFromDie, importNameFor, isMatrix } from "../importer/tables/table-manifest.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";
import { sourceKey } from "../shared/source-keys.mjs";

export const CORE_SOURCE = "core";
export const CORE_PDF_SOURCE_KEY = "CORE";
export const CORE_BOOK = "Shadowdark RPG";
export const MANAGED_TABLES_PACK = "sde-tables";

const STATIC_ROLE_SPECS = Object.freeze([
  ["ancestry", "core-random-ancestry"],
  ["identifier", "core-identifier"],
  ["age", "core-age"],
  ["alignment", "core-random-alignment"],
  ["npc-wealth", "core-wealth-npc"],
  ["occupation", "core-occupation"],
  ["renown", "core-renown"],
  ["secret", "core-secret"],
  ["rival-wealth", "core-wealth-rival-crawlers"],
]);

const MATRIX_ROLE_SPECS = Object.freeze([
  ["npc-name-by-ancestry", "core-npc-names-by-ancestry"],
  ["npc-qualities", "core-npc-qualities"],
  ["party-name", "core-party-name"],
]);

const SIGNATURE_TACTICS_ENTRY_ID = "core-signature-tactics";
export const SIGNATURE_TACTICS_ALIGNMENTS = Object.freeze(["lawful", "neutral", "chaotic"]);

/** The stable logical role vocabulary consumed by G5 and G7. */
export const SUPPORTING_ROLE_KEYS = Object.freeze([
  "ancestry",
  "npc-name-by-ancestry",
  "identifier",
  "age",
  "alignment",
  "npc-wealth",
  "npc-qualities",
  "occupation",
  "renown",
  "secret",
  "rival-wealth",
  "party-name",
  ...SIGNATURE_TACTICS_ALIGNMENTS.map((alignment) => `signature-tactics:${alignment}`),
]);

/** Convenient aliases for callers that prefer a shorter registry name. */
export const ROLE_KEYS = SUPPORTING_ROLE_KEYS;
export const SUPPORTING_ROLES = Object.freeze(
  Object.fromEntries(SUPPORTING_ROLE_KEYS.map((role) => [role, role])),
);
export const SIGNATURE_TACTICS_ROLE_KEYS = Object.freeze(
  SIGNATURE_TACTICS_ALIGNMENTS.map((alignment) => `signature-tactics:${alignment}`),
);

const ROLE_SET = new Set(SUPPORTING_ROLE_KEYS);

function freezeData(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    freezeData(child, seen);
  }
  return Object.freeze(value);
}

function requiredEntry(entryId) {
  const entry = findById(entryId);
  if (!entry) throw new Error(`supporting-tables: manifest entry "${entryId}" is missing`);
  return entry;
}

function childName(entry, column) {
  return `${importNameFor(entry)} - ${column}`;
}

function childDefinition(entry, column, role, family) {
  const manifestId = columnManifestId(entry.id, column);
  return {
    role,
    family,
    column,
    columnKey: columnSlug(column),
    manifestEntryId: entry.id,
    manifestId,
    expectedManifestId: manifestId,
    id: manifestId,
    source: CORE_SOURCE,
    expectedSource: CORE_SOURCE,
    importName: childName(entry, column),
    expectedImportName: childName(entry, column),
    name: childName(entry, column),
    label: childName(entry, column),
    page: entry.page ?? null,
    die: entry.die ?? null,
    formula: formulaFromDie(entry.die),
    rows: entry.rows ?? null,
    systemUuid: null,
    kind: "matrix-column",
  };
}

function singleDefinition(role, entryId) {
  const entry = requiredEntry(entryId);
  const requestedDie = role === "identifier" ? "4d4" : entry.die;
  return {
    role,
    manifestEntryId: entry.id,
    manifestId: entry.id,
    expectedManifestId: entry.id,
    id: entry.id,
    source: CORE_SOURCE,
    expectedSource: CORE_SOURCE,
    importName: importNameFor(entry),
    expectedImportName: importNameFor(entry),
    name: importNameFor(entry),
    label: importNameFor(entry),
    page: entry.page ?? null,
    die: entry.die ?? null,
    requestedDie,
    logicalDie: requestedDie,
    formula: formulaFromDie(entry.die),
    rows: entry.rows ?? null,
    systemUuid: entry.systemUuid ?? null,
    category: entry.category ?? null,
    sub: entry.sub ?? null,
    kind: "single",
  };
}

function matrixDefinition(role, entryId) {
  const entry = requiredEntry(entryId);
  if (!isMatrix(entry)) {
    throw new Error(`supporting-tables: manifest entry "${entryId}" is not a matrix`);
  }
  const children = entry.columns.map((column) => childDefinition(entry, column, role, role));
  return {
    role,
    manifestEntryId: entry.id,
    manifestId: entry.id,
    expectedManifestId: entry.id,
    id: entry.id,
    source: CORE_SOURCE,
    expectedSource: CORE_SOURCE,
    importName: importNameFor(entry),
    expectedImportName: importNameFor(entry),
    name: importNameFor(entry),
    label: importNameFor(entry),
    page: entry.page ?? null,
    die: entry.die ?? null,
    formula: formulaFromDie(entry.die),
    rows: entry.rows ?? null,
    systemUuid: null,
    category: entry.category ?? null,
    sub: entry.sub ?? null,
    kind: "matrix",
    columns: [...entry.columns],
    widths: entry.widths ? entry.widths.map((row) => [...row]) : null,
    children,
  };
}

const ROLE_DEFINITION_ENTRIES = [
  ...STATIC_ROLE_SPECS.map(([role, entryId]) => [role, singleDefinition(role, entryId)]),
  ...MATRIX_ROLE_SPECS.map(([role, entryId]) => [role, matrixDefinition(role, entryId)]),
];

for (const alignment of SIGNATURE_TACTICS_ALIGNMENTS) {
  const entry = requiredEntry(SIGNATURE_TACTICS_ENTRY_ID);
  const column = entry.columns.find((candidate) => columnSlug(candidate) === alignment);
  if (!column) throw new Error(`supporting-tables: signature tactic column "${alignment}" is missing`);
  ROLE_DEFINITION_ENTRIES.push([
    `signature-tactics:${alignment}`,
    childDefinition(entry, column, `signature-tactics:${alignment}`, "signature-tactics"),
  ]);
}

/** Immutable definitions for every logical role and matrix family. */
export const SUPPORTING_ROLE_DEFINITIONS = freezeData(
  Object.fromEntries(ROLE_DEFINITION_ENTRIES),
);
export const ROLE_DEFINITIONS = SUPPORTING_ROLE_DEFINITIONS;
export const SUPPORTING_TABLE_DEFS = SUPPORTING_ROLE_DEFINITIONS;

/** The three direct Signature Tactics child definitions, keyed by alignment. */
export const SIGNATURE_TACTICS_DEFS = freezeData(
  Object.fromEntries(
    SIGNATURE_TACTICS_ALIGNMENTS.map((alignment) => [
      alignment,
      SUPPORTING_ROLE_DEFINITIONS[`signature-tactics:${alignment}`],
    ]),
  ),
);

/** Exact identities/names emitted by the existing Signature Tactics matrix import. */
export const SIGNATURE_TACTICS_IDENTITIES = freezeData(
  Object.fromEntries(
    SIGNATURE_TACTICS_ALIGNMENTS.map((alignment) => {
      const definition = SUPPORTING_ROLE_DEFINITIONS[`signature-tactics:${alignment}`];
      return [alignment, {
        manifestId: definition.manifestId,
        name: definition.expectedImportName,
      }];
    }),
  ),
);

const SYSTEM_ROLE_KEYS = new Set(
  STATIC_ROLE_SPECS
    .map(([role]) => role)
    .filter((role) => SUPPORTING_ROLE_DEFINITIONS[role]?.systemUuid),
);

const WANTED_MANIFEST_IDS = new Set(
  SUPPORTING_ROLE_KEYS.flatMap((role) => {
    const definition = SUPPORTING_ROLE_DEFINITIONS[role];
    if (definition.kind === "matrix") return definition.children.map((child) => child.manifestId);
    return [definition.manifestId];
  }),
);

/** Every exact managed identity this registry will read, in role order. */
export const SUPPORTING_MANIFEST_IDS = Object.freeze([...WANTED_MANIFEST_IDS]);
export const IDENTITY_IDS = SUPPORTING_MANIFEST_IDS;

function normalizeAlignment(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  return SIGNATURE_TACTICS_ALIGNMENTS.includes(normalized) ? normalized : null;
}

const ANCESTRY_COLUMNS = SUPPORTING_ROLE_DEFINITIONS["npc-name-by-ancestry"].columns;
const ANCESTRY_BY_SLUG = new Map(ANCESTRY_COLUMNS.map((column) => [columnSlug(column), column]));

function normalizeAncestry(value) {
  const raw = typeof value === "object" && value !== null
    ? (value.slug ?? value.key ?? value.name ?? value.value)
    : value;
  const slug = columnSlug(raw);
  return ANCESTRY_BY_SLUG.has(slug) ? slug : null;
}

function invalidDefinition(role, expectedManifestId, reason) {
  return {
    role: String(role ?? ""),
    manifestEntryId: null,
    manifestId: null,
    expectedManifestId,
    source: CORE_SOURCE,
    expectedSource: CORE_SOURCE,
    importName: "",
    expectedImportName: "",
    kind: "invalid",
    invalidReason: reason,
  };
}

/**
 * Resolve a public role key to its exact manifest identity.  Dynamic families
 * require `ancestry` or `alignment` and retain the family role in the result.
 * No live documents are read here.
 */
export function definitionForRole(role, options = {}) {
  const rawRole = String(role ?? "").trim().toLowerCase();
  if (ROLE_SET.has(rawRole)) {
    const definition = SUPPORTING_ROLE_DEFINITIONS[rawRole];
    if (rawRole === "npc-name-by-ancestry") {
      const ancestry = normalizeAncestry(options.ancestry);
      if (!ancestry) {
        return invalidDefinition(
          rawRole,
          `core-npc-names-by-ancestry:${columnSlug(options.ancestry) || "<ancestry-slug>"}`,
          options.ancestry == null ? "ancestry is required" : "unknown ancestry",
        );
      }
      const column = ANCESTRY_BY_SLUG.get(ancestry);
      return {
        ...definition.children.find((child) => child.columnKey === columnSlug(column)),
        role: rawRole,
        ancestry,
      };
    }
    return definition;
  }

  if (rawRole === "signature-tactics") {
    const alignment = normalizeAlignment(options.alignment);
    return alignment
      ? SUPPORTING_ROLE_DEFINITIONS[`signature-tactics:${alignment}`]
      : invalidDefinition(
        rawRole,
        `core-signature-tactics:${columnSlug(options.alignment) || "<alignment>"}`,
        options.alignment == null ? "alignment is required" : "unknown alignment",
      );
  }

  if (rawRole.startsWith("signature-tactics:")) {
    const alignment = normalizeAlignment(rawRole.slice("signature-tactics:".length));
    return alignment
      ? SUPPORTING_ROLE_DEFINITIONS[`signature-tactics:${alignment}`]
      : invalidDefinition(rawRole, rawRole.replace(/\s+/g, "-"), "unknown alignment");
  }

  if (rawRole.startsWith("npc-name-by-ancestry:")) {
    return definitionForRole("npc-name-by-ancestry", {
      ancestry: rawRole.slice("npc-name-by-ancestry:".length),
    });
  }

  return invalidDefinition(rawRole, rawRole || "<role>", "unknown logical role");
}

export const getSupportingRoleDefinition = definitionForRole;
export const manifestIdForRole = (role, options = {}) => definitionForRole(role, options).expectedManifestId;

/** Build the canonical Importer Hub seed.  This never imports or persists. */
export function buildSupportingTableSeed(role, options = {}) {
  const definition = definitionForRole(role, options);
  if (definition.invalidReason) {
    throw new Error(
      `Cannot build a seed for logical role "${definition.role}": expected manifest id "${definition.expectedManifestId}" (${definition.invalidReason}).`,
    );
  }
  const entry = requiredEntry(definition.manifestEntryId);
  return {
    name: importNameFor(entry),
    die: entry.die,
    requestedDie: definition.requestedDie ?? entry.die,
    logicalDie: definition.logicalDie ?? definition.requestedDie ?? entry.die,
    page: entry.page,
    formula: formulaFromDie(entry.die),
    category: entry.category ?? null,
    folderLabel: entry.sub || entry.category || null,
    manifestId: entry.id,
    matrix: isMatrix(entry),
    columns: entry.columns ? [...entry.columns] : null,
    widths: entry.widths ? entry.widths.map((row) => [...row]) : null,
    grid: !!entry.grid,
    src: CORE_PDF_SOURCE_KEY,
    book: CORE_BOOK,
    logicalRole: definition.role,
    expectedManifestId: definition.expectedManifestId,
    expectedImportName: definition.expectedImportName,
  };
}

export const buildTableSeed = buildSupportingTableSeed;
export const buildImportSeed = buildSupportingTableSeed;

function moduleFlag(document, key) {
  let value;
  if (typeof document?.getFlag === "function") {
    try {
      value = document.getFlag(MODULE_ID, key);
    } catch (_) {
      value = undefined;
    }
  }
  return value ?? document?.flags?.[MODULE_ID]?.[key];
}

function resultRows(results) {
  if (!results) return [];
  if (Array.isArray(results)) return results;
  if (typeof results.values === "function") return [...results.values()];
  if (typeof results[Symbol.iterator] === "function") return [...results];
  return [];
}

function resultDescriptor(result) {
  const range = Array.isArray(result?.range)
    ? [...result.range]
    : [result?.range, result?.range];
  return {
    id: result?.id ?? result?._id ?? null,
    range,
    text: result?.name ?? result?.description ?? result?.text ?? "",
  };
}

/** Convert a live or fixture RollTable into the internal, identity-bearing shape. */
export function describeSupportingTable(document, options = {}) {
  const location = options.location ?? "managed";
  const stampedManifestId = moduleFlag(document, "manifestId")
    ?? (options.stampedOnly ? null : document?.manifestId)
    ?? null;
  const stampedSource = moduleFlag(document, "source")
    ?? (options.stampedOnly ? null : document?.source)
    ?? null;
  const manifestId = stampedManifestId == null || String(stampedManifestId).trim() === ""
    ? null
    : String(stampedManifestId).trim();
  const source = stampedSource == null || String(stampedSource).trim() === ""
    ? (location === "system" ? CORE_SOURCE : null)
    : sourceKey(stampedSource);
  const documentResults = document?.results ?? document?.table?.results;
  return {
    table: document?.table ?? document,
    uuid: document?.uuid ?? document?.table?.uuid ?? null,
    id: document?.id ?? document?._id ?? document?.table?.id ?? document?.table?._id ?? null,
    name: document?.name ?? document?.table?.name ?? "",
    manifestId,
    source,
    sourceStamp: stampedSource == null ? null : String(stampedSource),
    formula: document?.formula ?? document?.table?.formula ?? "",
    results: resultRows(documentResults).map(resultDescriptor),
    location,
    systemUuid: options.systemUuid ?? null,
  };
}

function descriptorFromFixture(value) {
  if (value?.table || value?.manifestId != null || value?.source != null) {
    return describeSupportingTable(value, { location: value.location ?? "managed" });
  }
  return describeSupportingTable(value, { location: "managed" });
}

/** Read the managed Roll Tables pack; names are intentionally ignored. */
export async function loadManagedSupportingTables({ game: gameRef = globalThis.game, findPack = findSuitePack } = {}) {
  const pack = findPack(MANAGED_TABLES_PACK, { game: gameRef });
  if (!pack || typeof pack.getDocuments !== "function") return [];
  let documents;
  try {
    documents = await pack.getDocuments();
  } catch (error) {
    console.warn(`${MODULE_ID} | supporting-tables: failed reading ${MANAGED_TABLES_PACK}`, error);
    return [];
  }
  return resultRows(documents)
    .map((document) => describeSupportingTable(document, { location: "managed", stampedOnly: true }))
    .filter((descriptor) => WANTED_MANIFEST_IDS.has(descriptor.manifestId));
}

export const loadManagedDescriptors = loadManagedSupportingTables;
export const readManagedSupportingTables = loadManagedSupportingTables;

/** Read only the two exact Core system tables used for ancestry and alignment. */
export async function loadSystemSupportingTables({ fromUuid: resolver = globalThis.fromUuid } = {}) {
  if (typeof resolver !== "function") return [];
  const output = [];
  for (const role of SYSTEM_ROLE_KEYS) {
    const definition = SUPPORTING_ROLE_DEFINITIONS[role];
    if (!definition.systemUuid) continue;
    let document;
    try {
      document = await resolver(definition.systemUuid);
    } catch (_) {
      document = null;
    }
    if (!document) continue;
    if (document.uuid && document.uuid !== definition.systemUuid) continue;
    output.push(describeSupportingTable(document, {
      location: "system",
      systemUuid: definition.systemUuid,
    }));
    output[output.length - 1].manifestId = definition.manifestId;
    output[output.length - 1].source = CORE_SOURCE;
  }
  return output;
}

export const loadSystemDescriptors = loadSystemSupportingTables;

function diagnostic(code, role, expectedManifestId, detail = "") {
  const suffix = detail ? ` ${detail}` : "";
  return {
    code,
    role,
    expectedManifestId,
    message: `Logical role "${role}" expected manifest id "${expectedManifestId}" from source "${CORE_SOURCE}".${suffix}`,
  };
}

function stateFromDefinition(definition, fields = {}) {
  return {
    role: definition.role,
    kind: definition.kind,
    manifestId: definition.manifestId,
    expectedManifestId: definition.expectedManifestId,
    expectedSource: definition.expectedSource,
    expectedImportName: definition.expectedImportName,
    ready: false,
    status: "missing",
    table: null,
    descriptor: null,
    tables: [],
    children: [],
    diagnostics: [],
    ...fields,
  };
}

function evidenceFor(descriptors) {
  return descriptors.map((descriptor) => ({
    uuid: descriptor.uuid,
    id: descriptor.id,
    name: descriptor.name,
    manifestId: descriptor.manifestId,
    source: descriptor.source,
  }));
}

function resolveOne(definition, descriptors, diagnosticRole = definition.role) {
  const allMatching = descriptors.get(definition.manifestId) ?? [];
  // The Core system tables are a fallback for the two system-owned roles.  A
  // managed candidate, including a foreign or duplicate stamp, must win that
  // decision so a bad managed import cannot be hidden by the system copy.
  const managedMatching = allMatching.filter((descriptor) => descriptor.location !== "system");
  const matching = managedMatching.length
    ? managedMatching
    : allMatching.filter((descriptor) => descriptor.location === "system");
  const valid = matching.filter((descriptor) => descriptor.source === definition.expectedSource);
  const base = stateFromDefinition(definition, {
    role: diagnosticRole,
    manifestId: definition.manifestId,
    expectedManifestId: definition.expectedManifestId,
    column: definition.column ?? null,
    columnKey: definition.columnKey ?? null,
    importName: definition.importName,
    expectedImportName: definition.expectedImportName,
    evidence: evidenceFor(matching),
  });

  if (matching.length === 0) {
    return {
      ...base,
      diagnostics: [diagnostic(
        "missing",
        diagnosticRole,
        definition.expectedManifestId,
        "No stamped managed table was found.",
      )],
    };
  }
  if (valid.length === 0) {
    const sources = [...new Set(matching.map((descriptor) => descriptor.source ?? "<missing>"))].join(", ");
    return {
      ...base,
      status: "foreign-source",
      diagnostics: [diagnostic(
        "foreign-source",
        diagnosticRole,
        definition.expectedManifestId,
        `Found ${matching.length} table(s) with source stamp(s) ${sources}, but none carries the expected source stamp.`,
      )],
    };
  }
  if (matching.length !== 1 || valid.length !== 1) {
    return {
      ...base,
      status: "duplicate",
      diagnostics: [diagnostic(
        "duplicate",
        diagnosticRole,
        definition.expectedManifestId,
        `Found ${matching.length} stamped table(s); exactly one is required.`,
      )],
    };
  }

  const descriptor = valid[0];
  return {
    ...base,
    ready: true,
    status: "ready",
    table: descriptor.table ?? descriptor,
    descriptor,
    tables: [descriptor.table ?? descriptor],
    diagnostics: [],
  };
}

function resolveFamily(definition, descriptors) {
  const children = definition.children.map((child) => resolveOne(child, descriptors, definition.role));
  const diagnostics = children.flatMap((child) => child.diagnostics);
  return stateFromDefinition(definition, {
    ready: children.every((child) => child.ready),
    status: children.every((child) => child.ready) ? "ready" : "partial",
    tables: children.filter((child) => child.ready).flatMap((child) => child.tables),
    children,
    diagnostics,
  });
}

function normalizeDescriptors(values, location = "managed") {
  return resultRows(values).map((value) => {
    const descriptor = descriptorFromFixture(value);
    if (value?.location == null && location === "system") {
      return {
        ...descriptor,
        location,
        source: descriptor.source ?? CORE_SOURCE,
      };
    }
    return descriptor.location ? descriptor : { ...descriptor, location };
  });
}

/**
 * Assemble a fail-closed catalog from identity descriptors.  This is pure: a
 * caller can pass fixtures, the managed-pack adapter's output, or both.
 */
export function buildSupportingTableCatalog(input = [], options = {}) {
  let descriptorsInput = input;
  let opts = options;
  if (!Array.isArray(input) && input && typeof input === "object") {
    opts = { ...input, ...options };
    descriptorsInput = opts.descriptors ?? [];
  }
  const managed = normalizeDescriptors(descriptorsInput, "managed");
  const system = normalizeDescriptors(opts.systemDescriptors ?? [], "system");
  const descriptors = [...managed, ...system];
  const byManifestId = new Map();
  for (const descriptor of descriptors) {
    if (!WANTED_MANIFEST_IDS.has(descriptor.manifestId)) continue;
    if (!byManifestId.has(descriptor.manifestId)) byManifestId.set(descriptor.manifestId, []);
    byManifestId.get(descriptor.manifestId).push(descriptor);
  }

  const roles = {};
  for (const role of SUPPORTING_ROLE_KEYS) {
    const definition = SUPPORTING_ROLE_DEFINITIONS[role];
    roles[role] = definition.kind === "matrix"
      ? resolveFamily(definition, byManifestId)
      : resolveOne(definition, byManifestId);
  }
  const diagnostics = Object.values(roles).flatMap((state) => state.diagnostics);
  return Object.freeze({
    ready: diagnostics.length === 0,
    roleKeys: SUPPORTING_ROLE_KEYS,
    roles: Object.freeze(roles),
    byRole: roles,
    diagnostics,
    missing: diagnostics,
    descriptors,
  });
}

export const buildCatalog = buildSupportingTableCatalog;
export const resolveSupportingTableCatalog = buildSupportingTableCatalog;

function invalidState(definition) {
  return stateFromDefinition(definition, {
    role: definition.role,
    manifestId: definition.manifestId,
    expectedManifestId: definition.expectedManifestId,
    status: "invalid",
    diagnostics: [diagnostic(
      "invalid-role",
      definition.role,
      definition.expectedManifestId,
      `${definition.invalidReason}.`,
    )],
  });
}

/** Resolve one logical role from a catalog, with dynamic-family options. */
export function resolveSupportingTableRole(first, second, third = {}) {
  let role;
  let catalogValue;
  let options;
  if (typeof first === "string") {
    role = first;
    options = second ?? {};
    catalogValue = options.catalog;
  } else {
    catalogValue = first;
    role = second;
    options = third ?? {};
  }
  const definition = definitionForRole(role, options);
  if (definition.invalidReason) return invalidState(definition);
  const catalogValueResolved = catalogValue ?? buildSupportingTableCatalog(options);
  const baseRole = definition.role;
  if (definition.kind === "matrix-column" && definition.family !== "signature-tactics") {
    const family = catalogValueResolved.roles?.[baseRole];
    const child = family?.children?.find((candidate) => candidate.manifestId === definition.manifestId);
    if (child) return child;
    return resolveOne(definition, new Map(), baseRole);
  }
  return catalogValueResolved.roles?.[baseRole]
    ?? invalidState(invalidDefinition(baseRole, definition.expectedManifestId, "role is not present in catalog"));
}

export const resolveRole = resolveSupportingTableRole;

/** Return the live document/descriptor for a ready role, or null when blocked. */
export function tableForRole(first, second, third = {}) {
  const state = resolveSupportingTableRole(first, second, third);
  return state.ready ? state.table : null;
}

/** Throw the visible role/manifest diagnostic when a required role is absent. */
export function requireSupportingTable(first, second, third = {}) {
  const state = resolveSupportingTableRole(first, second, third);
  if (state.ready) return state.table;
  const message = state.diagnostics.map((entry) => entry.message).join(" ")
    || `Logical role "${state.role}" expected manifest id "${state.expectedManifestId}".`;
  throw new Error(message);
}

function tableResults(tableOrState) {
  const descriptor = tableOrState?.descriptor ?? tableOrState;
  const rows = descriptor?.results ?? descriptor?.table?.results ?? tableOrState?.results;
  return resultRows(rows).map(resultDescriptor);
}

function formulaDomain(formula) {
  const match = String(formula ?? "").trim().toLowerCase().match(/^(\d+)d(\d+)$/);
  if (!match) return null;
  const count = Number(match[1]);
  const faces = Number(match[2]);
  return count > 0 && faces > 0 ? [count, count * faces] : null;
}

/** Select one imported row with an injected [0, 1) RNG (or Math.random). */
export function pickSupportingTableResult(tableOrState, rng = Math.random) {
  const state = tableOrState?.ready === false ? tableOrState : null;
  if (state && !state.ready) {
    const detail = state.diagnostics.map((entry) => entry.message).join(" ");
    throw new Error(detail || `Logical role "${state.role}" is not ready.`);
  }
  const descriptor = tableOrState?.descriptor ?? tableOrState;
  const rows = tableResults(tableOrState);
  if (!rows.length) throw new Error("Supporting table has no imported results.");
  if (typeof rng !== "function") throw new TypeError("Supporting-table RNG must be a function.");
  const sample = Number(rng());
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError("Supporting-table RNG must return a number in [0, 1).");
  }
  const domain = formulaDomain(descriptor?.formula);
  const ranges = rows.filter((row) => Number.isFinite(row.range[0]) && Number.isFinite(row.range[1]));
  const low = domain?.[0] ?? (ranges.length ? Math.min(...ranges.map((row) => row.range[0])) : 1);
  const high = domain?.[1] ?? (ranges.length ? Math.max(...ranges.map((row) => row.range[1])) : rows.length);
  const roll = low + Math.floor(sample * (high - low + 1));
  const selected = ranges.find((row) => roll >= row.range[0] && roll <= row.range[1])
    ?? rows[Math.min(rows.length - 1, Math.floor(sample * rows.length))];
  return {
    ...selected,
    manifestId: tableOrState?.manifestId ?? descriptor?.manifestId ?? null,
    tableUuid: tableOrState?.uuid ?? descriptor?.uuid ?? null,
  };
}

export const selectSupportingTableResult = pickSupportingTableResult;
export const rollSupportingTable = pickSupportingTableResult;

/** Read both managed and exact system sources and assemble the current catalog. */
export async function catalog(options = {}) {
  const managed = Object.hasOwn(options, "descriptors")
    ? options.descriptors
    : await loadManagedSupportingTables(options);
  const system = Object.hasOwn(options, "systemDescriptors")
    ? options.systemDescriptors
    : await loadSystemSupportingTables(options);
  return buildSupportingTableCatalog(managed, { systemDescriptors: system });
}

const REGISTRY = {
  roleKeys: SUPPORTING_ROLE_KEYS,
  roles: SUPPORTING_ROLE_DEFINITIONS,
  definitions: SUPPORTING_ROLE_DEFINITIONS,
  definitionForRole,
  buildCatalog: buildSupportingTableCatalog,
  resolve: resolveSupportingTableRole,
  tableForRole,
  require: requireSupportingTable,
  loadManaged: loadManagedSupportingTables,
  catalog,
};

/** Module-internal registry object; nothing is attached to `game`. */
export const SupportingTableRegistry = Object.freeze(REGISTRY);
export const supportingTableRegistry = SupportingTableRegistry;
