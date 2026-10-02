/** Read-once SDX adoption. No SDX writes and no private fields on Scenes/Actors. */
import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { EXTRAS_ID, EXTRAS_HEX_JOURNAL } from "./extras-records.mjs";
import { hexNumberAt } from "./hex-number-api.mjs";
import { normalizeTerrainWord, FEATURES } from "./tag-store.mjs";
import { importFog } from "./hex-fog-core.mjs";
import { RECORD_FLAG, sceneRef, sceneUuid, offsetKey, recordJournal, isHexAdopted, publishHexProjection, assertPrivateJournal, loadHexRecords, ensurePrivateHexPack, cacheHexJournal } from "./hex-records.mjs";

const object = v => !!v && typeof v === "object" && !Array.isArray(v);
const clone = v => structuredClone(v);
export function parseOffsetKey(key) {
  const match = String(key).match(/^(-?\d+)[_-](-?\d+)$/);
  if (!match) return null;
  const i = Number(match[1]), j = Number(match[2]);
  return Number.isSafeInteger(i) && Number.isSafeInteger(j) ? { i, j } : null;
}
/** Existing values (including empty notes and false disclosure) are authoritative. */
function mergeMissing(legacy, native, conflicts, key, prefix = "") {
  const out = clone(legacy);
  for (const [field, value] of Object.entries(native)) {
    if (Object.hasOwn(out, field) && JSON.stringify(out[field]) !== JSON.stringify(value)) conflicts.push({ key, field: prefix + field });
    out[field] = object(out[field]) && object(value) ? mergeMissing(out[field], value, conflicts, key, `${prefix}${field}.`) : clone(value);
  }
  return out;
}
export function planHexAdoption({ sceneUuid: uuid, legacy = {}, existing = {}, tags = null, numberAt = () => null } = {}) {
  if (!uuid || !object(legacy) || !object(existing)) throw new Error("SDE.hexRecords.unreadable");
  const cells = clone(existing), nextTags = tags ? clone(tags) : null;
  const report = { sceneUuid: uuid, imported: 0, conflicts: [], skipped: [], warningKey: "SDE.hexRecords.legacyPrivacy" };
  for (const [inputKey, raw] of Object.entries(legacy)) {
    const offset = parseOffsetKey(inputKey);
    if (!offset || !object(raw)) { report.skipped.push({ key: inputKey, input: clone(raw), reason: "SDE.hexRecords.invalidCell" }); continue; }
    const key = offsetKey(offset), num = numberAt(offset);
    const imported = { ...clone(raw), legacy: clone(raw) };
    if (!Object.hasOwn(imported, "title")) imported.title = raw.name ?? "";
    if (!Object.hasOwn(imported, "discovery")) imported.discovery = { revealed: ["explored", "mapped"].includes(raw.exploration), visited: raw.exploration === "explored" };
    if (num !== null && nextTags?.origin) {
      const terrain = normalizeTerrainWord(raw.terrain);
      const features = (Array.isArray(raw.features) ? raw.features : []).map(f => typeof f === "string" ? f : f?.type).filter(f => FEATURES.includes(f) && f !== terrain);
      const value = terrain ? `${[terrain, ...new Set(features)].join(";")}|sdx` : null;
      nextTags.cells ??= {};
      if (Object.hasOwn(nextTags.cells, String(num))) {
        if (value && nextTags.cells[num] !== value) report.conflicts.push({ key, field: "tags" });
      } else if (value) nextTags.cells[num] = value;
      // Original terrain is archived, not a competing editable tag source.
      delete imported.terrain;
    }
    cells[key] = mergeMissing(imported, cells[key] ?? {}, report.conflicts, key);
    report.imported++;
  }
  return { cells, tags: nextTags, report };
}
const sameData = (a, b) => a === b || !!a && !!b && typeof a === "object" && typeof b === "object"
  && Array.isArray(a) === Array.isArray(b) && Object.keys(a).length === Object.keys(b).length
  && Object.keys(a).every(key => Object.hasOwn(b, key) && sameData(a[key], b[key]));
/** E2/E3 stored default discovery without provenance. Only pristine imported
 * records can be identified as synthesized; preserve edited/native records.
 * This is called only before fogImported, never on subsequent adoption reruns.
 */
export function planHexFogImport(cells, flags) {
  const inputs = clone(cells);
  for (const [key, cell] of Object.entries(inputs)) {
    if (!object(cell.legacy) || Object.hasOwn(cell.legacy, "discovery")) continue;
    const original = planHexAdoption({ sceneUuid: "migration", legacy: { [key]: cell.legacy } }).cells[key];
    if (!original) continue;
    // Numbered predecessors put terrain in hexTags, not the record.
    if (!Object.hasOwn(cell, "terrain")) delete original.terrain;
    if (sameData(cell, original) && !["explored", "mapped"].includes(cell.legacy.exploration)) delete cell.discovery;
  }
  return importFog(inputs, flags);
}
const locks = new Map();
export function withHexLock(scene, work) {
  const key = sceneUuid(scene), previous = locks.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(work);
  locks.set(key, pending);
  return pending.finally(() => { if (locks.get(key) === pending) locks.delete(key); });
}
function legacyScene(scene) {
  const entries = (game.journal?.contents ?? []).filter(j => j.name === EXTRAS_HEX_JOURNAL);
  if (entries.length > 1) throw new Error("SDE.hexRecords.duplicateStore");
  // Raw persisted flags work with SDX disabled. getFlag rejects inactive scopes in v14.
  const all = entries[0]?.flags?.[EXTRAS_ID]?.hexData;
  if (all !== undefined && !object(all)) throw new Error("SDE.hexRecords.unreadable");
  const data = all?.[scene.id];
  if (data !== undefined && !object(data)) throw new Error("SDE.hexRecords.unreadable");
  return data;
}
export async function adoptHexScene(target, { rerun = false } = {}) {
  if (!game.user?.isGM) throw new Error("SDE.hexRecords.gmOnly");
  const scene = sceneRef(target);
  if (!scene || !scene.grid?.isHexagonal) return null;
  return withHexLock(scene, async () => {
    await loadHexRecords();
    if (isHexAdopted(scene) && !rerun && recordJournal(scene)?.flags[MODULE_ID][RECORD_FLAG].fogImported) return recordJournal(scene).flags[MODULE_ID][RECORD_FLAG].report ?? null;
    const legacy = legacyScene(scene), tags = scene.getFlag?.(MODULE_ID, "hexTags");
    if (legacy === undefined && !tags?.origin && !recordJournal(scene)) return null;
    let journal = recordJournal(scene);
    if (journal) assertPrivateJournal(journal);
    const saved = journal?.flags?.[MODULE_ID]?.[RECORD_FLAG];
    const plan = planHexAdoption({ sceneUuid: sceneUuid(scene), legacy: legacy ?? {}, existing: saved?.cells ?? {}, tags, numberAt: offset => hexNumberAt(offset, scene) });
    const fogInputs = Object.fromEntries(["hexFogRevealed", "hexFogDiscovery", "hexRolledCells"].filter(k => scene.flags?.[EXTRAS_ID]?.[k] !== undefined).map(k => [k, scene.flags[EXTRAS_ID][k]]));
    const fog = saved?.fogImported ? null : planHexFogImport(plan.cells, fogInputs);
    const value = { ...saved, version: 1, sceneUuid: sceneUuid(scene), cells: fog?.cells ?? plan.cells, report: plan.report,
      fogImported: true, ...(fog ? { legacyFog: fog.legacy } : {}) };
    if (journal) await replaceModuleFlag(journal, RECORD_FLAG, value);
    else {
      const pack = await ensurePrivateHexPack();
      journal = await JournalEntry.create({ name: game.i18n.format("SDE.hexRecords.privateName", { scene: scene.name }), ownership: { default: 0 }, flags: { [MODULE_ID]: { [RECORD_FLAG]: value } } }, { pack: pack.collection });
      cacheHexJournal(journal);
    }
    if (plan.tags && JSON.stringify(plan.tags) !== JSON.stringify(tags)) await replaceModuleFlag(scene, "hexTags", plan.tags);
    await publishHexProjection(scene);
    // A scene carries identity/ownership only, never records, reports or private content.
    await replaceModuleFlag(scene, RECORD_FLAG, { version: 1, adopted: true });
    if (legacy !== undefined) reportAdoption(plan.report);
    return plan.report;
  });
}
function reportAdoption(report) {
  const key = report.conflicts.length || report.skipped.length ? "SDE.hexRecords.reportWarning" : "SDE.hexRecords.report";
  try { globalThis.ui?.notifications?.info?.(game.i18n.format(key, { count: report.imported, conflicts: report.conflicts.length, skipped: report.skipped.length })); } catch { /* adoption is already saved */ }
  console.info(`${MODULE_ID} | hex adoption`, report);
}
const activeGM = () => game.user?.isGM && (!game.users?.activeGM || game.users.activeGM.id === game.user.id);
function autoAdopt(scene) {
  if (!activeGM()) return;
  adoptHexScene(scene).catch(error => {
    console.error(`${MODULE_ID} | hex adoption skipped`, sceneUuid(scene), error);
    try { ui.notifications?.warn(game.i18n.format("SDE.hexRecords.failed", { scene: scene?.name ?? "", reason: game.i18n.localize(error.message) })); } catch { /* keep failure visible in console */ }
  });
}
export function registerHexAdoption() {
  Hooks.once("ready", () => { for (const scene of game.scenes?.contents ?? []) autoAdopt(scene); });
  Hooks.on("createScene", autoAdopt);
  Hooks.on("canvasReady", canvas => autoAdopt(canvas?.scene));
  Hooks.on("updateScene", (scene, changed) => {
    if (!activeGM() || !changed?.flags?.[MODULE_ID]?.hexTags) return;
    if (!isHexAdopted(scene)) autoAdopt(scene);
    else withHexLock(scene, () => publishHexProjection(scene)).catch(console.error);
  });
}
