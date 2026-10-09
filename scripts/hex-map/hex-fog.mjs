/** Native adopted-scene fog. One static overlay; all gameplay reads one disclosure predicate. */
import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { rulesApi } from "../rules-data/rules-data-core.mjs";
import { storedRulesFor } from "../rules-data/rules-data-scope.mjs";
import { timeApi } from "../time/time.mjs";
import { Party, isParty } from "../party/party.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";
import { HexRecords, isHexAdopted, sceneRef, recordJournal, offsetKey, readPass, RECORD_FLAG, publishHexProjection, assertPrivateJournal, loadHexRecords } from "./hex-records.mjs";
import { adoptHexScene, withHexLock } from "./hex-adoption.mjs";
import { disclosure, effectiveDiscovery, withPartyDiscovery, overlapAllowed, revealRadius, revealCells, arrivalDue } from "./hex-fog-core.mjs";

let overlay = null, warned = false;
/** The GM sees the unexplored hexes through a 60% veil; this draws them as a player does, solid black. Kept per browser. */
export const playerViewOn = () => { try { return game.settings.get(MODULE_ID, "hexPlayerFogView") === true; } catch { return false; } };
/** The setting's onChange redraws the fog. */
export const togglePlayerView = () => game.settings.set(MODULE_ID, "hexPlayerFogView", !playerViewOn());
/** SDX must explicitly advertise the full writer/overlay/disclosure stand-down contract. */
export function ownsHexFog(target) {
  const scene = sceneRef(target);
  if (!scene?.grid?.isHexagonal || !isHexAdopted(scene) || scene.flags?.[MODULE_ID]?.hexFog?.enabled === false) return false;
  const extras = game.modules?.get("shadowdark-extras");
  let disabled = false;
  if (extras?.active) {
    try { disabled = game.settings.get("shadowdark-extras", "disabledFeatures")?.includes("hex.fog") === true; } catch { /* absence is not permission */ }
    try { disabled ||= extras.api?.hex?.isFogEnabled?.(scene.id) === false; } catch { /* unknown stays off */ }
  }
  const allowed = overlapAllowed({ active: !!extras?.active, disabled, guardVersion: extras?.api?.hex?.enhancerOwnershipGuardVersion ?? 0 });
  if (!allowed && !warned) {
    warned = true;
    try { ui.notifications?.info(game.i18n.localize("SDE.hexFog.overlap")); } catch { /* no mutation depends on reporting */ }
  }
  return allowed;
}
/** The party whose map the GM sees: the one selected, else the one travelling. A player's own parties are chosen in HexRecords.read. */
export function viewedPartyIds() {
  const chosen = Party.selected();
  if (chosen) return [chosen.id];
  try {
    const uuid = game.settings.get(MODULE_ID, "overlandState")?.tokenUuid, actor = uuid ? fromUuidSync(uuid)?.actor : null;
    return isParty(actor) ? [actor.id] : [];
  } catch { return []; }
}
export function hexDisclosure(scene, offset, kind = "terrain", exceptions = {}, pass = null) {
  const discovery = HexRecords.read(offset, scene, pass)?.discovery;
  if (!game.user?.isGM) return disclosure(discovery, kind, exceptions);
  const ids = pass ? (pass.viewed ??= viewedPartyIds()) : viewedPartyIds();
  return disclosure(effectiveDiscovery(discovery, ids), kind, exceptions);
}
export function positionDisclosed(scene, point, kind = "terrain", exceptions = {}, pass = null) {
  return hexDisclosure(scene, scene.grid.getOffset(point), kind, exceptions, pass);
}
/** Exact native scene geometry, including scenes without a background image. */
export function fogCells(scene) {
  const grid = scene.grid, r = scene.dimensions?.sceneRect;
  if (!grid?.isHexagonal || !r) return [];
  const tl = grid.getOffset({ x: r.x, y: r.y }), br = grid.getOffset({ x: r.x + r.width, y: r.y + r.height }), cells = [];
  for (let i = tl.i - 1; i <= br.i + 1; i++) for (let j = tl.j - 1; j <= br.j + 1; j++) {
    const point = grid.getCenterPoint({ i, j });
    if (r.contains(point.x, point.y)) cells.push({ i, j });
  }
  return cells;
}
export function refreshHexFog() {
  overlay?.destroy(); overlay = null;
  const scene = globalThis.canvas?.scene;
  if (!canvas?.ready || !ownsHexFog(scene)) return;
  overlay = new PIXI.Graphics(); overlay.name = "sde-hex-fog"; overlay.eventMode = "none";
  overlay.beginFill(0x000000, game.user.isGM && !playerViewOn() ? 0.6 : 1);
  // One pass for every cell: the store journal, decoded tags and pin index are read once.
  const pass = readPass(scene);
  for (const offset of fogCells(scene)) if (!hexDisclosure(scene, offset, "terrain", {}, pass)) overlay.drawPolygon(scene.grid.getVertices(offset).flatMap(p => [p.x, p.y]));
  overlay.endFill(); canvas.interface.addChildAt(overlay, 0);
  for (const token of canvas.tokens?.placeables ?? []) token.renderFlags.set({ refreshVisibility: true });
  for (const note of canvas.notes?.placeables ?? []) note.renderFlags.set({ refreshVisibility: true });
}
async function saveCells(scene, work) {
  if (!game.user?.isGM) throw new Error("SDE.hexRecords.gmOnly");
  await adoptHexScene(scene);
  return withHexLock(scene, async () => {
    const journal = recordJournal(scene);
    if (!journal) throw new Error("SDE.hexRecords.unreadable");
    assertPrivateJournal(journal);
    const saved = structuredClone(journal.flags[MODULE_ID][RECORD_FLAG]);
    const result = await work(saved.cells);
    await replaceModuleFlag(journal, RECORD_FLAG, saved);
    // Both writes redraw the fog through their journal hooks.
    await publishHexProjection(scene);
    return result;
  });
}
/** Manual conceal never clears visited or arrivalRolled. */
export async function setHexDisclosure(offset, patch, target) {
  const scene = sceneRef(target), key = offsetKey(offset);
  if (!key || !scene) throw new Error("SDE.hexRecords.invalidCell");
  return saveCells(scene, cells => {
    const cell = cells[key] ??= {}, discovery = cell.discovery ??= { revealed: false, visited: false };
    for (const field of ["revealed", "locationRevealed"]) if (typeof patch?.[field] === "boolean") discovery[field] = patch[field];
    if (patch?.locationRevealed === true) discovery.revealed = true;
    return structuredClone(discovery);
  });
}
/** Only Overland's paid, committed travel path may visit or roll; dawn is reveal-only. */
export async function revealParty(token, { path = null, weather = null, committed = false } = {}) {
  // The party is the token's own: what it finds is its alone, whichever party this GM has selected.
  const scene = token?.parent, party = isParty(token?.actor) ? token.actor : null;
  if (!game.user?.isGM || !ownsHexFog(scene) || !party) return null;
  const origin = scene.grid.getOffset(token.getCenterPoint()), entered = committed ? (path ?? []) : [];
  const rules = rulesApi(() => storedRulesFor(scene)).visibility();
  const validRules = ["darkness", "stormy", "excellent", "slight", "high"].every(k => Number.isFinite(rules[k]));
  const validWeather = ["fair", "stormy", "excellent"].includes(weather?.kind) && weather.until > game.time.worldTime;
  const pass = readPass(scene);
  const all = fogCells(scene), records = new Map(all.map(o => [offsetKey(o), HexRecords.read(o, scene, pass)]));
  const mountain = o => records.get(offsetKey(o))?.terrain === "mountain";
  const draws = [];
  const result = await saveCells(scene, async cells => {
    const reveal = new Set();
    for (const at of committed ? entered : [origin]) {
      reveal.add(offsetKey(at));
      const record = records.get(offsetKey(at));
      if (!record?.terrain || !validRules || !validWeather) continue;
      const night = timeApi.isNight(undefined, { region: record.region ?? record.zone });
      const radius = revealRadius(rules, record.terrain, night, weather.kind);
      for (const key of revealCells({ grid: scene.grid, origin: at, cells: all, radius, mountain, night, weather: weather.kind })) reveal.add(key);
    }
    for (const key of reveal) {
      const cell = cells[key] ??= {};
      cell.discovery = withPartyDiscovery(cell.discovery, party.id, { revealed: true });
    }
    for (const at of entered) {
      const key = offsetKey(at), cell = cells[key] ??= {};
      cell.discovery = withPartyDiscovery(cell.discovery, party.id, { revealed: true, visited: true });
      if (!arrivalDue(cell, { entered: true, partyId: party.id })) continue;
      if (Math.random() * 100 >= (cell.rollTableChance ?? 100)) continue;
      const table = await fromUuid(cell.rollTable);
      if (!(table instanceof RollTable)) continue;
      // First-entry history rides the single saveCells write below, before any chat.
      if (cell.rollTableFirstOnly) cell.arrivalRolledBy = [...new Set([...(cell.arrivalRolledBy ?? []), party.id])];
      draws.push(table);
    }
    return { revealed: [...reveal], visited: entered.map(offsetKey) };
  });
  for (const table of draws) try { await table.draw(); } catch (error) { console.error(`${MODULE_ID} | arrival table`, error); }
  return result;
}
export const HexFog = { owns: ownsHexFog, disclosed: hexDisclosure, setDisclosure: setHexDisclosure, revealParty,
  async setEnabled(enabled, target) {
    if (!game.user?.isGM) throw new Error("SDE.hexRecords.gmOnly");
    const scene = sceneRef(target);
    await replaceModuleFlag(scene, "hexFog", { enabled: !!enabled }); refreshHexFog();
  } };
export function registerHexFog() {
  const Note = CONFIG.Note?.objectClass;
  if (Note) CONFIG.Note.objectClass = class HexFogNote extends Note {
    get isVisible() {
      const visible = super.isVisible, scene = this.document.parent;
      if (!visible || game.user.isGM || this.isPreview || this.isAuthor || this.document.page?.isOwner || this.document.entry?.isOwner || !ownsHexFog(scene)) return visible;
      return positionDisclosed(scene, { x: this.document.x, y: this.document.y }, "location");
    }
  };
  // A GM's records sit in a pack that loads on demand. Until it has, every hex reads as unexplored and the whole map
  // is veiled, so the first draw waits for it; a reload used to show the explored area as veiled as the rest.
  Hooks.on("canvasReady", async () => {
    try { await loadHexRecords(); } catch (error) { console.error(`${MODULE_ID} | hex records`, error); }
    refreshHexFog();
  });
  Hooks.on("canvasTearDown", () => { overlay?.destroy(); overlay = null; });
  // Only a change the fog is drawn from: the sky writes the darkness on every clock slice of a walk or a
  // night, and a rebuild is ~5,000 hexes (40-80 ms on a desktop, several times that on a Steam Deck).
  Hooks.on("updateScene", (scene, changed) => { if (scene === canvas?.scene && ("flags" in changed || "grid" in changed)) queueHexFog(); });
  // A reveal writes the GM's records and then the players' view: each screen redraws for the one it draws from.
  Hooks.on("createJournalEntry", journal => { if (drawnFrom(journal)) queueHexFog(); });
  Hooks.on("updateJournalEntry", journal => { if (drawnFrom(journal)) queueHexFog(); });
  // The GM's veil follows the party they look at; a roster change reaches the players' maps (the projection names each party's members).
  Hooks.on(`${MODULE_ID}.partySelected`, queueHexFog);
  Hooks.on("updateActor", (actor, changes) => {
    const scene = globalThis.canvas?.scene;
    if (!changes?.flags?.[MODULE_ID]?.partyData || !isActiveGM() || !ownsHexFog(scene)) return;
    withHexLock(scene, () => publishHexProjection(scene)).catch(console.error);
  });
}
function drawnFrom(journal) {
  try { return journal?.id === recordJournal(canvas?.scene, { publicOnly: !game.user?.isGM })?.id; } catch { return true; }
}
let fogFrame = null;
/** One rebuild on the next frame for every write that asked: a reveal writes two journals. */
function queueHexFog() {
  fogFrame ??= requestAnimationFrame(() => { fogFrame = null; refreshHexFog(); });
}
