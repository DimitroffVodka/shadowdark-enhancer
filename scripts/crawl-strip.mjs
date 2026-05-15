import { MODULE_ID } from "./module-id.mjs";
import { CrawlState } from "./crawl-state.mjs";

const STRIP_ID = "shadowdark-enhancer-strip";
const TEMPLATE = `modules/${MODULE_ID}/templates/crawl-strip.hbs`;

export const CrawlStrip = {
  _el: null,
  _renderQueued: false,
  _hookIds: [],
  _resizeListener: null,

  init() {
    // Defensive helper registration — Foundry usually provides `eq` but verify.
    if (!Handlebars.helpers.eq) {
      Handlebars.registerHelper("eq", (a, b) => a === b);
    }

    this.mount();

    const queue = () => this.queueRender();
    this._hookIds.push(Hooks.on(CrawlState.HOOK_CHANGED, queue));
    this._hookIds.push(Hooks.on("combatStart", queue));
    this._hookIds.push(Hooks.on("combatRound", queue));
    this._hookIds.push(Hooks.on("combatTurn", queue));
    this._hookIds.push(Hooks.on("deleteCombat", queue));
    this._hookIds.push(Hooks.on("renderSceneNavigation", () => this._updateBounds()));
    this._hookIds.push(Hooks.on("collapseSidebar", () => this._updateBounds()));

    this._resizeListener = () => this._updateBounds();
    window.addEventListener("resize", this._resizeListener);
  },

  dispose() {
    for (const id of this._hookIds) Hooks.off(id);
    this._hookIds = [];
    if (this._resizeListener) window.removeEventListener("resize", this._resizeListener);
    this._resizeListener = null;
    this._el?.remove();
    this._el = null;
  },

  mount() {
    if (document.getElementById(STRIP_ID)) return;
    const strip = document.createElement("div");
    strip.id = STRIP_ID;
    strip.classList.add("sde-strip");

    const iface = document.getElementById("interface");
    if (iface) iface.prepend(strip);
    else document.getElementById("ui-top")?.prepend(strip);

    this._el = strip;
    this._attachDelegatedEvents();
    this.queueRender();
    this._updateBounds();
  },

  queueRender() {
    if (this._renderQueued) return;
    this._renderQueued = true;
    requestAnimationFrame(() => {
      this._renderQueued = false;
      this.render();
    });
  },

  async render() {
    if (!this._el) return;

    const mode = CrawlState.mode;
    const isGM = game.user.isGM;

    if (mode === "off" && !isGM) {
      this._el.style.display = "none";
      return;
    }
    this._el.style.display = "";

    const ctx = {
      mode,
      isGM,
      crawlTurn: CrawlState.crawlTurn,
      round: game.combat?.round ?? 0,
      turn: (game.combat?.turn ?? -1) + 1,
      turns: game.combat?.turns?.length ?? 0,
    };

    const r = (typeof renderTemplate === "function")
      ? renderTemplate
      : foundry.applications.handlebars.renderTemplate;
    const html = await r(TEMPLATE, ctx);
    this._el.innerHTML = html;
  },

  _attachDelegatedEvents() {
    this._el.addEventListener("click", async (ev) => {
      const btn = ev.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      switch (action) {
        case "startCrawl":    return CrawlState.startCrawl();
        case "endCrawl":      return CrawlState.endCrawl();
        case "nextCrawlTurn": return CrawlState.nextCrawlTurn();
      }
    });
  },

  _updateBounds() {
    if (!this._el) return;
    const sceneNav = document.getElementById("scene-navigation");
    const sidebar = document.getElementById("sidebar");
    const navWidth = sceneNav?.getBoundingClientRect()?.width ?? 0;
    const sidebarWidth = sidebar?.getBoundingClientRect()?.width ?? 0;
    this._el.style.left = `${Math.max(0, navWidth + 8)}px`;
    this._el.style.right = `${Math.max(0, sidebarWidth + 8)}px`;
  },
};
