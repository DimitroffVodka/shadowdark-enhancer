/**
 * Shadowdark Enhancer — the GM's landing page editor (ApplicationV2).
 *
 * One window per scene: the town's name and welcome text, which tiles players see, and its
 * merchants. A merchant is an NPC the GM picks; its own items are the stock (edit them on the NPC), and what the GM
 * sets here is how it presents and prices: role, pitch, prices %, what it buys back for, open or closed, and a
 * Restock that puts the whole shelf back. Edits are kept in a draft and written once, on Save, as the scene's
 * `landing` flag (town-core.mjs). Opened from the Scenes directory's right-click menu.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { KINDS, SIZES } from "../merchant/stock-generator.mjs";
import { makeMerchant } from "./town-stock.mjs";
import { GAME_KEYS, TABLE_GAMES } from "./games-core.mjs";
import {
  PLACE_IDS, PLACE_LABEL_KEYS, addMerchant, applyForm, landingOf, linkableNpcs, mergeSave, normalizeLanding,
  removeMerchant, restockMerchant, waresCount,
} from "./town-core.mjs";
import { today, updateLanding } from "./town-live.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TownEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-town-editor",
    classes: ["shadowdark-enhancer", "sde-ui", "sde-town-editor"],
    position: { width: 680, height: 780 },
    window: { icon: "fa-solid fa-landmark", title: "SDE.town.editor.title", resizable: true },
    actions: {
      openScene: TownEditorApp.prototype._onOpenScene,
      addMerchant: TownEditorApp.prototype._onAddMerchant,
      removeMerchant: TownEditorApp.prototype._onRemoveMerchant,
      restockMerchant: TownEditorApp.prototype._onRestockMerchant,
      openStock: TownEditorApp.prototype._onOpenStock,
      generateMerchant: TownEditorApp.prototype._onGenerateMerchant,
      save: TownEditorApp.prototype._onSave,
      cancel: TownEditorApp.prototype._onCancel,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/town/town-editor.hbs`, scrollable: [".ui-body"] },
  };

  /** The scene being edited, its stored page (for what a restock changes) and the unsaved draft. */
  scene = null;
  saved = null;
  draft = null;
  /** True while Generate is running, so a second click cannot make a second merchant. */
  _generating = false;

  constructor({ scene, ...options } = {}) {
    super(options);
    this.scene = scene;
    this.saved = landingOf(scene);
    this.draft = this.saved ?? normalizeLanding({ title: scene?.name });
  }

  /** Open (or bring forward) the editor for a scene. GM only. */
  static open(scene) {
    if (!game.user.isGM || !scene) return null;
    const id = `${TownEditorApp.DEFAULT_OPTIONS.id}-${scene.id}`;
    const app = foundry.applications.instances.get(id) ?? new TownEditorApp({ id, scene });
    app.render({ force: true });
    return app;
  }

  get title() { return `${t("SDE.town.editor.title")}: ${this.scene?.name ?? ""}`; }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const page = this.draft;
    const savedRev = new Map((this.saved?.merchants ?? []).map((m) => [m.id, m.rev]));
    context.sceneName = this.scene?.name ?? "";
    context.page = page;
    context.places = PLACE_IDS.map((id) => ({ id, label: t(PLACE_LABEL_KEYS[id]), on: page.places.includes(id) }));
    context.games = TABLE_GAMES.map((id) => ({ id, label: t(GAME_KEYS[id].name), on: page.games.list.includes(id) }));
    context.merchants = page.merchants.map((m) => {
      const actor = game.actors.get(m.actorId);
      const wares = actor ? waresCount(actor) : 0;
      return {
        ...m, name: actor?.name ?? t("SDE.town.editor.missingName"), img: actor?.img || "icons/svg/mystery-man.svg",
        wares, missing: !actor, empty: !!actor && !wares, restocking: savedRev.has(m.id) && m.rev > savedRev.get(m.id),
      };
    });
    context.openCount = page.merchants.filter((m) => m.open).length;
    context.kinds = KINDS.map((k) => ({ id: k.id, label: t(k.labelKey) }));
    context.sizes = SIZES.map((z) => ({ id: z.id, label: t(z.labelKey), selected: z.id === "town" }));
    context.npcs = linkableNpcs(game.actors.contents, page).map((a) => ({ id: a.id, name: a.name }));
    return context;
  }

  /** The window's title is only read when it is first drawn, so a reopened window sets it again. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    if (this.window?.title) this.window.title.textContent = this.title;
  }

  /** The draft with whatever is typed in the form right now folded in, so a redraw never loses typing. */
  _collect() {
    const form = this.element?.querySelector("form");
    if (!form) return this.draft;
    const fields = {};
    for (const [key, value] of new FormData(form)) fields[key] = value;
    return applyForm(this.draft, fields);
  }

  /** The picture the landing page is drawn over is the scene's own background; it is set in the scene's settings. */
  _onOpenScene() { return this.scene?.sheet?.render(true); }

  _onAddMerchant() {
    const picked = this.element.querySelector("select[name=addActor]")?.value;
    if (!picked) return;
    this.draft = addMerchant(this._collect(), picked, () => foundry.utils.randomID());
    return this.render();
  }

  _onRemoveMerchant(_event, target) {
    this.draft = removeMerchant(this._collect(), target.dataset.merchantId);
    return this.render();
  }

  _onRestockMerchant(_event, target) {
    this.draft = restockMerchant(this._collect(), target.dataset.merchantId, today());
    return this.render();
  }

  _onOpenStock(_event, target) {
    return game.actors.get(target.dataset.actorId)?.sheet?.render(true);
  }

  /**
   * Make an NPC that sells ordinary gear for the chosen kind and town size, and add it to the draft. The NPC is made
   * at once, so cancelling the editor leaves it behind in its folder (the hint says so).
   */
  async _onGenerateMerchant(_event, target) {
    if (!game.user.isGM || this._generating) return;
    this._generating = true;
    if (target) target.disabled = true;
    try { return await this._generateMerchant(); }
    finally { this._generating = false; if (target) target.disabled = false; }
  }

  async _generateMerchant() {
    const form = this.element.querySelector("form");
    const kind = KINDS.find((k) => k.id === form.querySelector("select[name=genKind]")?.value) ?? KINDS[0];
    const size = SIZES.find((z) => z.id === form.querySelector("select[name=genSize]")?.value)?.id ?? "town";
    const actor = await makeMerchant({ kind: kind.id, size, sceneName: this.scene?.name ?? "" });
    if (!actor) return;
    const page = addMerchant(this._collect(), actor.id, () => foundry.utils.randomID());
    this.draft = normalizeLanding({ ...page, merchants: page.merchants.map((m) => (m.actorId === actor.id ? { ...m, role: t(kind.labelKey), stock: { kind: kind.id, size } } : m)) });
    ui.notifications.info(t("SDE.town.editor.generated", { name: actor.name, n: actor.items.size }));
    return this.render();
  }

  async _onSave() {
    // A window left open must not put back a page the GM took away, or a shelf that was restocked meanwhile.
    const draft = this._collect();
    await updateLanding(this.scene, (live) => mergeSave(live, draft, this.saved, today()));
    ui.notifications.info(t("SDE.town.editor.saved"));
    return this.close();
  }

  _onCancel() { return this.close(); }
}
