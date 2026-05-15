/**
 * Shadowdark Enhancer — Crawl Bar
 *
 * Persistent bottom bar (GM only) sitting above the macro bar.
 * Faithful port of vagabond-crawler/scripts/crawl-bar.mjs, adapted to the
 * simpler Shadowdark CrawlState (no heroes/gm phase split — single crawl
 * turn counter).
 *
 * M2-roadmap buttons (Encounter, Lights, Rest, Forge & Loot) are rendered
 * but dimmed via the `.sde-bar-disabled` class — clicking shows a notification.
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

  init() {
    if (!game.user.isGM) return;
    this.mount();
    const queue = () => this.render();
    this._hookIds.push(Hooks.on(CrawlState.HOOK_CHANGED, queue));
    this._hookIds.push(Hooks.on("combatStart",   queue));
    this._hookIds.push(Hooks.on("createCombat",  queue));
    this._hookIds.push(Hooks.on("deleteCombat",  queue));
    this._hookIds.push(Hooks.on("updateCombat",  queue));
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
    for (const id of this._hookIds) Hooks.off(id);
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

        <button class="sde-bar-btn" data-action="addSelectedTokens" title="Add selected tokens to the combat tracker">
          ${ICONS.addTokens} Add Tokens
        </button>
        <button class="sde-bar-btn sde-bar-combat-btn" data-action="startCombat">
          ${ICONS.combat} Combat
        </button>

        <div class="sde-bar-divider"></div>

        <button class="sde-bar-btn sde-bar-disabled" data-action="m2Placeholder" data-feature="Encounter" title="Coming in a later milestone">
          ${ICONS.encounter} Encounter
        </button>
        <button class="sde-bar-btn sde-bar-disabled" data-action="m2Placeholder" data-feature="Lights" title="Coming in a later milestone">
          ${ICONS.lights} Lights
        </button>
        <button class="sde-bar-btn sde-bar-disabled" data-action="m2Placeholder" data-feature="Rest" title="Coming in a later milestone">
          ${ICONS.rest} Rest
        </button>
        <button class="sde-bar-btn sde-bar-disabled" data-action="m2Placeholder" data-feature="Forge & Loot" title="Coming in a later milestone">
          <i class="fas fa-hammer"></i> Forge &amp; Loot
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
    });
  },

  async _onAction(action, el, ev) {
    switch (action) {

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

      case "m2Placeholder":
        ui.notifications.info(`${el.dataset.feature ?? "Feature"}: coming in a later milestone.`);
        break;
    }
  },

  async _addSelectedTokens() {
    const selected = canvas.tokens?.controlled ?? [];
    if (!selected.length) {
      ui.notifications.warn("Select tokens first.");
      return;
    }
    if (!game.combat) {
      ui.notifications.warn("No active combat. Click Combat to start one first.");
      return;
    }
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
