/**
 * Shadowdark Enhancer — the out-of-combat tracker, as a real sidebar tab.
 *
 * Foundry ships a Combat tab and nothing for the order a party moves in
 * outside combat, so the rolled order only ever existed on the crawl strip.
 * This is the same order in the place a GM already looks for turn order: its
 * own icon in the sidebar rail, with the holder highlighted and the roll-all /
 * advance / reset controls the strip's badge carries.
 *
 * How it hangs off core (verified against the live 14.366 build at
 * `FoundryV14/app/public/scripts/foundry.mjs`):
 *
 *   - `Sidebar.TABS` (foundry.mjs:143951) is a plain static map of tab id →
 *     `{tooltip, icon, documentName?, gmOnly?}`. A tab needs NO document
 *     collection — core's own `placeables` entry is icon + tooltip only.
 *   - `Sidebar#_configureRenderOptions` gives every TABS key a stub part, and
 *     `#renderTabs` (foundry.mjs:144108) resolves each id against `ui[id]`,
 *     hides the rail button when `_canRender()` returns false, and otherwise
 *     renders the tab.
 *   - `ui[id]` is constructed from `CONFIG.ui[id]` in `Game#initializeUI`
 *     (foundry.mjs:206533), which runs during setup — AFTER the `init` hook,
 *     so registering there is in time.
 *   - Right-clicking a rail icon calls `renderPopout()` on the tab, so the
 *     tracker gets a floating window for free.
 *
 * `Sidebar.TABS` is core internals rather than a documented module API, so the
 * whole registration is wrapped: if a future build moves it, the module logs a
 * warning and loses this tab instead of failing to load.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { CrawlState } from "./crawl-state.mjs";
import { OocControls, showOocRollAll, showOocAdvance } from "./crawl-strip.mjs";
import { oocOrderComplete } from "./crawl-state-core.mjs";
import { buildTrackerRows, showOocReset } from "./crawl-tracker-core.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;

/** Tab id: the `Sidebar.TABS` key, the `CONFIG.ui` key and `tabName` must agree. */
export const TRACKER_TAB_ID = "sdeCrawlTracker";

export class CrawlTrackerTab extends HandlebarsApplicationMixin(
  foundry.applications.sidebar.AbstractSidebarTab,
) {
  static tabName = TRACKER_TAB_ID;

  static DEFAULT_OPTIONS = {
    classes: ["sde-tracker-tab"],
    window: { title: "SDE.tracker.title", icon: "fa-solid fa-person-hiking" },
    actions: {
      trackerRollAll: CrawlTrackerTab.prototype._onRollAll,
      trackerAdvance: CrawlTrackerTab.prototype._onAdvance,
      trackerReset:   CrawlTrackerTab.prototype._onReset,
    },
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/crawl-tracker.hbs`,
      scrollable: [""],
    },
  };

  /**
   * Hidden unless a crawl is running. Core reads a literal `false` as "hide the
   * rail button and skip the render" (`Sidebar#renderTabs`), so this is both
   * the icon's visibility and the tab's.
   */
  _canRender(_options) {
    if (CrawlState.mode !== "crawl") return false;
  }

  /**
   * Keep the section's `active` class in step with the sidebar.
   *
   * `AbstractSidebarTab` stamps `active` once, at construction, and after that
   * `Sidebar#changeTab` maintains it — but `changeTab` returns early when the
   * requested tab is already the active one. This tab is constructed before the
   * sidebar restores the last-used tab, so on a reload with the tracker active
   * the class is never applied and nothing later applies it: the rail button is
   * pressed, the group says this tab is active, and the panel renders
   * `display: none`. Caught live; re-asserting it on every render is the fix
   * that survives both orders.
   */
  _onRender(context, options) {
    super._onRender(context, options);
    if (!this.isPopout) this.element.classList.toggle("active", this.active);
  }

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = CrawlState;
    const rows = buildTrackerRows({
      members: state.members,
      oocInitiative: state.oocInitiative,
      oocTurn: state.oocTurn,
    });
    const rolledCount = rows.filter(r => r.initiative !== null).length;
    const holderId = state.oocTurn;

    context.round = state.crawlTurn;
    context.rows = rows.map(row => {
      const actor = game.actors.get(row.actorId);
      return {
        ...row,
        name: actor?.name ?? game.i18n.localize("SDE.tracker.unknownMember"),
        img: actor?.img ?? "icons/svg/mystery-man.svg",
        // The template cannot branch on `initiative` directly: Handlebars
        // treats a rolled 0 as absent, so the label is resolved here.
        initLabel: row.initiative === null ? "—" : String(row.initiative),
        unrolled: row.initiative === null,
      };
    });
    context.controls = {
      rollAll: showOocRollAll({
        isGM: game.user.isGM,
        memberCount: state.members.length,
        orderComplete: oocOrderComplete(state),
      }),
      advance: showOocAdvance({
        isGM: game.user.isGM,
        oocOrderActive: oocOrderComplete(state) && !!holderId,
        ownsHolder: !!holderId && !!game.actors.get(holderId)?.isOwner,
      }),
      reset: showOocReset({ isGM: game.user.isGM, rolledCount }),
    };
    context.anyControl = context.controls.rollAll || context.controls.advance || context.controls.reset;
    context.empty = rows.length === 0;
    return context;
  }

  /* ── Actions ──────────────────────────────────────────────────────────── */

  /**
   * Every action disables its own button for the round trip and lets the
   * state-change re-render restore it: the underlying controls refuse a second
   * call while the first is in flight, and a disabled button says so on screen.
   */
  async _withBusy(target, fn) {
    if (target) target.disabled = true;
    try {
      await fn();
    } finally {
      if (target?.isConnected) target.disabled = false;
    }
  }

  async _onRollAll(_event, target) {
    await this._withBusy(target, () => OocControls.rollAll());
  }

  async _onAdvance(_event, target) {
    await this._withBusy(target, () => OocControls.advance());
  }

  async _onReset(_event, target) {
    await this._withBusy(target, () => OocControls.reset());
  }
}

/**
 * Re-render the tab and re-evaluate its rail button on any crawl-state change.
 *
 * `Sidebar#render({parts})` runs core's own `#renderTabs`, which is what
 * toggles the rail button's `hidden` — re-rendering the tab alone would leave
 * a stale icon. If the crawl ends while the tracker is the active tab, the
 * sidebar would be left showing an empty panel, so hand focus back to chat.
 *
 * Also called once at ready: the sidebar's first render happens during setup,
 * BEFORE `CrawlState.init()` has read the saved state, so a world reloaded
 * mid-crawl would otherwise show the rail button hidden until the next state
 * change (caught live — the tab was invisible in a world whose mode was
 * already "crawl").
 */
export function refreshTracker() {
  const sidebar = ui.sidebar;
  if (!sidebar?.rendered) return;
  const visible = ui[TRACKER_TAB_ID]?._canRender({}) !== false;
  if (!visible && sidebar.tabGroups?.primary === TRACKER_TAB_ID) {
    sidebar.changeTab("chat", "primary");
  }
  sidebar.render({ parts: [TRACKER_TAB_ID] });
}

/**
 * Register the tab. Call from `init` — `Game#initializeUI` constructs
 * `CONFIG.ui` entries during setup, so anything later misses the pass.
 *
 * The tab is inserted directly after **Combat** rather than appended, because
 * the two answer the same question in the two modes of play and belong next to
 * each other in the rail.
 */
export function registerCrawlTracker() {
  try {
    const Sidebar = foundry.applications.sidebar?.Sidebar;
    if (!Sidebar?.TABS) throw new Error("Sidebar.TABS is not available on this build");

    CONFIG.ui[TRACKER_TAB_ID] = CrawlTrackerTab;

    const def = {
      tooltip: "SDE.tracker.title",
      icon: "fa-solid fa-person-hiking",
    };
    const rebuilt = {};
    for (const [key, value] of Object.entries(Sidebar.TABS)) {
      rebuilt[key] = value;
      if (key === "combat") rebuilt[TRACKER_TAB_ID] = def;
    }
    rebuilt[TRACKER_TAB_ID] ??= def; // no combat tab on this build → rail end
    Sidebar.TABS = rebuilt;

    Hooks.on(CrawlState.HOOK_CHANGED, refreshTracker);
  } catch (err) {
    console.warn(`${MODULE_ID} | crawl tracker sidebar tab unavailable on this Foundry build`, err);
  }
}
