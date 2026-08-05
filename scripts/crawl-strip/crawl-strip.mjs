/**
 * Shadowdark Enhancer — Crawl Strip
 *
 * Faithful port of vagabond-crawler/scripts/crawl-strip/crawl-strip.mjs.
 * Adapted for Shadowdark's simpler CrawlState model:
 *   - No heroes/gm phases — just `mode: "off" | "crawl" | "combat"`
 *   - Single `crawlTurn` counter (no phase toggle)
 *   - Luck instead of Stress (shamrock icon stays; semantics shift)
 *   - Movement is module-setting-driven (no per-actor speed field)
 */

import { MODULE_ID }        from "../shared/module-id.mjs";
import { esc }              from "../shared/esc.mjs";
import { CrawlState }       from "./crawl-state.mjs";
import { MovementTracker }  from "./movement-tracker.mjs";
import { ICONS }            from "../shared/icons.mjs";
import { relayToGM, authorizeActorFor, refuseQuery } from "../shared/gm-relay.mjs";
import { computeLightState, isLightItem } from "./crawl-lights-core.mjs";
import { canAdvanceTurn, canAdvanceOocTurn, nextTurnWouldRollRound } from "./crawl-turn-core.mjs";
import { oocOrderComplete } from "./crawl-state-core.mjs";
import {
  buildTabStripHTML,
  bindActionMenuEvents,
  closeActionMenu,
} from "./npc-action-menu.mjs";

const STRIP_ID = "shadowdark-enhancer-strip";

/**
 * The authenticated player→GM channel for luck-token gifts, namespaced per
 * Foundry's convention (downtime-session.mjs:89).
 */
export const LUCK_QUERY = `${MODULE_ID}.luck`;

/**
 * The authenticated player→GM channel for combat turn advances. A player may
 * only ever ask the GM to advance ONE turn, and only while the actor whose
 * turn it is belongs to them — the GM re-verifies both against current state
 * at handling time (handleAdvanceTurnQuery / canAdvanceTurn).
 */
export const CRAWL_TURN_QUERY = `${MODULE_ID}.combatNextTurn`;

/**
 * The authenticated player→GM channel for OUT-OF-COMBAT turn advances. The
 * current OoC turn-holder may ask the GM to advance the rolled initiative
 * order one step; the GM re-verifies ownership of the CURRENT holder against
 * server-authenticated state at handling time (handleOocAdvanceQuery /
 * canAdvanceOocTurn).
 */
export const OOC_TURN_QUERY = `${MODULE_ID}.oocNextTurn`;

/**
 * The card highlight state for one strip member — combat and the
 * out-of-combat order speak ONE visual idiom (issue #14 part 2): the current
 * turn-holder is the "active" card (`sde-strip-active` + the
 * `sde-strip-is-turn` accent) and every other card is dimmed
 * (`sde-strip-dim`), exactly the contrast users already know from combat.
 * Out of combat with NO active order, every card stays active as it always
 * has — no phase split, no accent.
 *
 * @param {object}  facts
 * @param {boolean} facts.inCombat        The strip is rendering combat mode.
 * @param {boolean} facts.isCurrent       This card is the current combatant.
 * @param {boolean} facts.oocOrderActive  An OoC order is in effect (crawl mode + complete order + a holder exists).
 * @param {boolean} facts.isOocHolder     This card is the current OoC turn-holder.
 * @returns {{isActivePhase: boolean, isTurn: boolean}}
 */
export function cardTurnState({ inCombat, isCurrent, oocOrderActive, isOocHolder } = {}) {
  if (inCombat) return { isActivePhase: isCurrent, isTurn: isCurrent };
  if (oocOrderActive) return { isActivePhase: isOocHolder, isTurn: isOocHolder };
  return { isActivePhase: true, isTurn: false };
}

/**
 * In-flight turn-advance locks on the GM client, keyed
 * `${combat.id}:${combat.round}:${combat.turn}`.
 *
 * The authoritative guard against a double advance. Two relayed requests that
 * race run their whole synchronous prologue against the SAME pre-advance
 * Foundry state — the Combat document only updates after the server
 * round-trip (ClientDatabaseBackend applies the response), so no re-read of
 * `combat.turn`/`combatant` can tell the handlers apart. Only a marker set
 * synchronously BEFORE the await can: the second handler entering while the
 * first awaits sees the key and refuses. Cleared in a `finally`, so a throw
 * cannot strand it.
 *
 * NOT A TOTAL GUARANTEE: this is per-client in-memory state. If the active
 * GM disconnects (or another GM logs in) mid-advance, the NEW active GM
 * starts with an empty lock and can serve a second request against still-
 * stale combat state. Closing that fully requires server-side serialization
 * of Combat updates, which is out of scope here — treat this lock as the
 * defence for the cooperative-race case it was built for, not as a
 * substitute for server serialization.
 */
const _advanceLocks = new Set();

/**
 * Run `fn` under the in-flight advance lock for `key`. The check-and-insert
 * is synchronous and precedes the first await, so of two racing callers (a
 * relayed request and a GM-local click included) only one runs `fn`; the
 * loser gets `false`. The key clears in a `finally`, so a throw cannot
 * strand it.
 *
 * Combat advances key on `${combat.id}:${combat.round}:${combat.turn}` (the
 * same turn cannot advance twice); the out-of-combat advance uses a single
 * global key — the pointer mutates synchronously in the reducer, so the
 * first advance's new turn can only be advanced after it lands.
 *
 * @param {string} key
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<boolean>} true if `fn` ran, false if another advance
 *   under the same key is already in flight on this client.
 */
async function withAdvanceLock(key, fn) {
  if (_advanceLocks.has(key)) return false;
  _advanceLocks.add(key);
  try {
    await fn();
    return true;
  } finally {
    _advanceLocks.delete(key);
  }
}

export const CrawlStrip = {

  _el:             null,
  _renderQueued:   false,
  _hookIds:        [],
  _resizeListener: null,
  // True while a player's turn-advance relay is in flight; the nextTurn
  // button renders disabled so a double-click cannot queue two advances.
  _turnAdvanceInFlight: false,

  init() {
    this.mount();
    const queue = () => this.queueRender();
    // Store [event, id] pairs — Hooks.off REQUIRES the event name (a bare
    // numeric id is a silent no-op in v14), so destroy() can actually detach.
    const on = (ev, fn) => this._hookIds.push([ev, Hooks.on(ev, fn)]);
    on(CrawlState.HOOK_CHANGED, queue);
    on("combatStart",   queue);
    on("combatRound",   queue);
    on("combatTurn",    () => { closeActionMenu(); queue(); });
    on("updateCombat",  queue);
    on("updateCombatant", queue);
    on("createCombatant", queue);
    on("deleteCombatant", queue);
    on("deleteCombat",  queue);
    // Relevance filter: world-wide document churn (a player editing
    // inventory on another scene, an actor nobody displays) must not rebuild
    // the strip. Only re-render when the changed document belongs to a
    // currently displayed member card. Membership changes themselves arrive
    // via the CrawlState/combatant hooks above, which stay unfiltered.
    const shown = (attr, id) => !!(id && this._el?.querySelector(`[data-${attr}="${id}"]`));
    const actorOf = doc => doc?.documentName === "Actor" ? doc
      : (doc?.parent?.documentName === "Actor" ? doc.parent : doc?.parent?.parent);
    const queueIfShown = doc => {
      const a = actorOf(doc);
      if (shown("actor-id", a?.id) || shown("token-id", a?.token?.id)) queue();
      // A dead NPC has no card left to match, but healing it back above 0 HP
      // must restore the card — in combat, combatant membership counts as shown.
      else if (a?.id && CrawlState.mode === "combat" &&
               game.combat?.combatants.some(c => c.actorId === a.id)) queue();
    };
    on("updateActor",   queueIfShown);
    on("updateToken",   td => { if (shown("token-id", td?.id) || shown("actor-id", td?.actorId)) queue(); });
    on("createToken",   queue);
    on("deleteToken",   queue);
    on("canvasReady",   queue);
    on("updateItem",    queueIfShown);
    // Gaining or spending an item changes which action-menu tabs a card has —
    // casting a scroll deletes it, learning a spell creates one. Without these
    // the tab strip keeps offering a tab whose contents are gone.
    on("createItem",    queueIfShown);
    on("deleteItem",    queueIfShown);
    on("createActiveEffect", queueIfShown);
    on("deleteActiveEffect", queueIfShown);
    on("updateActiveEffect", queueIfShown);

    // Luck-give requests from players (who can't update other actors directly),
    // over the authenticated relay. TWO defects closed here, both real:
    //
    //   * the gate read the CLAIMED `msg.userId`, so naming any online GM took
    //     a luck token OFF another character and put it on the attacker's —
    //     the one finding in the 2026-07-29 audit that moved a resource between
    //     players rather than merely griefing;
    //   * the handler checked `isGM`, not `activeGM`, so in this world (always-
    //     on "Bridge" GM) BOTH GM clients ran it and pulp mode debited the
    //     giver twice. `refuseQuery` keeps that gate: a query is point-to-point
    //     but the SENDER chooses the recipient, so it can choose both GMs.
    CONFIG.queries[LUCK_QUERY] = (data, { user } = {}) => CrawlStrip.handleLuckQuery(data, user);
    // Player combat turn-advance, over the same authenticated channel. The
    // handler re-verifies ownership of the CURRENT combatant against state it
    // reads itself — see handleAdvanceTurnQuery.
    CONFIG.queries[CRAWL_TURN_QUERY] = (data, { user } = {}) => CrawlStrip.handleAdvanceTurnQuery(data, user);
    // Player OUT-OF-COMBAT turn-advance, same discipline — see
    // handleOocAdvanceQuery.
    CONFIG.queries[OOC_TURN_QUERY] = (data, { user } = {}) => CrawlStrip.handleOocAdvanceQuery(data, user);
  },

  /**
   * @param {object} data  { action, giverId, receiverId }
   * @param {User}   user  The AUTHENTICATED giver, from core's query context.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async handleLuckQuery(data, user) {
    const refusal = refuseQuery(user, "Luck token gifts");
    if (refusal) return refusal;
    if (data?.action !== "luck:give") return { ok: false, error: "Unknown luck action." };

    // Only someone who owns the GIVER may give from it.
    const auth = authorizeActorFor(data.giverId, user);
    if (!auth.ok) return auth;
    const receiver = game.actors.get(data.receiverId);
    if (!receiver) return { ok: false, error: "That character no longer exists." };

    await this._giveLuckToken(auth.actor, receiver);
    return { ok: true };
  },

  /**
   * GM side of the player turn-advance relay. The ONLY permitted action is
   * "advance one turn"; everything else is refused. The combatant is whoever
   * is current on THIS client's combat document at handling time — the
   * payload carries no ids at all, and ownership is re-verified against that
   * re-read state (canAdvanceTurn), so a malicious client cannot spin the
   * tracker, jump turns, or advance someone else's turn. The most a forged
   * request can do is advance the current combatant's turn early, which is
   * exactly what the actor's owner is entitled to anyway.
   *
   * Two further guards on top of the decision:
   *   - `_advanceLocks` refuses a second advance of the same
   *     `combat.id:round:turn` while the first is awaiting the server
   *     round-trip. A client-side button disable is not enough — two clients
   *     (or two tabs) can both send, and both handlers would otherwise pass
   *     authorization against the same stale pre-advance state. The lock is
   *     the only thing that can distinguish them, because it is set
   *     synchronously before the await;
   *   - a player may not advance when doing so would roll the round
   *     (nextTurnWouldRollRound): rounds are the GM's control.
   *
   * @param {object} data  { action: "combat:nextTurn" }. Any other field is ignored.
   * @param {User}   user  The AUTHENTICATED requester, from core's query context.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async handleAdvanceTurnQuery(data, user) {
    const refusal = refuseQuery(user, "Combat turn advances");
    if (refusal) return refusal;
    if (data?.action !== "combat:nextTurn") {
      return { ok: false, error: game.i18n.localize("SDE.crawlStrip.unknownCombatAction") };
    }

    // Re-read current world state — nothing in the payload is trusted. The
    // requester may advance only when the actor whose turn it is right now is
    // one they own, and only when the advance would not roll the round.
    const combat = game.combat;
    const combatant = combat?.combatant;
    const turns = combat?.turns ?? [];
    const turnIndex = combat?.turn ?? -1;
    const verdict = canAdvanceTurn({
      combatActive: !!(combat && combatant),
      requesterIsGM: !!user?.isGM,
      requesterOwnsCurrentCombatant: !!(combatant?.actor && user
        && combatant.actor.testUserPermission(user, "OWNER")),
      advanceWouldRollRound: nextTurnWouldRollRound({
        round: combat?.round ?? 0,
        turn: turnIndex,
        turnCount: turns.length,
        skipDefeated: combat?.settings?.skipDefeated ?? false,
        defeated: turns.map(t => !!t?.isDefeated),
      }),
    });
    if (!verdict.ok) {
      const refusalKeys = {
        "no-combat": "SDE.crawlStrip.turnAdvanceNoCombat",
        "round-boundary": "SDE.crawlStrip.turnAdvanceRoundBoundary",
        "not-your-turn": "SDE.crawlStrip.turnAdvanceNotYourTurn",
      };
      return {
        ok: false,
        error: game.i18n.localize(refusalKeys[verdict.reason] ?? refusalKeys["not-your-turn"]),
      };
    }

    // Authoritative race guard: the in-memory lock (withAdvanceLock) is
    // checked and inserted synchronously BEFORE the await. A second handler
    // entering while this one awaits the server round-trip sees the same key
    // (the combat state has not changed yet — the update lands only with the
    // server response) and refuses. The client-side button disable covers one
    // user's double-click; this covers any two senders racing.
    if (!(await withAdvanceLock(`${combat.id}:${combat.round}:${combat.turn}`, () => combat.nextTurn()))) {
      return { ok: false, error: game.i18n.localize("SDE.crawlStrip.turnAdvanceInProgress") };
    }
    return { ok: true };
  },

  /**
   * GM side of the OUT-OF-COMBAT turn-advance relay. The ONLY permitted
   * action is "advance one turn" of the rolled initiative order; everything
   * else is refused. The holder is whoever CrawlState currently points at on
   * THIS client — the payload carries no ids at all, and ownership is
   * re-verified against that re-read state (canAdvanceOocTurn), so a
   * malicious client cannot advance someone else's turn or fabricate an
   * order. The advance itself goes through the same in-memory lock as the
   * combat path.
   *
   * @param {object} data  { action: "ooc:nextTurn" }. Any other field is ignored.
   * @param {User}   user  The AUTHENTICATED requester, from core's query context.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async handleOocAdvanceQuery(data, user) {
    const refusal = refuseQuery(user, "Out-of-combat turn advances");
    if (refusal) return refusal;
    if (data?.action !== "ooc:nextTurn") {
      return { ok: false, error: game.i18n.localize("SDE.crawlStrip.unknownAction") };
    }

    // Re-read current state — nothing in the payload is trusted. The
    // requester may advance only when they own the CURRENT holder (or are a
    // GM), the crawl is actually in crawl mode (during combat the OoC order
    // is dormant — advanceOocTurn would no-op), and a COMPLETE order exists
    // (every crawl member has rolled — an incomplete order is not an order).
    const holderId = CrawlState.oocTurn;
    const holderActor = holderId ? game.actors.get(holderId) : null;
    const orderActive = CrawlState.mode === "crawl" && oocOrderComplete(CrawlState);
    const verdict = canAdvanceOocTurn({
      orderActive,
      requesterIsGM: !!user?.isGM,
      requesterOwnsCurrentHolder: !!(holderActor && user && holderActor.testUserPermission(user, "OWNER")),
    });
    if (!verdict.ok) {
      const refusalKeys = {
        "no-order": "SDE.crawlStrip.oocTurnAdvanceNoOrder",
        "not-your-turn": "SDE.crawlStrip.turnAdvanceNotYourTurn",
      };
      return {
        ok: false,
        error: game.i18n.localize(refusalKeys[verdict.reason] ?? refusalKeys["not-your-turn"]),
      };
    }

    if (!(await withAdvanceLock("ooc", () => CrawlState.advanceOocTurn()))) {
      return { ok: false, error: game.i18n.localize("SDE.crawlStrip.turnAdvanceInProgress") };
    }
    return { ok: true };
  },

  /**
   * GM-local next-turn advance from the strip's own combat buttons. Same
   * in-memory lock as the relay handler, so a GM clicking next-turn in two
   * tabs (or a fast double-click) produces ONE advance; the loser is a
   * silent no-op — never the player-facing "already in progress" toast, and
   * nothing a GM can notice in ordinary single-click use.
   *
   * @param {Combat} combat
   */
  async _gmAdvanceTurn(combat) {
    await withAdvanceLock(`${combat.id}:${combat.round}:${combat.turn}`, () => combat.nextTurn());
  },

  queueRender() {
    // Microtask debounce: coalesces synchronous hook bursts (e.g. state change
    // + combat hook firing in the same tick) into a single render. Avoiding
    // requestAnimationFrame here because Foundry's canvas pauses rAF callbacks
    // when the scene is idle, which can starve renders triggered by non-canvas
    // events (state changes, settings tweaks, member additions).
    if (this._renderQueued) return;
    this._renderQueued = true;
    Promise.resolve().then(() => {
      this._renderQueued = false;
      this.render();
    });
  },

  destroy() {
    if (this._resizeListener) {
      window.removeEventListener("resize", this._resizeListener);
      this._resizeListener = null;
    }
    for (const [ev, id] of this._hookIds) Hooks.off(ev, id);
    this._hookIds = [];
    this._el?.remove();
    this._el = null;
    this._contextmenuBound = false;
  },

  mount() {
    if (document.getElementById(STRIP_ID)) {
      this._el = document.getElementById(STRIP_ID);
      this.render();
      return;
    }
    const strip = document.createElement("div");
    strip.id = STRIP_ID;
    strip.classList.add("shadowdark-enhancer-strip");

    // Mount into #interface so we can push left past #ui-top's left edge
    const iface = document.getElementById("interface");
    if (iface) {
      iface.prepend(strip);
    } else {
      document.getElementById("ui-top")?.prepend(strip);
    }
    this._el = strip;
    this.render();

    const updateBounds = () => {
      if (!this._el) return;
      const sceneNav = document.getElementById("scene-navigation");
      const sidebar  = document.getElementById("sidebar");
      const iface    = document.getElementById("interface");
      if (!iface) return;

      const ifaceRect = iface.getBoundingClientRect();
      const leftEdge  = sceneNav
        ? sceneNav.getBoundingClientRect().right - ifaceRect.left
        : 0;
      const rightEdge = sidebar
        ? sidebar.getBoundingClientRect().left - ifaceRect.left
        : ifaceRect.width;

      this._el.style.left  = leftEdge + "px";
      this._el.style.width = (rightEdge - leftEdge) + "px";
      this._sizeCards();
    };
    this._resizeListener = updateBounds;
    window.addEventListener("resize", updateBounds);
    this._hookIds.push(["collapseSidebar", Hooks.on("collapseSidebar", () => setTimeout(updateBounds, 350))]);
    this._hookIds.push(["renderSidebar",   Hooks.on("renderSidebar",   () => setTimeout(updateBounds, 350))]);
    this._hookIds.push(["renderSceneNavigation", Hooks.on("renderSceneNavigation", () => setTimeout(updateBounds, 50))]);
    updateBounds();
  },

  // Resolve the strip's member set from current world state.
  //   - crawl mode:  Player tokens explicitly added via Add Tokens
  //                  (CrawlState.members), sorted by OoC init when present
  //   - combat mode: ALL combatants in game.combat.turns order (initiative
  //                  order, including the system's Clockwise Initiative setting).
  //                  No heroes/NPC split — Shadowdark uses individual initiative
  //                  so the strip mirrors the combat tracker's flat list.
  _gatherMembers() {
    const mode = CrawlState.mode;
    if (mode === "off") return { heroes: [], npcs: [], inCombat: false };

    const inCombat = mode === "combat" && !!game.combat;

    if (!inCombat) {
      // Crawl mode — opt-in member list (Add Tokens drives this). Membership is
      // world-scoped: `CrawlState.members` holds ACTOR ids, not scene-local
      // token ids, so the same party shows in the strip on every scene. Each
      // member resolves to its token on the CURRENT scene (when one exists) for
      // movement/select/pan; a member whose actor has no token placed on this
      // scene still gets a card (resolved from the world actor).
      const memberActorIds = CrawlState.members ?? [];
      const scene = canvas.scene;
      const ooc = CrawlState.oocInitiative;
      const entries = memberActorIds
        .map(actorId => {
          const actor = game.actors.get(actorId);
          if (!actor || actor.type !== "Player") return null;
          const tokenDoc = scene?.tokens.find(t => t.actorId === actorId) ?? null;
          return { actorId, actor, tokenDoc };
        })
        .filter(Boolean)
        .sort((a, b) => {
          const ai = ooc[a.actorId]?.roll;
          const bi = ooc[b.actorId]?.roll;
          if (ai != null && bi != null) return bi - ai;
          if (ai != null) return -1;
          if (bi != null) return 1;
          return (a.actor.name ?? "").localeCompare(b.actor.name ?? "");
        });
      const heroes = entries.map(({ actorId, actor, tokenDoc }) => ({
        id:      `member-${actorId}`,
        name:    tokenDoc?.name ?? actor.name ?? "Token",
        img:     tokenDoc?.texture?.src ?? actor.img ?? "icons/svg/mystery-man.svg",
        type:    "player",
        actorId,
        tokenId: tokenDoc?.id ?? null,
      }));
      // Append the synthetic GM card — out of combat always shows it so the
      // GM has a visible "their turn" marker for things like encounter rolls,
      // light tracker ticks, etc. (Vagabond pattern.)
      heroes.push({
        id:      "sde-gm",
        name:    "Game Master",
        img:     game.settings.get(MODULE_ID, "gmAvatarImage") || "icons/svg/cowled.svg",
        type:    "gm",
        actorId: null,
        tokenId: null,
      });
      return { heroes, npcs: [], inCombat: false };
    }

    // Combat — single flat list in initiative order. No heroes/NPC split.
    const turns = game.combat.turns ?? [];
    const heroes = [];
    for (const c of turns) {
      const actor = c.actor;
      if (!actor) continue;
      const tokenDoc = c.token;
      const isPlayer = actor.type === "Player";
      // Dead enemies drop off the strip but stay in the combat tracker — the
      // tracker is the end-of-combat ledger (loot drops and the session recap
      // read defeated combatants from it). Same death test as those readers.
      const hp = actor.system?.attributes?.hp?.value ?? actor.system?.hp?.value ?? 1;
      if (!isPlayer && (c.defeated || hp <= 0)) continue;
      heroes.push({
        id:        `combatant-${c.id}`,
        name:      tokenDoc?.name ?? actor.name,
        img:       tokenDoc?.texture?.src ?? actor.img,
        type:      isPlayer ? "player" : "npc",
        actorId:   actor.id,
        tokenId:   tokenDoc?.id ?? c.tokenId,
        combatantId: c.id,
      });
    }
    return { heroes, npcs: [], inCombat: true };
  },

  render() {
    if (!this._el) return;
    const state = CrawlState;

    if (!state.isActive) {
      this._el.innerHTML = "";
      this._el.classList.remove("sde-strip-visible");
      document.body.classList.remove("sde-strip-active");
      return;
    }

    this._el.classList.add("sde-strip-visible");
    document.body.classList.add("sde-strip-active");
    document.body.classList.toggle("sde-strip-paused", state.mode === "combat");

    const inCombat   = state.mode === "combat";

    // An out-of-combat order is "in effect" only in crawl mode, once EVERY
    // member has rolled AND someone holds the turn (the lock fails open on a
    // missing holder, and so does the presentation — no holder means no turn
    // to show). Shared by the card highlight idiom and the badge below, so
    // the two cannot disagree about whether an order is active.
    const oocOrderActive = !inCombat && oocOrderComplete(state) && !!state.oocTurn;

    const combatantMap = new Map(
      (game.combat?.combatants ?? []).map(c => [c.tokenId, c])
    );

    const { heroes } = this._gatherMembers();

    const makeCard = (m) => {
      // Special-case the synthetic GM card — no actor lookup, no stats, just
      // a visible marker for the GM's turn in the crawl loop.
      if (m.type === "gm") {
        const gmTitle = game.user.isGM
          ? game.i18n.localize("SDE.crawlStrip.gmAvatarPick")
          : esc(m.name);
        return `
        <div class="sde-strip-card-wrap">
          <div class="sde-strip-member sde-strip-active sde-strip-type-gm${game.user.isGM ? " sde-strip-gm-editable" : ""}"
               data-member-id="${m.id}" title="${gmTitle}">
            <img class="sde-strip-portrait" src="${esc(m.img)}" alt="${esc(m.name)}" />
            <div class="sde-strip-overlay">
              <div class="sde-strip-name">${esc(m.name)}</div>
            </div>
          </div>
        </div>`;
      }

      // Resolve actor + token
      let actor = null;
      let tokenDoc = null;
      if (m.tokenId) {
        const token = canvas.tokens?.get(m.tokenId);
        actor    = token?.actor ?? (m.actorId ? game.actors.get(m.actorId) : null);
        tokenDoc = token?.document ?? null;
      } else if (m.actorId) {
        actor = game.actors.get(m.actorId);
      }
      const data = actor ? this._extractData(actor, inCombat, tokenDoc) : null;

      // Combat current-turn detection (no `combatantId` for crawl members)
      const isCurrent  = !!m.combatantId && game.combat?.combatant?.id === m.combatantId;
      // Out-of-combat: the current OoC turn-holder. Only player cards hold
      // the OoC turn (the order is over crawl members).
      const isOocHolder = !inCombat && m.type === "player" && !!m.actorId
        && CrawlState.oocTurn === m.actorId;
      const combatant  = m.combatantId
        ? game.combat?.combatants.get(m.combatantId)
        : (m.tokenId ? combatantMap.get(m.tokenId) : null);
      const isDefeated = combatant?.defeated ?? false;

      // Visibility:
      //   - Players NEVER see a hidden token/combatant — it stays off their
      //     strip until the GM reveals it (no name/HP/presence leak).
      //   - The GM ALWAYS sees it, flagged hidden below (dim + eye-slash) so
      //     they can tell at a glance which cards the party can't see.
      const combatantHidden = combatant?.hidden === true;
      const tokenHidden     = tokenDoc?.hidden === true;
      const isHidden        = combatantHidden || tokenHidden;
      if (isHidden && !game.user.isGM) return "";

      // Active phase highlight — combat and the OoC order speak ONE visual
      // idiom (cardTurnState): the current turn-holder is the active card,
      // everyone else is dim, plus the is-turn accent. With no active order
      // out of combat, every card stays active exactly as before.
      const { isActivePhase, isTurn } = cardTurnState({
        inCombat,
        isCurrent,
        oocOrderActive,
        isOocHolder,
      });

      const displayName = esc(m.name);

      const hpPct   = data && data.hpMax > 0 ? Math.max(0, Math.min(100, Math.round((data.hp / data.hpMax) * 100))) : 0;
      const hpClass = !data || data.hp <= 0     ? "sde-strip-hp-dead"
        : data.hp <= data.hpMax * 0.25          ? "sde-strip-hp-critical"
        : data.hp <= data.hpMax * 0.50          ? "sde-strip-hp-low"
        : data.hp <= data.hpMax * 0.75          ? "sde-strip-hp-mid"
        : "sde-strip-hp-ok";
      const luckClass = data?.luck === 0 ? "sde-strip-pill-empty" : "";
      // Negative = past the soft cap → red. Exactly 0 → empty/dim. Positive → normal.
      const moveClass = (data && data.moveRemaining < 0)
        ? "sde-strip-pill-over"
        : (data?.moveExhausted ? "sde-strip-pill-empty" : "");

      // AC sub-line — rendered right under the name to keep the pill row uncrowded.
      const acLine = (data && data.ac != null)
        ? `<div class="sde-strip-ac-line" title="Armor Class">AC ${data.ac}</div>`
        : "";

      // Pills:
      //   - PCs:  luck + movement
      //   - NPCs in combat: movement only (no luck — NPCs don't carry it)
      let pills = "";
      if (data) {
        if (m.type === "player") {
          // Luck pill is clickable → spends a luck token via actor.system.useLuckToken().
          // Only attach the data-action when there's actually a token to spend.
          // Always include data-actor-id so the GM can right-click to add a token even at zero.
          const luckClickable = data.luck > 0 ? `data-action="spendLuck" role="button" tabindex="0" aria-label="Spend a Luck Token"` : "";
          const luckTitle = data.luck > 0 ? "Click to spend a Luck Token" : (game.user.isGM ? "No Luck Tokens — right-click to add one" : "No Luck Tokens");
          pills = `
        <div class="sde-strip-pills">
          <div class="sde-strip-pill ${luckClass}" data-actor-id="${m.actorId ?? ""}" ${luckClickable} title="${luckTitle}">${ICONS.shamrock}${data.luck}</div>
          <div class="sde-strip-pill ${moveClass}">${ICONS.walking}${data.moveRemaining}/${data.activeSpeed}ft</div>
        </div>`;
        } else if (m.type === "npc" && inCombat) {
          pills = `
        <div class="sde-strip-pills">
          <div class="sde-strip-pill ${moveClass}">${ICONS.walking}${data.moveRemaining}/${data.activeSpeed}ft</div>
        </div>`;
        }
      }

      // Active effects row — status conditions only
      let effectsRow = "";
      if (actor) {
        const activeEffects = actor.effects.filter(e => !e.disabled && e.statuses?.size > 0);
        if (activeEffects.length) {
          const icons = activeEffects.map(e => {
            const icon = esc(e.img || "icons/svg/aura.svg");
            const label = esc(e.name || "Effect");
            const durationInfo = e.duration?.rounds
              ? ` (${e.duration.rounds}R)`
              : "";
            return `<img class="sde-strip-effect-icon" src="${icon}" title="${label}${durationInfo}" alt="${label}" width="18" height="18" />`;
          }).join("");
          effectsRow = `<div class="sde-strip-effects-row">${icons}</div>`;
        }
      }

      // Light-source badge — PC cards only, in both crawl and combat. Shows
      // whether a light is burning (and roughly how much life is left) and lets
      // the owner/GM light or snuff a torch/lantern with one click. Rendered as
      // a direct child of the card (below), NOT inside the pointer-events:none
      // overlay, so its click target is live.
      const lightBadge = (actor && m.type === "player")
        ? this._lightBadgeHTML(actor)
        : "";

      const cardHTML = `
        <div class="sde-strip-member ${isActivePhase ? "sde-strip-active" : "sde-strip-dim"} ${isTurn ? "sde-strip-is-turn" : ""} ${isDefeated ? "sde-strip-defeated" : ""} ${isHidden ? "sde-strip-hidden" : ""} sde-strip-type-${m.type}"
             data-member-id="${m.id}" data-token-id="${m.tokenId ?? ""}" data-actor-id="${m.actorId ?? ""}" ${m.combatantId ? `data-combatant-id="${m.combatantId}"` : ""} title="${!inCombat && isTurn ? game.i18n.localize("SDE.crawlStrip.currentTurn") : ""}" tabindex="0">
          <img class="sde-strip-portrait" src="${esc(m.img)}" alt="${esc(m.name)}" />
          ${isHidden ? `<div class="sde-strip-hidden-icon" title="Hidden from players">${ICONS.eyeSlash}</div>` : ""}
          <div class="sde-strip-overlay">
            ${displayName ? `<div class="sde-strip-name">${displayName}</div>` : ""}
            ${acLine}
            ${effectsRow}
            <div class="sde-strip-bottom">
              <div class="sde-strip-hp-bar-wrap">
                <div class="sde-strip-hp-bar ${hpClass}" style="width:${hpPct}%"></div>
                <span class="sde-strip-hp-label">${data ? `${data.hp}/${data.hpMax}` : ""}</span>
              </div>
              ${pills}
            </div>
          </div>
          ${lightBadge}
          ${isDefeated ? `<div class="sde-strip-defeated-icon">${ICONS.skull}</div>` : ""}
          ${(() => {
            // Combat mode: dice when combatant has no initiative; otherwise show the rolled value as a badge.
            if (inCombat && combatant) {
              if (combatant.initiative == null && (actor?.isOwner || game.user.isGM)) {
                return `<button class="sde-strip-rollinit-btn" data-combatant-id="${combatant.id}" data-action="rollInit" title="Roll Initiative">${ICONS.diceD20}</button>`;
              }
              if (combatant.initiative != null) {
                return `<div class="sde-strip-init-badge" title="Initiative">${combatant.initiative}</div>`;
              }
            }
            // Crawl mode: dice when no oocInitiative; otherwise show the rolled
            // value. Keyed by actorId (world-scoped) so the rolled order carries
            // across scenes.
            if (!inCombat && m.actorId && m.type === "player") {
              const oocEntry = CrawlState.oocInitiative[m.actorId];
              if (!oocEntry && (actor?.isOwner || game.user.isGM)) {
                return `<button class="sde-strip-rollinit-btn" data-actor-id="${m.actorId}" data-action="rollOocInit" title="Roll Initiative (out of combat)">${ICONS.diceD20}</button>`;
              }
              if (oocEntry) {
                return `<div class="sde-strip-init-badge" title="Initiative (out of combat)">${oocEntry.roll}</div>`;
              }
            }
            return "";
          })()}
          ${inCombat && combatant && game.user.isGM ? `<button class="sde-strip-activate-btn ${isCurrent ? "sde-strip-activate-active" : ""}" data-combatant-id="${combatant.id}" data-action="${isCurrent ? "endTurn" : "activateTurn"}" title="${isCurrent ? "End Turn" : "Activate Turn"}">${isCurrent ? ICONS.deactivate : ICONS.activate}</button>` : ""}
        </div>`;

      // Action menu tab strip — owned cards in any mode. Players need to cast
      // utility spells, browse weapons, etc. out of combat too.
      const isNPCType = actor && actor.type !== "Player";
      const showMenu  = actor?.isOwner;
      const tabStrip  = showMenu ? buildTabStripHTML(actor, isNPCType) : "";
      const hasMenu   = showMenu && !!tabStrip;

      return `<div class="sde-strip-card-wrap"
                   ${hasMenu ? `data-has-menu data-actor-id="${actor.id}" data-is-npc="${isNPCType ? 1 : 0}"` : ""}>
        ${cardHTML}
        ${tabStrip}
      </div>`;
    };

    const heroCards = heroes.map(makeCard).join("");

    // Crawl turn badge — the GM can advance the crawl turn straight from the
    // strip (parity with the Crawl Bar's "Next Turn"); players see a static
    // read-only counter. Advancing goes through CrawlState.nextCrawlTurn(),
    // which commits + broadcasts state and captures fresh movement anchors.
    //
    // Out-of-combat turn order (issue #14 part 2): the order is in effect
    // only in crawl mode, once EVERY crawl member has rolled AND someone
    // holds the turn — an incomplete order is not an order, so the advance
    // button appears exactly when the movement lock engages (and no dead
    // buttons exist for a partial order, a holderless order, or during
    // combat). A player only ever sees the advance when the CURRENT holder
    // is an actor they own; the GM re-verifies that ownership on the far
    // side of the relay (handleOocAdvanceQuery).
    const oocHolderId = oocOrderActive ? state.oocTurn : null;
    const playerMayAdvance = !!oocHolderId && !!game.actors.get(oocHolderId)?.isOwner;
    const oocAdvanceBtn = (game.user.isGM || playerMayAdvance)
      ? `<button class="sde-strip-cbtn" data-action="nextOocTurn" title="${game.i18n.localize("SDE.crawlStrip.nextOocTurn")}"${this._turnAdvanceInFlight ? " disabled" : ""}>${ICONS.nextOocTurn}</button>`
      : "";
    const crawlBadge = game.user.isGM
      ? `<div class="sde-strip-combat-controls sde-strip-crawl-controls">
           <div class="sde-strip-crawl-turn" title="${game.i18n.localize("SDE.crawlStrip.crawlRound")}">${state.crawlTurn}</div>
           <button class="sde-strip-cbtn" data-action="nextCrawlTurn" title="${game.i18n.localize("SDE.crawlStrip.nextCrawlRound")}">${ICONS.nextRound}</button>
           ${oocAdvanceBtn}
         </div>`
      : `<div class="sde-strip-combat-controls sde-strip-crawl-controls">
           <div class="sde-strip-turn-num" title="${game.i18n.localize("SDE.crawlStrip.crawlRound")}">${state.crawlTurn}</div>
           ${oocAdvanceBtn}
         </div>`;

    // Left badge — combat controls in combat, crawl turn counter otherwise.
    // The full four-button set is GM-only; a player gets just the round
    // counter plus the next-turn advance, and only while the current
    // combatant is an actor they own (the GM re-verifies that ownership on
    // the far side of the relay — crawl-turn-core.mjs).
    const leftBadge = inCombat ? this._combatControlsHTML() : crawlBadge;

    // Merchant Shop launcher — visible to the GM always, and to players only
    // while the shop is open for them. Re-renders pick up availability changes
    // because MerchantShop calls CrawlStrip.queueRender() when it toggles.
    // Never shown in combat: shopping isn't a combat action, and the strip is
    // the initiative board there.
    const shopAvailable = !inCombat
      && (game.user.isGM || game.settings.get(MODULE_ID, "shopAvailableToPlayers"));
    const shopButton = shopAvailable
      ? `<button class="sde-strip-merchant-btn" data-action="openMerchant" title="Open Merchant Shop"><i class="fas fa-store"></i></button>`
      : "";

    // Combat: single flat init-ordered list, no PARTY/NPCS label.
    // Crawl:  Players-only list with PARTY label. The label plate is a column —
    //         PARTY claims the space above, the shop button fills the dead
    //         space beneath it (the vertical word never reaches the bottom).
    const heroesBlock = heroCards
      ? (inCombat
          ? `<div class="sde-strip-group sde-strip-group-combat">
               <div class="sde-strip-members">${heroCards}</div>
             </div>`
          : `<div class="sde-strip-group sde-strip-group-heroes">
               <div class="sde-strip-label-col sde-strip-label-heroes">
                 <div class="sde-strip-group-label">PARTY</div>
                 ${shopButton}
               </div>
               <div class="sde-strip-members">${heroCards}</div>
             </div>`)
      : "";
    const npcsBlock = ""; // no longer used — kept identifier for diff readability

    // An empty party draws no label plate to tuck the button into, so in that
    // one case it keeps its old spot at the end of the strip. (Combat never
    // renders it at all — `shopAvailable` is false there.)
    const looseShopButton = heroCards ? "" : shopButton;

    this._el.innerHTML = `
      <div class="sde-strip-inner ${inCombat ? "sde-strip-paused" : ""}">
        ${leftBadge}
        ${heroesBlock}
        ${npcsBlock}
        ${looseShopButton}
      </div>`;

    this._bindEvents();
    this._sizeCards();
    bindActionMenuEvents(this._el);
    requestAnimationFrame(() => {
      if (!this._el) return;
      const h = this._el.getBoundingClientRect().height ?? 0;
      if (h > 0) document.documentElement.style.setProperty("--sde-strip-height", Math.ceil(h) + "px");
    });
  },

  /**
   * The combat-control button column. GMs get the full set (previous/next
   * round and turn) exactly as before, all acting locally. A non-GM gets
   * ONLY the advance they may actually use: the next-turn button renders
   * solely while the current combatant's actor is one they own, and even
   * then the GM re-checks ownership at handling time — so this is a UI
   * filter, not the gate. prevTurn / nextRound / prevRound are never
   * rendered for players.
   */
  _combatControlsHTML() {
    const combat = game.combat;
    const roundNum = `<div class="sde-strip-round-num">R${combat?.round ?? 1}</div>`;
    if (game.user.isGM) {
      return `<div class="sde-strip-combat-controls">
        <button class="sde-strip-cbtn" data-combat="prevRound" title="${game.i18n.localize("SDE.crawlStrip.combatPrevRound")}">${ICONS.prevRound}</button>
        <button class="sde-strip-cbtn" data-combat="prevTurn"  title="${game.i18n.localize("SDE.crawlStrip.combatPrevTurn")}">${ICONS.prevRound}</button>
        ${roundNum}
        <button class="sde-strip-cbtn" data-combat="nextTurn"  title="${game.i18n.localize("SDE.crawlStrip.combatNextTurn")}">${ICONS.nextRound}</button>
        <button class="sde-strip-cbtn" data-combat="nextRound" title="${game.i18n.localize("SDE.crawlStrip.combatNextRound")}">${ICONS.nextRound}</button>
      </div>`;
    }
    const currentCombatant = combat?.combatant;
    const mayAdvance = !!currentCombatant?.actor && currentCombatant.actor.isOwner;
    const busy = this._turnAdvanceInFlight;
    return `<div class="sde-strip-combat-controls">
      ${roundNum}
      ${mayAdvance
        ? `<button class="sde-strip-cbtn" data-combat="nextTurn" title="${game.i18n.localize("SDE.crawlStrip.combatNextTurn")}"${busy ? " disabled" : ""}>${ICONS.nextRound}</button>`
        : ""}
    </div>`;
  },

  _sizeCards() {
    if (!this._el) return;
    const available = this._el.getBoundingClientRect().width;
    if (available < 10) return;

    const cards = this._el.querySelectorAll(".sde-strip-member");
    if (!cards.length) return;

    const n      = cards.length;
    const gap    = 2;
    const reserved = 36 + 16 + 16 + 32;
    const maxW   = 110;
    const maxH   = 130;

    const idealW = (available - reserved - gap * (n - 1)) / n;
    const cardW  = Math.min(maxW, Math.max(36, Math.floor(idealW)));
    const cardH  = Math.round(cardW * (maxH / maxW));

    cards.forEach(c => {
      c.style.width  = cardW + "px";
      c.style.height = cardH + "px";
    });
  },

  /**
   * Extract per-actor display data.
   * Shadowdark adaptation:
   *   - HP from actor.system.attributes.hp.{value,max}
   *   - Luck from actor.system.luck.{remaining|available}
   *   - Movement from MovementTracker (module setting, not per-actor)
   */
  _extractData(actor, inCombat = false, tokenDoc = null) {
    const s = actor.system ?? {};
    const hp = s.attributes?.hp ?? { value: 0, max: 0 };
    const ac = s.attributes?.ac?.value ?? null;   // Shadowdark stores derived AC at system.attributes.ac.value

    // Luck count for the shamrock pill.
    //   - Pulp Mode (`shadowdark.usePulpMode` setting): luck is numeric; show
    //     `remaining` directly (which can be 0). `available` is leftover from
    //     non-pulp use and must be ignored.
    //   - Classic mode: a fresh PC has `{available: true, remaining: 0}` (one
    //     base token). After spending, `available` flips to false. Show
    //     `remaining` if > 0, else 1 if `available`, else 0.
    const luckObj = s.luck ?? {};
    const pulp = game.settings.get("shadowdark", "usePulpMode") === true;
    let luck = 0;
    if (pulp) {
      luck = typeof luckObj.remaining === "number" ? luckObj.remaining : 0;
    } else if (typeof luckObj.remaining === "number" && luckObj.remaining > 0) {
      luck = luckObj.remaining;
    } else if (luckObj.available === true) {
      luck = 1;
    }

    // Movement — module setting drives the budget. No per-actor speed in Shadowdark.
    // Reads the per-token moveRemaining flag directly (Vagabond pattern).
    const mode        = inCombat ? "combat" : "crawl";
    const activeSpeed = MovementTracker.budgetFor(mode, tokenDoc);
    const moveRemaining = MovementTracker.remainingFor(tokenDoc, mode);

    return {
      hp:           hp.value ?? 0,
      hpMax:        hp.max   ?? 0,
      ac,
      luck,
      activeSpeed,
      moveRemaining,
      moveExhausted: moveRemaining <= 0,
    };
  },

  /**
   * Build the corner light-source badge for a PC card. Returns "" when the
   * actor carries no light source (keeps the card uncluttered).
   *
   * States (from computeLightState):
   *   - lit:       glowing flame, colour by remaining life; owner/GM click snuffs it
   *   - available: dim ember; owner/GM click lights it (chooser when >1 carried)
   *
   * @param {Actor} actor
   * @returns {string}
   */
  _lightBadgeHTML(actor) {
    const items = actor.items?.contents ?? Array.from(actor.items ?? []);
    const state = computeLightState(items);
    if (state.state === "none") return "";

    const canToggle = !!(actor.isOwner || game.user.isGM);
    const lit       = state.state === "lit";
    // Interactive only when there's an action to take: snuff a Basic source, or
    // light a carried one. Effect-only lit sources are read-only indicators.
    const hasAction = lit ? !!state.toggleId : (state.choices?.length > 0);
    const clickable = canToggle && hasAction;

    // Respect the system's "players see remaining minutes" setting for non-GMs.
    let showMins = game.user.isGM;
    if (!showMins) {
      try { showMins = (game.settings.get("shadowdark", "playerShowLightRemaining") ?? 0) > 1; }
      catch { showMins = false; }
    }

    let title;
    if (lit) {
      const mins = showMins ? ` — ${state.remainingMins} min left` : "";
      const tail = clickable ? " · click to put out" : "";
      title = `${state.activeName} is lit${mins}${tail}`;
    } else if (state.choices.length === 1) {
      title = `Light ${state.choices[0].name}`;
    } else {
      title = `Light a source (${state.choices.length} carried)`;
    }

    const classes = [
      "sde-strip-light-badge",
      lit ? "sde-strip-light-lit" : "sde-strip-light-off",
      lit && state.lifeClass ? state.lifeClass : "",
      clickable ? "sde-strip-light-clickable" : "",
    ].filter(Boolean).join(" ");

    const actionAttrs = clickable
      ? `data-action="toggleLight" data-actor-id="${actor.id}"${state.toggleId ? ` data-light-id="${state.toggleId}"` : ""} role="button" tabindex="0" aria-label="${esc(title)}"`
      : "";

    return `<div class="${classes}" ${actionAttrs} title="${esc(title)}">${ICONS.torch}</div>`;
  },

  // Owner/GM clicked a light badge. Resolve the target source, then toggle via
  // the system's own sheet flow (chat card + light tracker + token light stay
  // in sync). A missing direct target means several carriables → chooser.
  async _onToggleLight(el) {
    const actor = el.dataset.actorId ? game.actors.get(el.dataset.actorId) : null;
    if (!actor || !(actor.isOwner || game.user.isGM)) return;

    const directId = el.dataset.lightId;
    if (directId) return this._applyLightToggle(actor, directId);

    const items = actor.items?.contents ?? Array.from(actor.items ?? []);
    const carried = items.filter(i => isLightItem(i) && i.type === "Basic" && !i.system.light.active);
    if (!carried.length) return;
    if (carried.length === 1) return this._applyLightToggle(actor, carried[0].id);

    const chosen = await this._promptLightChoice(actor, carried);
    if (chosen) await this._applyLightToggle(actor, chosen);
  },

  async _applyLightToggle(actor, itemId) {
    const item = actor.items.get(itemId);
    if (!item) return;
    try {
      // Prefer the system's PlayerSheet flow: it snuffs any other active light,
      // stamps hasBeenUsed, updates the token light, posts the chat card, and
      // pings the Light Source Tracker — all the things a raw item update skips.
      if (typeof actor.sheet?._toggleLightSource === "function") {
        await actor.sheet._toggleLightSource(item);
      } else {
        await this._fallbackToggleLight(actor, item);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | light toggle failed`, err);
      ui.notifications?.warn("Could not toggle that light source.");
    }
    this.queueRender();
  },

  // Defensive path if the system sheet API is unavailable — mirror its core
  // effect: snuff other active lights, flip this one, sync the token light.
  async _fallbackToggleLight(actor, item) {
    const active = !item.system.light.active;
    const updates = [];
    if (active) {
      for (const l of actor.items) {
        if (isLightItem(l) && l.system.light.active) {
          updates.push({ _id: l.id, "system.light.active": false });
        }
      }
    }
    updates.push({ _id: item.id, "system.light.active": active, "system.light.hasBeenUsed": true });
    await actor.updateEmbeddedDocuments("Item", updates);
    if (typeof actor.toggleLight === "function") await actor.toggleLight(active, item.id);
  },

  async _promptLightChoice(actor, carried) {
    const dlg = foundry?.applications?.api?.DialogV2;
    if (!dlg?.wait) return carried[0]?.id ?? null; // no DialogV2 → light the first
    const buttons = carried.map(i => ({ action: i.id, label: esc(i.name), icon: "fas fa-fire" }));
    buttons.push({ action: "cancel", label: game.i18n.localize("Cancel"), icon: "fas fa-times" });
    const result = await dlg.wait({
      window: { title: "Light a Source", icon: "fas fa-fire" },
      content: `<p>Which light source should ${esc(actor.name)} light?</p>`,
      buttons,
      rejectClose: false,
    }).catch(() => null);
    return (result && result !== "cancel") ? result : null;
  },

  _bindEvents() {
    if (!this._el) return;

    // Card double-click → open sheet; single-click → pan + select token
    this._el.querySelectorAll(".sde-strip-member").forEach(card => {
      card.addEventListener("dblclick", async (ev) => {
        if (ev.target.closest(".sde-strip-activate-btn")) return;
        if (ev.target.closest(".sde-strip-rollinit-btn")) return;
        const tokenId = card.dataset.tokenId;
        const token = tokenId ? canvas.tokens?.get(tokenId) : null;
        const actor = token?.actor ?? (card.dataset.actorId ? game.actors.get(card.dataset.actorId) : null);
        if (actor) actor.sheet.render(true);
      });
      card.addEventListener("click", async (ev) => {
        // GM avatar card → click to pick a portrait (GM only). The synthetic
        // GM card has no token/actor, so it owns its own click behaviour.
        if (card.classList.contains("sde-strip-type-gm")) {
          if (!game.user.isGM) return;
          ev.stopPropagation();
          const FilePickerImpl = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
          const fp = new FilePickerImpl({
            type: "imagevideo",
            current: game.settings.get(MODULE_ID, "gmAvatarImage") || "",
            callback: async (path) => {
              await game.settings.set(MODULE_ID, "gmAvatarImage", path);
              this.queueRender();
            },
          });
          fp.render(true);
          return;
        }
        if (ev.target.closest(".sde-strip-activate-btn")) return;
        if (ev.target.closest(".sde-strip-rollinit-btn")) {
          ev.stopPropagation();
          const btn = ev.target.closest(".sde-strip-rollinit-btn");
          const action = btn.dataset.action;

          if (action === "rollOocInit") {
            // Crawl-mode out-of-combat initiative — uses InitiativeManager so
            // the roll goes through Roll#toMessage (chat card + DsN). Keyed by
            // actor (world-scoped membership).
            const actorId = btn.dataset.actorId;
            if (actorId && !CrawlState.oocInitiative[actorId]) {
              const { InitiativeManager } = await import("./initiative-manager.mjs");
              await InitiativeManager.rollOocForActor(actorId);
              this.queueRender();
            }
            return;
          }

          // Combat-mode initiative — combat exists, combatant has no init yet
          const combatantId = btn.dataset.combatantId;
          const combat = game.combat;
          const combatant = (combatantId && combat) ? combat.combatants.get(combatantId) : null;
          if (combatant && combatant.initiative == null) {
            await combat.rollInitiative([combatant.id]);
            this.queueRender();
          }
          return;
        }

        // Luck pill click → spend (if owned) or offer to give (if another player's).
        // Match on data-actor-id so pills at 0 luck are still reachable for giving.
        const luckBtn = ev.target.closest('.sde-strip-pill[data-actor-id]');
        if (luckBtn) {
          ev.stopPropagation();
          const actorId = luckBtn.dataset.actorId;
          const actor = actorId ? game.actors.get(actorId) : null;
          if (!actor) return;
          // Owned pill with luck → spend normally
          if (actor.isOwner && luckBtn.hasAttribute("data-action")) {
            if (actor.system?.useLuckToken) await actor.system.useLuckToken(true);
            return;
          }
          // Owned pill at 0 → nothing to spend
          if (actor.isOwner) return;
          // Another player's pill → offer to give a luck token from your own PC
          await this._offerGiveLuck(actor);
          return;
        }

        const tokenId = card.dataset.tokenId;
        if (!tokenId) return;
        const token = canvas.tokens?.get(tokenId);
        if (!token) return;
        token.control({ releaseOthers: !ev.shiftKey });
        await canvas.animatePan({ x: token.center.x, y: token.center.y,
          scale: Math.max(canvas.stage.scale.x, 0.5) });
      });

      // Keyboard parity: Enter/Space on the focused card = select + pan
      // (same as click), or spend Luck when the pill is focused. Real
      // <button>s inside the card handle their own keys.
      card.addEventListener("keydown", ev => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        if (ev.target.closest("button")) return;
        ev.preventDefault();
        ev.stopPropagation();
        const luck = ev.target.closest('[data-action="spendLuck"]');
        if (luck) luck.click(); else card.click();
      });
    });

    // Light-source badges — clickable for a member's owner or the GM (bound
    // before the GM-only guard below so players can light their own torch).
    // stopPropagation keeps the card's select/pan click from also firing.
    this._el.querySelectorAll('[data-action="toggleLight"]').forEach(el => {
      el.addEventListener("click", async ev => {
        ev.stopPropagation();
        ev.preventDefault();
        await this._onToggleLight(el);
      });
      el.addEventListener("keydown", ev => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        ev.stopPropagation();
        el.click();
      });
    });

    // Merchant Shop button — available to the GM always, to players when the
    // shop is open. openLocally() renders the manage view (GM) or buy/sell
    // (player). Bound before the GM-only guard below so players can open it.
    const merchantBtn = this._el.querySelector('[data-action="openMerchant"]');
    if (merchantBtn) {
      merchantBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        game.shadowdarkEnhancer?.merchant?.openLocally();
      });
    }

    // Luck pill right-click → GM adds a luck token (delegated on the strip so
    // it survives re-renders). Matches on data-actor-id so empty pills work too.
    // Bound once via a flag — _bindEvents runs on every render, and addEventListener
    // on the persistent strip element would otherwise stack duplicate listeners.
    if (!this._contextmenuBound) {
      this._contextmenuBound = true;
      this._el.addEventListener("contextmenu", async (ev) => {
        const luckBtn = ev.target.closest('.sde-strip-pill[data-actor-id]');
        if (!luckBtn) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (!game.user.isGM) return;
        const actorId = luckBtn.dataset.actorId;
        const actor = actorId ? game.actors.get(actorId) : null;
        if (actor) await this._addLuckToken(actor);
      });
    }

    // Combat control buttons (prev/next round/turn). Bound on every client:
    // the next-turn advance is a player action too when the current
    // combatant's actor is theirs. A GM's click advances locally, exactly as
    // before; a player's click relays through the authenticated GM channel,
    // whose handler re-verifies ownership against current combat state before
    // advancing (handleAdvanceTurnQuery / canAdvanceTurn). The other three
    // buttons are GM-only and never rendered for players — a player's click
    // here can only ever be the advance they were shown.
    this._el.querySelectorAll(".sde-strip-cbtn[data-combat]").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const action = btn.dataset.combat;
        const combat = game.combat;
        if (!combat) return;
        if (action === "nextTurn") {
          if (game.user.isGM) {
            // Same in-memory lock as the relay path: a GM clicking next-turn
            // in two tabs produces one advance, not two.
            await this._gmAdvanceTurn(combat);
          } else {
            // One relayed advance at a time: a double-click (or a re-render
            // that re-enables the button mid-flight) must not queue a second
            // request. The GM side is still the authoritative guard.
            if (this._turnAdvanceInFlight) return;
            this._turnAdvanceInFlight = true;
            btn.disabled = true;
            try {
              await relayToGM(CRAWL_TURN_QUERY, { action: "combat:nextTurn" },
                { label: "combat turn advances" });
            } finally {
              this._turnAdvanceInFlight = false;
              this.queueRender(); // re-render re-enables the button
            }
          }
          return;
        }
        if (!game.user.isGM) return;
        // prevTurn / nextRound / prevRound are DELIBERATELY NOT locked. A GM
        // double-click here (two tabs, or a fast repeat) can double-advance
        // world time — `Combat#nextRound` writes `worldTime: {delta}` and
        // fires `combatRound` per call (foundry.mjs:50983) — the same class
        // as the nextTurn hole, but GM-only, self-inflicted, and identical to
        // core tracker behaviour. Out of scope for the player-channel fix;
        // only nextTurn goes through withAdvanceLock.
        if      (action === "prevTurn")   await combat.previousTurn();
        else if (action === "nextRound")  await combat.nextRound();
        else if (action === "prevRound")  await combat.previousRound();
      });
    });

    // Out-of-combat turn advance — the current OoC turn-holder (or any GM)
    // advances the rolled initiative order. GMs advance locally under the
    // same in-memory lock (two tabs produce one advance); players relay
    // through the authenticated GM channel (handleOocAdvanceQuery), which
    // re-verifies ownership of the CURRENT holder before advancing.
    this._el.querySelectorAll('.sde-strip-cbtn[data-action="nextOocTurn"]').forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        if (game.user.isGM) {
          await withAdvanceLock("ooc", () => CrawlState.advanceOocTurn());
          return;
        }
        if (this._turnAdvanceInFlight) return;
        this._turnAdvanceInFlight = true;
        btn.disabled = true;
        try {
          await relayToGM(OOC_TURN_QUERY, { action: "ooc:nextTurn" },
            { label: "out-of-combat turn advances" });
        } finally {
          this._turnAdvanceInFlight = false;
          this.queueRender(); // re-render re-enables the button
        }
      });
    });

    if (!game.user.isGM) return;

    // Crawl turn advance — strip parity with the Crawl Bar's "Next Turn".
    this._el.querySelectorAll('.sde-strip-cbtn[data-action="nextCrawlTurn"]').forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        await CrawlState.nextCrawlTurn();
      });
    });

    // Activate / end-turn buttons — bridge to the combat tracker's native buttons
    this._el.querySelectorAll(".sde-strip-activate-btn").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const combatantId = btn.dataset.combatantId;
        const action      = btn.dataset.action;
        const combat = game.combat;
        if (!combat) return;
        if (action === "activateTurn") {
          // Find combatant's turn index, advance combat to it
          const idx = combat.turns.findIndex(c => c.id === combatantId);
          if (idx >= 0) await combat.update({ turn: idx });
        } else if (action === "endTurn") {
          await combat.nextTurn();
        }
      });
    });
  },

  /**
   * Add a luck token to an actor (GM right-click on the Luck pill).
   * Respects Pulp/Classic mode just like the display logic in _extractData.
   */
  async _addLuckToken(actor) {
    const system = actor.system;
    const pulp = game.settings.get("shadowdark", "usePulpMode") === true;

    // Classic mode stores one boolean token and the system's useLuckToken()
    // only ever reads luck.available outside pulp — an "extra" written to
    // luck.remaining there is a token the player can never spend. Say so.
    if (!pulp && system.luck?.available) {
      ui.notifications?.warn(`${actor.name} already has a luck token.`);
      return;
    }

    const update = pulp
      ? { "system.luck.remaining": (system.luck.remaining ?? 0) + 1 }
      : { "system.luck.available": true };

    await actor.update(update);

    await ChatMessage.create({
      content: game.i18n.format("SDE.crawlStrip.luckTokenRegained", { name: actor.name }),
      speaker: ChatMessage.getSpeaker({ actor }),
      user: game.user.id,
    });

    this.queueRender();
  },

  /**
   * Show a dialog offering to give one of your own luck tokens to another PC.
   * @param {Actor} receiver — the actor whose pill was clicked
   */
  async _offerGiveLuck(receiver) {
    // Find PCs owned by the current user that have luck tokens to give
    const owned = game.actors.filter(a =>
      a.type === "Player" && a.isOwner && this._luckCount(a) > 0
    );

    if (!owned.length) {
      ui.notifications?.warn("You have no luck tokens to give.");
      return;
    }

    // Single giver → straightforward confirmation
    if (owned.length === 1) {
      const giver = owned[0];
      const dlg = foundry?.applications?.api?.DialogV2;
      if (!dlg?.confirm) {
        await this._executeGive(giver, receiver);
        return;
      }
      const confirmed = await dlg.confirm({
        window: { title: "Give Luck Token" },
        content: game.i18n.format("SDE.crawlStrip.giveLuckConfirm", {
          giver: giver.name,
          receiver: receiver.name,
        }),
        yes: { label: "Give", icon: "fas fa-hand-holding-heart" },
        no: { label: "Cancel", icon: "fas fa-times" },
        defaultYes: false,
      }).catch(() => false);
      if (confirmed) await this._executeGive(giver, receiver);
      return;
    }

    // Multiple givers → pick which PC to give from
    const dlg = foundry?.applications?.api?.DialogV2;
    if (!dlg?.wait) {
      await this._executeGive(owned[0], receiver);
      return;
    }
    const buttons = owned.map(a => ({
      action: a.id,
      label: `${a.name} (${this._luckCount(a)} luck)`,
      icon: "fas fa-user",
    }));
    buttons.push({ action: "cancel", label: game.i18n.localize("Cancel"), icon: "fas fa-times" });
    const chosen = await dlg.wait({
      window: { title: "Give Luck Token" },
      content: game.i18n.format("SDE.crawlStrip.giveLuckChoose", { receiver: receiver.name }),
      buttons,
      rejectClose: false,
    }).catch(() => null);
    if (!chosen || chosen === "cancel") return;
    const giver = game.actors.get(chosen);
    if (giver) await this._executeGive(giver, receiver);
  },

  /**
   * Route a luck-give through the GM if the current user isn't one.
   * Players can't update another actor directly, so we relay via socket.
   */
  async _executeGive(giver, receiver) {
    if (game.user.isGM) {
      await this._giveLuckToken(giver, receiver);
    } else {
      await relayToGM(LUCK_QUERY, {
        action: "luck:give",
        giverId: giver.id,
        receiverId: receiver.id,
      }, { label: "luck token gifts" });
    }
  },

  /**
   * Transfer one luck token from giver to receiver. Both are Player actors.
   */
  async _giveLuckToken(giver, receiver) {
    const pulp = game.settings.get("shadowdark", "usePulpMode") === true;
    const rSystem = receiver.system;

    // Classic mode has one boolean token per PC, so a receiver already holding
    // it has nowhere to put a second — refuse before anyone spends anything
    // rather than bank an unspendable one (see _addLuckToken).
    if (!pulp && rSystem.luck?.available) {
      ui.notifications?.warn(`${receiver.name} already has a luck token.`);
      return;
    }

    // Spend from giver (use the system method so classic/pulp are handled
    // correctly). It returns false when there was nothing to spend — crediting
    // the receiver anyway would mint a token out of nothing.
    const spent = await giver.system?.useLuckToken?.(false);
    if (spent === false) {
      ui.notifications?.warn(`${giver.name} has no luck token to give.`);
      return;
    }

    const update = pulp
      ? { "system.luck.remaining": (rSystem.luck.remaining ?? 0) + 1 }
      : { "system.luck.available": true };
    await receiver.update(update);

    await ChatMessage.create({
      content: game.i18n.format("SDE.crawlStrip.luckTokenGiven", {
        giver: giver.name,
        receiver: receiver.name,
      }),
      speaker: ChatMessage.getSpeaker({ actor: giver }),
      user: game.user.id,
    });

    this.queueRender();
  },

  /**
   * Count displayable luck tokens for a player actor.
   * Mirrors the logic in _extractData so the count matches what's on the pill.
   */
  _luckCount(actor) {
    const luck = actor.system?.luck ?? {};
    const pulp = game.settings.get("shadowdark", "usePulpMode") === true;
    if (pulp) return typeof luck.remaining === "number" ? luck.remaining : 0;
    if (typeof luck.remaining === "number" && luck.remaining > 0) return luck.remaining;
    if (luck.available === true) return 1;
    return 0;
  },
};
