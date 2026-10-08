/**
 * Shadowdark Enhancer — Crawl Bar
 *
 * Persistent bottom bar (GM only) sitting above the macro bar.
 * Faithful port of vagabond-crawler/scripts/crawl-bar/crawl-bar.mjs, adapted to the
 * simpler Shadowdark CrawlState (no heroes/gm phase split — single crawl
 * turn counter).
 */

import { MODULE_ID }       from "../shared/module-id.mjs";
import { CrawlState }      from "../crawl-strip/crawl-state.mjs";
import { ICONS }           from "../shared/icons.mjs";
import { CrawlStrip }      from "../crawl-strip/crawl-strip.mjs";
import { isHexMapScene }   from "../encounter/encounter-terrain.mjs";
import { BASTION_TYPE } from "../bastion/bastion-art.mjs";
import { esc }             from "../shared/esc.mjs";
import { BUTTONS, barItems, overlandBadge, toolsSections } from "./crawl-bar-core.mjs";
import {
  startOverland, endOverland, rollWeather, weatherNow, weatherName, startDayFromParty, resume, overlandState, OVERLAND_CHANGED,
  askForage, forage, makeCamp,
} from "../overland/overland.mjs";
import { L as loc } from "../shared/i18n.mjs";

const BAR_ID = "shadowdark-enhancer-bar";

// How often the AUTOMATIC crawl-round encounter check runs (issue #171):
// 1 = every round, then every 2 … 10. The gate itself (`encounterCheckDue`)
// accepts any value ≥ 1; the ten choices are a menu bound, not a state rule.
const CHECK_FREQUENCY_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** "every round" / "every 3 rounds" — the header's reading of the setting. */
const frequencyLabel = (n) => (n === 1
  ? game.i18n.localize("SDE.crawlBar.encounterMenu.everyRound")
  : game.i18n.format("SDE.crawlBar.encounterMenu.everyNRounds", { n }));

/** What each Tools entry opens: the module's API (game.shadowdarkEnhancer) handed in. */
const TOOL_OPENERS = {
  // Foundry's own Roll Tables tab: the entry rolls a table, it is not the importer (that is the next one).
  rollTables:  () => { ui.sidebar?.expand?.(); ui.sidebar?.changeTab("tables", "primary"); },
  // The Importer's front door: the wizard until a first import has linked a book, then the hub's Import tab (D-01).
  importer:    (api) => api.tables.openImporter(),
  lootGen:     (api) => api.loot.open(),
  magicForge:  (api) => api.forge.open(),
  merchant:    (api) => api.merchant.openLocally(),
  partyXp:     (api) => api.partyXp.open(),
  downtime:    (api) => api.downtime.open(),
  training:    (api) => api.training.open(),
  renown:      (api) => api.renown.open(),
  recap:       (api) => api.recap.open(),
  pitFighting: (api) => api.pitFighting.open(),
  bastions:    (api) => api.bastion.openPanel(),
  // A dialog: the Tools panel is closed before it opens.
  rumors:      () => import("../rumors/rumors.mjs").then(({ askAndGive }) => askAndGive())
    .catch((err) => console.error("shadowdark-enhancer | give rumors", err)),
};

export const CrawlBar = {

  _el: null,
  _hookIds: [],
  _renderQueued: false,
  /** The weather kind the Overland badge shows, or null. */
  _weatherShown: null,
  /** The Tools panel is open. Kept here, not in the markup, so a re-render does not close it. */
  _toolsOpen: false,
  _toolsListeners: null,

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
    // The Travel button is offered only on a hex map, so it follows the scene.
    on("canvasReady",   queue);
    // ...and the Bastions button follows the world's bastions.
    on("createActor", (actor) => { if (actor.type === BASTION_TYPE) queue(); });
    on("deleteActor", (actor) => { if (actor.type === BASTION_TYPE) queue(); });
    // The Overland badge shows today's weather, which also ends at a dawn with
    // no write. The clock moves every second under real-time light tracking,
    // so re-render only when what the badge shows would change.
    on(OVERLAND_CHANGED, queue);
    on("updateWorldTime", () => { if (this._badgeWeather() !== this._weatherShown) queue(); });
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
    this._setTools(false);
    for (const [ev, id] of this._hookIds) Hooks.off(ev, id);
    this._hookIds = [];
    this._el?.remove();
    this._el = null;
  },

  /** The weather kind the Overland badge should show now. */
  _badgeWeather() {
    return CrawlState.isOverland ? weatherNow() : null;
  },

  render() {
    if (!this._el) return;
    const state = CrawlState;
    this._weatherShown = this._badgeWeather();

    // COMBAT state
    if (state.mode === "combat") {
      this._setTools(false);
      const combatStarted = game.combat?.started ?? false;
      this._el.innerHTML = `
        <div class="sde-bar-inner">
          ${combatStarted
            ? `<button class="sde-bar-btn sde-bar-danger-btn" data-action="endEncounter">${ICONS.close} ${game.i18n.localize("SDE.crawlBar.endEncounter")}</button>`
            : `<button class="sde-bar-btn sde-bar-combat-btn" data-action="beginEncounter">${ICONS.combat} ${game.i18n.localize("SDE.crawlBar.beginEncounter")}</button>`
          }
          <button class="sde-bar-btn" data-action="addSelectedTokens" title="${game.i18n.localize("SDE.crawlBar.addTokensCombatTip")}">
            ${ICONS.addTokens} ${game.i18n.localize("SDE.crawlBar.addTokens")}
          </button>
          <button class="sde-bar-btn sde-bar-danger-btn" data-action="deleteEncounter" title="${game.i18n.localize("SDE.crawlBar.deleteEncounterTip")}">
            ${ICONS.close} ${game.i18n.localize("SDE.crawlBar.deleteEncounter")}
          </button>
        </div>`;
      this._bindEvents();
      return;
    }

    // One row in every other mode. The crawl bar is ALWAYS shown (no separate
    // "Start Crawl" screen): with no session the last button reads "Start", and
    // the controls that only mean something in a session are not drawn.
    // Overland travel (#229) is a mode of its own, not a crawl; Start a crawl is
    // in its Tools panel (§4.3).
    const mode = state.mode === "overland" ? "overland" : state.isActive ? "crawl" : "off";
    const day = mode === "overland" ? overlandState() : null;
    const items = barItems({ mode, hexScene: mode === "off" && isHexMapScene(), pending: !!day?.pending });
    const hasBastion = game.actors.some((a) => a.type === BASTION_TYPE);

    const badge = () => {
      if (mode === "overland") {
        const { text, title } = overlandBadge({
          hex: day.hex, day, t: loc,
          weather: this._weatherShown ? weatherName(this._weatherShown) : null,
        });
        return `<span class="sde-bar-phase-badge sde-bar-phase-overland"${title ? ` title="${esc(title)}"` : ""}>${ICONS.walking} ${esc(text)}</span>`;
      }
      return `<span class="sde-bar-phase-badge sde-bar-phase-crawl"${mode === "off" ? ' style="opacity:0.55"' : ""}>
          ${ICONS.startCrawl} ${loc("SDE.crawlBar.roundBadge", { turn: state.crawlTurn })}
        </span>`;
    };
    const button = (action) => {
      const b = BUTTONS[action];
      return `<button type="button" class="sde-bar-btn${b.cls ? ` ${b.cls}` : ""}" data-action="${action}"${b.tip ? ` title="${esc(loc(b.tip))}"` : ""}>${ICONS[b.icon]} ${loc(b.label)}</button>`;
    };
    const item = (id) => {
      if (id === "badge") return badge();
      if (id === "spacer") return `<span class="sde-bar-gap"></span>`;
      if (id === "tools") return this._toolsHtml(toolsSections({ mode, hasBastion }), loc);
      return button(id);
    };

    this._el.innerHTML = `<div class="sde-bar-inner sde-bar-active">${items.map(item).join("")}</div>`;
    this._bindEvents();
    if (this._toolsOpen) this._keepToolsOnScreen();
  },

  /**
   * The Tools button and its panel: every tool, grouped under a name, opening
   * upward. The panel is always in the markup (hidden while closed) so a
   * re-render mid-session keeps it open.
   */
  _toolsHtml(sections, loc) {
    const open = this._toolsOpen;
    const entry = (e) => {
      const disabled = e.action === "resetOocInit" && !Object.keys(CrawlState.oocInitiative ?? {}).length;
      const tip = e.action === "resetOocInit"
        ? loc(disabled ? "SDE.crawlBar.addTokensMenu.resetInitNoneTip" : "SDE.crawlBar.addTokensMenu.resetInitTip")
        : e.tip ? loc(e.tip) : "";
      const button = `<button type="button" class="sde-bar-btn" role="menuitem" data-action="${e.action}"${tip ? ` title="${esc(tip)}"` : ""}${disabled ? " disabled" : ""}>${ICONS[e.icon]} ${loc(e.label)}</button>`;
      // Encounter's right-click menu has no keyboard or touch way in, so its
      // options also open from a button beside it.
      return e.action === "encounter"
        ? `<span class="sde-bar-split">${button}<button type="button" class="sde-bar-btn" role="menuitem" data-action="encounterMenu" aria-haspopup="menu" title="${esc(loc("SDE.crawlBar.encounterOptionsTip"))}" aria-label="${esc(loc("SDE.crawlBar.encounterOptions"))}">${ICONS.encounterOptions}</button></span>`
        : button;
    };
    return `<div class="sde-bar-tools">
      <button type="button" class="sde-bar-btn sde-bar-tools-btn" data-action="tools" aria-haspopup="menu" aria-expanded="${open}" aria-controls="sde-bar-tools-menu" title="${esc(loc("SDE.crawlBar.toolsTip"))}">${ICONS.tools} ${loc("SDE.crawlBar.toolsButton")} ${ICONS.caretUp}</button>
      <div class="sde-bar-menu" id="sde-bar-tools-menu" role="menu" aria-label="${esc(loc("SDE.crawlBar.toolsMenu.aria"))}"${open ? "" : " hidden"}>
        ${sections.map((sec) => `<section role="group" aria-labelledby="sde-bar-menu-${sec.id}">
          <h4 id="sde-bar-menu-${sec.id}">${loc(sec.label)}</h4>
          <div class="sde-bar-menu-row">${sec.entries.map(entry).join("")}</div>
        </section>`).join("")}
      </div>
    </div>`;
  },

  /**
   * Open or close the Tools panel. Open, it closes on a press outside it or
   * Escape (focus goes back to the Tools button), arrow keys move between its
   * entries, and Tab out of it closes it.
   * @param {boolean} open
   * @param {{focusFirst?:boolean, refocus?:boolean}} [opts]  focus the first entry; focus the Tools button
   */
  _setTools(open, { focusFirst = false, refocus = false } = {}) {
    this._toolsListeners ??= {
      pointerdown: (ev) => { if (!ev.target.closest?.(".sde-bar-tools")) this._setTools(false); },
      keydown: (ev) => this._onToolsKey(ev),
    };
    for (const [type, fn] of Object.entries(this._toolsListeners)) {
      document.removeEventListener(type, fn, true);
      if (open) document.addEventListener(type, fn, true);
    }
    this._toolsOpen = open;
    const wrap = this._el?.querySelector(".sde-bar-tools");
    const toggle = wrap?.querySelector(".sde-bar-tools-btn");
    const menu = wrap?.querySelector(".sde-bar-menu");
    if (menu) menu.hidden = !open;
    toggle?.setAttribute("aria-expanded", String(open));
    if (open) this._keepToolsOnScreen();
    if (open && focusFirst) menu?.querySelector("button:not([disabled])")?.focus();
    if (!open && refocus) toggle?.focus();
  },

  /** The panel opens leftward from the Tools button; on a narrow window, slide it back in. */
  _keepToolsOnScreen() {
    const menu = this._el?.querySelector(".sde-bar-menu");
    if (!menu) return;
    menu.style.right = "";
    const { left } = menu.getBoundingClientRect();
    if (left < 8) menu.style.right = `${left - 8}px`;
  },

  _onToolsKey(ev) {
    const wrap = this._el?.querySelector(".sde-bar-tools");
    if (!wrap) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      this._setTools(false, { refocus: true });
      return;
    }
    const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"];
    if (!keys.includes(ev.key) || !wrap.contains(document.activeElement)) return;
    ev.preventDefault();
    const entries = [...wrap.querySelectorAll(".sde-bar-menu button:not([disabled])")];
    const at = entries.indexOf(document.activeElement);
    const forward = ev.key === "ArrowDown" || ev.key === "ArrowRight";
    const last = entries.length - 1;
    const to = ev.key === "Home" || (at < 0 && forward) ? 0
      : ev.key === "End" || (at < 0 && !forward) ? last
      : (at + (forward ? 1 : -1) + entries.length) % entries.length;
    entries[to]?.focus();
  },

  _bindEvents() {
    if (!this._el) return;
    this._el.querySelectorAll("[data-action]").forEach(el => {
      el.addEventListener("click", ev => {
        ev.preventDefault();
        ev.stopPropagation();
        // A pick from the Tools panel closes it. Detail 0 is the keyboard.
        if (el.closest(".sde-bar-menu")) this._setTools(false, { refocus: ev.detail === 0 });
        this._onAction(el.dataset.action, el, ev);
      });

      // Right-click for the Encounter options (they also open from the button beside it)
      if (el.dataset.action === "encounter") {
        el.addEventListener("contextmenu", ev => {
          ev.preventDefault();
          ev.stopPropagation();
          this._setTools(false);
          this._onAction("encounterMenu", el, ev);
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

      // Drag-drop for RollTable (Encounter entry)
      if (el.dataset.action === "encounter") {
        el.addEventListener("dragover", ev => {
          ev.preventDefault();
          el.classList.add("sde-drag-over");
        });
        el.addEventListener("dragleave", () => el.classList.remove("sde-drag-over"));
        el.addEventListener("drop", async ev => {
          ev.preventDefault();
          el.classList.remove("sde-drag-over");
          this._setTools(false);
          const data = JSON.parse(ev.dataTransfer.getData("text/plain"));
          if (data.type === "RollTable") {
            const table = await fromUuid(data.uuid);
            if (table) {
              await game.shadowdarkEnhancer.encounter.setActiveTable(table.uuid);
              ui.notifications.info(game.i18n.format("SDE.crawlBar.notify.tableSet", { name: table.name }));
            }
          }
        });
      }
    });

    // Dragging anything over the Tools button opens the panel, so a roll table
    // from the sidebar can be dropped on Encounter; the panel closes when the drag ends.
    const wrap = this._el.querySelector(".sde-bar-tools");
    wrap?.querySelector(".sde-bar-tools-btn")?.addEventListener("dragenter", () => {
      if (this._toolsOpen) return;
      this._setTools(true);
      document.addEventListener("dragend", () => this._setTools(false), { once: true });
    });
    // Tab out of the open panel closes it; ArrowDown on its button opens it.
    wrap?.addEventListener("focusout", ev => {
      if (ev.relatedTarget && !wrap.contains(ev.relatedTarget)) this._setTools(false);
    });
    wrap?.querySelector(".sde-bar-tools-btn")?.addEventListener("keydown", ev => {
      if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
      ev.preventDefault();
      this._setTools(true, { focusFirst: true });
    });
  },

  async _onAction(action, el, ev) {
    switch (action) {

      case "tools":
        this._setTools(!this._toolsOpen, { focusFirst: !this._toolsOpen && ev.detail === 0 });
        break;

      case "encounter":
        game.shadowdarkEnhancer.encounter.openRoller("tables");
        break;

      case "encounterMenu":
        // The panel is closed by now; the menu opens above the Tools button it came from.
        this._onEncounterContextMenu(this._el.querySelector(".sde-bar-tools-btn") ?? el);
        break;

      case "startTravel": {
        const started = await startOverland();
        this.render();
        CrawlStrip.render();
        // The day comes next: open Start day at once, unless a day is already open.
        if (started && !Number.isFinite(overlandState().day)) {
          const reply = await startDayFromParty();
          if (!reply?.ok && reply?.error) ui.notifications.warn(reply.error);
          this.render();
        }
        break;
      }

      case "rollWeather": {
        const reply = await rollWeather();
        if (!reply?.ok) { if (reply?.error) ui.notifications.warn(reply.error); }
        else if (!reply.rolled) {
          ui.notifications.info(game.i18n.format("SDE.overland.notify.weatherHolds",
            { date: game.shadowdarkEnhancer.time.format(reply.weather.until) }));
        }
        this.render();
        break;
      }

      case "forage": {
        const ids = await askForage();
        for (const id of ids ?? []) await forage(id);
        break;
      }

      case "makeCamp": {
        const reply = await makeCamp();
        if (!reply?.ok && reply?.error) ui.notifications.warn(reply.error);
        this.render();
        break;
      }

      case "resumeTravel": {
        const reply = await resume();
        if (!reply?.ok && reply?.error) ui.notifications.warn(reply.error);
        this.render();
        break;
      }

      case "startDay": {
        const reply = await startDayFromParty();
        if (!reply?.ok && reply?.error) ui.notifications.warn(reply.error);
        this.render();
        break;
      }

      case "endTravel":
        await endOverland();
        this.render();
        CrawlStrip.render();
        break;

      case "startCrawl":
        await CrawlState.startCrawl();
        this.render();
        CrawlStrip.render();
        break;

      case "endCrawl": {
        const ok = await this._confirm("SDE.crawlBar.confirm.endCrawlTitle", "SDE.crawlBar.confirm.endCrawl", "SDE.crawlBar.confirm.endCrawlYes", "SDE.crawlBar.confirm.endCrawlNo");
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
          const ok = await this._confirm("SDE.crawlBar.deleteEncounterTitle", "SDE.crawlBar.deleteEncounterConfirm", "SDE.crawlBar.deleteEncounterYes", "SDE.crawlBar.deleteEncounterNo");
          if (ok) {
            // Hunter, Loot drops and Session Recap skip a combat deleted with this.
            await game.combat.delete({ [MODULE_ID]: { discard: true } });
            this.render();
            CrawlStrip.render();
          }
        }
        break;

      case "addSelectedTokens":
        await this._addSelectedTokens();
        break;

      default:
        TOOL_OPENERS[action]?.(game.shadowdarkEnhancer);
    }
  },

  _onAddTokensContextMenu(el, _ev) {
    if (!game.user.isGM || CrawlState.mode !== "crawl") return;

    const existing = document.getElementById("sde-add-tokens-context-menu");
    if (existing) { existing.remove(); return; }

    const hasInit = Object.keys(CrawlState.oocInitiative ?? {}).length > 0;
    const menu = document.createElement("div");
    menu.id = "sde-add-tokens-context-menu";
    menu.className = "sde-bar-context-menu";
    menu.innerHTML = `
      <div class="sde-menu-header">${game.i18n.localize("SDE.crawlBar.addTokens")}</div>
      <div class="sde-menu-item sde-menu-btn ${hasInit ? "" : "sde-menu-disabled"}"
           data-addtokens-action="resetOocInit" role="menuitem" tabindex="0"
           aria-disabled="${hasInit ? "false" : "true"}"
           title="${game.i18n.localize(hasInit ? "SDE.crawlBar.addTokensMenu.resetInitTip" : "SDE.crawlBar.addTokensMenu.resetInitNoneTip")}">
        ${ICONS.diceD20} ${game.i18n.localize("SDE.crawlBar.addTokensMenu.resetInit")}
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

  _onEncounterContextMenu(el, _ev) {
    if (!game.user.isGM) return;

    const threshold = game.shadowdarkEnhancer.encounter.getThreshold();
    const frequency = game.shadowdarkEnhancer.encounter.getCheckFrequency();
    const tableUuid = game.settings.get(MODULE_ID, "encounterTableUuid");
    const tableName = tableUuid
      ? (fromUuidSync(tableUuid)?.name ?? game.i18n.localize("SDE.crawlBar.encounterMenu.deletedTable"))
      : game.i18n.localize("SDE.crawlBar.encounterMenu.noTable");
    const terrainCount = Object.keys(game.settings.get(MODULE_ID, "encounterTerrainTables") ?? {}).length;

    const menu = document.createElement("div");
    menu.id = "sde-encounter-context-menu";
    menu.className = "sde-bar-context-menu";
    // Interpolated values are module settings (two numbers), a fixed list of
    // frequency choices, and the active table's document name.
    menu.innerHTML = `
      <div class="sde-menu-item sde-menu-btn" data-action="check" role="menuitem" tabindex="0">
        <i class="fas fa-dice-d6"></i> ${game.i18n.localize("SDE.crawlBar.encounterMenu.check")}
      </div>
      <div class="sde-menu-divider"></div>
      <div class="sde-menu-header">${game.i18n.format("SDE.crawlBar.encounterMenu.threshold", { threshold })}</div>
      ${[1, 2, 3, 4, 5].map(n => `
        <div class="sde-menu-item sde-menu-radio" data-action="setThreshold" data-value="${n}" role="menuitemradio" aria-checked="${threshold === n}" tabindex="0">
          <i class="far ${threshold === n ? "fa-dot-circle" : "fa-circle"}"></i> ${game.i18n.format(n === 1 ? "SDE.crawlBar.encounterMenu.thresholdDefault" : "SDE.crawlBar.encounterMenu.thresholdOption", { n })}
        </div>
      `).join("")}
      <div class="sde-menu-divider"></div>
      <div class="sde-menu-header">${game.i18n.format("SDE.crawlBar.encounterMenu.frequency", { frequency: frequencyLabel(frequency) })}</div>
      <div class="sde-menu-numbers" role="group" aria-label="${game.i18n.localize("SDE.crawlBar.encounterMenu.frequencyAria")}">
        ${CHECK_FREQUENCY_CHOICES.map(n => `
          <button type="button" class="sde-menu-number ${n === frequency ? "active" : ""}" data-action="setFrequency" data-value="${n}" aria-pressed="${n === frequency}" title="${game.i18n.format("SDE.crawlBar.encounterMenu.frequencyTip", { frequency: frequencyLabel(n) })}">${n}</button>
        `).join("")}
      </div>
      <div class="sde-menu-divider"></div>
      <div class="sde-menu-item sde-menu-table">
        ${game.i18n.localize("SDE.crawlBar.encounterMenu.activeTable")} <span class="sde-table-name">${tableName}</span>
        ${tableUuid ? `<i class="fas fa-times sde-clear-table" data-action="clearTable" title="${game.i18n.localize("SDE.crawlBar.encounterMenu.clearTable")}" role="button" tabindex="0" aria-label="${game.i18n.localize("SDE.crawlBar.encounterMenu.clearTable")}"></i>` : ""}
      </div>
      <div class="sde-menu-item sde-menu-btn" data-action="terrainTables" role="menuitem" tabindex="0" title="${game.i18n.localize("SDE.crawlBar.encounterMenu.terrainTablesTip")}">
        <i class="fas fa-mountain-sun"></i> ${terrainCount
          ? game.i18n.format("SDE.crawlBar.encounterMenu.terrainTablesCount", { count: terrainCount })
          : game.i18n.localize("SDE.crawlBar.encounterMenu.terrainTables")}
      </div>
    `;

    // Position menu above button, kept inside the window (it opens from the
    // Tools button, near the bar's right end).
    const rect = el.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.bottom = `${window.innerHeight - rect.top + 5}px`;

    document.body.appendChild(menu);
    menu.setAttribute("role", "menu");
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;

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
      } else if (action === "setFrequency") {
        const val = parseInt(target.dataset.value, 10);
        // Guarded: these are real <button>s, so Enter/Space can reach this
        // handler twice (the menu's keydown shim clicks it, then the browser's
        // native activation does) — a second write of the same value is a
        // pointless world broadcast.
        if (val !== game.shadowdarkEnhancer.encounter.getCheckFrequency()) {
          await game.shadowdarkEnhancer.encounter.setCheckFrequency(val);
        }
        menu.remove();
      } else if (action === "terrainTables") {
        menu.remove();
        const { openTerrainTables } = await import("../encounter/encounter-terrain.mjs");
        await openTerrainTables();
      } else if (action === "clearTable") {
        await game.shadowdarkEnhancer.encounter.setActiveTable(null);
        ui.notifications.info(game.i18n.localize("SDE.crawlBar.notify.tableCleared"));
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

  async _addSelectedTokens() {
    const selected = canvas.tokens?.controlled ?? [];
    if (!selected.length) {
      ui.notifications.warn(game.i18n.localize("SDE.crawlBar.notify.selectTokens"));
      return;
    }

    // In combat mode: add to the combat tracker (Vagabond behavior).
    if (CrawlState.mode === "combat" && game.combat) {
      const existing = new Set(game.combat.combatants.map(c => c.tokenId));
      const docs = selected.map(t => t.document).filter(td => !existing.has(td.id));
      if (!docs.length) {
        ui.notifications.info(game.i18n.localize("SDE.crawlBar.notify.alreadyInCombat"));
        return;
      }
      await TokenDocument.implementation.createCombatants(docs);
      ui.notifications.info(game.i18n.format("SDE.crawlBar.notify.addedToCombat", { count: docs.length }));
      this.render();
      CrawlStrip.render();
      return;
    }

    // In crawl mode: add to CrawlState.members (opt-in roster, not auto).
    // Membership is world-scoped — keyed by ACTOR id, not scene-local token id
    // — so a member stays in the strip when the GM switches scenes.
    if (CrawlState.mode === "crawl") {
      const pcActorIds = [...new Set(
        selected
          .filter(t => t.actor?.type === "Player")
          .map(t => t.actor.id)
      )];
      const skipped = selected.length - selected.filter(t => t.actor?.type === "Player").length;
      if (!pcActorIds.length) {
        ui.notifications.warn(game.i18n.localize("SDE.crawlBar.notify.selectPlayers"));
        return;
      }
      const before = new Set(CrawlState.members);
      await CrawlState.addMembers(pcActorIds);
      const added = pcActorIds.filter(id => !before.has(id)).length;
      const dup = pcActorIds.length - added;
      const parts = [];
      if (added) parts.push(game.i18n.format("SDE.crawlBar.notify.membersAdded", { count: added }));
      if (dup) parts.push(game.i18n.format("SDE.crawlBar.notify.membersAlready", { count: dup }));
      if (skipped) parts.push(game.i18n.format("SDE.crawlBar.notify.nonPcSkipped", { count: skipped }));
      ui.notifications.info(parts.join(" • ") || game.i18n.localize("SDE.crawlBar.notify.noChanges"));
      return;
    }

    ui.notifications.warn(game.i18n.localize("SDE.crawlBar.notify.startFirst"));
  },

  async _startCombat() {
    const scene = canvas.scene;
    if (!scene) {
      ui.notifications.warn(game.i18n.localize("SDE.crawlBar.notify.noScene"));
      return;
    }

    // Create combat if none exists — CrawlState transitions to "combat" via the
    // combatStart / createCombat hook in CrawlState.init().
    // noAutoEnroll: this method adds the whole party itself (all scene PC
    // tokens + selection, below). Without the flag, CrawlState's createCombat
    // auto-enroll races this add — each side dedupes against a combatant
    // collection the other's in-flight write hasn't reached yet — and every
    // crawl member lands in the tracker twice.
    let combat = game.combat;
    if (!combat) combat = await Combat.create({
      scene: scene.id,
      flags: { [MODULE_ID]: { noAutoEnroll: true } },
    });
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

  /** Yes/no confirm; `titleKey` and `contentKey` are en.json keys. */
  async _confirm(titleKey, contentKey, yesKey, noKey) {
    return foundry.applications.api.DialogV2.confirm({
      classes: ["sde-ui", "sde-dialog"],
      window: { title: titleKey },
      content: `<p>${game.i18n.localize(contentKey)}</p>`,
      yes: { label: yesKey, icon: "fa-solid fa-check" },
      no: { label: noKey, icon: "fa-solid fa-xmark", default: true },
      rejectClose: false,
    });
  },
};
