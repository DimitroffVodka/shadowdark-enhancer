/**
 * Shadowdark Enhancer — Session Recap window (ApplicationV2).
 *
 * Tabbed recap: Overview / Combat / Loot / XP / History. Reads the current
 * session (or a viewed archive) from SessionRecap, renders derived views, and
 * offers a Discord-markdown copy + clear. Ported from vagabond-crawler and
 * adapted to SD currency ({gp,sp,cp}) + this module's data shapes.
 */

import { SessionRecap } from "./session-recap.mjs";
import { toCopper, formatCurrency } from "./session-recap-core.mjs";
import { esc } from "../util/esc.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class SessionRecapApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "shadowdark-enhancer-session-recap",
    classes: ["shadowdark-enhancer", "sde-session-recap"],
    tag: "div",
    window: { title: "Session Recap", icon: "fas fa-scroll", resizable: true },
    position: { width: 660, height: 560 },
    actions: {
      changeTab: SessionRecapApp._onChangeTab,
      toggleEncounter: SessionRecapApp._onToggleEncounter,
      viewSession: SessionRecapApp._onViewSession,
      backToCurrent: SessionRecapApp._onBackToCurrent,
      deleteSession: SessionRecapApp._onDeleteSession,
      copyDiscord: SessionRecapApp._onCopyDiscord,
      clearSession: SessionRecapApp._onClearSession,
    },
  };

  static PARTS = {
    body: {
      template: "modules/shadowdark-enhancer/templates/session-recap.hbs",
      scrollable: [".sr-tab-content"],
    },
  };

  constructor(options = {}) {
    super(options);
    this.activeTab = "overview";
    this._expandedCombats = new Set();
    this._viewingHistoryId = null;
  }

  async close(options = {}) {
    SessionRecap._app = null;
    return super.close(options);
  }

  async _prepareContext() {
    let data;
    let viewingSession = null;
    if (this._viewingHistoryId) {
      viewingSession = SessionRecap.getHistory().find(s => s.id === this._viewingHistoryId);
      if (viewingSession) data = { ...viewingSession.data, sessionStart: viewingSession.startTime };
      else { this._viewingHistoryId = null; data = SessionRecap.getData(); }
    } else {
      data = SessionRecap.getData();
    }
    // Defensive defaults for archived payloads missing newer arrays.
    data.sales ??= []; data.purchases ??= []; data.encounterChecks ??= [];

    const hasDamageLog = game.modules.get("damage-log")?.active ?? false;
    const sessionDuration = viewingSession
      ? SessionRecap._formatDuration(viewingSession.endTime - viewingSession.startTime)
      : data.sessionStart ? SessionRecap._formatDuration(Date.now() - data.sessionStart) : "No events yet";

    // Overview — party cards
    const playerSummaries = Object.entries(data.playerStats).map(([actorId, s]) => ({
      actorId, name: s.name, kills: s.kills, damageDealt: s.damageDealt, damageTaken: s.damageTaken,
      totalXp: data.xp.filter(x => x.actorId === actorId).reduce((sum, x) => sum + x.totalXp, 0),
    }));

    // Combat — encounters
    const combats = data.combats.map((c, idx) => ({
      index: idx,
      label: `Encounter ${idx + 1}`,
      rounds: c.rounds,
      duration: c.startTime && c.endTime ? SessionRecap._formatDuration(c.endTime - c.startTime) : "",
      enemies: c.enemies,
      participants: c.participants,
      totalEnemies: c.enemies.length,
      totalDefeated: c.enemies.filter(e => e.defeated).length,
      expanded: this._expandedCombats.has(idx),
    }));

    // Combat — roll/damage stats table
    const playerStatsTable = Object.entries(data.playerStats).map(([, s]) => {
      const totalAtk = s.attacks.hits + s.attacks.misses;
      const totalSaves = s.saves.passes + s.saves.fails;
      return {
        name: s.name,
        hitRate: totalAtk > 0 ? `${s.attacks.hits}/${totalAtk} (${Math.round((s.attacks.hits / totalAtk) * 100)}%)` : "—",
        nat20s: s.attacks.nat20s + s.saves.nat20s,
        nat1s: s.attacks.nat1s + s.saves.nat1s,
        avgD20: s.rolls.total > 0 ? (s.rolls.sum / s.rolls.total).toFixed(1) : "—",
        saveRate: totalSaves > 0 ? `${s.saves.passes}/${totalSaves}` : "—",
        damageDealt: s.damageDealt, damageTaken: s.damageTaken, kills: s.kills,
      };
    });

    // Loot — newest first
    const lootEntries = [...data.loot].reverse().map(entry => {
      const detail = entry.type === "currency"
        ? formatCurrency(toCopper(entry.coins))
        : `${entry.detail ?? ""}${(entry.qty ?? 1) > 1 ? ` ×${entry.qty}` : ""}`;
      const iconHtml = entry.type === "currency"
        ? '<i class="fas fa-coins" style="color:var(--sde-bar-accent,#c9a54a);"></i>'
        : entry.img ? `<img src="${esc(entry.img)}" width="20" height="20" style="border-radius:2px;">`
          : '<i class="fas fa-box" style="color:#aaa;"></i>';
      return { ...entry, detail, iconHtml, unclaimed: entry.claimed === false };
    });

    // Merchant — sales / purchases summary (under Loot tab)
    const merchantRows = (entries) => {
      const byPlayer = {};
      for (const e of entries) (byPlayer[e.player] ??= []).push(e);
      return Object.entries(byPlayer).map(([player, list]) => ({
        player,
        items: list.map(e => ({
          item: e.item,
          qtyLabel: (e.qty ?? 1) > 1 ? ` ×${e.qty}` : "",
          price: formatCurrency(toCopper(e.price)),
          ratio: (e.ratio ?? 100) !== 100 ? `${e.ratio}%` : null,
        })),
        subtotal: formatCurrency(list.reduce((s, e) => s + toCopper(e.price), 0)),
      }));
    };
    const sales = merchantRows(data.sales);
    const purchases = merchantRows(data.purchases);

    // XP — grouped by player
    const xpByPlayer = {};
    for (const e of data.xp) {
      if (!xpByPlayer[e.player]) xpByPlayer[e.player] = { entries: [], total: 0 };
      xpByPlayer[e.player].entries.push(e);
      xpByPlayer[e.player].total += e.totalXp;
    }
    const xpPlayers = Object.entries(xpByPlayer).map(([player, { entries, total }]) => ({
      player,
      awards: entries.map(e => ({ time: e.time, totalXp: e.totalXp, label: e.label || "Award" })),
      total,
    }));

    // Encounter checks
    const checks = data.encounterChecks;
    const encounterChecks = checks.map(c => ({ ...c }));
    const encounterSummary = checks.length > 0
      ? `${checks.length} rolls — ${checks.filter(c => c.hit).length} encounters · avg d6 ${(checks.reduce((a, c) => a + (Number(c.roll) || 0), 0) / checks.length).toFixed(1)}`
      : null;

    const totalCombats = data.combats.length;
    const totalEnemiesDefeated = data.combats.reduce((sum, c) => sum + c.enemies.filter(e => e.defeated).length, 0);

    const sessionDisplayName = viewingSession ? viewingSession.name
      : data.sessionStart ? SessionRecap._generateSessionName(data.sessionStart) : "Session";
    const sessionStatusLabel = viewingSession ? "Archived"
      : data.sessionState === "active" ? "In Progress"
        : data.sessionStart ? "Idle" : "Not Started";
    const sessionStats = [
      { label: sessionDuration },
      { label: totalCombats === 1 ? "1 combat" : `${totalCombats} combats` },
      { label: `${totalEnemiesDefeated} defeated` },
    ];

    return {
      tab: {
        overview: this.activeTab === "overview",
        combat: this.activeTab === "combat",
        loot: this.activeTab === "loot",
        xp: this.activeTab === "xp",
        history: this.activeTab === "history",
      },
      activeTab: this.activeTab,
      isGM: game.user.isGM,
      hasDamageLog,
      sessionDisplayName, sessionStatusLabel, sessionStats,
      playerSummaries, hasPlayerSummaries: playerSummaries.length > 0,
      combats, hasCombats: combats.length > 0,
      playerStatsTable, hasPlayerStats: playerStatsTable.length > 0,
      lootEntries, hasLoot: lootEntries.length > 0,
      sales, purchases, hasMerchant: sales.length > 0 || purchases.length > 0,
      xpPlayers, hasXp: xpPlayers.length > 0,
      encounterChecks, hasEncounterChecks: encounterChecks.length > 0, encounterSummary,
      viewingSession: viewingSession ? { id: viewingSession.id, name: viewingSession.name } : null,
      isViewingHistory: !!this._viewingHistoryId,
      historyEntries: SessionRecap.getHistory().map(s => ({
        id: s.id, name: s.name,
        duration: SessionRecap._formatDuration(s.endTime - s.startTime),
        combatCount: s.data.combats.length,
        enemiesDefeated: s.data.combats.reduce((sum, c) => sum + c.enemies.filter(e => e.defeated).length, 0),
        lootCount: s.data.loot.length,
      })),
      hasHistory: SessionRecap.getHistory().length > 0,
      sessionState: SessionRecap.getData().sessionState,
    };
  }

  static _onChangeTab(event, target) {
    const tab = target.dataset.tab;
    if (tab) { this.activeTab = tab; this.render(); }
  }

  static _onToggleEncounter(event, target) {
    const idx = parseInt(target.dataset.index);
    if (Number.isNaN(idx)) return;
    if (this._expandedCombats.has(idx)) this._expandedCombats.delete(idx);
    else this._expandedCombats.add(idx);
    this.render();
  }

  static _onViewSession(event, target) {
    const id = target.dataset.sessionId;
    if (!id) return;
    this._viewingHistoryId = id;
    this.activeTab = "overview";
    this.render();
  }

  static _onBackToCurrent() {
    this._viewingHistoryId = null;
    this.activeTab = "overview";
    this.render();
  }

  static async _onDeleteSession(event, target) {
    const id = target.dataset.sessionId;
    if (!id) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete Session" },
      content: "<p>Delete this saved session? This cannot be undone.</p>",
      rejectClose: false,
    }).catch(() => false);
    if (!ok) return;
    await SessionRecap.deleteFromHistory(id);
    if (this._viewingHistoryId === id) { this._viewingHistoryId = null; this.activeTab = "history"; }
    this.render();
  }

  static async _onCopyDiscord() {
    let text;
    if (this._viewingHistoryId) {
      const session = SessionRecap.getHistory().find(s => s.id === this._viewingHistoryId);
      if (session) text = SessionRecap.formatForDiscordFromData(session.data, session.startTime, session.endTime);
    }
    if (!text) text = SessionRecap.formatForDiscord();
    try {
      await game.clipboard.copyPlainText(text);
      ui.notifications.info("Session recap copied to clipboard!");
    } catch {
      await navigator.clipboard.writeText(text);
      ui.notifications.info("Session recap copied to clipboard!");
    }
  }

  static async _onClearSession() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Clear Session" },
      content: "<p>Clear all current session data? This cannot be undone.</p>",
      rejectClose: false,
    }).catch(() => false);
    if (ok) { await SessionRecap.clear(); this.render(); }
  }
}
