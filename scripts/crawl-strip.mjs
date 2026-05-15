import { MODULE_ID } from "./module-id.mjs";
import { CrawlState } from "./crawl-state.mjs";
import { hpPanel }       from "./stat-panels/hp-panel.mjs";
import { movementPanel } from "./stat-panels/movement-panel.mjs";
import { luckPanel }     from "./stat-panels/luck-panel.mjs";
import { InitiativeManager } from "./initiative-manager.mjs";
import { MovementTracker } from "./movement-tracker.mjs";
import { NpcActionMenu } from "./npc-action-menu.mjs";
import { esc } from "./util/esc.mjs";

const TOP_STRIP_ID    = "shadowdark-enhancer-top-strip";
const BOTTOM_STRIP_ID = "shadowdark-enhancer-bottom-strip";
const BOTTOM_TEMPLATE = `modules/${MODULE_ID}/templates/bottom-strip.hbs`;

export const CrawlStrip = {
  _top: null,
  _bottom: null,
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

    this._hookIds.push(Hooks.on("combatTurn", () => NpcActionMenu.close()));

    this._resizeListener = () => this._updateBounds();
    window.addEventListener("resize", this._resizeListener);
  },

  dispose() {
    for (const id of this._hookIds) Hooks.off(id);
    this._hookIds = [];
    if (this._resizeListener) window.removeEventListener("resize", this._resizeListener);
    this._resizeListener = null;
    this._top?.remove();
    this._bottom?.remove();
    this._top = null;
    this._bottom = null;
  },

  mount() {
    const iface = document.getElementById("interface") ?? document.getElementById("ui-top");
    if (!iface) return;

    // Top strip first so it precedes the bottom strip in DOM tab order.
    if (!document.getElementById(TOP_STRIP_ID)) {
      const top = document.createElement("div");
      top.id = TOP_STRIP_ID;
      top.classList.add("sde-top-strip");
      iface.prepend(top);
      this._top = top;
    } else {
      this._top = document.getElementById(TOP_STRIP_ID);
    }

    if (!document.getElementById(BOTTOM_STRIP_ID)) {
      const bottom = document.createElement("div");
      bottom.id = BOTTOM_STRIP_ID;
      bottom.classList.add("sde-bottom-strip");
      iface.append(bottom);
      this._bottom = bottom;
    } else {
      this._bottom = document.getElementById(BOTTOM_STRIP_ID);
    }

    this._attachDelegatedEvents(this._top);
    this._attachDelegatedEvents(this._bottom);
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
    if (!this._top || !this._bottom) return;

    const mode = CrawlState.mode;
    const isGM = game.user.isGM;

    // Bottom strip is always shown for GMs (so they can Start Crawl in off mode).
    // For non-GMs in off mode, hide the bottom strip entirely.
    if (mode === "off" && !isGM) {
      this._bottom.style.display = "none";
    } else {
      this._bottom.style.display = "";
    }

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
    const bottomHTML = await r(BOTTOM_TEMPLATE, ctx);
    this._bottom.innerHTML = bottomHTML;

    // Top strip: built imperatively. Hidden in off mode or when there is nothing to show.
    const topHTML = this._buildTopStripHTML();
    if (topHTML == null) {
      this._top.style.display = "none";
      this._top.innerHTML = "";
    } else {
      this._top.style.display = "";
      this._top.innerHTML = topHTML;
    }
  },

  _buildTopStripHTML() {
    const mode = CrawlState.mode;
    if (mode === "off") return null;

    if (mode === "crawl") {
      const heroes = this._buildCrawlCards();
      if (!heroes) return null;
      return `
        <div class="sde-section sde-section-heroes"><span class="sde-section-label">HEROES</span></div>
        <div class="sde-cards-row">${heroes}</div>
      `;
    }

    if (mode === "combat") {
      const { heroesHTML, npcsHTML } = this._buildCombatCardsGrouped();
      if (!heroesHTML && !npcsHTML) return null;
      const round = game.combat?.round ?? 0;
      const badge = game.combat ? `<div class="sde-round-badge">${round}</div>` : "";
      const heroesBlock = heroesHTML
        ? `<div class="sde-section sde-section-heroes"><span class="sde-section-label">HEROES</span></div>
           <div class="sde-cards-row">${heroesHTML}</div>`
        : "";
      const npcsBlock = npcsHTML
        ? `<div class="sde-section sde-section-npcs"><span class="sde-section-label">NPCs</span></div>
           <div class="sde-cards-row">${npcsHTML}</div>`
        : "";
      return `${badge}${heroesBlock}${npcsBlock}`;
    }

    return null;
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

    const budget = MovementTracker.budgetFor("crawl");

    return sorted.map(({ token, actor }) => {
      const init = ooc[token.id]?.roll;
      const initStr = (init == null) ? "—" : init;
      return `
        <div class="sde-card" data-token-id="${token.id}" data-actor-id="${actor.id}">
          <div class="sde-card-name">
            <img class="sde-portrait" src="${esc(actor.img)}" alt="" />
            <span>${esc(actor.name)}</span>
          </div>
          ${hpPanel.render(actor)}
          ${movementPanel.render(actor, { mode: "crawl", used: MovementTracker.usedFor(token, "crawl"), budget })}
          ${luckPanel.render(actor)}
          <span class="sde-cell sde-init">Init ${initStr}</span>
        </div>
      `;
    }).join("");
  },

  _buildCombatCardsGrouped() {
    const combat = game.combat;
    if (!combat) return { heroesHTML: "", npcsHTML: "" };

    const hideHidden = game.settings.get(MODULE_ID, "hideHiddenNpcCards");
    const combatMv = MovementTracker.budgetFor("combat");
    const turns = combat.turns ?? [];
    const activeId = combat.combatant?.id;

    const visible = turns.filter(c => {
      if (!hideHidden) return true;
      if (c.hidden) return false;
      if (c.token?.hidden) return false;
      return true;
    });

    const renderCard = (c) => {
      const actor = c.actor;
      if (!actor) return "";
      const tokenDoc = c.token;
      const tokenId = tokenDoc?.id ?? c.tokenId;
      const isActive = c.id === activeId ? "sde-card-active" : "";
      const init = (c.initiative != null) ? c.initiative : "—";
      return `
        <div class="sde-card ${isActive}" data-combatant-id="${c.id}" data-token-id="${tokenId}" data-actor-id="${actor.id}">
          <div class="sde-card-name">
            <img class="sde-portrait" src="${esc(actor.img)}" alt="" />
            <span>${esc(actor.name)}</span>
          </div>
          ${hpPanel.render(actor)}
          ${movementPanel.render(actor, { mode: "combat", used: MovementTracker.usedFor(tokenDoc, "combat"), budget: combatMv })}
          ${luckPanel.render(actor)}
          <span class="sde-cell sde-init">Init ${init}</span>
          ${isActive ? `<button class="sde-btn sde-hud-trigger" data-action="hudOpen">▼ HUD ▼</button>` : ""}
        </div>
      `;
    };

    const heroesHTML = visible.filter(c => c.actor?.type === "Player").map(renderCard).join("");
    const npcsHTML   = visible.filter(c => c.actor?.type !== "Player").map(renderCard).join("");
    return { heroesHTML, npcsHTML };
  },

  _attachDelegatedEvents(host) {
    host.addEventListener("click", async (ev) => {
      const btn = ev.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      switch (action) {
        case "startCrawl":    return CrawlState.startCrawl();
        case "endCrawl":      return CrawlState.endCrawl();
        case "nextCrawlTurn": return CrawlState.nextCrawlTurn();
        case "rollOocInit":   return InitiativeManager.rollOocForAll();
        case "resetOocInit":  return CrawlState.clearOocInitiative();
        case "spendLuck": {
          const actorId = btn.dataset.actorId ?? btn.closest("[data-actor-id]")?.dataset.actorId;
          const actor = game.actors.get(actorId);
          if (actor?.system?.useLuckToken) await actor.system.useLuckToken();
          return;
        }
        case "hudOpen": {
          const cardEl = btn.closest(".sde-card");
          const actorId = cardEl?.dataset.actorId;
          const tokenId = cardEl?.dataset.tokenId;
          const actor = game.actors.get(actorId);
          const tokenDoc = canvas.scene?.tokens.get(tokenId);
          if (actor && tokenDoc && cardEl) await NpcActionMenu.open(cardEl, actor, tokenDoc);
          return;
        }
        case "hudClose": return NpcActionMenu.close();
        case "hudTab": {
          const tab = btn.dataset.tab;
          if (tab) await NpcActionMenu.setTab(tab);
          return;
        }
        case "openSheet": {
          const cardEl = btn.closest(".sde-card");
          const actor = game.actors.get(cardEl?.dataset.actorId);
          actor?.sheet?.render(true);
          return;
        }
        case "hpDelta": {
          const cardEl = btn.closest(".sde-card");
          const actor = game.actors.get(cardEl?.dataset.actorId);
          const delta = Number(btn.dataset.delta ?? 0);
          if (!actor) return;
          const hp = actor.system?.attributes?.hp ?? { value: 0, max: 0 };
          const next = Math.max(0, Math.min((hp.max ?? 0), (hp.value ?? 0) + delta));
          await actor.update({ "system.attributes.hp.value": next });
          return;
        }
        case "rollbackTurn": {
          const cardEl = btn.closest(".sde-card");
          const tokenDoc = canvas.scene?.tokens.get(cardEl?.dataset.tokenId);
          if (tokenDoc) await MovementTracker.rollbackToTurnStart(tokenDoc);
          NpcActionMenu.close();
          return;
        }
      }
    });
  },

  _updateBounds() {
    const sidebar = document.getElementById("sidebar");
    const sidebarWidth = sidebar?.getBoundingClientRect()?.width ?? 0;
    const rightOffset = `${Math.max(0, sidebarWidth + 8)}px`;

    // Top strip must dodge the scene-navigation pills as well.
    if (this._top) {
      const sceneNav = document.getElementById("scene-navigation") ?? document.getElementById("navigation");
      const navRect = sceneNav?.getBoundingClientRect();
      const navBottom = navRect ? (navRect.bottom + 6) : 8;
      this._top.style.left = `8px`;
      this._top.style.right = rightOffset;
      this._top.style.top = `${navBottom}px`;
    }

    if (this._bottom) {
      this._bottom.style.left = `8px`;
      this._bottom.style.right = rightOffset;
    }
  },
};
