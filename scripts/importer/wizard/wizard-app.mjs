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
import { startUpdate } from "./wizard-core.mjs";
import { runWizardImport } from "./wizard-run.mjs";
import { wireFiles, openPicker, actionData } from "./wizard-dom.mjs";
import { useSessionPdf, sessionPdfPath, onTheForge, FORGE_UPLOAD_LIMIT_MB } from "../session-pdf.mjs";
import { resolveSourcePdf, uploadSourcePdf, findLibraryJournal } from "../source-pdf-registry.mjs";
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
  static open({ update = null } = {}) {
    if (!game.user?.isGM) { ui.notifications.warn(t("SDE.importer.notify.gmOnly")); return null; }
    this._instance ??= new ImportWizardApp({}, update);
    this._instance.render({ force: true });
    return this._instance;
  }

  constructor(options = {}, update = null) {
    super(options);
    this.ctl = new WizardController(this._env(), () => this.render());
    if (update) startUpdate(this.ctl.state, update, (src) => !!resolveSourcePdf(src));
    this._leaving = false;
    this._scroll = { page: null, top: 0 };
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
      openAdvanced: async () => { await app._leave(); (await import("../importer-hub-app.mjs")).ImporterHubApp.open(); },
      openHex: async () => { ui.notifications.info(t("SDE.importer.wizard.hexLater")); },
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
    let hub = null;
    // Building a scene opens the placer, which takes the GM's view to it; the GM's view goes back where it was afterwards.
    const viewed = game.scenes?.viewed ?? null;
    try {
      const result = await runWizardImport(state, hooks, {
        t,
        adventureBooks: adventureBooks(),
        // The hub's own "Import everything", on a window nobody sees; its toasts are captured, not shown.
        library: async (opts) => { hub ??= await ImporterHubApp.openHidden(); return hub._onBatchImport(null, null, { quiet: true, ...opts }); },
        fileAdventures: (src, opts) => importAdventures(src, opts),
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

  async _leave() {
    this._leaving = true;
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
    const body = this.element.querySelector(".sde-wiz-body");
    if (body && this._scroll.page === this.ctl.state.page) body.scrollTop = this._scroll.top;
  }

  /** The window's own X: a run in progress is asked to stop, anything else asks before throwing the picks away. */
  async close(options = {}) {
    if (!this._leaving) {
      if (this.ctl.state.page === "import") { this.ctl.stopRequested = true; this.ctl.changed(); return this; }
      if (this.ctl.state.page !== "done" && !(await this._confirmLeave())) return this;
    }
    await releaseLocalPdfs();
    ImportWizardApp._instance = null;
    return super.close(options);
  }
}
