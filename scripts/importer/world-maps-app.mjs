/**
 * Shadowdark Enhancer — the "Maps for this world" window.
 *
 * One row per map the supported books contain, each with one thing to do: nothing (it is in this world), Load (it waits
 * in the Adventures compendium), or Add map file (the module never saw its picture). Opened from the quick guide's first
 * page once the world has imported. The rows and the dispatch are world-maps-core.mjs; this file joins them to Foundry.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { mapList, mapsView, loadMap, addMapFiles } from "./world-maps-core.mjs";
import { HEX_MAPS } from "./wizard/wizard-core.mjs";
import { hexPrint } from "../hex-map/hex-prints.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class WorldMapsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-world-maps",
    classes: ["sde-ui", "sde-world-maps"],
    window: { title: "SDE.importer.maps.windowTitle", icon: "fas fa-map", resizable: true },
    position: { width: 560, height: 640 },
    actions: {
      load(_e, el) { return this._work(el.dataset.id, () => loadMap(el.dataset.id, this._deps())); },
      addFile(_e, el) { return this._pick(el.dataset.id); },
      view(_e, el) { return game.scenes.get(el.dataset.scene)?.view(); },
      async advanced() { await this.close(); (await import("./importer-hub-app.mjs")).ImporterHubApp.open("import"); },
    },
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/importer-world-maps.hbs` } };

  static open() {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.notify.gmOnly")); return null; }
    const app = foundry.applications.instances.get("sde-world-maps") ?? new WorldMapsApp();
    app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this._busy = null;   // the id of the row at work
    this._lines = {};    // id → the plain line its last action left, and the scene it can show
  }

  /** The Foundry parts world-maps-core.mjs works through. */
  _deps() {
    return {
      sceneOf: (id) => this._sceneOf(id)?.id ?? null,
      importPacked: async (id) => {
        const { findPackedAdventure, importPackedAdventure } = await import("./adventure/adventure-pack.mjs");
        const packed = await findPackedAdventure(id);
        return packed ? importPackedAdventure(packed) : { status: "missing" };   // the import offers the quick guide's terrain step
      },
      buildHex: async (id, files) => {
        const { buildHexAdventure } = await import("./hex/hex-adventure.mjs");
        const made = await buildHexAdventure(files, { id, title: HEX_MAPS.find((h) => h.id === id)?.title, firstNum: hexPrint(id)?.firstNum ?? "0000", placement: "world" });
        const scene = made.sceneId && game.scenes.get(made.sceneId);
        if (scene) (await import("./wizard/wizard-app.mjs")).offerTerrainGuide([scene]);   // not awaited: the row turns first
        return made;
      },
      uploadMap: async (file) => (await import("./adventure/adventure-scene.mjs")).uploadMapImage(file),
      buildSite: async (id, path) => {
        const [{ findSite }, { buildSiteWithPins }, { buildPlaced }] = await Promise.all([
          import("./adventure/adventure-manifest.mjs"), import("./adventure/adventure-placer.mjs"), import("./adventure/adventure-pack.mjs"),
        ]);
        const site = findSite(id);
        return buildPlaced(site, () => buildSiteWithPins(site, path), { placement: "world" });
      },
    };
  }

  /** The map a world scene shows, hex or adventure, or "" (the flag names are read in _prepareContext, before any click). */
  _mapIdOf(scene) { return scene.getFlag(MODULE_ID, this._flags.hex) || scene.getFlag(MODULE_ID, this._flags.site)?.site || ""; }

  /** The world scene of a map, or null. */
  _sceneOf(id) { return game.scenes.find((s) => this._mapIdOf(s) === id) ?? null; }

  /** Ask for the map's picture (both halves at once for a print that ships in two). */
  _pick(id) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = (HEX_MAPS.find((h) => h.id === id)?.files.length ?? 1) > 1;
    input.addEventListener("change", () => { if (input.files?.length) this._work(id, () => addMapFiles(id, [...input.files], this._deps())); });
    input.click();
  }

  /** Run one row's action; the row shows a spinner meanwhile, and its line and View button after. */
  async _work(id, fn) {
    if (this._busy) return;
    this._busy = id;
    this.render();
    try {
      const r = await fn();
      this._lines[id] = { text: r.line ? t(r.line.key, r.line.args) : "", sceneId: r.sceneId ?? null };
    } catch (err) {
      console.error(`${MODULE_ID} | maps for this world: ${id}`, err);
      this._lines[id] = { text: t("SDE.importer.maps.line.buildFailed"), sceneId: null };
    } finally {
      this._busy = null;
      this.render();
    }
  }

  async _prepareContext() {
    const [{ findSuitePack }, { filedSiteIds, MAP_FLAG }, { ADVENTURE_PACK_FLAG }, { HEXMAP_FLAG }] = await Promise.all([
      import("../shared/compendium-suite.mjs"), import("./adventure/adventure-scene.mjs"), import("./adventure/adventure-pack.mjs"),
      import("../hex-map/hex-map-flow.mjs"),
    ]);
    this._flags = { hex: HEXMAP_FLAG, site: MAP_FLAG };
    const pack = findSuitePack("adventures");
    const index = pack ? await pack.getIndex({ fields: [`flags.${MODULE_ID}.${ADVENTURE_PACK_FLAG}`] }) : [];
    const packed = new Set([...index].map((e) => e.flags?.[MODULE_ID]?.[ADVENTURE_PACK_FLAG]?.site).filter(Boolean));
    const inWorld = new Set(game.scenes.map((s) => this._mapIdOf(s)).filter(Boolean));
    const canUpload = !!game.user?.can?.("FILES_UPLOAD");
    this._filed ??= await filedSiteIds();   // read once: nothing this window does files a book
    const groups = mapsView(mapList({ inWorld, packed, filed: this._filed }), { busy: this._busy, lines: this._lines, canUpload, t });
    return { groups, canUpload };
  }
}
