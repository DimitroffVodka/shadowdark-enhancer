import { MODULE_ID } from "./module-id.mjs";

const TEMPLATE = `modules/${MODULE_ID}/templates/npc-action-menu.hbs`;

export const NpcActionMenu = {
  _activeActorId: null,
  _activeTokenId: null,
  _activeTab: "status",
  _container: null,

  /**
   * Show dropdown anchored to the given card element (renders ABOVE the card).
   */
  async open(cardEl, actor, tokenDoc) {
    this.close();
    this._activeActorId = actor.id;
    this._activeTokenId = tokenDoc.id;

    const ctx = {
      actorId: actor.id,
      tokenId: tokenDoc.id,
      tab: this._activeTab,
      hp: actor.system?.attributes?.hp ?? { value: 0, max: 0 },
      hasLuck: actor.system?.hasLuckToken === true,
    };

    const renderTpl = (typeof renderTemplate === "function")
      ? renderTemplate
      : foundry.applications.handlebars.renderTemplate;
    const html = await renderTpl(TEMPLATE, ctx);

    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    const el = wrap.firstElementChild;
    cardEl.appendChild(el);
    this._container = el;

    // Delay outside-click registration so the initial click event doesn't immediately close us.
    setTimeout(() => {
      document.addEventListener("click", this._onOutsideClick, { capture: true });
    }, 0);
  },

  close() {
    if (this._container) {
      this._container.remove();
      this._container = null;
      this._activeActorId = null;
      this._activeTokenId = null;
      document.removeEventListener("click", this._onOutsideClick, { capture: true });
    }
  },

  async setTab(tab) {
    this._activeTab = tab;
    if (!this._activeActorId) return;
    const cardEl = this._container?.parentElement;
    const actor = game.actors.get(this._activeActorId);
    const tokenDoc = canvas.scene?.tokens.get(this._activeTokenId);
    if (cardEl && actor && tokenDoc) await this.open(cardEl, actor, tokenDoc);
  },

  // Arrow ensures `this` is preserved when removeEventListener is called.
  _onOutsideClick: (ev) => {
    const dropdown = NpcActionMenu._container;
    if (!dropdown) return;
    if (dropdown.contains(ev.target)) return;
    // Don't close when clicking the HUD trigger button itself (it has its own toggle logic).
    if (ev.target.closest?.('[data-action="hudOpen"]')) return;
    NpcActionMenu.close();
  },
};
