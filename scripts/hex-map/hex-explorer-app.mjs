import { MODULE_ID } from "../shared/module-id.mjs";
import { HexRecords, sceneRef, offsetKey } from "./hex-records.mjs";
import { HexExplorer, explorerCell, encounterReadout } from "./hex-explorer.mjs";
import { FEATURES, decodeTags } from "./tag-store.mjs";
import { terrainOptions, OTHER } from "./tag-overlay.mjs";
import { tableForCheck, pickTable, TERRAIN_TABLES } from "../encounter/encounter-terrain.mjs";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const t = key => game.i18n.localize(key);
const LABELS = { river: "SDE.hexMap.feature.river", path: "SDE.hexMap.feature.path", coast: "SDE.hexMap.feature.coast" };
const ENCOUNTER_NOTES = { region: "SDE.hexExplorer.enc.region", ambiguous: "SDE.hexExplorer.enc.ambiguous", terrain: "SDE.hexExplorer.enc.terrain", active: "SDE.hexExplorer.enc.active", none: "SDE.hexExplorer.enc.none" };
export class HexExplorerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["shadowdark", "sde-hex-explorer", "sde-ui"], window: { title: "SDE.hexExplorer.title", icon: "fa-solid fa-map", resizable: true },
    position: { width: 480, height: 620 },
    actions: {
      save: function () { return this._save(); },
      addFeature: function () { this._capture(); this.draft.features.push({ index: null, type: "", name: "", uuid: "", discovered: false }); this.render(); },
      addNote: function () { this._capture(); this.draft.notes.push({ index: null, text: "", visible: false, location: false }); this.render(); },
      addLink: function () { this._capture(); this.draft.links.push({ index: null, uuid: "", label: "", visible: false }); this.render(); },
      remove: function (_event, el) { el.closest("[data-row]").remove(); this._capture(); this.render(); },
      rollEncounter: async function () {
        const roller = await game.shadowdarkEnhancer.encounter.openRoller("tables");
        return roller.rollActiveTable(this.encounterUuid);
      },
      openEncounterTable: async function () { (await fromUuid(this.encounterUuid))?.sheet?.render(true); },
    },
  };
  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/hex-map/hex-explorer.hbs`, scrollable: [".sde-hex-explorer-body"] } };
  constructor(offset, scene, options = {}) { super(options); this.offset = { ...offset }; this.scene = scene; this.draft = null; this.saving = false; }
  static open(offset, target) {
    const scene = sceneRef(target);
    if (!game.user?.isGM || !explorerCell(scene, offset)) return null;
    const id = `sde-hex-explorer-${scene.id}-${offsetKey(offset)}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) { existing.bringToFront(); return existing; }
    const app = new this(offset, scene, { id }); app.render(true); return app;
  }
  async _prepareContext() {
    if (!game.user?.isGM) return {};
    const record = HexRecords.read(this.offset, this.scene);
    if (!this.draft) this.draft = {
      terrain: record.terrain ?? "", title: record.title ?? "",
      lines: FEATURES.filter(type => record.features?.some(f => f.type === type)),
      lineDiscovery: Object.fromEntries(FEATURES.map(type => [type, record.features?.find(f => f.type === type)?.discovered === true])),
      features: (record.features ?? []).map((f, index) => ({ ...f, index })).filter(f => !FEATURES.includes(f.type)),
      notes: (record.notes ?? []).map((n, index) => ({ ...n, index })), links: (record.links ?? []).map((l, index) => ({ ...l, index })),
      revealed: !!record.discovery.revealed, visited: !!record.discovery.visited,
      location: record.discovery.locationRevealed === undefined ? "auto" : record.discovery.locationRevealed ? "show" : "hide",
    };
    const d = this.draft;
    // The saved cell, as a travel check reads it; tableForCheck never throws, so a bad lookup shows as no table.
    const hex = { num: record.num ?? undefined, terrain: record.terrain, features: (record.features ?? []).map(f => f?.type).filter(type => FEATURES.includes(type)) };
    const res = await tableForCheck(hex, { scene: this.scene });
    const enc = encounterReadout(res, res.uuid ? (await fromUuid(res.uuid).catch(() => null))?.name ?? "" : "", game.settings.get(MODULE_ID, "encounterTableUuid"),
      pickTable(game.settings.get(MODULE_ID, TERRAIN_TABLES), hex.terrain));
    this.encounterUuid = enc.uuid;
    return { ...d, rootId: this.id, encounter: { ...enc, note: game.i18n.format(ENCOUNTER_NOTES[enc.state], enc) }, isGM: true, saving: this.saving, sceneName: this.scene.name,
      number: record.num === null ? game.i18n.format("SDE.hexExplorer.offset", this.offset) : String(record.num).padStart(4, "0"),
      locationAuto: d.location === "auto", locationShow: d.location === "show", locationHide: d.location === "hide",
      terrainOptions: this._terrainOptions(d.terrain),
      lineRows: FEATURES.map(type => ({ type, label: t(LABELS[type]), checked: d.lines.includes(type), discovered: d.lineDiscovery[type] })) };
  }
  /** The map's own terrains (the on-map editor's list); a new one is made with "other…", never typed into a free box. */
  _terrainOptions(current) {
    const state = decodeTags(this.scene.getFlag(MODULE_ID, "hexTags"));
    const options = terrainOptions(state.cells, state.palette);
    if (current && !options.some(o => o.value === current)) options.push({ value: current, label: current.replace(/_/g, " ") });
    return options.map(o => ({ ...o, selected: o.value === current }));
  }
  _onRender(context, options) {
    super._onRender(context, options);
    const select = this.element.querySelector('select[name="terrain"]'), other = this.element.querySelector('[name="terrainOther"]');
    select?.addEventListener("change", () => { other.hidden = select.value !== OTHER; if (!other.hidden) other.focus(); });
  }
  _capture() {
    if (!this.element || !this.draft) return;
    const value = name => this.element.querySelector(`[name="${name}"]`)?.value ?? "";
    const checked = name => !!this.element.querySelector(`[name="${name}"]`)?.checked;
    const collection = (kind, fields) => [...this.element.querySelectorAll(`[data-row="${kind}"]`)].map(el => {
      const index = el.dataset.index === "" ? null : Number(el.dataset.index);
      return { index, ...Object.fromEntries(fields.map(key => {
        const field = el.querySelector(`[data-field="${key}"]`);
        return [key, field.type === "checkbox" ? field.checked : field.value];
      })) };
    });
    this.draft = { terrain: value("terrain") === OTHER ? value("terrainOther") : value("terrain"), title: value("title"), lines: FEATURES.filter(type => checked(type)),
      lineDiscovery: Object.fromEntries(FEATURES.map(type => [type, checked(`${type}Discovered`)])),
      features: collection("feature", ["type", "name", "uuid", "discovered"]), notes: collection("note", ["text", "visible", "location"]), links: collection("link", ["uuid", "label", "visible"]),
      revealed: checked("revealed"), visited: checked("visited"), location: value("location") };
  }
  async _save() {
    if (this.saving || !game.user?.isGM) return;
    this._capture(); this.saving = true;
    this.element.querySelector('[data-action="save"]').disabled = true;
    try { await HexExplorer.save(this.offset, this.draft, this.scene); this.draft = null; }
    catch (error) { console.error(`${MODULE_ID} | Hexplorer edit`, error); ui.notifications.warn(t(error.message.startsWith("SDE.") ? error.message : "SDE.hexExplorer.failed")); }
    finally { this.saving = false; this.render(); }
  }
}
