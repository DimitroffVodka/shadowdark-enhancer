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
import {
  startOverland, endOverland, rollWeather, weatherNow, weatherName, askDay, startDay, resume, overlandState, OVERLAND_CHANGED,
  askForage, forage, makeCamp,
} from "../overland/overland.mjs";

const BAR_ID = "shadowdark-enhancer-bar";

// How often the AUTOMATIC crawl-round encounter check runs (issue #171):
// 1 = every round, then every 2 … 10. The gate itself (`encounterCheckDue`)
// accepts any value ≥ 1; the ten choices are a menu bound, not a state rule.
const CHECK_FREQUENCY_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** "every round" / "every 3 rounds" — the header's reading of the setting. */
const frequencyLabel = (n) => (n === 1
  ? game.i18n.localize("SDE.crawlBar.encounterMenu.everyRound")
  : game.i18n.format("SDE.crawlBar.encounterMenu.everyNRounds", { n }));

export const CrawlBar = {

  _el: null,
  _hookIds: [],
  _renderQueued: false,
  /** The weather kind the Overland badge shows, or null. */
  _weatherShown: null,

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

    // The crawl bar is ALWAYS shown (no separate "Start Crawl" screen). When no
    // session is active the last button reads "Start"; starting flips it to
    // "End". Session-only actions (Next Turn, Combat) are disabled while idle.
    const idle = !state.isActive;
    const idleAttr = idle ? 'disabled style="opacity:0.4;cursor:default"' : "";

    // COMBAT state
    if (state.mode === "combat") {
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

    // Overland travel (#229) is a mode of its own: not a crawl, so the crawl's
    // session actions stay idle; Start still begins a crawl from it (§4.3).
    const overland = state.mode === "overland";
    const weather = this._weatherShown ? weatherName(this._weatherShown) : null;
    const day = overland ? overlandState() : null;
    const badge = [
      weather ? game.i18n.format("SDE.overland.badgeWeather", { weather }) : game.i18n.localize("SDE.overland.badge"),
      Number.isFinite(day?.day) ? game.i18n.format("SDE.overland.badgeHexes", { left: day.hexesLeft, budget: day.budget }) : null,
    ].filter(Boolean).join(" · ");
    const continueButton = day?.pending
      ? `<button class="sde-bar-btn sde-bar-start-btn" data-action="resumeTravel" title="${game.i18n.localize("SDE.overland.resumeHint")}">${ICONS.play} ${game.i18n.localize("SDE.overland.resume")}</button>`
      : "";
    const travelButton = overland
      ? `${continueButton}<button class="sde-bar-btn" data-action="startDay" title="${game.i18n.localize("SDE.overland.startDayHint")}">${ICONS.sunrise} ${game.i18n.localize("SDE.overland.startDay")}</button>
        <button class="sde-bar-btn" data-action="forage" title="${game.i18n.localize("SDE.overland.forage.buttonHint")}">${ICONS.forage} ${game.i18n.localize("SDE.overland.forage.button")}</button>
        <button class="sde-bar-btn" data-action="makeCamp" title="${game.i18n.localize("SDE.overland.makeCampHint")}">${ICONS.camp} ${game.i18n.localize("SDE.overland.makeCamp")}</button>
        <button class="sde-bar-btn" data-action="rollWeather" title="${game.i18n.localize("SDE.overland.rollWeatherHint")}">${ICONS.weather} ${game.i18n.localize("SDE.overland.rollWeather")}</button>
        <button class="sde-bar-btn sde-bar-danger-btn" data-action="endTravel" title="${game.i18n.localize("SDE.overland.endTravelHint")}">${ICONS.close} ${game.i18n.localize("SDE.overland.endTravel")}</button>`
      : (state.mode === "off" && isHexMapScene()
        ? `<button class="sde-bar-btn" data-action="startTravel" title="${game.i18n.localize("SDE.overland.startTravelHint")}">${ICONS.walking} ${game.i18n.localize("SDE.overland.startTravel")}</button>`
        : "");

    // CRAWL state — single phase, just turn counter + next button
    this._el.innerHTML = `
      <div class="sde-bar-inner sde-bar-active">

        ${overland
          ? `<span class="sde-bar-phase-badge sde-bar-phase-overland">${ICONS.walking} ${badge}</span>`
          : `<span class="sde-bar-phase-badge sde-bar-phase-crawl"${idle ? ' style="opacity:0.55"' : ""}>
          ${ICONS.startCrawl} ${game.i18n.format("SDE.crawlBar.roundBadge", { turn: state.crawlTurn })}
        </span>`}
        <button class="sde-bar-btn sde-bar-next-btn" data-action="nextCrawlTurn" ${idleAttr}>
          ${ICONS.nextTurn} ${game.i18n.localize("SDE.crawlBar.nextRound")}
        </button>

        <button class="sde-bar-btn" data-action="addSelectedTokens" title="${game.i18n.localize("SDE.crawlBar.addTokensCrawlTip")}">
          ${ICONS.addTokens} ${game.i18n.localize("SDE.crawlBar.addTokens")}
        </button>
        <button class="sde-bar-btn sde-bar-combat-btn" data-action="startCombat" ${idleAttr}>
          ${ICONS.combat} ${game.i18n.localize("SDE.crawlBar.combat")}
        </button>

        <button class="sde-bar-btn" data-action="encounter" title="${game.i18n.localize("SDE.crawlBar.encounterTip")}">
          ${ICONS.encounter} ${game.i18n.localize("SDE.crawlBar.encounter")}
        </button>
        <button class="sde-bar-btn" data-action="loot" title="${game.i18n.localize("SDE.crawlBar.forgeLootTip")}">
          ${ICONS.forge} ${game.i18n.localize("SDE.crawlBar.forgeLoot")}
        </button>
        <button class="sde-bar-btn" data-action="rollTables" title="${game.i18n.localize("SDE.crawlBar.importerTip")}">
          ${ICONS.importer} ${game.i18n.localize("SDE.crawlBar.importer")}
        </button>
        ${travelButton}
        ${idle
          ? `<button class="sde-bar-btn sde-bar-start-btn" data-action="startCrawl" title="${game.i18n.localize("SDE.crawlBar.startTip")}">${ICONS.startCrawl} ${game.i18n.localize("SDE.crawlBar.start")}</button>`
          : `<button class="sde-bar-btn sde-bar-danger-btn" data-action="endCrawl" title="${game.i18n.localize("SDE.crawlBar.endTip")}">${ICONS.close} ${game.i18n.localize("SDE.crawlBar.end")}</button>`}

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
              ui.notifications.info(game.i18n.format("SDE.crawlBar.notify.tableSet", { name: table.name }));
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

      case "startTravel": {
        const started = await startOverland();
        this.render();
        CrawlStrip.render();
        // The day comes next: open Start day at once, unless a day is already open.
        if (started && !Number.isFinite(overlandState().day)) {
          const options = await askDay();
          if (options) {
            const reply = await startDay(options);
            if (!reply?.ok && reply?.error) ui.notifications.warn(reply.error);
          }
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
        const options = await askDay();
        if (!options) break;
        const reply = await startDay(options);
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
        const ok = await this._confirm("SDE.crawlBar.confirm.endCrawlTitle", "SDE.crawlBar.confirm.endCrawl");
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
          const ok = await this._confirm("SDE.crawlBar.deleteEncounterTitle", "SDE.crawlBar.deleteEncounterConfirm");
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

      case "loot":
        // Left-click opens the Forge & Loot menu.
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

  _onLootContextMenu(el, _ev) {
    if (!game.user.isGM) return;

    const existing = document.getElementById("sde-loot-context-menu");
    if (existing) { existing.remove(); return; }

    const menu = document.createElement("div");
    menu.id = "sde-loot-context-menu";
    menu.className = "sde-bar-context-menu";
    // Forge & Loot is deliberately absent from this menu: every generator it
    // hosts is still a placeholder, so the entry opened a window whose only
    // buttons refuse.  Restore this item in the same change that registers a
    // working generator — it stays reachable meanwhile via
    // game.shadowdarkEnhancer.forgeLoot.open() for development.
    menu.innerHTML = `
      <div class="sde-menu-item sde-menu-btn" data-loot-action="lootGen" role="menuitem" tabindex="0">
        <i class="fas fa-coins"></i> ${game.i18n.localize("SDE.crawlBar.lootMenu.lootGen")}
      </div>
      <div class="sde-menu-item sde-menu-btn" data-loot-action="magicForge" role="menuitem" tabindex="0">
        <i class="fas fa-hammer"></i> ${game.i18n.localize("SDE.crawlBar.lootMenu.magicForge")}
      </div>
      <div class="sde-menu-item sde-menu-btn" data-loot-action="merchant" role="menuitem" tabindex="0">
        <i class="fas fa-store"></i> ${game.i18n.localize("SDE.crawlBar.lootMenu.merchant")}
      </div>
      <div class="sde-menu-item sde-menu-btn" data-loot-action="partyXp" role="menuitem" tabindex="0">
        <i class="fas fa-star"></i> ${game.i18n.localize("SDE.crawlBar.lootMenu.partyXp")}
      </div>
      <div class="sde-menu-item sde-menu-btn" data-loot-action="downtime" role="menuitem" tabindex="0">
        <i class="fas fa-mug-hot"></i> ${game.i18n.localize("SDE.crawlBar.lootMenu.downtime")}
      </div>
      <div class="sde-menu-item sde-menu-btn" data-loot-action="pitFighting" role="menuitem" tabindex="0">
        <i class="fas fa-hand-fist"></i> ${game.i18n.localize("SDE.crawlBar.lootMenu.pitFighting")}
      </div>
      <div class="sde-menu-item sde-menu-btn" data-loot-action="training" role="menuitem" tabindex="0">
        <i class="fas fa-dumbbell"></i> ${game.i18n.localize("SDE.crawlBar.lootMenu.training")}
      </div>
      <div class="sde-menu-item sde-menu-btn" data-loot-action="renown" role="menuitem" tabindex="0">
        <i class="fas fa-crown"></i> ${game.i18n.localize("SDE.crawlBar.lootMenu.renown")}
      </div>
      <div class="sde-menu-item sde-menu-btn" data-loot-action="rumors" role="menuitem" tabindex="0">
        <i class="fas fa-comments"></i> ${game.i18n.localize("SDE.crawlBar.lootMenu.rumors")}
      </div>
      <div class="sde-menu-item sde-menu-btn" data-loot-action="recap" role="menuitem" tabindex="0">
        <i class="fas fa-scroll"></i> ${game.i18n.localize("SDE.crawlBar.lootMenu.recap")}
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
      if (target.dataset.lootAction === "forgeLoot") {
        import("../forge-loot/forge-loot-app.mjs")
          .then(({ ForgeLootApp }) => ForgeLootApp.open())
          .catch((error) => ui.notifications?.error(game.i18n.format("SDE.crawlBar.notify.forgeLootFailed", { error: error.message })));
      }
      if (target.dataset.lootAction === "lootGen") game.shadowdarkEnhancer.loot.open();
      if (target.dataset.lootAction === "magicForge") game.shadowdarkEnhancer.forge.open();
      if (target.dataset.lootAction === "merchant") game.shadowdarkEnhancer.merchant.openLocally();
      if (target.dataset.lootAction === "partyXp") game.shadowdarkEnhancer.partyXp.open();
      if (target.dataset.lootAction === "downtime") game.shadowdarkEnhancer.downtime.open();
      if (target.dataset.lootAction === "pitFighting") game.shadowdarkEnhancer.pitFighting.open();
      if (target.dataset.lootAction === "training") game.shadowdarkEnhancer.training.open();
      if (target.dataset.lootAction === "renown") game.shadowdarkEnhancer.renown.open();
      if (target.dataset.lootAction === "recap") game.shadowdarkEnhancer.recap.open();
      menu.remove();
      // A dialog: the menu goes first, or it stays open behind it.
      if (target.dataset.lootAction === "rumors") {
        import("../rumors/rumors.mjs").then(({ askAndGive }) => askAndGive())
          .catch((err) => console.error("shadowdark-enhancer | give rumors", err));
      }
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
  async _confirm(titleKey, contentKey) {
    return foundry.applications.api.DialogV2.confirm({
      window: { title: titleKey },
      content: `<p>${game.i18n.localize(contentKey)}</p>`,
      rejectClose: false,
    });
  },
};
