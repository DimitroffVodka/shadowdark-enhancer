/**
 * Shadowdark Enhancer — the import wizard's window.
 *
 * A thin ApplicationV2 around WizardController: it draws what the controller describes, hands every click
 * and file drop back to it, and supplies the parts that need Foundry (uploads, the PDF reader, the hub's
 * batch import, scene building). The page flow and every decision live in wizard-core / -check / -controller
 * / -run, which Node tests; this file only joins them to the game.
 */
import { MODULE_ID } from "../../shared/module-id.mjs";
import { WizardController, ACTIONS } from "./wizard-controller.mjs";
import { startUpdate, filesOfHex, HEX_MAPS } from "./wizard-core.mjs";
import { hexPrint } from "../../hex-map/hex-prints.mjs";
import { runWizardImport } from "./wizard-run.mjs";
import { wireFiles, wireLegend, openPicker, actionData } from "./wizard-dom.mjs";
import { useSessionPdf, sessionPdfPath, onTheForge, FORGE_UPLOAD_LIMIT_MB } from "../session-pdf.mjs";
import { resolveSourcePdf, uploadSourcePdf, findLibraryJournal, listSourcePdfs } from "../source-pdf-registry.mjs";
import { extractPdfText, releaseLocalPdfs } from "../pdf-text-extract.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const t = (key, args) => (args ? game.i18n.format(key, args) : game.i18n.localize(key));

/** One click handler per template action; "choose" opens the file dialog itself, "pick" arrives from a drop or the dialog. */
const act = (name) => function onAction(_event, target) { return this.ctl.dispatch(name, actionData(target)); };
const ACTION_MAP = {
  ...Object.fromEntries(ACTIONS.filter((a) => a !== "choose").map((a) => [a, act(a)])),
  choose(_event, target) { openPicker(target); },
};

/** The world setting a finished run writes: { at, version, books }. */
const RUN_SETTING = "importerWizardRun";

/**
 * Does this world still need its first import? Not when a wizard run has finished here, and not when a book
 * is linked (a hub import, or a kept upload). A world with neither has nothing to open the advanced importer
 * on, so the wizard is the front door; the advanced importer stays one link away.
 */
export const wizardFirst = () => !game.settings.get(MODULE_ID, RUN_SETTING)?.at
  && !findLibraryJournal()?.pages.some((p) => p.type === "pdf");

/** Remember that this world has imported: when, with which module version, and from which books. */
async function recordRun(books) {
  const before = game.settings.get(MODULE_ID, RUN_SETTING) ?? {};
  await game.settings.set(MODULE_ID, RUN_SETTING, {
    at: new Date().toISOString(),
    version: String(game.modules.get(MODULE_ID)?.version ?? ""),
    books: [...new Set([...(before.books ?? []), ...books])],
  });
}

export class ImportWizardApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-import-wizard",
    classes: ["sde-ui", "sde-import-wizard"],
    window: { title: "SDE.importer.wizard.windowTitle", icon: "fas fa-file-import", resizable: true },
    position: { width: 640, height: 700 },
    actions: ACTION_MAP,
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/importer-wizard.hbs` } };

  /** The one open wizard, or null. */
  static _instance = null;

  /**
   * Open the wizard, or bring forward the one that is open.
   * @param {{update?:{n:number, books:string[]}}} [opts]  update: a release added content (see importer-hub-news.mjs)
   */
  static async open({ update = null } = {}) {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.notify.gmOnly")); return null; }
    if (!this._instance) {
      // "Is this book already here?" is asked of the server (listSourcePdfs checks each file); a default path nobody has
      // probed yet looks linked to resolveSourcePdf, and a book used once is not anywhere on the server.
      const have = update ? new Set((await listSourcePdfs()).filter((r) => r.linked).map((r) => r.src)) : null;
      this._instance = new ImportWizardApp({}, update, have);
    }
    this._instance.render({ force: true });
    return this._instance;
  }

  constructor(options = {}, update = null, have = new Set()) {
    super(options);
    this.ctl = new WizardController(this._env(), () => this.render());
    if (update) startUpdate(this.ctl.state, update, (src) => have.has(src));
    this._leaving = false;
    this._scroll = { page: null, top: 0 };
    this._viewedAtStart = game.scenes?.viewed?.id ?? null;   // the Terrain page takes the canvas to each hex map; closing puts it back
    this._tookCanvas = false;
  }

  // ── What Foundry supplies to the controller ────────────────────────────────

  _env() {
    const app = this;
    return {
      t,
      forge: onTheForge(),
      limitMB: FORGE_UPLOAD_LIMIT_MB,
      canUpload: !!game.user?.can?.("FILES_UPLOAD"),
      useOnce: (src, file) => useSessionPdf(src, file),
      uploadBook: (src, file) => uploadSourcePdf(src, file),
      // Whatever the book resolves to is what the import will read: the session copy, or the uploaded file.
      probeBook: async (src) => (await extractPdfText(resolveSourcePdf(src) ?? sessionPdfPath(src), { pages: [1] })).numPages,
      probeImage: async (file) => { const bitmap = await createImageBitmap(file); const size = { w: bitmap.width, h: bitmap.height }; bitmap.close?.(); return size; },
      uploadMap: async (file) => (await import("../adventure/adventure-scene.mjs")).uploadMapImage(file),
      run: (state, hooks) => app._run(state, hooks),
      release: () => releaseLocalPdfs(),
      confirmCancel: () => app._confirmLeave(),
      openAdvanced: async () => { await app._leave({ keepBooks: true }); (await import("../importer-hub-app.mjs")).ImporterHubApp.open(); },
      // A map the wizard was unsure of, or cannot do alone: the full Hex map from image flow, with its grid window.
      openHex: async (files, id) => {
        const { hexMapFromFile } = await import("../../hex-map/hex-map-flow.mjs");
        const title = HEX_MAPS.find((h) => h.id === id)?.title;
        if (files.length) await hexMapFromFile(files, { name: title, mapId: id, firstNum: hexPrint(id)?.firstNum ?? "0000" });
      },
      // The Terrain page: read a hex map and build its Legend cards (hex-legend-session.mjs), on this page rather than the tagger's.
      legendOpen: async ({ id, sceneId }, onProgress) => {
        app._tookCanvas = true;
        const { openLegendSession } = await import("../../hex-map/hex-legend-session.mjs");
        return openLegendSession({ sceneId, folder: hexPrint(id)?.folder, onProgress });
      },
      // A map whose terrain was left for later: the tagger's own Legend, on that map.
      openLegend: async (sceneId) => {
        const scene = game.scenes.get(sceneId);
        if (!scene) return;
        await scene.view();
        (await import("../../hex-map/hex-tagger-app.mjs")).HexTaggerApp.open({ legend: true });
      },
      close: () => app._leave(),
    };
  }

  /** The three stages of the import, joined to the game (the flow itself is wizard-run.mjs). */
  async _run(state, hooks) {
    const { ImporterHubApp } = await import("../importer-hub-app.mjs");
    const { adventureBooks, findSite } = await import("../adventure/adventure-manifest.mjs");
    const { importAdventures } = await import("../adventure/adventure-book-import.mjs");
    const scenes = await import("../adventure/adventure-scene.mjs");
    const { hasKnownPositions } = await import("../adventure/adventure-layouts.mjs");
    const { AdventurePlacer } = await import("../adventure/adventure-placer.mjs");
    const { CHAR_SOURCES } = await import("../char-content/char-content-manifest.mjs");
    const { importKeyLocations, keyLocationBooks } = await import("../hex/hex-book-import.mjs");
    const { legendNamed } = await import("../../hex-map/hex-legend-session.mjs");
    const { hexMapFromFile } = await import("../../hex-map/hex-map-flow.mjs");
    let hub = null;
    // Building a scene opens the placer, which takes the GM's view to it; the GM's view goes back where it was afterwards.
    const viewed = game.scenes?.viewed ?? null;
    try {
      const result = await runWizardImport(state, hooks, {
        t,
        adventureBooks: adventureBooks(),
        // The hub's own "Import everything", on a window nobody sees; its toasts are captured, not shown.
        library: async (opts) => { hub ??= await ImporterHubApp.openHidden(); return hub._onBatchImport(null, null, { quiet: true, ...opts }); },
        fileAdventures: (src, opts) => importAdventures(src, { ...opts, keepExisting: true }),   // "Nothing you already have will be overwritten"
        keyBooks: keyLocationBooks(),
        keyLocations: (src, opts) => importKeyLocations(src, { ...opts, keepExisting: true }),
        // The hex map's file is the one the GM picked; nothing is asked, and a scene made on an earlier run is left alone.
        hexMap: async (id, { title, firstNum }) => {
          const files = filesOfHex(state, id);   // a print that ships as two halves has two, in order
          if (!files.length) return { status: "failed" };
          const made = await hexMapFromFile(files, { name: title, mapId: id, firstNum: firstNum ?? "0000", auto: true });
          const scene = made.scene;
          // A scene made now still needs its Legend; one found from an earlier run needs it only until the GM has applied one.
          const legend = made.status === "ready" ? !!made.legend : !!scene && !legendNamed(scene);
          return { status: made.status, sceneId: scene?.id, legend, pinned: made.pinned };
        },
        siteOf: (id) => { const site = findSite(id); return site && { ...site, src: CHAR_SOURCES[site.src]?.label ?? site.src }; },
        isFiled: async (id) => (await scenes.filedSiteIds()).has(id),
        buildScene: async (id, path) => {
          const site = findSite(id);
          if (scenes.findSiteScene(id)) return { status: "already", placed: 0, left: 0, known: true };
          const built = path ? await scenes.buildSiteScene(site, path) : null;
          if (!built) return { status: "failed", placed: 0, left: 0, known: false };
          // The module places every pin it knows the position of; the rest are the GM's, in the placer.
          const placer = await AdventurePlacer.open(built.scene);
          const known = hasKnownPositions(site);
          const placed = known ? (await placer?.placeFromBook())?.placed ?? 0 : 0;
          const left = placer?._rows().filter((r) => r.state === "pending").length ?? 0;
          await placer?.close();
          return { status: "built", placed, left, known };
        },
      });
      if (!result.stopped) await recordRun(state.check.ready.filter((id) => id.startsWith("book:")).map((id) => id.slice(5)));
      return result;
    } finally {
      await hub?.close();
      if (viewed && game.scenes.viewed?.id !== viewed.id && game.scenes.has(viewed.id)) await viewed.view();
    }
  }

  async _confirmLeave() {
    if (!Object.keys(this.ctl.state.books).length && !Object.keys(this.ctl.state.maps).length) return true;
    return foundry.applications.api.DialogV2.confirm({
      classes: ["sde-ui", "sde-dialog"],
      window: { title: t("SDE.importer.wizard.leave.title"), icon: "fas fa-door-open" },
      content: `<p>${t("SDE.importer.wizard.leave.body")}</p>`,
      yes: { label: t("SDE.importer.wizard.leave.yes") },
      no: { label: t("SDE.importer.wizard.leave.no"), default: true },
      rejectClose: false,
    }).catch(() => false);
  }

  /** Close without asking. keepBooks: the checked "use once" PDFs are handed on (to the advanced importer) instead of let go. */
  async _leave({ keepBooks = false } = {}) {
    this._leaving = true;
    this._keepBooks = keepBooks;
    await this.close();
  }

  // ── The window ─────────────────────────────────────────────────────────────

  async _prepareContext() {
    return this.ctl.viewModel();
  }

  /** The body keeps its scroll through a redraw of the same page (the import bar redraws about once a job). */
  async _preRender(context, options) {
    const body = this.element?.querySelector(".sde-wiz-body");
    this._scroll = { page: this.ctl.state.page, top: body?.scrollTop ?? 0 };
    return super._preRender(context, options);
  }

  _onRender(context, options) {
    super._onRender(context, options);
    wireFiles(this.element, this.ctl);
    wireLegend(this.element, this.ctl);
    const body = this.element.querySelector(".sde-wiz-body");
    if (body && this._scroll.page === this.ctl.state.page) body.scrollTop = this._scroll.top;
  }

  /** The window's own X: a run in progress is asked to stop, anything else asks before throwing the picks away. */
  async close(options = {}) {
    if (!this._leaving) {
      if (this.ctl.state.page === "import") { this.ctl.stopRequested = true; this.ctl.changed(); return this; }
      // By the Terrain page the import has happened: only a map's names are left, and the Hex Tagger can still take them.
      if (!["done", "terrain"].includes(this.ctl.state.page) && !(await this._confirmLeave())) return this;
    }
    if (!this._keepBooks) await releaseLocalPdfs();
    await this.ctl.legend?.close?.();
    ImportWizardApp._instance = null;
    const start = this._viewedAtStart && game.scenes.get(this._viewedAtStart);
    if (this._tookCanvas && start && game.scenes.viewed?.id !== start.id) await start.view();
    return super.close(options);
  }
}
