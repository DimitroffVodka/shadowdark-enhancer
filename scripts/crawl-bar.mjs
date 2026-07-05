/**
 * Shadowdark Enhancer — Crawl Bar
 *
 * Persistent bottom bar (GM only) sitting above the macro bar.
 * Faithful port of vagabond-crawler/scripts/crawl-bar.mjs, adapted to the
 * simpler Shadowdark CrawlState (no heroes/gm phase split — single crawl
 * turn counter).
 */

import { MODULE_ID }       from "./module-id.mjs";
import { CrawlState }      from "./crawl-state.mjs";
import { MovementTracker } from "./movement-tracker.mjs";
import { ICONS }           from "./icons.mjs";
import { CrawlStrip }      from "./crawl-strip.mjs";

const BAR_ID = "shadowdark-enhancer-bar";

export const CrawlBar = {

  _el: null,
  _hookIds: [],
  _renderQueued: false,

  init() {
    if (!game.user.isGM) return;
    this.mount();
    const queue = () => this.queueRender();
    // [event, id] pairs — Hooks.off requires the event name (bare id is a
    // silent no-op in v14), so destroy() can actually detach.
    const on = (ev, fn) => this._hookIds.push([ev, Hooks.on(ev, fn)]);
    on(CrawlState.HOOK_CHANGED, queue);
    on("combatStart",   queue);
    on("createCombat",  queue);
    on("deleteCombat",  queue);
    on("updateCombat",  queue);
  },

  /**
   * Microtask-debounced render: combat hooks (updateCombat/updateCombatant)
   * fire in bursts — e.g. rolling initiative for a whole party — and each one
   * rebuilds the bar's innerHTML. Coalescing a synchronous burst into one
   * render mirrors CrawlStrip.queueRender.
   */
  queueRender() {
    if (this._renderQueued) return;
    this._renderQueued = true;
    Promise.resolve().then(() => {
      this._renderQueued = false;
      this.render();
    });
  },

  mount() {
    if (document.getElementById(BAR_ID)) {
      this._el = document.getElementById(BAR_ID);
      this.render();
      return;
    }
    const bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.classList.add("shadowdark-enhancer-bar");

    // Append to #ui-middle as last flex child — natural block flow.
    // #ui-bottom gets flex-shrink so it compresses to give us room.
    const uiMiddle = document.getElementById("ui-middle");
    const uiBottom = document.getElementById("ui-bottom");
    if (uiBottom) {
      uiBottom.style.flexShrink = "1";
      uiBottom.style.minHeight  = "0";
    }
    if (uiMiddle) {
      uiMiddle.appendChild(bar);
    } else {
      document.body.appendChild(bar);
    }

    this._el = bar;
    this.render();
  },

  destroy() {
    for (const [ev, id] of this._hookIds) Hooks.off(ev, id);
    this._hookIds = [];
    this._el?.remove();
    this._el = null;
  },

  render() {
    if (!this._el) return;
    const state = CrawlState;

    // OFF state — single "Start Crawl" button
    if (!state.isActive) {
      this._el.innerHTML = `
        <div class="sde-bar-inner sde-bar-inactive">
          <button class="sde-bar-btn sde-bar-start-btn" data-action="startCrawl">
            ${ICONS.startCrawl} Start Crawl
          </button>
        </div>`;
      this._bindEvents();
      return;
    }

    // COMBAT state
    if (state.mode === "combat") {
      const combatStarted = game.combat?.started ?? false;
      this._el.innerHTML = `
        <div class="sde-bar-inner">
          ${combatStarted
            ? `<button class="sde-bar-btn sde-bar-danger-btn" data-action="endEncounter">${ICONS.close} End Encounter</button>`
            : `<button class="sde-bar-btn sde-bar-combat-btn" data-action="beginEncounter">${ICONS.combat} Begin Encounter</button>`
          }
          <div class="sde-bar-divider"></div>
          <button class="sde-bar-btn" data-action="addSelectedTokens" title="Add selected tokens to the combat tracker">
            ${ICONS.addTokens} Add Tokens
          </button>
          <button class="sde-bar-btn sde-bar-danger-btn" data-action="deleteEncounter" title="Delete the combat encounter without ending it">
            ${ICONS.close} Delete Encounter
          </button>
        </div>`;
      this._bindEvents();
      return;
    }

    // CRAWL state — single phase, just turn counter + next button
    this._el.innerHTML = `
      <div class="sde-bar-inner sde-bar-active">

        <span class="sde-bar-phase-badge sde-bar-phase-crawl">
          ${ICONS.startCrawl} Crawl · Turn ${state.crawlTurn}
        </span>
        <button class="sde-bar-btn sde-bar-next-btn" data-action="nextCrawlTurn">
          ${ICONS.nextTurn} Next Turn
        </button>
        <div class="sde-bar-divider"></div>

        <button class="sde-bar-btn" data-action="addSelectedTokens" title="Left-click: add selected tokens to the crawl · Right-click: reset out-of-combat initiative">
          ${ICONS.addTokens} Add Tokens
        </button>
        <button class="sde-bar-btn sde-bar-combat-btn" data-action="startCombat">
          ${ICONS.combat} Combat
        </button>

        <div class="sde-bar-divider"></div>

        <button class="sde-bar-btn" data-action="encounter" title="Left-click: open Encounter Roller · Right-click: menu">
          ${ICONS.encounter} Encounter
        </button>
        <button class="sde-bar-btn" data-action="loot" title="Loot Generator · Magic Item Forge · Merchant Shop">
          <i class="fas fa-hammer"></i> Forge &amp; Loot
        </button>
        <button class="sde-bar-btn" data-action="rollTables" title="Importer — paste a PDF dump; manage tables &amp; monsters">
          <i class="fas fa-file-import"></i> Importer
        </button>
        <button class="sde-bar-btn sde-bar-danger-btn" data-action="endCrawl">
          ${ICONS.close} End
        </button>

      </div>`;

    this._bindEvents();
  },

  _bindEvents() {
    if (!this._el) return;
    this._el.querySelectorAll("[data-action]").forEach(el => {
      el.addEventListener("click", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        this._onAction(el.dataset.action, el, ev);
      });

      // Right-click for Encounter
      if (el.dataset.action === "encounter") {
        el.addEventListener("contextmenu", ev => {
          ev.preventDefault();
          ev.stopPropagation();
          this._onEncounterContextMenu(el, ev);
        });
      }

      // Right-click for Add Tokens (crawl utility menu)
      if (el.dataset.action === "addSelectedTokens") {
        el.addEventListener("contextmenu", ev => {
          if (CrawlState.mode !== "crawl") return;
          ev.preventDefault();
          ev.stopPropagation();
          this._onAddTokensContextMenu(el, ev);
        });
      }

      // Drag-drop for RollTable (Encounter button)
      if (el.dataset.action === "encounter") {
        el.addEventListener("dragover", ev => {
          ev.preventDefault();
          el.classList.add("sde-drag-over");
        });
        el.addEventListener("dragleave", () => el.classList.remove("sde-drag-over"));
        el.addEventListener("drop", async ev => {
          ev.preventDefault();
          el.classList.remove("sde-drag-over");
          const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
          if (data.type === "RollTable") {
            const table = await fromUuid(data.uuid);
            if (table) {
              await game.shadowdarkEnhancer.encounter.setActiveTable(table.uuid);
              ui.notifications.info(`Active encounter table set to: ${table.name}`);
            }
          }
        });
      }

      // Right-click for Forge & Loot
      if (el.dataset.action === "loot") {
        el.addEventListener("contextmenu", ev => {
          ev.preventDefault();
          ev.stopPropagation();
          this._onLootContextMenu(el, ev);
        });
      }
    });
  },

  async _onAction(action, el, ev) {
    switch (action) {

      case "encounter":
        game.shadowdarkEnhancer.encounter.openRoller("tables");
        break;

      case "startCrawl":
        await CrawlState.startCrawl();
        this.render();
        CrawlStrip.render();
        break;

      case "endCrawl": {
        const ok = await this._confirm("End Crawl", "End crawl mode?");
        if (ok) {
          await CrawlState.endCrawl();
          this.render();
          CrawlStrip.render();
        }
        break;
      }

      case "nextCrawlTurn":
        await CrawlState.nextCrawlTurn();
        this.render();
        CrawlStrip.render();
        break;

      case "resetOocInit":
        await CrawlState.clearOocInitiative();
        this.render();
        CrawlStrip.render();
        break;

      case "startCombat":
        await this._startCombat();
        break;

      case "beginEncounter":
        if (game.combat && !game.combat.started) {
          await game.combat.startCombat();
        }
        this.render();
        break;

      case "endEncounter":
        if (game.combat) {
          await game.combat.endCombat();
        }
        break;

      case "deleteEncounter":
        if (game.combat) {
          const ok = await this._confirm("Delete Encounter", "Delete this combat encounter? This will not trigger the end-of-combat flow.");
          if (ok) {
            await game.combat.delete();
            this.render();
            CrawlStrip.render();
          }
        }
        break;

      case "addSelectedTokens":
        await this._addSelectedTokens();
        break;

      case "loot":
        // Left-click opens the Forge & Loot menu (Loot Generator | Magic Item Forge).
        this._onLootContextMenu(el, ev);
        break;

      case "rollTables":
        // The Importer button is the hub's front door — land on the Import
        // tab (D-01). Bare openHub() keeps its legacy dashboard mapping for
        // old callers.
        game.shadowdarkEnhancer.tables.openHub("import");
        break;

      case "recap":
        game.shadowdarkEnhancer.recap.open();
        break;
    }
  },

  _onAddTokensContextMenu(el, ev) {
    if (!game.user.isGM || CrawlState.mode !== "crawl") return;

    const existing = document.getElementById("sde-add-tokens-context-menu");
    if (existing) { existing.remove(); return; }

    const hasInit = Object.keys(CrawlState.oocInitiative ?? {}).length > 0;
    const menu = document.createElement("div");
    menu.id = "sde-add-tokens-context-menu";
    menu.className = "sde-bar-context-menu";
    menu.innerHTML = `
      <div class="sde-menu-header">Add Tokens</div>
      <div class="sde-menu-item sde-menu-btn ${hasInit ? "" : "sde-menu-disabled"}"
           data-addtokens-action="resetOocInit" role="menuitem" tabindex="0"
           aria-disabled="${hasInit ? "false" : "true"}"
           title="${hasInit ? "Clear all out-of-combat initiative rolls" : "No out-of-combat initiative rolls to clear"}">
        ${ICONS.diceD20} Reset Initiative
      </div>
    `;

    const rect = el.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.bottom = `${window.innerHeight - rect.top + 5}px`;

    document.body.appendChild(menu);
    menu.setAttribute("role", "menu");

    menu.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.stopPropagation(); menu.remove(); return; }
      if (e.key === "Enter" || e.key === " ") {
        const t = e.target.closest("[data-addtokens-action]");
        if (t) { e.preventDefault(); t.click(); }
      }
    });
    menu.querySelector("[data-addtokens-action]")?.focus();

    menu.addEventListener("click", async e => {
      e.stopPropagation();
      const target = e.target.closest("[data-addtokens-action]");
      if (!target || target.classList.contains("sde-menu-disabled")) return;
      if (target.dataset.addtokensAction === "resetOocInit") {
        await CrawlState.clearOocInitiative();
        this.render();
        CrawlStrip.render();
      }
      menu.remove();
    });

    const close = () => {
      menu.remove();
      document.removeEventListener("click", close);
    };
    setTimeout(() => document.addEventListener("click", close), 10);
  },

  _onEncounterContextMenu(el, ev) {
    if (!game.user.isGM) return;

    const threshold = game.shadowdarkEnhancer.encounter.getThreshold();
    const tableUuid = game.settings.get(MODULE_ID, "encounterTableUuid");
    const tableName = tableUuid ? (fromUuidSync(tableUuid)?.name ?? "(deleted table)") : "(none)";

    const menu = document.createElement("div");
    menu.id = "sde-encounter-context-menu";
    menu.className = "sde-bar-context-menu";
    menu.innerHTML = `
      <div class="sde-menu-item sde-menu-btn" data-action="check" role="menuitem" tabindex="0">
        <i class="fas fa-dice-d6"></i> Encounter Check
      </div>
      <div class="sde-menu-divider"></div>
      <div class="sde-menu-header">Threshold (current: ${threshold} in 6)</div>
      ${[1, 2, 3, 4, 5].map(n => `
        <div class="sde-menu-item sde-menu-radio" data-action="setThreshold" data-value="${n}" role="menuitemradio" aria-checked="${threshold === n}" tabindex="0">
          <i class="far ${threshold === n ? "fa-dot-circle" : "fa-circle"}"></i> ${n} in 6 ${n === 1 ? "(RAW default)" : ""}
        </div>
      `).join("")}
      <div class="sde-menu-divider"></div>
      <div class="sde-menu-item sde-menu-table">
        Active Table: <span class="sde-table-name">${tableName}</span>
        ${tableUuid ? `<i class="fas fa-times sde-clear-table" data-action="clearTable" title="Clear active table" role="button" tabindex="0" aria-label="Clear active table"></i>` : ""}
      </div>
    `;

    // Position menu above button
    const rect = el.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.bottom = `${window.innerHeight - rect.top + 5}px`;

    document.body.appendChild(menu);
    menu.setAttribute("role", "menu");

    // Keyboard: Escape closes; Enter/Space activates the focused item.
    menu.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.stopPropagation(); menu.remove(); return; }
      if (e.key === "Enter" || e.key === " ") {
        const t = e.target.closest("[data-action]");
        if (t) { e.preventDefault(); t.click(); }
      }
    });
    menu.querySelector("[data-action]")?.focus();

    // Event listeners for menu
    menu.addEventListener("click", async e => {
      e.stopPropagation();
      const target = e.target.closest("[data-action]");
      if (!target) return;

      const action = target.dataset.action;
      if (action === "check") {
        await game.shadowdarkEnhancer.encounter.check();
        menu.remove();
      } else if (action === "setThreshold") {
        const val = parseInt(target.dataset.value);
        await game.shadowdarkEnhancer.encounter.setThreshold(val);
        menu.remove();
      } else if (action === "clearTable") {
        await game.shadowdarkEnhancer.encounter.setActiveTable(null);
        ui.notifications.info("Active encounter table cleared.");
        menu.remove();
      }
    });

    // Close on click outside
    const close = () => {
      menu.remove();
      document.removeEventListener("click", close);
    };
    setTimeout(() => document.addEventListener("click", close), 10);
  },

  _onLootContextMenu(el, ev) {
    if (!game.user.isGM) return;

    const existing = document.getElementById("sde-loot-context-menu");
    if (existing) { existing.remove(); return; }

    const menu = document.createElement("div");
    menu.id = "sde-loot-context-menu";
    menu.className = "sde-bar-context-menu";
    menu.innerHTML = `
      <div class="sde-menu-item sde-menu-btn" data-loot-action="lootGen" role="menuitem" tabindex="0">
        <i class="fas fa-coins"></i> Loot Generator
      </div>
      <div class="sde-menu-item sde-menu-btn" data-loot-action="magicForge" role="menuitem" tabindex="0">
        <i class="fas fa-hammer"></i> Magic Item Forge
      </div>
      <div class="sde-menu-item sde-menu-btn" data-loot-action="merchant" role="menuitem" tabindex="0">
        <i class="fas fa-store"></i> Merchant Shop
      </div>
      <div class="sde-menu-divider"></div>
      <div class="sde-menu-item sde-menu-btn" data-loot-action="partyXp" role="menuitem" tabindex="0">
        <i class="fas fa-star"></i> Party XP
      </div>
      <div class="sde-menu-item sde-menu-btn" data-loot-action="recap" role="menuitem" tabindex="0">
        <i class="fas fa-scroll"></i> Session Recap
      </div>
    `;

    // Position menu above button
    const rect = el.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.bottom = `${window.innerHeight - rect.top + 5}px`;

    document.body.appendChild(menu);
    menu.setAttribute("role", "menu");

    // Keyboard: Escape closes; Enter/Space activates the focused item.
    menu.addEventListener("keydown", e => {
      if (e.key === "Escape") { e.stopPropagation(); menu.remove(); return; }
      if (e.key === "Enter" || e.key === " ") {
        const t = e.target.closest("[data-loot-action]");
        if (t) { e.preventDefault(); t.click(); }
      }
    });
    menu.querySelector("[data-loot-action]")?.focus();

    menu.addEventListener("click", e => {
      e.stopPropagation();
      const target = e.target.closest("[data-loot-action]");
      if (!target) return;
      if (target.dataset.lootAction === "lootGen") game.shadowdarkEnhancer.loot.open();
      if (target.dataset.lootAction === "magicForge") game.shadowdarkEnhancer.forge.open();
      if (target.dataset.lootAction === "merchant") game.shadowdarkEnhancer.merchant.openLocally();
      if (target.dataset.lootAction === "partyXp") game.shadowdarkEnhancer.partyXp.open();
      if (target.dataset.lootAction === "recap") game.shadowdarkEnhancer.recap.open();
      menu.remove();
    });

    const close = () => {
      menu.remove();
      document.removeEventListener("click", close);
    };
    setTimeout(() => document.addEventListener("click", close), 10);
  },

  async _addSelectedTokens() {
    const selected = canvas.tokens?.controlled ?? [];
    if (!selected.length) {
      ui.notifications.warn("Select tokens first.");
      return;
    }

    // In combat mode: add to the combat tracker (Vagabond behavior).
    if (CrawlState.mode === "combat" && game.combat) {
      const existing = new Set(game.combat.combatants.map(c => c.tokenId));
      const docs = selected.map(t => t.document).filter(td => !existing.has(td.id));
      if (!docs.length) {
        ui.notifications.info("Selected tokens already in combat.");
        return;
      }
      await TokenDocument.implementation.createCombatants(docs);
      ui.notifications.info(`Added ${docs.length} token(s) to combat.`);
      this.render();
      CrawlStrip.render();
      return;
    }

    // In crawl mode: add to CrawlState.members (opt-in roster, not auto).
    if (CrawlState.mode === "crawl") {
      const pcTokenIds = selected
        .filter(t => t.actor?.type === "Player")
        .map(t => t.document.id);
      const skipped = selected.length - pcTokenIds.length;
      if (!pcTokenIds.length) {
        ui.notifications.warn("Select Player tokens to add to the crawl.");
        return;
      }
      const before = new Set(CrawlState.members);
      await CrawlState.addMembers(pcTokenIds);
      const added = pcTokenIds.filter(id => !before.has(id)).length;
      const dup = pcTokenIds.length - added;
      const parts = [];
      if (added) parts.push(`Added ${added}`);
      if (dup) parts.push(`${dup} already in roster`);
      if (skipped) parts.push(`${skipped} non-PC skipped`);
      ui.notifications.info(parts.join(" • ") || "No changes.");
      return;
    }

    ui.notifications.warn("Start a Crawl or Combat first.");
  },

  async _startCombat() {
    const scene = canvas.scene;
    if (!scene) {
      ui.notifications.warn("No active scene.");
      return;
    }

    // Create combat if none exists — CrawlState transitions to "combat" via the
    // combatStart / createCombat hook in CrawlState.init().
    let combat = game.combat;
    if (!combat) combat = await Combat.create({ scene: scene.id });
    if (combat.active === false) await combat.activate();

    // Add all PC tokens from the scene + selected tokens, deduped.
    const existing = new Set(combat.combatants.map(c => c.tokenId));
    const tokenDocs = new Map();
    for (const t of scene.tokens) {
      if (t.actor?.type !== "Player") continue;
      if (existing.has(t.id)) continue;
      tokenDocs.set(t.id, t);
    }
    for (const t of canvas.tokens?.controlled ?? []) {
      if (existing.has(t.id)) continue;
      tokenDocs.set(t.id, t.document);
    }

    if (tokenDocs.size > 0) {
      await TokenDocument.implementation.createCombatants([...tokenDocs.values()]);
    }

    ui.combat?.render(true);
    this.render();
    CrawlStrip.render();
  },

  async _confirm(title, content) {
    // Foundry v13/14 — DialogV2.confirm preferred when available; fall back to Dialog.
    const dlgV2 = foundry?.applications?.api?.DialogV2;
    if (dlgV2?.confirm) {
      return await dlgV2.confirm({
        window: { title },
        content: `<p>${content}</p>`,
        rejectClose: false,
      });
    }
    return await new Promise((resolve) => {
      new Dialog({
        title,
        content: `<p>${content}</p>`,
        buttons: {
          yes: { label: "Yes", callback: () => resolve(true) },
          no:  { label: "No",  callback: () => resolve(false) },
        },
        default: "no",
        close: () => resolve(false),
      }).render(true);
    });
  },
};
