import { MODULE_ID } from "../shared/module-id.mjs";
import { HexRecords, sceneRef, offsetKey, bookKeyedPages, mergeKeyedPages } from "./hex-records.mjs";
import { HexExplorer, explorerCell, encounterReadout, enterStat, droppedLink, playerOpenable, regionLine, regionText } from "./hex-explorer.mjs";
import { viewedPartyIds } from "./hex-fog.mjs";
import { effectiveDiscovery } from "./hex-fog-core.mjs";
import { FEATURES, decodeTags } from "./tag-store.mjs";
import { terrainOptions, OTHER } from "./tag-overlay.mjs";
import { tableForCheck, pickTable, hexZonesFor, onHexZonesForgotten, TERRAIN_TABLES } from "../encounter/encounter-terrain.mjs";
import { rulesFrom } from "../rules-data/rules-data-core.mjs";
import { storedRulesFor } from "../rules-data/rules-data-scope.mjs";
import { Quests } from "../quests/quests.mjs";
import { questsAtHex, STATUS_LABELS } from "../quests/quest-core.mjs";
import { hexArtSources, paintedTileOf } from "./keyed-art.mjs";
import { paintedScenesFor, extrasHexApi } from "../importer/hex/hex-handoff.mjs";
import { terrainWord } from "../importer/hex/hex-dataset.mjs";
import { SETTLEMENTS } from "../importer/hex/hex-summary.mjs";
import { tilesAvailable, paintTarget, tileChoices, terrainChoices, rerollTile, setTile } from "./hex-tile-chooser.mjs";
import { bakeAvailable, bakedCopies, previousBake, playSigns, bakedName, bakePainted } from "./bake-map.mjs";
import { recordJournal } from "./hex-records.mjs";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const t = (key) => game.i18n.localize(key);
/** Whether the file is really there: a missing one is a plain no, never a console error or a notice. */
const fileLoads = async src => { try { return (await fetch(src, { method: "HEAD" })).ok; } catch { return false; } };
const LABELS = { river: "SDE.hexMap.feature.river", path: "SDE.hexMap.feature.path", coast: "SDE.hexMap.feature.coast" };
const ENCOUNTER_NOTES = { region: "SDE.hexExplorer.enc.region", ambiguous: "SDE.hexExplorer.enc.ambiguous", terrain: "SDE.hexExplorer.enc.terrain", active: "SDE.hexExplorer.enc.active", none: "SDE.hexExplorer.enc.none" };
/** Every region this map names — the scan's, the GM's corrections, the nearest-hex guesses — plus the hex's own answer. */
const regionChoiceNames = (zones, current) => {
  const names = new Set([...zones?.byNum?.values?.() ?? []].map(z => z.zone));
  if (current) names.add(current);
  return [...names].sort((a, b) => a.localeCompare(b));
};
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
      addQuest: function () { return this._addQuest(); },
      // An adventure is attached to the hex but lives in its compendium until the GM imports it there.
      linkAdventure: function () {
        const select = this.element.querySelector('[name="adventurePick"]');
        if (!select?.value) return;
        this._capture();
        this.draft.adventures.push({ index: null, uuid: select.value, label: select.selectedOptions[0]?.textContent ?? "" });
        this.render();
      },
      openQuest: async function (_event, el) {
        const { QuestLogApp } = await import("../quests/quest-log-app.mjs");
        return QuestLogApp.open(el.dataset.uuid);
      },
      openEncounterTable: async function () { (await fromUuid(this.encounterUuid))?.sheet?.render(true); },
      openPage: async function (_event, el) {
        const doc = await fromUuid(el.dataset.uuid);
        if (doc?.documentName === "JournalEntryPage") doc.parent.sheet?.render(true, { pageId: doc.id });
        else doc?.sheet?.render(true);
      },
      showArt: function () { return this._showArt(); },
      // A tile change is written at once, to the painted map: it is not part of this window's Save.
      tileReroll: function () { return this._changeTile({ reroll: true }); },
      tileSet: function (_event, el) { return this._changeTile({ src: el.dataset.src }); },
      tileChoose: function () { this._capture(); this.tilePick = this.tilePick ? null : { terrain: null }; this.render(); },
      bakeMap: function () { return this._bakeMap(); },
    },
  };
  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/hex-map/hex-explorer.hbs`, scrollable: [".sde-hex-explorer-body"] } };
  constructor(offset, scene, options = {}) { super(options); this.offset = { ...offset }; this.scene = scene; this.draft = null; this.saving = false; this.artSrc = null; this.artTitle = ""; this.keyedBook = null; this.tilePick = null; this.tileTarget = null; this.adventurePacks = null; }
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
    // The region answer every reader gives this hex; the select shows it, and a save corrects it on the scan's scene.
    const zones = await hexZonesFor(this.scene).catch(() => null);
    const region = this.shownRegion = regionLine(zones, record.num);
    // The reveal boxes are the viewed party's: what they say is what that party's players see.
    const seen = effectiveDiscovery(record.discovery, viewedPartyIds());
    // The draft belongs to the party it was filled from; switching party while the window is open must not move its boxes to another.
    if (!this.draft) this.partyId = viewedPartyIds()[0] ?? null;
    if (!this.draft) this.regionBase = region?.zone ?? "";
    if (!this.draft) this.draft = {
      terrain: record.terrain ?? "", region: region?.zone ?? "", title: record.title ?? "",
      lines: FEATURES.filter(type => record.features?.some(f => f.type === type)),
      features: (record.features ?? []).map((f, index) => ({ ...f, index })).filter(f => !FEATURES.includes(f.type)),
      notes: (record.notes ?? []).map((n, index) => ({ ...n, index })), links: (record.links ?? []).map((l, index) => ({ ...l, index })),
      adventures: (record.adventures ?? []).map((a, index) => ({ ...a, index })),
      rollTable: record.rollTable ?? "", rollTableChance: record.rollTableChance ?? 100, rollTableFirstOnly: !!record.rollTableFirstOnly,
      revealed: !!seen.revealed, visited: !!seen.visited,
      location: seen.locationRevealed === undefined ? "auto" : seen.locationRevealed ? "show" : "hide",
    };
    const d = this.draft;
    // The saved cell, as a travel check reads it; tableForCheck never throws, so a bad lookup shows as no table.
    const hex = { num: record.num ?? undefined, terrain: record.terrain, features: (record.features ?? []).map(f => f?.type).filter(type => FEATURES.includes(type)) };
    // The "To enter" stat reads the hex scene's OWN ruleset, not the viewed scene's. A keyed or settlement hex stands on
    // the ground its book row names: the same read as the region, and the same map travel prices with.
    const enter = enterStat(rulesFrom(storedRulesFor(this.scene)), record, zones?.ground?.get(record.num));
    const res = await tableForCheck(hex, { scene: this.scene });
    const enc = encounterReadout(res, res.uuid ? (await fromUuid(res.uuid).catch(() => null))?.name ?? "" : "", game.settings.get(MODULE_ID, "encounterTableUuid"),
      pickTable(game.settings.get(MODULE_ID, TERRAIN_TABLES), hex.terrain));
    this.encounterUuid = enc.uuid;
    // Quests tie to a hex by its printed number, so an unnumbered hex has no quest section.
    const numbered = Number.isInteger(record.num), all = numbered ? Quests.list() : [];
    const here = questsAtHex(all, { num: record.num, sceneUuid: this.scene.uuid });
    const pad = n => String(n).padStart(4, "0"), row = q => ({ uuid: q.uuid, name: q.name, status: t(STATUS_LABELS[q.status]) });
    // The book's page for a keyed hex comes from the map's pin on it, not from the stored cell, so it is shown but never saved.
    // A disclosed link whose document players cannot open is what the row's warning calls out; the tick raises it on save.
    const links = await Promise.all(d.links.map(async link => ({ ...link, warn: !!link.visible && !playerOpenable(await fromUuid(link.uuid).catch(() => null)) })));
    const arrivalName = d.rollTable ? (await fromUuid(d.rollTable).catch(() => null))?.name ?? "" : "";
    // A keyed hex lists the book's own pages, pin or no pin. With none, an imported crawl means the hex is simply not keyed
    // (no section, as before); only when no crawl was found does the section say why instead of vanishing.
    const book = numbered ? await this._keyedBookPages(record.num) : null;
    const keyed = mergeKeyedPages(record.keyed ?? [], book?.pages ?? []);
    const explain = numbered && !keyed.length && !book?.imported;
    // The header art is the picture this hex wears, when its file really loads; the pop-out is titled by the number alone.
    const number = record.num === null ? game.i18n.format("SDE.hexExplorer.offset", this.offset) : String(record.num).padStart(4, "0");
    this.artTitle = number;
    this.artSrc = await this._artSrc(record);
    const tile = await this._tileContext(record);
    return { ...d, ...tile, links, arrivalName, keyed, keyedSection: keyed.length > 0 || explain, keyedNote: explain ? t(book?.book ? "SDE.hexExplorer.noKeyedPages" : "SDE.hexExplorer.noBook") : "",
      questSection: numbered, quests: here.map(row),
      // A quest already tied to another hex says so, so moving it is a choice and not a surprise.
      questChoices: all.filter(q => !here.includes(q)).map(q => ({ ...row(q), where: q.hex === null ? "" : ` → ${pad(q.hex)}` })),
      rootId: this.id, encounter: { ...enc, note: game.i18n.format(ENCOUNTER_NOTES[enc.state], enc) }, isGM: true, saving: this.saving, sceneName: this.scene.name,
      // "Difficult (2)": the type's word and its cost of hexes; the word alone for impassable; blank when the rules say neither.
      enter: !enter ? "" : enter.cost === null ? t(`SDE.rulesData.type.${enter.type}`)
        : game.i18n.format("SDE.hexExplorer.enterCost", { type: t(`SDE.rulesData.type.${enter.type}`), cost: enter.cost }),
      region: region && regionText(region),
      // A region is a printed number's answer, so an adopted offset cell has none to correct.
      canRegion: numbered,
      regionOptions: regionChoiceNames(zones, d.region).map(name => ({ value: name, label: name, selected: name === d.region })),
      adventures: d.adventures, adventureChoices: await this._adventureChoices(),
      number, artSrc: this.artSrc,
      locationAuto: d.location === "auto", locationShow: d.location === "show", locationHide: d.location === "hide",
      terrainOptions: this._terrainOptions(d.terrain),
      lineRows: FEATURES.map(type => ({ type, label: t(LABELS[type]), checked: d.lines.includes(type) })) };
  }
  /**
   * The tile section: shown for a numbered hex whose painted map is in this world and whose Extras can read a terrain's tiles.
   * A keyed hex wears its art (set in the Tagger), so it only says so. A baked scene holds no Tiles, so the change goes to
   * the painted copy it was made from; the note says the bake shows it once baked again.
   */
  async _tileContext(record) {
    this.tileTarget = null;
    const api = extrasHexApi();
    if (!tilesAvailable(api) || !Number.isInteger(record.num)) return { tileSection: false };
    const target = paintTarget(this.scene, this._paintedCopies());
    const here = target ? paintedTileOf(target, this.offset) : null;
    if (!here) return { tileSection: false };
    const canBake = bakeAvailable(api);
    if (here.keyed) return { tileSection: true, tileKeyed: true, tileNote: t("SDE.hexExplorer.tile.keyed"), bakeAvailable: canBake };
    // The painted map's own word for this hex is the terrain its pool is read for, and the one a repaint must keep.
    // Read through an async function so that a call that throws before it returns (a stale number, a scene that is
    // gone) is a rejection like any other, and the cell's own word is the fallback the guard is there for.
    const read = async () => api.getHexRecords?.(target.id, [record.num]);
    const held = (await read().catch(() => null))?.[record.num]?.terrain || terrainWord(record.terrain);
    if (!held) return { tileSection: false };
    this.tileTarget = { id: target.id, num: record.num, terrain: held };
    const word = this.tilePick?.terrain || held;
    const poolOf = async () => api.getTilePool(word);
    const pool = this.tilePick ? await poolOf().catch(() => []) : [];
    const words = this._terrainOptions(this.draft?.terrain ?? record.terrain).map(o => terrainWord(o.value));
    return {
      tileSection: true, tileKeyed: false, bakeAvailable: canBake,
      tileNote: game.i18n.format(target.id === this.scene.id ? "SDE.hexExplorer.tile.onScene" : "SDE.hexExplorer.tile.onCopy", { scene: target.name }),
      tilePickerOpen: !!this.tilePick, tileChoices: tileChoices(pool, here.src),
      // What sits on a hex (a village, a keyed location) is tagged beside its terrain but has no tiles of its own.
      tileTerrains: terrainChoices(words, word, [...Object.values(SETTLEMENTS), "keyed_location"].map(terrainWord)),
    };
  }
  /**
   * Bake the painted map into a new scene, here in this GM's own client (the GPU is this tab's). The sequence is bake-map.mjs;
   * this is the asking: what it does, what a scene being played on would not carry over, and whether to switch to the result.
   */
  async _bakeMap() {
    const api = extrasHexApi(), held = this.tileTarget, source = held ? game.scenes.get(held.id) : null;
    if (!game.user?.isGM || !source || !bakeAvailable(api)) return;
    if (!canvas?.app?.renderer) { ui.notifications.warn(t("SDE.hexExplorer.bake.noCanvas")); return; }
    const esc = foundry.utils.escapeHTML;
    const grid = this.scene.flags?.["shadowdark-extras"]?.hexcrawl?.grid;
    const previous = grid ? previousBake(this.scene, bakedCopies(game.scenes, { cols: grid.cols, rows: grid.rows, origin: grid.origin ?? 1 }), game.scenes.active) : null;
    const signs = playSigns(previous, scene => { try { return Object.keys(recordJournal(scene)?.flags?.[MODULE_ID]?.hexRecords?.cells ?? {}).length; } catch { return 0; } });
    const warning = signs ? `<p class="ui-note warn">${esc(game.i18n.format("SDE.hexExplorer.bake.played", { scene: previous.name, recorded: signs.recorded, tokens: signs.tokens }))}</p>` : "";
    const go = await foundry.applications.api.DialogV2.confirm({
      classes: ["sde-ui", "sde-dialog"], window: { title: t("SDE.hexExplorer.bake.title") },
      content: `<p>${esc(game.i18n.format("SDE.hexExplorer.bake.confirm", { source: source.name }))}</p>${warning}`,
      yes: { label: t("SDE.hexExplorer.bake.go") }, rejectClose: false,
    });
    if (!go) return;
    this._capture();
    ui.notifications.info(game.i18n.format("SDE.hexExplorer.bake.progress", { source: source.name }));
    let made = null;
    try { made = await bakePainted(source, api, game.shadowdarkEnhancer.hexMaps); }
    catch (error) {
      console.error(`${MODULE_ID} | Hex Data bake`, error);
      ui.notifications.error(game.i18n.format("SDE.hexExplorer.bake.failed", { error: error.message }));
      return;
    }
    if (!made) return; // Extras said why
    const scene = game.scenes.get(made.sceneId);
    if (scene) await scene.update({ name: bakedName(source) });
    ui.notifications.info(game.i18n.format("SDE.hexExplorer.bake.done", { name: scene?.name ?? made.name }));
    const activate = scene && await foundry.applications.api.DialogV2.confirm({
      classes: ["sde-ui", "sde-dialog"], window: { title: t("SDE.hexExplorer.bake.activateTitle") },
      content: `<p>${esc(game.i18n.format("SDE.hexExplorer.bake.activate", { name: scene.name }))}</p>`,
      yes: { label: t("SDE.hexExplorer.bake.makeActive") }, no: { label: t("SDE.hexExplorer.bake.notNow") }, rejectClose: false,
    });
    if (activate) await scene.activate();
    this.render();
  }
  /** Another tile (a fresh draw) or this exact one, on the painted map; the window then draws again with what it now wears. */
  async _changeTile({ reroll = false, src = null }) {
    const held = this.tileTarget;
    if (!held || !game.user?.isGM) return;
    this._capture();
    try {
      if (reroll) await rerollTile(held.id, held.num, held.terrain);
      else if (src) await setTile(held.id, held.num, held.terrain, src);
    } catch (error) {
      console.error(`${MODULE_ID} | Hex Data tile`, error);
      ui.notifications.warn(game.i18n.format("SDE.hexExplorer.tile.failed", { error: error.message }));
    }
    this.render();
  }
  /** Hovering or focusing a tile in the picker enlarges it: one card, filled and placed beside that tile, kept inside the window. */
  _wireTileZoom() {
    const zoom = this.element.querySelector(".hx-tile-zoom");
    if (!zoom) return;
    const image = zoom.querySelector("image"), label = zoom.querySelector(".hx-tile-zoom-name"), shell = zoom.parentElement;
    const show = (option) => {
      image.setAttribute("href", option.dataset.src);
      label.textContent = option.title;
      zoom.hidden = false;
      const at = option.getBoundingClientRect(), box = shell.getBoundingClientRect(), gap = 8;
      const left = Math.max(gap, Math.min(at.left - box.left + (at.width - zoom.offsetWidth) / 2, box.width - zoom.offsetWidth - gap));
      const above = at.top - box.top - zoom.offsetHeight - gap;
      const top = above >= gap ? above : at.bottom - box.top + gap;
      zoom.style.left = `${left}px`;
      zoom.style.top = `${Math.max(gap, Math.min(top, box.height - zoom.offsetHeight - gap))}px`;
    };
    const hide = () => { zoom.hidden = true; };
    for (const option of this.element.querySelectorAll(".hx-tile-opt")) {
      option.addEventListener("mouseenter", () => show(option));
      option.addEventListener("focus", () => show(option));
      option.addEventListener("mouseleave", hide);
      option.addEventListener("blur", hide);
    }
  }
  /** The header's picture: the first art source for this hex whose file is really there, or null for the stock hexagon. */
  async _artSrc(record) {
    const sources = hexArtSources(this.scene, this.offset, record.num, this._paintedCopies()), key = sources.join("\n");
    // Kept per list of sources: a Disclosed re-render does not HEAD again, and a changed bake or number asks afresh.
    if (this.artFor?.key !== key) this.artFor = { key, found: (async () => { for (const src of sources) if (await fileLoads(src)) return src; return null; })() };
    return this.artFor.found;
  }
  /**
   * The other painted scenes of this map (same published grid), the ones holding Tiles first: a bake and a print draw no
   * terrain tile of their own, so the picture is read from the map they were made from.
   */
  _paintedCopies() {
    const grid = this.scene.flags?.["shadowdark-extras"]?.hexcrawl?.grid;
    if (!grid) return [];
    const mine = (scene) => scene.tiles?.some?.((tile) => tile.flags?.["shadowdark-extras"]?.painted) ? 0 : 1;
    return paintedScenesFor(game.scenes, this.scene.id, { cols: grid.cols, rows: grid.rows, origin: grid.origin ?? 1 })
      .filter((scene) => scene.id !== this.scene.id).sort((a, b) => mine(a) - mine(b));
  }
  /** Foundry's own image pop-out, whose share action sends the picture to the players. */
  _showArt() {
    if (!this.artSrc) return null;
    return new foundry.applications.apps.ImagePopout({ src: this.artSrc, window: { title: this.artTitle } }).render(true);
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
  /** A quest made from this window is tied to the hex at birth, so the log's Hex column already points at it. */
  async _addQuest() {
    if (!Number.isInteger(this.record?.num)) return;
    const quest = await Quests.create({ hex: this.record.num, hexScene: this.scene.uuid });
    if (!quest) return;
    this.render();
    const { QuestLogApp } = await import("../quests/quest-log-app.mjs");
    QuestLogApp.open(quest.id ?? quest.uuid);
  }
  /** Every Adventure in a compendium, grouped by pack: the list a GM loads one from when the party reaches the hex. Read once. */
  _adventureChoices() {
    return this.adventurePacks ??= (async () => {
      const out = [];
      for (const pack of [...(game.packs ?? [])].filter(p => p.documentName === "Adventure")) {
        let rows = [];
        try { rows = [...(await pack.getIndex()).values()]; } catch { rows = []; }
        const entries = rows.map(r => ({ uuid: r.uuid ?? `Compendium.${pack.collection}.${pack.documentName}.${r._id ?? r.id}`, label: r.name }));
        if (entries.length) out.push({ label: pack.metadata?.label ?? pack.collection, entries });
      }
      return out;
    })().catch(() => []);
  }
  /** The map's own terrains (the on-map editor's list); a new one is made with "other…", never typed into a free box. */
  _terrainOptions(current) {
    const state = decodeTags(this.scene.getFlag(MODULE_ID, "hexTags"));
    const options = terrainOptions(state.cells, state.palette);
    if (current && !options.some(o => o.value === current)) options.push({ value: current, label: current.replace(/_/g, " ") });
    return options.map(o => ({ ...o, selected: o.value === current }));
  }
  /**
   * Any journal or scene write drops the cached regions, so the header is asked again, and the form is drawn again
   * only when this hex's own answer moved: a redraw takes the cursor out of the field being typed in.
   */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.stopRegions = onHexZonesForgotten(async () => {
      const now = regionLine(await hexZonesFor(this.scene).catch(() => null), this.record?.num), was = this.shownRegion;
      if (!this.stopRegions || (now?.zone === was?.zone && now?.estimated === was?.estimated)) return;
      this._capture(); this.render();
    });
  }
  _onClose(options) { this.stopRegions?.(); this.stopRegions = null; super._onClose(options); }
  _onRender(context, options) {
    super._onRender(context, options);
    for (const [name, otherName] of [["terrain", "terrainOther"], ["region", "regionOther"]]) {
      const select = this.element.querySelector(`select[name="${name}"]`), other = this.element.querySelector(`[name="${otherName}"]`);
      select?.addEventListener("change", () => { other.hidden = select.value !== OTHER; if (!other.hidden) other.focus(); });
    }
    // The picker lists one terrain's tiles at a time; choosing another terrain here shows its tiles for this hex.
    this._wireTileZoom();
    const tileTerrain = this.element.querySelector('select[name="tileTerrain"]');
    tileTerrain?.addEventListener("change", () => { this._capture(); this.tilePick = { terrain: tileTerrain.value }; this.render(); });
    const zone = (selector, onDrop) => {
      const el = this.element.querySelector(selector);
      if (!el) return;
      el.addEventListener("dragover", event => { event.preventDefault(); el.classList.add("sde-drag-over"); });
      el.addEventListener("dragleave", () => el.classList.remove("sde-drag-over"));
      el.addEventListener("drop", event => { event.preventDefault(); el.classList.remove("sde-drag-over"); void onDrop(event); });
    };
    zone('[data-drop="links"]', event => this._dropLink(this._dropped(event)));
    zone('[data-drop="arrival"]', event => this._dropTable(this._dropped(event)));
    // Ticking Disclosed decides whether the "players cannot open it" warning applies: draw again, keeping the draft.
    for (const box of this.element.querySelectorAll('[data-row="link"] input[data-field="visible"]')) box.addEventListener("change", () => { this._capture(); this.render(); });
  }
  /** The drag payload; a drag that is not a document (a file, a text selection) has none. */
  _dropped(event) {
    try { return foundry.applications.ux.TextEditor.implementation.getDragEventData(event); } catch { return null; }
  }
  async _dropLink(data) {
    const doc = data?.uuid ? await fromUuid(data.uuid).catch(() => null) : null;
    const row = droppedLink(doc);
    if (!row) { ui.notifications?.warn(game.i18n.localize("SDE.hexExplorer.dropRefused")); return; }
    this._capture(); this.draft.links.push(row); this.render();
  }
  async _dropTable(data) {
    const doc = data?.uuid ? await fromUuid(data.uuid).catch(() => null) : null;
    if (doc?.documentName !== "RollTable") { ui.notifications?.warn(game.i18n.localize("SDE.hexExplorer.dropTableRefused")); return; }
    this._capture(); this.draft.rollTable = doc.uuid; this.render();
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
    this.draft = { terrain: value("terrain") === OTHER ? value("terrainOther") : value("terrain"), region: value("region") === OTHER ? value("regionOther") : value("region"), title: value("title"), lines: FEATURES.filter(type => checked(type)),
      features: collection("feature", ["type", "name", "uuid", "discovered"]), notes: collection("note", ["text", "visible", "location"]), links: collection("link", ["uuid", "label", "visible", "share"]),
      adventures: collection("adventure", ["uuid", "label"]),
      rollTable: value("rollTable").trim(), rollTableChance: value("rollTableChance"), rollTableFirstOnly: checked("rollTableFirstOnly"),
      revealed: checked("revealed"), visited: checked("visited"), location: value("location") };
  }
  async _save() {
    if (this.saving || !game.user?.isGM) return;
    this._capture(); this.saving = true;
    // Only a region the GM changed is written: an untouched select must not turn the map's estimate into a correction.
    const input = { ...this.draft };
    if (input.region === this.regionBase) delete input.region;
    this.element.querySelector('[data-action="save"]').disabled = true;
    try { await HexExplorer.save(this.offset, input, this.scene, this.partyId); this.draft = null; }
    catch (error) { console.error(`${MODULE_ID} | Hex Data edit`, error); ui.notifications.warn(t(error.message.startsWith("SDE.") ? error.message : "SDE.hexExplorer.failed")); }
    finally { this.saving = false; this.render(); }
  }
}
