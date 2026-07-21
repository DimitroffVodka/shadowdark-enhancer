/**
 * Shadowdark Enhancer — Session Recap (data layer).
 *
 * Singleton that tracks per-session events — loot, merchant sales/purchases,
 * XP awards, combats, random-encounter checks, and per-PC roll/damage stats —
 * persists them to the world setting `sessionRecap`, archives finished sessions
 * to `sessionHistory`, and exports a Discord-markdown recap.
 *
 * Adapted from vagabond-crawler/scripts/session-recap.mjs to Shadowdark:
 *   - PCs are `type === "Player"` (not "character"); HP at
 *     `system.attributes.hp.value`.
 *   - Roll outcomes read the structured `flags.shadowdark.rollConfig` +
 *     `roll.options` (type/dc/criticalSuccessAt) — NOT brittle "HIT"/"MISS"
 *     chat-text scraping. Attack hit/miss is only recorded when the SD
 *     `enableTargeting` flow set a DC (target AC); nat20/nat1 + checks/saves
 *     are always reliable.
 *   - Currency is `{gp, sp, cp}` (1gp=10sp=100cp) via session-recap-core.mjs.
 *   - Lifecycle is driven by this module's own `crawlStart`/`crawlEnd` hooks.
 *
 * Pure math/format/export lives in session-recap-core.mjs (node-tested).
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import {
  DEFAULT_DATA, emptyPlayerStat, formatDuration, generateSessionName,
  formatForDiscordFromData,
} from "./session-recap-core.mjs";

const SETTING_KEY = "sessionRecap";
const HISTORY_KEY = "sessionHistory";

export const SessionRecap = {
  _app: null,

  // Transient combat state (not persisted — lives only during active combats)
  _activeCombats: new Map(),
  _killMap: new Map(),
  _hasDamageLog: false,
  _lastAttacker: null,

  // ── Settings ───────────────────────────────────────────────

  registerSettings() {
    game.settings.register(MODULE_ID, SETTING_KEY, {
      scope: "world", config: false, type: Object,
      default: foundry.utils.deepClone(DEFAULT_DATA),
    });
    game.settings.register(MODULE_ID, HISTORY_KEY, {
      scope: "world", config: false, type: Array, default: [],
    });
  },

  // ── Read / Write ───────────────────────────────────────────

  getData() {
    const data = game.settings.get(MODULE_ID, SETTING_KEY) ?? foundry.utils.deepClone(DEFAULT_DATA);
    // Defensive in-place migration for older payloads.
    if (!Array.isArray(data.sales)) data.sales = [];
    if (!Array.isArray(data.purchases)) data.purchases = [];
    if (!Array.isArray(data.encounterChecks)) data.encounterChecks = [];
    return data;
  },

  getHistory() {
    return game.settings.get(MODULE_ID, HISTORY_KEY) ?? [];
  },

  isActive() {
    return this.getData().sessionState === "active";
  },

  /**
   * Shared document hooks (createChatMessage, combat*) fire on EVERY connected
   * GM client. In a multi-GM world (e.g. a human GM + the always-on bridge
   * client) that would double-count combat/roll/damage stats and duplicate
   * combat records. Gate those handlers so only the primary (active) GM
   * processes them — mirrors the merchant-shop activeGM guard.
   */
  _isPrimaryGM() {
    return !!game.user?.isGM && game.users.activeGM?.id === game.user.id;
  },

  async _save(data) {
    await game.settings.set(MODULE_ID, SETTING_KEY, data);
    if (this._app?.rendered) this._app.render();
  },

  // Serializes read-modify-write cycles against the recap setting. Every
  // writer does getData() → mutate → _save(); rapid combat events (a
  // damage-log message triggers several updatePlayerStat calls) would
  // otherwise interleave on the same snapshot and silently drop increments
  // (last-write-wins). Routing all mutations through one promise chain makes
  // each mutator observe the previous write.
  _writeQueue: Promise.resolve(),

  _mutate(mutator) {
    const run = this._writeQueue.then(async () => {
      const data = this.getData();
      if (mutator(data) === false) return; // mutator opted out
      await this._save(data);
    });
    this._writeQueue = run.catch(() => {});
    return run;
  },

  async _saveHistory(history) {
    await game.settings.set(MODULE_ID, HISTORY_KEY, history);
    if (this._app?.rendered) this._app.render();
  },

  _ensureStart(data) {
    if (!data.sessionStart) data.sessionStart = Date.now();
  },

  _stamp() {
    return {
      timestamp: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
  },

  // ── Loot Logging ───────────────────────────────────────────

  /**
   * Log a loot claim. `entry` carries `{ type:"item"|"currency", player,
   * detail, source, img, qty, coins:{gp,sp,cp} }`. Defaults to claimed.
   * Self-guarded on an active session.
   */
  async logLoot(entry) {
    if (!this.isActive()) return;
    return this._mutate(data => {
      this._ensureStart(data);
      data.loot.push({ claimed: true, ...entry, ...this._stamp() });
    });
  },

  // ── Sale / Purchase Logging ────────────────────────────────

  async logSale({ player, item, qty, price, ratio }) {
    if (!this.isActive()) return;
    return this._mutate(data => {
      this._ensureStart(data);
      data.sales.push({
        player, item, qty: qty ?? 1,
        price: price ?? { gp: 0, sp: 0, cp: 0 },
        ratio: ratio ?? 100, ...this._stamp(),
      });
    });
  },

  async logPurchase({ player, item, qty, price }) {
    if (!this.isActive()) return;
    return this._mutate(data => {
      this._ensureStart(data);
      data.purchases.push({
        player, item, qty: qty ?? 1,
        price: price ?? { gp: 0, sp: 0, cp: 0 }, ...this._stamp(),
      });
    });
  },

  // ── XP Logging ─────────────────────────────────────────────

  /** Log one XP award to one PC. `{ player, actorId, totalXp, label }`. */
  async logXp({ player, actorId, totalXp, label }) {
    if (!this.isActive()) return;
    return this._mutate(data => {
      this._ensureStart(data);
      data.xp.push({ player, actorId, totalXp: Number(totalXp) || 0, label: label ?? "", ...this._stamp() });
    });
  },

  // ── Encounter Check Logging ────────────────────────────────

  async logEncounterCheck({ roll, threshold, hit, clockLabel = null }) {
    if (!this.isActive()) return;
    return this._mutate(data => {
      this._ensureStart(data);
      data.encounterChecks.push({
        roll: Number(roll), threshold: Number(threshold), hit: !!hit, clockLabel, ...this._stamp(),
      });
    });
  },

  // ── Combat Logging ─────────────────────────────────────────

  async logCombat(combatEntry) {
    return this._mutate(data => {
      this._ensureStart(data);
      data.combats.push(combatEntry);
    });
  },

  async _flushActiveCombats() {
    for (const [combatId, active] of this._activeCombats.entries()) {
      const live = game.combats.get(combatId);
      const rounds = live?.round ?? active.rounds ?? 0;
      const enemies = (live ? this._snapshotEnemies(live) : (active.enemies ?? []))
        .map(e => ({
          name: e.name,
          defeated: e.defeated,
          killedBy: e.defeated ? (this._killMap.get(e.tokenId) ?? null) : null,
        }));
      await this.logCombat({
        id: combatId, rounds, startTime: active.startTime, endTime: Date.now(),
        enemies, participants: active.participants,
      });
    }
    this._activeCombats.clear();
    this._killMap.clear();
  },

  // ── Player Stat Updates ────────────────────────────────────

  async updatePlayerStat(actorId, name, path, delta) {
    return this._mutate(data => {
      this._ensureStart(data);
      if (!data.playerStats[actorId]) data.playerStats[actorId] = emptyPlayerStat(name);
      const parts = path.split(".");
      let obj = data.playerStats[actorId];
      for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
      obj[parts[parts.length - 1]] += delta;
    });
  },

  // ── Clear ──────────────────────────────────────────────────

  async clear() {
    const fresh = foundry.utils.deepClone(DEFAULT_DATA);
    fresh.sessionState = "inactive";
    fresh.sessionStart = null;
    await this._save(fresh);
  },

  // ── Combat & Damage Hooks ─────────────────────────────────

  /**
   * Snapshot the non-friendly combatant roster. `defeated` = the combatant's
   * defeated flag OR HP ≤ 0 (Shadowdark HP at system.attributes.hp.value).
   */
  _snapshotEnemies(combat) {
    const enemies = [];
    for (const c of combat.combatants) {
      if (!c.actor) continue;
      const disp = c.token?.disposition ?? c.token?.document?.disposition;
      if (disp === CONST.TOKEN_DISPOSITIONS.FRIENDLY) continue;
      const hp = c.actor.system?.attributes?.hp;
      const defeated = c.defeated || (hp && hp.value <= 0);
      const tokenId = c.token?.id ?? c.token?.document?.id;
      enemies.push({ name: c.actor.name, defeated: !!defeated, tokenId });
    }
    return enemies;
  },

  _initCombatHooks() {
    if (!game.user.isGM) return;
    this._hasDamageLog = game.modules.get("damage-log")?.active ?? false;
    this._lastAttacker = null;

    // ── Track attacker from SD damage rolls ────────────────
    // SD appends a `damage` roll to the attack message; its speaker is the
    // attacker. The next damage-log HP change is credited to them.
    Hooks.on("createChatMessage", (message) => {
      if (!this.isActive() || !this._isPrimaryGM()) return;
      if (message.flags?.["damage-log"]?.changes?.length) return; // target update, handled below
      const hasDamage = (message.rolls ?? []).some(r => r.options?.type === "damage");
      if (!hasDamage) return;
      const actorId = message.speaker?.actor;
      const actor = actorId ? game.actors.get(actorId) : null;
      if (!actor) return;
      this._lastAttacker = { actorId: actor.id, actor, name: actor.name, timestamp: Date.now() };
    });

    // ── Combat start ───────────────────────────────────────
    Hooks.on("combatStart", (combat) => {
      if (!this.isActive() || !this._isPrimaryGM()) return;
      const participants = [];
      for (const c of combat.combatants) {
        if (!c.actor || !c.token) continue;
        const disp = c.token.disposition ?? c.token.document?.disposition;
        if (disp === CONST.TOKEN_DISPOSITIONS.FRIENDLY && c.actor.hasPlayerOwner) {
          participants.push({ name: c.actor.name, actorId: c.actor.id });
        }
      }
      this._activeCombats.set(combat.id, {
        startTime: Date.now(), participants, rounds: combat.round ?? 1,
        enemies: this._snapshotEnemies(combat), lastSnapshotAt: Date.now(),
      });
    });

    // ── Combat round / state change — refresh snapshot ─────
    Hooks.on("updateCombat", (combat) => {
      if (!this.isActive() || !this._isPrimaryGM()) return;
      const active = this._activeCombats.get(combat.id);
      if (!active) return;
      active.rounds = combat.round ?? active.rounds;
      active.enemies = this._snapshotEnemies(combat);
      active.lastSnapshotAt = Date.now();
    });

    // ── Combat end ─────────────────────────────────────────
    Hooks.on("deleteCombat", async (combat) => {
      if (!this._isPrimaryGM()) return;
      const active = this._activeCombats.get(combat.id);
      if (!active) return;
      const enemies = this._snapshotEnemies(combat).map(e => ({
        name: e.name, defeated: e.defeated,
        killedBy: e.defeated ? (this._killMap.get(e.tokenId) ?? null) : null,
      }));
      await this.logCombat({
        id: combat.id, rounds: combat.round ?? active.rounds ?? 0,
        startTime: active.startTime, endTime: Date.now(),
        enemies, participants: active.participants,
      });
      this._activeCombats.delete(combat.id);
      this._killMap.clear();
    });

    // ── Damage-log HP changes → damage dealt/taken + kills ──
    if (this._hasDamageLog) {
      Hooks.on("createChatMessage", (message) => {
        if (!this.isActive() || !this._isPrimaryGM()) return;
        const flags = message.flags?.["damage-log"];
        if (!flags?.changes?.length) return;

        const targetActorId = message.speaker?.actor;
        if (!targetActorId) return;
        const targetActor = game.actors.get(targetActorId);
        if (!targetActor) return;

        const FRESH_MS = 60_000;
        let attackerActor = null;
        if (this._lastAttacker && Date.now() - this._lastAttacker.timestamp < FRESH_MS) {
          attackerActor = this._lastAttacker.actor;
        }
        if (!attackerActor) attackerActor = game.combat?.combatant?.actor ?? null;
        attackerActor = this._unwrapToPC(attackerActor) ?? attackerActor;

        const attackerIsPC = !!attackerActor?.hasPlayerOwner && attackerActor.type === "Player";

        for (const change of flags.changes) {
          // damage-log keys HP changes by the system's resource id; be tolerant.
          const id = String(change.id ?? "");
          if (!(id === "hp" || /hp/i.test(id))) continue;
          const diff = (Number(change.new) || 0) - (Number(change.old) || 0);
          if (diff >= 0) continue;
          const absDiff = Math.abs(diff);
          const targetIsPC = targetActor.hasPlayerOwner && targetActor.type === "Player";

          if (targetIsPC) {
            this.updatePlayerStat(targetActorId, targetActor.name, "damageTaken", absDiff);
          } else if (attackerIsPC && attackerActor) {
            this.updatePlayerStat(attackerActor.id, attackerActor.name, "damageDealt", absDiff);
            const tokenId = message.speaker?.token;
            if (tokenId) this._killMap.set(tokenId, attackerActor.name);
            if ((Number(change.new) || 0) <= 0) {
              this.updatePlayerStat(attackerActor.id, attackerActor.name, "kills", 1);
            }
          }
        }
      });
    }
  },

  /** Resolve a combat actor to its controlling PC (polymorph / familiar), else null. */
  _unwrapToPC(actor) {
    if (!actor) return null;
    if (actor.type === "Player" && actor.hasPlayerOwner) return actor;
    const origUuid = actor.flags?.core?.originalActor;
    if (origUuid) {
      try {
        const orig = fromUuidSync(origUuid);
        if (orig?.hasPlayerOwner && orig.type === "Player") return orig;
      } catch { /* fall through */ }
    }
    if (actor.hasPlayerOwner) {
      for (const [uid, level] of Object.entries(actor.ownership || {})) {
        if (uid === "default") continue;
        if (level < CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER) continue;
        const pc = game.users.get(uid)?.character;
        if (pc && pc.id !== actor.id && pc.type === "Player") return pc;
      }
    }
    return null;
  },

  // ── Roll Stats Hooks (Shadowdark structured detection) ─────

  _initRollHooks() {
    if (!game.user.isGM) return;
    Hooks.on("createChatMessage", (message) => {
      if (!this.isActive() || !this._isPrimaryGM()) return;
      const cfg = message.flags?.shadowdark?.rollConfig;
      if (!cfg) return;                       // not a Shadowdark roll card
      const actorId = message.speaker?.actor;
      if (!actorId) return;
      const actor = game.actors.get(actorId);
      if (!actor?.hasPlayerOwner) return;     // only the party's own rolls

      const main = (message.rolls ?? []).find(r => r.options?.type === "main");
      if (!main) return;
      const baseDie = main.dice?.find(d => d.faces === 20) ?? main.dice?.[0];
      const nat = baseDie?.total;
      if (nat == null) return;

      const isNat20 = nat >= (main.options?.criticalSuccessAt ?? 20);
      const isNat1 = nat <= (main.options?.criticalFailureAt ?? 1);
      const name = actor.name;

      this.updatePlayerStat(actorId, name, "rolls.total", 1);
      this.updatePlayerStat(actorId, name, "rolls.sum", nat);

      const type = cfg.type;                  // attack | check | ability | spell
      const dc = main.options?.dc;
      const determined = dc != null;

      if (type === "attack") {
        if (determined) {
          const hit = main.total >= dc;
          this.updatePlayerStat(actorId, name, hit ? "attacks.hits" : "attacks.misses", 1);
        }
        if (isNat20) this.updatePlayerStat(actorId, name, "attacks.nat20s", 1);
        if (isNat1) this.updatePlayerStat(actorId, name, "attacks.nat1s", 1);
      } else if (type === "check" || type === "ability" || type === "spell") {
        if (determined) {
          const pass = main.total >= dc;
          this.updatePlayerStat(actorId, name, pass ? "saves.passes" : "saves.fails", 1);
        }
        if (isNat20) this.updatePlayerStat(actorId, name, "saves.nat20s", 1);
        if (isNat1) this.updatePlayerStat(actorId, name, "saves.nat1s", 1);
      }
    });
  },

  // ── Export ─────────────────────────────────────────────────

  _formatDuration(ms) { return formatDuration(ms); },
  _generateSessionName(timestamp) {
    return generateSessionName(timestamp, this.getHistory().map(s => s.name));
  },

  formatForDiscordFromData(data, startTime, endTime) {
    return formatForDiscordFromData(data, startTime, endTime);
  },
  formatForDiscord() {
    const data = this.getData();
    return formatForDiscordFromData(data, data.sessionStart, Date.now());
  },

  // ── Session Lifecycle ──────────────────────────────────────

  async startSession() {
    const fresh = foundry.utils.deepClone(DEFAULT_DATA);
    fresh.sessionState = "active";
    fresh.sessionStart = Date.now();
    await this._save(fresh);
  },

  async continueSession() {
    const data = this.getData();
    data.sessionState = "active";
    await this._save(data);
  },

  async pauseSession() {
    await this._flushActiveCombats();
    const data = this.getData();
    data.sessionState = "paused";
    await this._save(data);
  },

  async endAndSave() {
    await this._flushActiveCombats();
    const data = this.getData();
    const now = Date.now();
    const history = this.getHistory();
    const snapshot = {
      id: `session-${now}`,
      name: this._generateSessionName(data.sessionStart ?? now),
      startTime: data.sessionStart ?? now,
      endTime: now,
      data: {
        loot: data.loot, sales: data.sales, purchases: data.purchases,
        xp: data.xp, combats: data.combats,
        encounterChecks: data.encounterChecks, playerStats: data.playerStats,
      },
    };
    history.unshift(snapshot);
    await this._saveHistory(history);
    await this.clear();
    ui.notifications.info(`Session saved: ${snapshot.name}`);
  },

  async discardSession() {
    await this.clear();
    ui.notifications.info("Session discarded.");
  },

  async deleteFromHistory(id) {
    await this._saveHistory(this.getHistory().filter(s => s.id !== id));
  },

  // ── Lifecycle prompt dialogs (tied to the crawl) ───────────

  async _waitChoice({ title, content, buttons, defaultButton }) {
    const DialogV2 = foundry.applications.api.DialogV2;
    return DialogV2.wait({
      window: { title },
      content: `<p>${content}</p>`,
      buttons: buttons.map(b => ({
        action: b.value, label: b.label, icon: b.icon,
        default: b.value === defaultButton,
        callback: () => b.value,
      })),
      rejectClose: false,
    }).catch(() => null);
  },

  _initLifecycleHooks() {
    if (!game.user.isGM) return;

    Hooks.on(`${MODULE_ID}.crawlStart`, async () => {
      const data = this.getData();
      const isPaused = data.sessionState === "paused";
      const buttons = [{ label: "Start New Session", icon: "fas fa-play", value: "start" }];
      if (isPaused) buttons.push({ label: "Continue Session", icon: "fas fa-forward", value: "continue" });
      buttons.push({ label: "No Tracking", icon: "fas fa-ban", value: "skip" });

      const choice = await this._waitChoice({
        title: "Session Tracking",
        content: isPaused ? "A paused session exists. What would you like to do?" : "Start tracking a new session?",
        buttons, defaultButton: isPaused ? "continue" : "start",
      });
      if (choice === "start") await this.startSession();
      else if (choice === "continue") await this.continueSession();
    });

    Hooks.on(`${MODULE_ID}.crawlEnd`, async () => {
      const data = this.getData();
      if (data.sessionState !== "active" && data.sessionState !== "paused") return;
      const hasData = data.loot.length > 0 || data.xp.length > 0 || data.combats.length > 0
        || Object.keys(data.playerStats).length > 0 || data.encounterChecks.length > 0
        || data.sales.length > 0 || data.purchases.length > 0;

      const buttons = [
        { label: "End & Save", icon: "fas fa-save", value: "save" },
        { label: "Pause Session", icon: "fas fa-pause", value: "pause" },
      ];
      if (hasData) buttons.push({ label: "Discard", icon: "fas fa-trash", value: "discard" });

      const choice = await this._waitChoice({
        title: "Session Tracking",
        content: "The crawl is ending. What would you like to do with this session?",
        buttons, defaultButton: "save",
      });
      if (choice === "save") await this.endAndSave();
      else if (choice === "pause") await this.pauseSession();
      else if (choice === "discard") await this.discardSession();
      else if (choice === null) await this.pauseSession();
    });
  },

  // ── Feed hooks (XP from the Party XP tool) ─────────────────

  _initFeedHooks() {
    if (!game.user.isGM) return;
    Hooks.on(`${MODULE_ID}.partyXpAwarded`, ({ amount, label, results }) => {
      if (!this.isActive()) return;
      for (const r of (results ?? [])) {
        this.logXp({ player: r.name, actorId: r.id, totalXp: r.added ?? amount, label });
      }
    });
  },

  // ── Init ───────────────────────────────────────────────────

  init() {
    this._initCombatHooks();
    this._initRollHooks();
    this._initFeedHooks();
    this._initLifecycleHooks();
    console.log(`${MODULE_ID} | Session Recap initialized.`);
  },

  // ── Open Window ────────────────────────────────────────────

  async open() {
    if (!this._app) {
      const { SessionRecapApp } = await import("./session-recap-app.mjs");
      this._app = new SessionRecapApp();
    }
    this._app.render(true);
    return this._app;
  },
};
