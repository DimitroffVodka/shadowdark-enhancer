/**
 * Shadowdark Enhancer — Crawl Strip
 *
 * Faithful port of vagabond-crawler/scripts/crawl-strip.mjs.
 * Adapted for Shadowdark's simpler CrawlState model:
 *   - No heroes/gm phases — just `mode: "off" | "crawl" | "combat"`
 *   - Single `crawlTurn` counter (no phase toggle)
 *   - Luck instead of Stress (shamrock icon stays; semantics shift)
 *   - Movement is module-setting-driven (no per-actor speed field)
 */

import { MODULE_ID }        from "./module-id.mjs";
import { CrawlState }       from "./crawl-state.mjs";
import { MovementTracker }  from "./movement-tracker.mjs";
import { ICONS }            from "./icons.mjs";
import {
  buildTabStripHTML,
  bindActionMenuEvents,
  closeActionMenu,
} from "./npc-action-menu.mjs";

const STRIP_ID = "shadowdark-enhancer-strip";

export const CrawlStrip = {

  _el:             null,
  _renderQueued:   false,
  _hookIds:        [],
  _resizeListener: null,

  init() {
    this.mount();
    const queue = () => this.queueRender();
    this._hookIds.push(Hooks.on(CrawlState.HOOK_CHANGED, queue));
    this._hookIds.push(Hooks.on("combatStart",   queue));
    this._hookIds.push(Hooks.on("combatRound",   queue));
    this._hookIds.push(Hooks.on("combatTurn",    () => { closeActionMenu(); queue(); }));
    this._hookIds.push(Hooks.on("updateCombat",  queue));
    this._hookIds.push(Hooks.on("updateCombatant", queue));
    this._hookIds.push(Hooks.on("createCombatant", queue));
    this._hookIds.push(Hooks.on("deleteCombatant", queue));
    this._hookIds.push(Hooks.on("deleteCombat",  queue));
    this._hookIds.push(Hooks.on("updateActor",   queue));
    this._hookIds.push(Hooks.on("updateToken",   queue));
    this._hookIds.push(Hooks.on("createToken",   queue));
    this._hookIds.push(Hooks.on("deleteToken",   queue));
    this._hookIds.push(Hooks.on("canvasReady",   queue));
    this._hookIds.push(Hooks.on("updateItem",    queue));
    this._hookIds.push(Hooks.on("createActiveEffect", queue));
    this._hookIds.push(Hooks.on("deleteActiveEffect", queue));
    this._hookIds.push(Hooks.on("updateActiveEffect", queue));
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
    for (const id of this._hookIds) Hooks.off(id);
    this._hookIds = [];
    this._el?.remove();
    this._el = null;
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
    this._hookIds.push(Hooks.on("collapseSidebar", () => setTimeout(updateBounds, 350)));
    this._hookIds.push(Hooks.on("renderSidebar",   () => setTimeout(updateBounds, 350)));
    this._hookIds.push(Hooks.on("renderSceneNavigation", () => setTimeout(updateBounds, 50)));
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
      // Crawl mode — opt-in member list (Add Tokens drives this).
      const memberIds = CrawlState.members ?? [];
      const scene = canvas.scene;
      const ooc = CrawlState.oocInitiative;
      const tokens = memberIds
        .map(id => scene?.tokens.get(id))
        .filter(t => t && t.actor?.type === "Player")
        .sort((a, b) => {
          const ai = ooc[a.id]?.roll;
          const bi = ooc[b.id]?.roll;
          if (ai != null && bi != null) return bi - ai;
          if (ai != null) return -1;
          if (bi != null) return 1;
          return (a.actor?.name ?? "").localeCompare(b.actor?.name ?? "");
        });
      const heroes = tokens.map(t => this._memberFromToken(t, "player"));
      // Append the synthetic GM card — out of combat always shows it so the
      // GM has a visible "their turn" marker for things like encounter rolls,
      // light tracker ticks, etc. (Vagabond pattern.)
      heroes.push({
        id:      "sde-gm",
        name:    "Game Master",
        img:     "icons/svg/cowled.svg",
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

  _memberFromToken(tokenDoc, type) {
    const actor = tokenDoc.actor;
    return {
      id:      `token-${tokenDoc.id}`,
      name:    tokenDoc.name ?? actor?.name ?? "Token",
      img:     tokenDoc.texture?.src ?? actor?.img ?? "icons/svg/mystery-man.svg",
      type,
      actorId: actor?.id ?? null,
      tokenId: tokenDoc.id,
    };
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
    const hideHidden = game.settings.get(MODULE_ID, "hideHiddenNpcCards") && !game.user.isGM;

    const combatantMap = new Map(
      (game.combat?.combatants ?? []).map(c => [c.tokenId, c])
    );

    const { heroes, npcs } = this._gatherMembers();

    const makeCard = (m) => {
      // Special-case the synthetic GM card — no actor lookup, no stats, just
      // a visible marker for the GM's turn in the crawl loop.
      if (m.type === "gm") {
        return `
        <div class="sde-strip-card-wrap">
          <div class="sde-strip-member sde-strip-active sde-strip-type-gm"
               data-member-id="${m.id}">
            <img class="sde-strip-portrait" src="${m.img}" alt="${m.name}" />
            <div class="sde-strip-overlay">
              <div class="sde-strip-name">${m.name}</div>
            </div>
            <div class="sde-strip-gm-crown">${ICONS.gmCrown}</div>
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
      const combatant  = m.combatantId
        ? game.combat?.combatants.get(m.combatantId)
        : (m.tokenId ? combatantMap.get(m.tokenId) : null);
      const isDefeated = combatant?.defeated ?? false;

      // Visibility — hide cards for hidden combatants/tokens from non-GMs
      const combatantHidden = combatant?.hidden === true;
      const tokenHidden     = tokenDoc?.hidden === true;
      if (combatantHidden && tokenHidden) return "";
      if ((combatantHidden || tokenHidden) && !game.user.isGM) return "";
      if (hideHidden && (combatantHidden || tokenHidden)) return "";

      // Active phase highlight:
      //   - in combat: the current combatant is "active"; everyone else dim
      //   - in crawl:  all heroes are "active" (no phase split)
      const isActivePhase = inCombat ? isCurrent : true;

      const displayName = m.name;

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
          const luckClickable = data.luck > 0 ? `data-action="spendLuck" data-actor-id="${m.actorId ?? ""}"` : "";
          const luckTitle = data.luck > 0 ? "Click to spend a Luck Token" : "No Luck Tokens";
          pills = `
        <div class="sde-strip-pills">
          <div class="sde-strip-pill ${luckClass}" ${luckClickable} title="${luckTitle}">${ICONS.shamrock}${data.luck}</div>
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
            const icon = e.img || "icons/svg/aura.svg";
            const label = e.name || "Effect";
            const durationInfo = e.duration?.rounds
              ? ` (${e.duration.rounds}R)`
              : "";
            return `<img class="sde-strip-effect-icon" src="${icon}" title="${label}${durationInfo}" alt="${label}" width="18" height="18" />`;
          }).join("");
          effectsRow = `<div class="sde-strip-effects-row">${icons}</div>`;
        }
      }

      const cardHTML = `
        <div class="sde-strip-member ${isActivePhase ? "sde-strip-active" : "sde-strip-dim"} ${isCurrent ? "sde-strip-is-turn" : ""} ${isDefeated ? "sde-strip-defeated" : ""} sde-strip-type-${m.type}"
             data-member-id="${m.id}" data-token-id="${m.tokenId ?? ""}" data-actor-id="${m.actorId ?? ""}" ${m.combatantId ? `data-combatant-id="${m.combatantId}"` : ""}>
          <img class="sde-strip-portrait" src="${m.img}" alt="${m.name}" />
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
          ${isCurrent ? `<div class="sde-strip-turn-badge">${ICONS.turnArrow}</div>` : ""}
          ${isDefeated ? `<div class="sde-strip-defeated-icon">${ICONS.skull}</div>` : ""}
          ${inCombat && combatant && game.user.isGM ? `<button class="sde-strip-activate-btn ${isCurrent ? "sde-strip-activate-active" : ""}" data-combatant-id="${combatant.id}" data-action="${isCurrent ? "endTurn" : "activateTurn"}" title="${isCurrent ? "End Turn" : "Activate Turn"}">${isCurrent ? ICONS.deactivate : ICONS.activate}</button>` : ""}
        </div>`;

      // Action menu tab strip — only during combat, only for owned actors, only below the card
      const isNPCType = actor && actor.type !== "Player";
      const showMenu  = inCombat && actor?.isOwner;
      const tabStrip  = showMenu ? buildTabStripHTML(actor, isNPCType) : "";
      const hasMenu   = showMenu && !!tabStrip;

      return `<div class="sde-strip-card-wrap"
                   ${hasMenu ? `data-has-menu data-actor-id="${actor.id}" data-is-npc="${isNPCType ? 1 : 0}"` : ""}>
        ${cardHTML}
        ${tabStrip}
      </div>`;
    };

    const heroCards = heroes.map(makeCard).join("");
    const npcCards  = npcs.map(makeCard).join("");

    // Left badge — combat controls in combat, crawl turn counter otherwise.
    const leftBadge = inCombat ? `
      <div class="sde-strip-combat-controls">
        <button class="sde-strip-cbtn" data-combat="prevRound" title="Previous Round">${ICONS.prevRound}</button>
        <button class="sde-strip-cbtn" data-combat="prevTurn"  title="Previous Turn">${ICONS.prevRound}</button>
        <div class="sde-strip-round-num">R${game.combat?.round ?? 1}</div>
        <button class="sde-strip-cbtn" data-combat="nextTurn"  title="Next Turn">${ICONS.nextRound}</button>
        <button class="sde-strip-cbtn" data-combat="nextRound" title="Next Round">${ICONS.nextRound}</button>
      </div>` : `<div class="sde-strip-turn-num">${state.crawlTurn}</div>`;

    // Combat: single flat init-ordered list, no HEROES/NPCS label.
    // Crawl:  Players-only list with HEROES label.
    const heroesBlock = heroCards
      ? (inCombat
          ? `<div class="sde-strip-group sde-strip-group-combat">
               <div class="sde-strip-members">${heroCards}</div>
             </div>`
          : `<div class="sde-strip-group sde-strip-group-heroes">
               <div class="sde-strip-group-label sde-strip-label-heroes">HEROES</div>
               <div class="sde-strip-members">${heroCards}</div>
             </div>`)
      : "";
    const npcsBlock = ""; // no longer used — kept identifier for diff readability

    this._el.innerHTML = `
      <div class="sde-strip-inner ${inCombat ? "sde-strip-paused" : ""}">
        ${leftBadge}
        ${heroesBlock}
        ${npcsBlock}
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
    //   - `remaining > 0`  → count of spendable tokens (e.g. luck die rolled 3)
    //   - else `available` → 1 (the base single-use Luck token)
    //   - else            → 0
    const luckObj = s.luck ?? {};
    let luck = 0;
    if (typeof luckObj.remaining === "number" && luckObj.remaining > 0) {
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

  _bindEvents() {
    if (!this._el) return;

    // Card double-click → open sheet; single-click → pan + select token
    this._el.querySelectorAll(".sde-strip-member").forEach(card => {
      card.addEventListener("dblclick", async (ev) => {
        if (ev.target.closest(".sde-strip-activate-btn")) return;
        const tokenId = card.dataset.tokenId;
        const token = tokenId ? canvas.tokens?.get(tokenId) : null;
        const actor = token?.actor ?? (card.dataset.actorId ? game.actors.get(card.dataset.actorId) : null);
        if (actor) actor.sheet.render(true);
      });
      card.addEventListener("click", async (ev) => {
        if (ev.target.closest(".sde-strip-activate-btn")) return;

        // Luck pill click → spend a luck token via the actor's system method.
        const luckBtn = ev.target.closest('[data-action="spendLuck"]');
        if (luckBtn) {
          ev.stopPropagation();
          const actorId = luckBtn.dataset.actorId || card.dataset.actorId;
          const actor = actorId ? game.actors.get(actorId) : null;
          if (actor?.system?.useLuckToken) await actor.system.useLuckToken();
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
    });

    if (!game.user.isGM) return;

    // Combat control buttons (prev/next round/turn)
    this._el.querySelectorAll(".sde-strip-cbtn").forEach(btn => {
      btn.addEventListener("click", async ev => {
        ev.stopPropagation();
        const action = btn.dataset.combat;
        const combat = game.combat;
        if (!combat) return;
        if      (action === "nextTurn")   await combat.nextTurn();
        else if (action === "prevTurn")   await combat.previousTurn();
        else if (action === "nextRound")  await combat.nextRound();
        else if (action === "prevRound")  await combat.previousRound();
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
};
