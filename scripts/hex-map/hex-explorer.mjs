/** Hexplorer: a read-only canvas observer and a GM edit path over existing authorities. */
import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { FEATURES, normalizeTerrainWord, decodeTags, encodeTags, applySheet } from "./tag-store.mjs";
import { HexRecords, playerProjection, offsetKey, sceneRef, recordJournal, RECORD_FLAG, assertPrivateJournal, publishHexProjection, isHexAdopted } from "./hex-records.mjs";
import { hasHexNumbering, hexNumberAt } from "./hex-number-api.mjs";
import { adoptHexScene, withHexLock } from "./hex-adoption.mjs";
import { decodeFixes, encodeFixes, recordEdits, FIXES_FLAG } from "./tag-corrections.mjs";
import { disclosure } from "./hex-fog-core.mjs";

const pick = (v, keys) => Object.fromEntries(keys.filter(k => typeof v?.[k] === "string").map(k => [k, v[k]]));
/** GM hover is player-safe too; GM-private content belongs only in the editor. */
export function explorerView(record, isGM = false) {
  const r = isGM ? playerProjection(record) : record;
  if (!disclosure(r?.discovery)) return null;
  const location = disclosure(r.discovery, "location");
  return { sceneUuid: r.sceneUuid, offset: { ...r.offset }, num: r.num, terrain: r.terrain,
    ...(location && typeof r.title === "string" ? { title: r.title } : {}),
    features: (r.features ?? []).filter(f => FEATURES.includes(f.type) || location).map(f => pick(f, ["type", "name"])),
    notes: (r.notes ?? []).map(n => pick(n, ["text"])),
    links: location ? [...(r.links ?? []).map(l => pick(l, ["uuid", "label"])), ...(record.keyed ?? []).map(k => ({ uuid: k.uuid, label: k.title }))] : [],
  };
}
/** Row indexes preserve imported rich/unknown metadata; only editable fields are replaced. */
function rows(previous, submitted, fields) {
  return (submitted ?? []).map(row => ({ ...(Number.isInteger(row.index) ? structuredClone(previous?.[row.index] ?? {}) : {}), ...Object.fromEntries(fields.map(k => [k, row[k]])) }));
}
export function planExplorerEdit(record, input, flag) {
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
    features.push({ ...(old ?? {}), type, discovered: input.lineDiscovery?.[type] ?? old?.discovered ?? false });
  }
  const discovery = { ...record.discovery, revealed: !!input.revealed, visited: !!input.visited };
  if (input.location === "auto") delete discovery.locationRevealed;
  else discovery.locationRevealed = input.location === "show";
  return { tags, verdicts, patch: { ...(!numbered ? { terrain } : {}), title: String(input.title ?? ""), features,
    notes: rows(record.notes, input.notes, ["text", "visible", "location"]), links: rows(record.links, input.links, ["uuid", "label", "visible"]), discovery } };
}
export const HexExplorer = {
  read(offset, target) { return explorerView(HexRecords.read(offset, target), !!game.user?.isGM); },
  async save(offset, input, target) {
    if (!game.user?.isGM) throw new Error("SDE.hexRecords.gmOnly");
    const scene = sceneRef(target);
    if (!explorerCell(scene, offset)) throw new Error("SDE.hexRecords.invalidCell");
    await adoptHexScene(scene);
    return withHexLock(scene, async () => {
      const journal = recordJournal(scene);
      if (!journal) throw new Error("SDE.hexRecords.unreadable");
      assertPrivateJournal(journal);
      const plan = planExplorerEdit(HexRecords.read(offset, scene), input, scene.getFlag(MODULE_ID, "hexTags"));
      const saved = structuredClone(journal.flags[MODULE_ID][RECORD_FLAG]);
      saved.cells[offsetKey(offset)] = { ...saved.cells[offsetKey(offset)], ...plan.patch };
      await replaceModuleFlag(journal, RECORD_FLAG, saved);
      const log = decodeFixes(scene.getFlag(MODULE_ID, FIXES_FLAG));
      const judged = recordEdits(log, plan.verdicts).judged;
      if (plan.tags) await replaceModuleFlag(scene, "hexTags", plan.tags);
      if (judged) await replaceModuleFlag(scene, FIXES_FLAG, encodeFixes(log));
      await publishHexProjection(scene);
      refreshHexExplorer();
      return HexRecords.read(offset, scene);
    });
  },
  async open(offset, target) {
    if (!game.user?.isGM) return null;
    return (await import("./hex-explorer-app.mjs")).HexExplorerApp.open(offset, target);
  },
};

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
let tip = null, hovered = null, selected = null, press = null, stage = null, warned = false;
const nativeHovers = new Set();
function placeableTarget(target) {
  for (let node = target; node; node = node.parent) if (node.document) return true;
  return false;
}
const t = (key) => game.i18n.localize(key);
function enabled(scene) {
  if (!hasHexNumbering(scene) && !isHexAdopted(scene)) return false;
  const extras = game.modules?.get("shadowdark-extras");
  if (!extras?.active) return true;
  let disabled = false;
  try { disabled = game.settings.get("shadowdark-extras", "disabledFeatures")?.includes("hex.tooltip") === true; } catch { /* overlap remains off */ }
  if (!disabled && !warned) { warned = true; ui.notifications?.info(t("SDE.hexExplorer.overlap")); }
  return disabled;
}
function atEvent(event) {
  if (!canvas?.ready || !enabled(canvas.scene) || nativeHovers.size || placeableTarget(event.target)) return null;
  const offset = canvas.grid.getOffset(event.getLocalPosition(canvas.stage));
  if (!explorerCell(canvas.scene, offset)) return null;
  return { scene: canvas.scene, offset, x: event.client?.x ?? event.global.x, y: event.client?.y ?? event.global.y };
}
function line(parent, text, tag = "div") {
  const el = document.createElement(tag); el.textContent = text; parent.append(el); return el;
}
export function refreshHexExplorer() {
  const cell = selected ?? hovered;
  if (!cell || !enabled(cell.scene)) { tip?.remove(); tip = null; return; }
  const view = HexExplorer.read(cell.offset, cell.scene);
  // Concealed cells show nothing to players, including their number.
  if (!view && !game.user.isGM) { tip?.remove(); tip = null; return; }
  tip ??= document.createElement("aside");
  tip.id = "sde-hex-explorer-tip"; tip.className = selected ? "selected" : "";
  tip.replaceChildren(); document.body.append(tip);
  const num = hexNumberAt(cell.offset, cell.scene);
  line(tip, num === null ? game.i18n.format("SDE.hexExplorer.offset", cell.offset) : String(num).padStart(4, "0"), "strong");
  if (view) {
    if (view.title) line(tip, view.title, "strong");
    line(tip, view.terrain ?? t("SDE.hexExplorer.unknown"));
    for (const feature of view.features) line(tip, feature.name || feature.type);
    for (const note of view.notes) line(tip, note.text ?? "");
    for (const link of view.links) {
      if (selected) {
        const button = line(tip, link.label || link.uuid, "button"); button.type = "button";
        button.addEventListener("click", async () => {
          const doc = await fromUuid(link.uuid);
          if (!doc?.testUserPermission?.(game.user, "OBSERVER") || doc.parent && !doc.parent.testUserPermission(game.user, "OBSERVER")) return;
          if (doc.documentName === "JournalEntryPage") doc.parent.sheet?.render(true, { pageId: doc.id });
          else doc.sheet?.render(true);
        });
      } else line(tip, link.label || link.uuid);
    }
  } else line(tip, t("SDE.hexExplorer.concealed"));
  if (selected) {
    if (game.user.isGM) {
      const edit = line(tip, t("SDE.hexExplorer.edit"), "button"); edit.type = "button";
      edit.addEventListener("click", () => void HexExplorer.open(cell.offset, cell.scene));
    }
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
  selected = cell; refreshHexExplorer();
}
function clear() {
  stage?.off("pointermove", move); stage?.off("pointerdown", down); stage?.off("pointerup", up); stage?.off("pointerupoutside", cancelPress);
  stage = null; tip?.remove(); tip = null; hovered = selected = press = null;
  nativeHovers.clear();
}
function cancelPress() { press = null; }
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
  });
  Hooks.on("canvasTearDown", clear);
  Hooks.on("updateScene", refreshHexExplorer);
  Hooks.on("createJournalEntry", refreshHexExplorer);
  Hooks.on("updateJournalEntry", refreshHexExplorer);
  Hooks.on("updateJournalEntryPage", refreshHexExplorer);
  Hooks.on("deleteJournalEntry", refreshHexExplorer);
}
