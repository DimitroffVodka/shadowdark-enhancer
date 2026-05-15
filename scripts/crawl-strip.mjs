import { MODULE_ID } from "./module-id.mjs";
import { CrawlState } from "./crawl-state.mjs";
import { hpPanel }       from "./stat-panels/hp-panel.mjs";
import { movementPanel } from "./stat-panels/movement-panel.mjs";
import { luckPanel }     from "./stat-panels/luck-panel.mjs";

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

    this._hookIds.push(Hooks.on("updateActor",  () => this.queueRender()));
    this._hookIds.push(Hooks.on("updateToken",  () => this.queueRender()));
    this._hookIds.push(Hooks.on("createToken",  () => this.queueRender()));
    this._hookIds.push(Hooks.on("deleteToken",  () => this.queueRender()));
    this._hookIds.push(Hooks.on("canvasReady",  () => this.queueRender()));

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
    // Microtask-based debounce: coalesces synchronous bursts (e.g. combatStart
    // + stateChanged firing in the same tick) into a single render. We avoid
    // requestAnimationFrame here because Foundry's canvas pauses rAF callbacks
    // when the scene is idle, which can leave the strip stuck on an empty
    // first render at world load.
    if (this._renderQueued) return;
    this._renderQueued = true;
    Promise.resolve().then(() => {
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

    const cardsRow = this._el.querySelector(".sde-strip-cards");
    if (cardsRow) {
      if (mode === "crawl") {
        cardsRow.innerHTML = this._buildCrawlCards();
      } else {
        cardsRow.innerHTML = "";
      }
    }
  },

  _buildCrawlCards() {
    const tokens = canvas.scene?.tokens?.contents ?? [];
    const playerEntries = tokens
      .map(t => ({ token: t, actor: t.actor }))
      .filter(({ actor }) => actor?.type === "Player");

    const ooc = CrawlState.oocInitiative;

    const sorted = playerEntries.sort((a, b) => {
      const ai = ooc[a.token.id]?.roll;
      const bi = ooc[b.token.id]?.roll;
      if (ai != null && bi != null) return bi - ai;   // both rolled → desc
      if (ai != null)              return -1;
      if (bi != null)              return 1;
      return (a.actor.name ?? "").localeCompare(b.actor.name ?? "");
    });

    const budget = game.settings.get(MODULE_ID, "oocMovementBudget");

    return sorted.map(({ token, actor }) => {
      const init = ooc[token.id]?.roll;
      const initStr = (init == null) ? "—" : init;
      return `
        <div class="sde-card" data-token-id="${token.id}" data-actor-id="${actor.id}">
          <div class="sde-card-name">
            <img class="sde-portrait" src="${actor.img}" alt="" />
            <span>${actor.name}</span>
          </div>
          ${hpPanel.render(actor)}
          ${movementPanel.render(actor, { mode: "crawl", used: 0, budget })}
          ${luckPanel.render(actor)}
          <span class="sde-cell sde-init">Init ${initStr}</span>
        </div>
      `;
    }).join("");
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
