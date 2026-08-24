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
import {
  buildTrackerRows, showOocReset, rowRollable, trackerFooter, parseInitiativeInput,
} from "./crawl-tracker-core.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;

/** Tab id: the `Sidebar.TABS` key, the `CONFIG.ui` key and `tabName` must agree. */
export const TRACKER_TAB_ID = "sdeCrawlTracker";

export class CrawlTrackerTab extends HandlebarsApplicationMixin(
  foundry.applications.sidebar.AbstractSidebarTab,
) {
  static tabName = TRACKER_TAB_ID;

  static DEFAULT_OPTIONS = {
    // `combat-sidebar` is not decoration: core's tracker styling is scoped to
    // that class (42 of its 51 combat rules), so wearing it — plus core's own
    // row markup — IS how this tab matches the combat tracker, rather than a
    // copied stylesheet that drifts on the next Foundry release.
    classes: ["combat-sidebar", "sde-tracker-tab"],
    window: { title: "Crawl Order", icon: "fa-solid fa-person-hiking" },
    actions: {
      trackerRollAll:   CrawlTrackerTab.prototype._onRollAll,
      trackerRollOne:   CrawlTrackerTab.prototype._onRollOne,
      trackerAdvance:       CrawlTrackerTab.prototype._onAdvance,
      trackerPrevious:      CrawlTrackerTab.prototype._onPrevious,
      trackerNextRound:     CrawlTrackerTab.prototype._onNextRound,
      trackerPreviousRound: CrawlTrackerTab.prototype._onPreviousRound,
      trackerReset:     CrawlTrackerTab.prototype._onReset,
      trackerEndCrawl:  CrawlTrackerTab.prototype._onEndCrawl,
      trackerSelect:    CrawlTrackerTab.prototype._onSelect,
      trackerPan:       CrawlTrackerTab.prototype._onPan,
    },
  };

  // Three parts, named and ordered as the combat tracker's own.
  static PARTS = {
    header:  { template: `modules/${MODULE_ID}/templates/crawl-tracker-header.hbs` },
    tracker: { template: `modules/${MODULE_ID}/templates/crawl-tracker-list.hbs`, scrollable: [""] },
    footer:  { template: `modules/${MODULE_ID}/templates/crawl-tracker-footer.hbs` },
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
    const isGM = game.user.isGM;
    const orderActive = oocOrderComplete(state) && !!holderId;
    const ownsHolder = !!holderId && !!game.actors.get(holderId)?.isOwner;

    context.isGM = isGM;
    context.round = state.crawlTurn;
    // Mirrors COMBAT.Round / COMBAT.NotStarted: a crawl with no order rolled is
    // the out-of-combat equivalent of an encounter nobody has rolled for.
    context.title = orderActive ? `Crawl Round ${state.crawlTurn}` : "No Initiative Rolled";
    // The d20 art the combat tracker rolls with, so the two roll buttons are
    // the same button.
    context.initiativeIcon = CONFIG.Combat.initiativeIcon;

    context.rows = rows.map(row => {
      const actor = game.actors.get(row.actorId);
      const isOwner = !!actor?.isOwner;
      const hasInitiative = row.initiative !== null;
      return {
        ...row,
        name: actor?.name ?? "(missing character)",
        img: actor?.img ?? "icons/svg/mystery-man.svg",
        hasInitiative,
        // `active` is core's own current-turn class — the holder gets combat's
        // highlight rather than a lookalike.
        css: row.isHolder ? "active" : "",
        canRoll: rowRollable({ isGM, isOwner, hasInitiative }),
        // Every row, not just their own: the combat tracker gives a player the
        // pan control on every combatant, and a crawl roster is all party
        // members anyway.
        canPan: !isGM,
      };
    });

    context.controls = {
      rollAll: showOocRollAll({
        isGM,
        memberCount: state.members.length,
        orderComplete: oocOrderComplete(state),
      }),
      advance: showOocAdvance({ isGM, oocOrderActive: orderActive, ownsHolder }),
      reset: showOocReset({ isGM, rolledCount }),
    };
    context.footer = trackerFooter({ isGM, orderActive, ownsHolder, round: state.crawlTurn });
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

  /** One row's d20 — the same roll the strip's card dice makes. */
  async _onRollOne(_event, target) {
    const actorId = target?.dataset?.actorId;
    if (!actorId || CrawlState.oocInitiative[actorId]) return;
    await this._withBusy(target, async () => {
      const { InitiativeManager } = await import("./initiative-manager.mjs");
      await InitiativeManager.rollOocForActor(actorId);
    });
  }

  async _onAdvance(_event, target) {
    await this._withBusy(target, () => OocControls.advance());
  }

  /** Step the turn back one holder (GM) — combat's Previous Turn. */
  async _onPrevious(_event, target) {
    if (!game.user.isGM) return;
    await this._withBusy(target, () => CrawlState.previousOocTurn());
  }

  /**
   * Next round — the crawl bar's Next Round, which is a round of the crawl
   * clock rather than of the initiative order: it refills movement budgets and
   * runs the wandering-monster check. GM-only, and deliberately available
   * before anyone has rolled, exactly as on the bar.
   */
  async _onNextRound(_event, target) {
    if (!game.user.isGM) return;
    await this._withBusy(target, () => CrawlState.nextCrawlTurn());
  }

  /** Step the crawl round back (GM) — corrects the counter, replays nothing. */
  async _onPreviousRound(_event, target) {
    if (!game.user.isGM) return;
    await this._withBusy(target, () => CrawlState.previousCrawlTurn());
  }

  async _onReset(_event, target) {
    await this._withBusy(target, () => OocControls.reset());
  }

  /** End Crawl, behind the same confirmation the crawl bar's End button uses. */
  async _onEndCrawl(_event, _target) {
    if (!game.user.isGM) return;
    const confirm = foundry.applications.api.DialogV2?.confirm;
    const ok = confirm
      ? await foundry.applications.api.DialogV2.confirm({
        window: { title: "End Crawl" },
        content: "<p>End crawl mode?</p>",
        rejectClose: false,
      })
      : true;
    if (ok) await CrawlState.endCrawl();
  }

  /**
   * Clicking a row selects that character's token on the current scene, the way
   * clicking a combatant does. Silent when the member has no token here — a
   * crawl roster follows the party across scenes, so an absent token is
   * ordinary rather than an error.
   */
  async _onSelect(_event, target) {
    const token = this._tokenFor(target?.dataset?.actorId);
    if (!token) return;
    if (token.isOwner) token.control({ releaseOthers: true });
  }

  /** Pan to the row's token without selecting it (core's player-side control). */
  async _onPan(event, target) {
    event?.stopPropagation();
    const token = this._tokenFor(target?.dataset?.actorId);
    if (token) await canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
  }

  /** This member's token on the scene being viewed, if it has one. */
  _tokenFor(actorId) {
    if (!actorId || !canvas?.ready) return null;
    return canvas.tokens?.placeables?.find(t => t.actor?.id === actorId) ?? null;
  }

  /** @inheritDoc */
  _attachPartListeners(partId, element, options) {
    super._attachPartListeners(partId, element, options);
    if (partId !== "tracker" || !game.user.isGM) return;
    // Typed initiative, as in the combat tracker. A blank or unparseable entry
    // re-renders the stored value back into the box rather than writing NaN —
    // or, before parseInitiativeInput owned the emptiness check, writing the 0
    // that `Number("")` quietly produces.
    for (const input of element.querySelectorAll(".initiative-input")) {
      input.addEventListener("change", async ev => {
        const actorId = ev.currentTarget.dataset.actorId;
        const parsed = parseInitiativeInput(ev.currentTarget.value);
        if (!actorId || !parsed.ok) return this.render();
        await CrawlState.setOocInitiative(actorId, {
          roll: parsed.value,
          advantage: CrawlState.oocInitiative[actorId]?.advantage ?? 0,
        });
      });
    }
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

    // Core runs the tooltip through `localize`, which returns a non-key
    // unchanged — so a plain English label is safe here, per CONTRIBUTING.md.
    const def = {
      tooltip: "Crawl Order",
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
