import { MODULE_ID } from "../shared/module-id.mjs";
import { HexRecords, sceneRef, offsetKey, bookKeyedPages, mergeKeyedPages } from "./hex-records.mjs";
import { HexExplorer, explorerCell, encounterReadout } from "./hex-explorer.mjs";
import { viewedPartyIds } from "./hex-fog.mjs";
import { effectiveDiscovery } from "./hex-fog-core.mjs";
import { FEATURES, decodeTags } from "./tag-store.mjs";
import { terrainOptions, OTHER } from "./tag-overlay.mjs";
import { tableForCheck, pickTable, TERRAIN_TABLES } from "../encounter/encounter-terrain.mjs";
import { Quests } from "../quests/quests.mjs";
import { questsAtHex, STATUS_LABELS } from "../quests/quest-core.mjs";
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
      // Quest links are the quest's own flag, written at once: they are not part of this window's Save.
      linkQuest: function () { return this._setQuestHex(this.element.querySelector('[name="questPick"]')?.value, this.record.num); },
      unlinkQuest: function (_event, el) { return this._setQuestHex(el.dataset.uuid, null); },
      openQuest: function (_event, el) { return fromUuid(el.dataset.uuid).then(doc => doc?.sheet?.render(true)); },
      openEncounterTable: async function () { (await fromUuid(this.encounterUuid))?.sheet?.render(true); },
      openPage: async function (_event, el) {
        const doc = await fromUuid(el.dataset.uuid);
        if (doc?.documentName === "JournalEntryPage") doc.parent.sheet?.render(true, { pageId: doc.id });
        else doc?.sheet?.render(true);
      },
    },
  };
  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/hex-map/hex-explorer.hbs`, scrollable: [".sde-hex-explorer-body"] } };
  constructor(offset, scene, options = {}) { super(options); this.offset = { ...offset }; this.scene = scene; this.draft = null; this.saving = false; this.keyedBook = null; }
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
    const record = this.record = HexRecords.read(this.offset, this.scene);
    // The reveal boxes are the viewed party's: what they say is what that party's players see.
    const seen = effectiveDiscovery(record.discovery, viewedPartyIds());
    // The draft belongs to the party it was filled from; switching party while the window is open must not move its boxes to another.
    if (!this.draft) this.partyId = viewedPartyIds()[0] ?? null;
    if (!this.draft) this.draft = {
      terrain: record.terrain ?? "", title: record.title ?? "",
      lines: FEATURES.filter(type => record.features?.some(f => f.type === type)),
      features: (record.features ?? []).map((f, index) => ({ ...f, index })).filter(f => !FEATURES.includes(f.type)),
      notes: (record.notes ?? []).map((n, index) => ({ ...n, index })), links: (record.links ?? []).map((l, index) => ({ ...l, index })),
      revealed: !!seen.revealed, visited: !!seen.visited,
      location: seen.locationRevealed === undefined ? "auto" : seen.locationRevealed ? "show" : "hide",
    };
    const d = this.draft;
    // The saved cell, as a travel check reads it; tableForCheck never throws, so a bad lookup shows as no table.
    const hex = { num: record.num ?? undefined, terrain: record.terrain, features: (record.features ?? []).map(f => f?.type).filter(type => FEATURES.includes(type)) };
    const res = await tableForCheck(hex, { scene: this.scene });
    const enc = encounterReadout(res, res.uuid ? (await fromUuid(res.uuid).catch(() => null))?.name ?? "" : "", game.settings.get(MODULE_ID, "encounterTableUuid"),
      pickTable(game.settings.get(MODULE_ID, TERRAIN_TABLES), hex.terrain));
    this.encounterUuid = enc.uuid;
    // Quests tie to a hex by its printed number, so an unnumbered hex has no quest section.
    const numbered = Number.isInteger(record.num), all = numbered ? Quests.list() : [];
    const here = questsAtHex(all, { num: record.num, sceneUuid: this.scene.uuid });
    const pad = n => String(n).padStart(4, "0"), row = q => ({ uuid: q.uuid, name: q.name, status: t(STATUS_LABELS[q.status]) });
    // A keyed hex lists the book's own pages, pin or no pin. With none, an imported crawl means the hex is simply not keyed
    // (no section, as before); only when no crawl was found does the section say why instead of vanishing.
    const book = numbered ? await this._keyedBookPages(record.num) : null;
    const keyed = mergeKeyedPages(record.keyed ?? [], book?.pages ?? []);
    const explain = numbered && !keyed.length && !book?.imported;
    return { ...d, keyed, keyedSection: keyed.length > 0 || explain, keyedNote: explain ? t(book?.book ? "SDE.hexExplorer.noKeyedPages" : "SDE.hexExplorer.noBook") : "",
      questSection: numbered, quests: here.map(row),
      // A quest already tied to another hex says so, so moving it is a choice and not a surprise.
      questChoices: all.filter(q => !here.includes(q)).map(q => ({ ...row(q), where: q.hex === null ? "" : ` → ${pad(q.hex)}` })),
      rootId: this.id, encounter: { ...enc, note: game.i18n.format(ENCOUNTER_NOTES[enc.state], enc) }, isGM: true, saving: this.saving, sceneName: this.scene.name,
      number: record.num === null ? game.i18n.format("SDE.hexExplorer.offset", this.offset) : String(record.num).padStart(4, "0"),
      locationAuto: d.location === "auto", locationShow: d.location === "show", locationHide: d.location === "hide",
      terrainOptions: this._terrainOptions(d.terrain),
      lineRows: FEATURES.map(type => ({ type, label: t(LABELS[type]), checked: d.lines.includes(type) })) };
  }
  /** The book's pages for this hex: one pack read per window, not one per render. */
  _keyedBookPages(num) {
    return this.keyedBook ??= bookKeyedPages(this.scene, num).catch(error => {
      console.error(`${MODULE_ID} | Hex Data keyed pages`, error);
      this.keyedBook = null; // a transient failure is not kept for the life of the window
      return { book: true, imported: false, pages: [] };
    });
  }
  async _setQuestHex(uuid, num) {
    if (!uuid || !game.user?.isGM) return;
    this._capture();
    try { await Quests.update(uuid, q => ({ ...q, hex: num, hexScene: num === null ? null : this.scene.uuid })); }
    catch (error) { console.error(`${MODULE_ID} | Hex Data quest link`, error); ui.notifications.warn(game.i18n.localize("SDE.hexExplorer.failed")); }
    this.render();
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
      features: collection("feature", ["type", "name", "uuid", "discovered"]), notes: collection("note", ["text", "visible", "location"]), links: collection("link", ["uuid", "label", "visible"]),
      revealed: checked("revealed"), visited: checked("visited"), location: value("location") };
  }
  async _save() {
    if (this.saving || !game.user?.isGM) return;
    this._capture(); this.saving = true;
    this.element.querySelector('[data-action="save"]').disabled = true;
    try { await HexExplorer.save(this.offset, this.draft, this.scene, this.partyId); this.draft = null; }
    catch (error) { console.error(`${MODULE_ID} | Hex Data edit`, error); ui.notifications.warn(t(error.message.startsWith("SDE.") ? error.message : "SDE.hexExplorer.failed")); }
    finally { this.saving = false; this.render(); }
  }
}
