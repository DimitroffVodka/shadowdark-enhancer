/** Hex Data: a read-only canvas observer and a GM edit path over existing authorities. */
import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { FEATURES, NOT_GROUND, normalizeTerrainWord, decodeTags, encodeTags, applySheet } from "./tag-store.mjs";
import { HexRecords, loadCrawlNames, playerProjection, offsetKey, sceneRef, recordJournal, RECORD_FLAG, assertPrivateJournal, publishHexProjection, isHexAdopted, isHexRecordStore } from "./hex-records.mjs";
import { hasHexNumbering, hexNumberAt } from "./hex-number-api.mjs";
import { adoptHexScene, withHexLock } from "./hex-adoption.mjs";
import { decodeFixes, encodeFixes, recordEdits, FIXES_FLAG } from "./tag-corrections.mjs";
import { disclosure, effectiveDiscovery, withPartyDiscovery } from "./hex-fog-core.mjs";
import { viewedPartyIds, playerViewOn } from "./hex-fog.mjs";
import { HexTagOverlay, isDoubleClick } from "./tag-overlay.mjs";
import { hexZonesFor, onHexZonesForgotten } from "../encounter/encounter-terrain.mjs";

const pick = (v, keys) => Object.fromEntries(keys.filter(k => typeof v?.[k] === "string").map(k => [k, v[k]]));
/** GM hover is player-safe too; GM-private content belongs only in the editor. */
export function explorerView(record, isGM = false, partyIds = []) {
  // The GM sees what the viewed party's players see, the same discovery the fog and the Hex Data window use.
  const r = isGM ? playerProjection({ ...record, discovery: effectiveDiscovery(record.discovery, partyIds) }) : record;
  if (!disclosure(r?.discovery)) return null;
  const location = disclosure(r.discovery, "location");
  // A manual link to a document the keyed pages already name shows once, as the keyed row.
  const keyed = (record.keyed ?? []).map(k => ({ uuid: k.uuid, label: k.title }));
  const named = new Set(keyed.map(k => String(k.uuid ?? "").trim()));
  return { sceneUuid: r.sceneUuid, offset: { ...r.offset }, num: r.num, terrain: r.terrain,
    located: !!location,
    ...(location && typeof r.title === "string" ? { title: r.title } : {}),
    // River, path and coast are always disclosed; hiding markers on other features are re-checked, not merely trusted.
    features: (r.features ?? []).filter(f => FEATURES.includes(f?.type) || f?.discovered !== false && location).map(f => pick(f, ["type", "name"])),
    notes: (r.notes ?? []).filter(n => n?.visible !== false).map(n => pick(n, ["text"])),
    links: location ? [...(r.links ?? []).filter(l => l?.visible !== false && !named.has(String(l?.uuid ?? "").trim())).map(l => pick(l, ["uuid", "label"])), ...keyed] : [],
  };
}
/**
 * What line 2 of the hover says. A keyed hex is tagged with what sits on it (keyed_location, village...), which is
 * not ground, so its line is the location's name. The GM always gets the name, marked when the viewed party has not
 * found it; a player, or the GM's Player view, never gets the tag word of a location that is not found.
 * @param {object|null} view  explorerView: has a title only once the location is disclosed
 * @param {object|null} record  the GM's own record (null on a player's client)
 * @returns {{name:string, found:boolean}|{terrain:string|null}|{hidden:true}} hidden: print nothing on this line
 */
export function hoverHead(view, record, asPlayer) {
  const terrain = view?.terrain ?? record?.terrain ?? null;
  if (!NOT_GROUND.has(terrain)) return { terrain };
  if (view?.title) return { name: view.title, found: true };
  if (!asPlayer && record?.title) return { name: record.title, found: false };
  // Found but unnamed keeps its settlement word; an unfound location shows a player nothing at all.
  return asPlayer && !view?.located ? { hidden: true } : { terrain };
}
/** Row indexes preserve imported rich/unknown metadata; only editable fields are replaced. */
function rows(previous, submitted, fields) {
  return (submitted ?? []).map(row => ({ ...(Number.isInteger(row.index) ? structuredClone(previous?.[row.index] ?? {}) : {}), ...Object.fromEntries(fields.map(k => [k, row[k]])) }));
}
/** `partyId`: the party the GM is looking at; the reveal boxes are then that party's own, not everyone's. */
export function planExplorerEdit(record, input, flag, partyId = null) {
  if (!offsetKey(record?.offset) || flag?.origin && !Number.isInteger(record?.num)) throw new Error("SDE.hexRecords.invalidCell");
  const terrain = normalizeTerrainWord(input.terrain);
  if (!terrain || /[;|]/.test(terrain) || FEATURES.includes(terrain) && terrain !== "river") throw new Error("SDE.hexExplorer.invalidTerrain");
  const lines = FEATURES.filter(type => (input.lines ?? []).includes(type));
  const state = decodeTags(flag);
  const numbered = Number.isInteger(record.num);
  const verdicts = numbered ? applySheet(state, { [record.num]: { terrain, features: lines } }) : [];
  // Preserve every OTHER raw cell byte, numbering, palette and provenance.
  const tags = numbered ? { ...structuredClone(flag), cells: { ...flag.cells, [record.num]: encodeTags(state).cells[record.num] } } : null;
  const features = rows(record.features, input.features, ["type", "name", "uuid", "discovered"]);
  if (features.some(f => FEATURES.includes(f.type))) throw new Error("SDE.hexExplorer.invalidFeature");
  for (const type of lines) {
    const old = record.features?.find(f => f.type === type);
    features.push({ ...(old ?? {}), type, discovered: true });
  }
  const seen = { revealed: !!input.revealed, visited: !!input.visited, locationRevealed: input.location === "auto" ? undefined : input.location === "show" };
  const discovery = partyId ? withPartyDiscovery(record.discovery, partyId, seen) : { ...record.discovery, ...seen };
  if (!partyId && seen.locationRevealed === undefined) delete discovery.locationRevealed;
  return { tags, verdicts, patch: { ...(!numbered ? { terrain } : {}), title: String(input.title ?? ""), features,
    notes: rows(record.notes, input.notes, ["text", "visible", "location"]), links: rows(record.links, input.links, ["uuid", "label", "visible"]), discovery, ...arrivalFields(input) } };
}
/** Ownership levels as the window reads them: a document carries numbers, a compendium's policy may carry names. */
const OWNERSHIP = { INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 };
const levelOf = value => typeof value === "number" ? value : (OWNERSHIP[value] ?? OWNERSHIP.NONE);
/**
 * Would an ordinary player (the default role) be able to open this document? Compendium content answers by its
 * pack's PLAYER policy; anything else walks INHERIT to its parent, as Document#getUserLevel does. This is what a
 * disclosed link in the window warns about and what its share tick raises. A per-user entry is not counted: the
 * question is what "players" as a class get.
 */
export function playerOpenable(doc) {
  if (!doc) return false;
  if (doc.pack) return levelOf(doc.compendium?.ownership?.PLAYER ?? "NONE") >= OWNERSHIP.OBSERVER;
  for (let target = doc, hops = 0; target && hops < 4; target = target.parent, hops++) {
    const level = levelOf(target.ownership?.default);
    if (level !== OWNERSHIP.INHERIT) return level >= OWNERSHIP.OBSERVER;
  }
  return false;
}
/** Whether `user` may open a card's link: Observer on the document as Foundry resolves it (a page that inherits answers by its journal). */
export function canOpenLink(doc, user) {
  return !!doc && !!user && !!doc.testUserPermission?.(user, "OBSERVER");
}
/**
 * A save's share tick: the default is raised to at least player observation and a per-user entry that only
 * inherits follows it. Nothing is ever lowered, and a level the GM set on one user on purpose stays.
 */
export function raisedOwnership(ownership = {}) {
  const raised = { ...ownership, default: Math.max(levelOf(ownership?.default ?? "NONE"), OWNERSHIP.OBSERVER) };
  for (const [id, level] of Object.entries(raised)) if (id !== "default" && levelOf(level) === OWNERSHIP.INHERIT) raised[id] = OWNERSHIP.OBSERVER;
  return raised;
}
/** A dropped journal entry, journal page or roll table as a new link row; anything else is not a link. */
export function droppedLink(doc) {
  if (!doc?.uuid || !["JournalEntry", "JournalEntryPage", "RollTable"].includes(doc.documentName)) return null;
  return { index: null, uuid: doc.uuid, label: doc.name ?? "", visible: false };
}
/**
 * The arrival block's stored fields, when the window carries the block. A table writes the trio; an empty box
 * writes explicit `undefined`, which the save's merge (`mergedCell`) deletes, so clearing the block removes
 * them. An input with no `rollTable` key at all leaves the stored fields alone, the preservation rule its
 * sibling rows follow. The chance is a whole 0-100 %, and an absent or unreadable one is 100 — the same
 * every-entry default an arrival check reads (`rollTableChance ?? 100`).
 */
export function arrivalFields(input = {}) {
  if (!Object.hasOwn(input, "rollTable")) return {};
  const rollTable = String(input.rollTable ?? "").trim();
  if (!rollTable) return { rollTable: undefined, rollTableChance: undefined, rollTableFirstOnly: undefined };
  const raw = String(input.rollTableChance ?? "").trim(), chance = raw === "" ? NaN : Number(raw);
  return { rollTable, rollTableChance: Number.isFinite(chance) ? Math.max(0, Math.min(100, Math.round(chance))) : 100, rollTableFirstOnly: !!input.rollTableFirstOnly };
}
/** The stored cell after a save's patch: a field the patch sets to `undefined` is removed, not written. */
export function mergedCell(previous, patch) {
  const next = { ...(previous ?? {}), ...(patch ?? {}) };
  for (const [field, value] of Object.entries(patch ?? {})) if (value === undefined) delete next[field];
  return next;
}
/**
 * What a wandering check on a hex would roll, as the editor words it. `res` is
 * tableForCheck's answer; `name` is that table's name. `state` says where the
 * table came from: the region's printed column, two columns the check could not
 * choose between (it rolls the first), the table mapped to the terrain (`mapped`
 * is its uuid, which wins when the active table is the same one), the active
 * table (`active` is its uuid), or none.
 */
export function encounterReadout({ uuid, zone, verdict } = {}, name = "", active = "", mapped = "") {
  const state = !uuid ? "none" : verdict?.status === "ambiguous" ? "ambiguous" : verdict?.column ? "region" : uuid === active && uuid !== mapped ? "active" : "terrain";
  return { state, uuid: uuid ?? "", name, zone: zone ?? "", column: verdict?.column?.column ?? "", options: (verdict?.columns ?? []).map(c => c.column).join(", ") };
}
export const HexExplorer = {
  read(offset, target) { return explorerView(HexRecords.read(offset, target), !!game.user?.isGM, viewedPartyIds()); },
  async save(offset, input, target, partyId = viewedPartyIds()[0] ?? null) {
    if (!game.user?.isGM) throw new Error("SDE.hexRecords.gmOnly");
    const scene = sceneRef(target);
    if (!explorerCell(scene, offset)) throw new Error("SDE.hexRecords.invalidCell");
    await adoptHexScene(scene);
    return withHexLock(scene, async () => {
      const journal = recordJournal(scene);
      if (!journal) throw new Error("SDE.hexRecords.unreadable");
      assertPrivateJournal(journal);
      const plan = planExplorerEdit(HexRecords.read(offset, scene), input, scene.getFlag(MODULE_ID, "hexTags"), partyId);
      const saved = structuredClone(journal.flags[MODULE_ID][RECORD_FLAG]);
      saved.cells[offsetKey(offset)] = mergedCell(saved.cells[offsetKey(offset)], plan.patch);
      await replaceModuleFlag(journal, RECORD_FLAG, saved);
      const log = decodeFixes(scene.getFlag(MODULE_ID, FIXES_FLAG));
      const judged = recordEdits(log, plan.verdicts).judged;
      if (plan.tags) await replaceModuleFlag(scene, "hexTags", plan.tags);
      if (judged) await replaceModuleFlag(scene, FIXES_FLAG, encodeFixes(log));
      await publishHexProjection(scene);
      await applyLinkShares(input.links);
      refreshHexExplorer();
      return HexRecords.read(offset, scene);
    });
  },
  async open(offset, target) {
    if (!game.user?.isGM) return null;
    return (await import("./hex-explorer-app.mjs")).HexExplorerApp.open(offset, target);
  },
};
/**
 * A save's per-link share tick raises the linked document's own ownership to at least player observation, and
 * only raises: an OWNER default or a higher per-user level stays, and a document players can already open is
 * not written. A page raises itself, never its journal: pages inherit, so raising the journal would open every
 * other page in it (the crawl journal holds 270 keyed hexes); a player opens a journal's sheet regardless and
 * sees only the pages they can observe. The module's own record store is refused outright: players on it would
 * break `assertPrivateJournal` for every later write. A link that no longer resolves, a compendium copy (its
 * access follows the pack's role policy) or an update a hook vetoes (it resolves undefined) is read back and
 * reported instead of failing the save or passing for a share.
 */
export async function applyLinkShares(links) {
  for (const link of links ?? []) {
    if (!link?.share || !link.uuid) continue;
    const label = link.label || link.uuid, warn = key => ui.notifications?.warn(game.i18n.format(key, { label }));
    const doc = await fromUuid(link.uuid).catch(() => null);
    if (!doc) { warn("SDE.hexExplorer.shareFailed"); continue; }
    if (isHexRecordStore(doc)) { warn("SDE.hexExplorer.sharePrivate"); continue; }
    if (playerOpenable(doc)) continue;
    try {
      await doc.update({ ownership: raisedOwnership(doc.ownership) });
      if (!playerOpenable(await fromUuid(link.uuid))) warn("SDE.hexExplorer.shareFailed");
    } catch (error) { console.error(`${MODULE_ID} | Hex Data link share`, error); warn("SDE.hexExplorer.shareFailed"); }
  }
}

/** No invented numbering; adopted unnumbered cells retain their native offset authority. */
export function explorerCell(scene, offset) {
  if (!offsetKey(offset) || !scene?.grid?.isHexagonal) return false;
  if (hasHexNumbering(scene)) return hexNumberAt(offset, scene) !== null;
  if (!isHexAdopted(scene)) return false;
  const rect = scene.dimensions?.sceneRect, point = scene.grid.getCenterPoint(offset);
  return !rect || rect.contains(point.x, point.y);
}
export function explorerClick(press, event, longPress) {
  return !!press && event.button === 0 && !placeableTarget(event.target)
    && Math.hypot(event.global.x - press.x, event.global.y - press.y) <= 5
    && event.timeStamp - press.at < longPress
    && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
}
let tip = null, hovered = null, selected = null, press = null, stage = null, view = null, lastUp = null;
const nativeHovers = new Set();
function placeableTarget(target) {
  for (let node = target; node; node = node.parent) if (node.document) return true;
  return false;
}
const t = (key) => game.i18n.localize(key);
/**
 * Hex Data always runs on a hex scene it can read: it does not wait for Shadowdark Extras' Hex Tooltip to be
 * switched off. Where both are active the Enhancer wins; `owns("hex.tooltip")` says so to Extras.
 */
function enabled(scene) { return hasHexNumbering(scene) || isHexAdopted(scene); }
/** The contract Extras reads (`game.shadowdarkEnhancer.owns("hex.tooltip", scene)`): Hex Data has this scene's hover card and editor. */
export function ownsHexData(target) {
  const scene = sceneRef(target);
  return !!scene?.grid?.isHexagonal && enabled(scene);
}
function atEvent(event) {
  if (!canvas?.ready || !enabled(canvas.scene) || nativeHovers.size || placeableTarget(event.target)) return null;
  // PIXI maps document-wide pointer moves onto the stage, so a pointer over a window or the HUD still arrives here.
  if (view && event.nativeEvent?.target !== view) return null;
  const offset = canvas.grid.getOffset(event.getLocalPosition(canvas.stage));
  if (!explorerCell(canvas.scene, offset)) return null;
  return { scene: canvas.scene, offset, x: event.client?.x ?? event.global.x, y: event.client?.y ?? event.global.y };
}
/**
 * A hex's region as the Show regions overlay and the encounter roll read it (hexZonesFor), or null when they find
 * none. `estimated` marks the nearest-keyed-hex answer, which the book never printed.
 * @param {{byNum?:Map<number,{zone:string}>, viaByNum?:Map<number,string>}|null} found
 */
export function regionLine(found, num) {
  const zone = Number.isInteger(num) ? found?.byNum?.get(num)?.zone : null;
  return zone ? { zone, estimated: found.viaByNum?.get(num) === "nearest" } : null;
}
export const regionText = (region) => region.estimated ? game.i18n.format("SDE.hexExplorer.regionEstimated", { region: region.zone }) : region.zone;
// The hover fires on every pointer move, so it reads this resolved copy and never the lookup itself.
const regionsByScene = new Map(), regionLoads = new Set();
let regionEpoch = 0;
function loadRegions(scene) {
  if (regionLoads.has(scene.id)) return;
  regionLoads.add(scene.id);
  const epoch = regionEpoch;
  // A failed read is kept as "no regions" until the next change, so a broken pack is not retried on every move.
  hexZonesFor(scene).catch(() => ({})).then((found) => { if (epoch === regionEpoch) regionsByScene.set(scene.id, found); })
    .finally(() => { regionLoads.delete(scene.id); refreshHexExplorer(); });
}
/** GM only: a player client computes nothing here and shows no region. */
function regionAt(scene, num) {
  if (!game.user?.isGM || !Number.isInteger(num)) return null;
  if (!regionsByScene.has(scene.id)) { loadRegions(scene); return null; }
  return regionLine(regionsByScene.get(scene.id), num);
}
/** The hover's region line. The GM's Player view previews the players' card, and a region is GM-only: print none and read none. */
export const hoverRegion = (scene, num, asPlayer) => asPlayer ? null : regionAt(scene, num);
function line(parent, text, tag = "div") {
  const el = document.createElement(tag); el.textContent = text; parent.append(el); return el;
}
export const hexTooltipHidden = () => !!game.user?.isGM && !!game.settings.get(MODULE_ID, "hexTooltipHidden");
export async function toggleHexTooltip() {
  await game.settings.set(MODULE_ID, "hexTooltipHidden", !hexTooltipHidden());
  refreshHexExplorer();
}
export function refreshHexExplorer() {
  const cell = selected ?? hovered;
  if (!cell || !enabled(cell.scene) || hexTooltipHidden()) { tip?.remove(); tip = null; return; }
  const view = HexExplorer.read(cell.offset, cell.scene);
  // Concealed cells show nothing to players, including their number.
  if (!view && !game.user.isGM) { tip?.remove(); tip = null; return; }
  tip ??= document.createElement("aside");
  tip.id = "sde-hex-explorer-tip"; tip.className = selected ? "selected" : "";
  tip.replaceChildren(); document.body.append(tip);
  const num = hexNumberAt(cell.offset, cell.scene), region = hoverRegion(cell.scene, num, playerViewOn());
  line(tip, num === null ? game.i18n.format("SDE.hexExplorer.offset", cell.offset) : String(num).padStart(4, "0"), "strong");
  const record = game.user.isGM ? HexRecords.read(cell.offset, cell.scene) : null;
  const head = hoverHead(view, record, !game.user.isGM || playerViewOn());
  const named = () => line(tip, head.found ? head.name : game.i18n.format("SDE.hexExplorer.notFoundYet", { name: head.name }), "strong");
  if (view) {
    if (head.name) named();
    else {
      if (view.title) line(tip, view.title, "strong");
      if (!head.hidden) line(tip, head.terrain ?? t("SDE.hexExplorer.unknown"));
    }
    if (region) line(tip, regionText(region));
    for (const feature of view.features) line(tip, feature.name || feature.type);
    for (const note of view.notes) line(tip, note.text ?? "");
    for (const link of view.links) {
      if (selected) {
        const button = line(tip, link.label || link.uuid, "button"); button.type = "button";
        button.addEventListener("click", async () => {
          const doc = await fromUuid(link.uuid);
          if (!canOpenLink(doc, game.user)) { ui.notifications?.warn(game.i18n.localize("SDE.hexExplorer.linkDenied")); return; }
          if (doc.documentName === "JournalEntryPage") doc.parent.sheet?.render(true, { pageId: doc.id });
          else doc.sheet?.render(true);
        });
      } else line(tip, link.label || link.uuid);
    }
  // The GM is not a player: an undiscovered hex still shows its real terrain.
  } else if (game.user.isGM) {
    if (head.name) named(); else if (!head.hidden) line(tip, head.terrain ?? t("SDE.hexExplorer.unknown"));
  }
  else line(tip, t("SDE.hexExplorer.concealed"));
  if (selected) {
    const close = line(tip, t("SDE.hexExplorer.close"), "button"); close.type = "button";
    close.addEventListener("click", () => { selected = null; hovered = null; refreshHexExplorer(); });
    tip.style.left = ""; tip.style.top = "";
  } else {
    tip.style.left = `${Math.min(cell.x + 18, window.innerWidth - 300)}px`;
    tip.style.top = `${Math.max(0, Math.min(cell.y + 18, window.innerHeight - tip.offsetHeight - 12))}px`;
  }
}
function move(event) { if (press || event.buttons) return; hovered = atEvent(event); if (!selected) refreshHexExplorer(); }
function down(event) {
  const cell = event.button === 0 ? atEvent(event) : null;
  press = cell ? { x: event.global.x, y: event.global.y, at: event.timeStamp, cell } : null;
}
function up(event) {
  const held = press; press = null;
  const duration = foundry.canvas?.interaction?.MouseInteractionManager?.LONG_PRESS_DURATION_MS ?? 500;
  if (!explorerClick(held, event, duration)) return;
  const cell = atEvent(event);
  if (!cell || cell.scene !== held.cell.scene || offsetKey(cell.offset) !== offsetKey(held.cell.offset)) return;
  // A GM never gets the pinned card: a double click opens the Hex Data window, and with the tagging overlay up a
  // single click is the overlay's own. Players keep the card, since their journal links live in it.
  const key = offsetKey(cell.offset), again = isDoubleClick(lastUp, key, event.timeStamp);
  lastUp = again ? null : { key, at: event.timeStamp };
  if (game.user.isGM) { if (again && !HexTagOverlay.current?.brush) void HexExplorer.open(cell.offset, cell.scene); return; }
  selected = cell; refreshHexExplorer();
}
function clear() {
  stage?.off("pointermove", move); stage?.off("pointerdown", down); stage?.off("pointerup", up); stage?.off("pointerupoutside", cancelPress);
  view?.removeEventListener("pointerleave", leave);
  stage = view = null; tip?.remove(); tip = null; hovered = selected = press = null;
  nativeHovers.clear();
}
function cancelPress() { press = null; }
/** The pointer left the canvas altogether (a window edge, the browser frame): no further move event reaches the stage. */
function leave() { hovered = null; if (!selected) refreshHexExplorer(); }
export function registerHexExplorer() {
  // Core can consume a Note/Token pointermove before it bubbles to the stage.
  // Its hover hooks also clear a previous blank-cell tooltip in that case.
  for (const hook of ["hoverNote", "hoverToken"]) Hooks.on(hook, (object, active) => {
    if (active) { nativeHovers.add(object); hovered = null; }
    else nativeHovers.delete(object);
    if (!selected) refreshHexExplorer();
  });
  Hooks.on("canvasReady", () => {
    clear(); stage = canvas.stage;
    stage.on("pointermove", move); stage.on("pointerdown", down); stage.on("pointerup", up); stage.on("pointerupoutside", cancelPress);
    view = canvas.app.canvas ?? canvas.app.view; view?.addEventListener("pointerleave", leave);
  });
  Hooks.on("canvasTearDown", clear);
  // A crawl entry, a scene or a region fix changed: the copies are stale, and the next draw reads them again.
  onHexZonesForgotten(() => { regionEpoch++; regionsByScene.clear(); refreshHexExplorer(); });
  // The crawl entries name the keyed hexes of a scene with no pins; read again when one is filed or edited.
  // A pack that cannot be read leaves the names as they were (empty at first): the hover just has none.
  const reloadNames = () => void loadCrawlNames().catch(() => {}).then(refreshHexExplorer);
  Hooks.on("canvasReady", reloadNames);
  for (const hook of ["createJournalEntry", "updateJournalEntry", "deleteJournalEntry"]) Hooks.on(hook, entry => { if (entry?.flags?.[MODULE_ID]?.hex?.crawl) reloadNames(); });
  Hooks.on("updateScene", refreshHexExplorer);
  Hooks.on("createJournalEntry", refreshHexExplorer);
  Hooks.on("updateJournalEntry", refreshHexExplorer);
  Hooks.on("updateJournalEntryPage", refreshHexExplorer);
  Hooks.on("deleteJournalEntry", refreshHexExplorer);
}
