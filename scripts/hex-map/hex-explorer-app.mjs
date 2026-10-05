import { MODULE_ID } from "../shared/module-id.mjs";
import { HexRecords, sceneRef, offsetKey } from "./hex-records.mjs";
import { HexExplorer, explorerCell } from "./hex-explorer.mjs";
import { FEATURES, paletteTags } from "./tag-store.mjs";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const t = key => game.i18n.localize(key);
const LABELS = { river: "SDE.hexMap.feature.river", path: "SDE.hexMap.feature.path", coast: "SDE.hexMap.feature.coast" };
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
    return { ...d, rootId: this.id, isGM: true, saving: this.saving, sceneName: this.scene.name,
      number: record.num === null ? game.i18n.format("SDE.hexExplorer.offset", this.offset) : String(record.num).padStart(4, "0"),
      locationAuto: d.location === "auto", locationShow: d.location === "show", locationHide: d.location === "hide",
      terrains: [...new Set([...paletteTags(this.scene.getFlag(MODULE_ID, "hexTags")?.palette), d.terrain].filter(Boolean))],
      lineRows: FEATURES.map(type => ({ type, label: t(LABELS[type]), checked: d.lines.includes(type), discovered: d.lineDiscovery[type] })) };
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
    this.draft = { terrain: value("terrain"), title: value("title"), lines: FEATURES.filter(type => checked(type)),
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
