import { MODULE_ID } from "../module-id.mjs";
import { MonsterTokenArt } from "./monster-token-art.mjs";
import { TokenArtCatalog } from "./token-art-catalog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Token Art Manager — one place to choose, per monster, which installed art
 * source skins the `shadowdark.monsters` compendium. A source-priority order
 * sets the default; per-monster clicks override it. "Apply" resolves the choice
 * into the enhancer's compendium-art overlay (every drag then uses the picks).
 */
export class TokenArtManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instance = null;

  static DEFAULT_OPTIONS = {
    id: "sde-token-art-manager",
    classes: ["sde-token-art-manager"],
    tag: "div",
    window: { title: "Token Art Manager", icon: "fa-solid fa-images", resizable: true },
    position: { width: 720, height: 760 },
    actions: {
      sourceUp: TokenArtManagerApp._onSourceMove,
      sourceDown: TokenArtManagerApp._onSourceMove,
      choose: TokenArtManagerApp._onChoose,
      clearRow: TokenArtManagerApp._onClearRow,
      apply: TokenArtManagerApp._onApply,
      resetAll: TokenArtManagerApp._onResetAll,
      refresh: TokenArtManagerApp._onRefresh,
      toggleConflicts: TokenArtManagerApp._onToggleConflicts,
      reskinPlaced: TokenArtManagerApp._onReskinPlaced,
      turnOff: TokenArtManagerApp._onTurnOff,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/token-art-manager.hbs`, scrollable: [".sde-tam-list"] },
  };

  _catalog = null;
  _filter = "";
  _conflictsOnly = false;

  static open() {
    if (!game.user.isGM) return null;
    this._instance ??= new TokenArtManagerApp();
    this._instance.render(true);
    return this._instance;
  }

  async close(opts) { TokenArtManagerApp._instance = null; return super.close(opts); }

  _state() { return game.settings.get(MODULE_ID, "tokenArtManager") ?? { priority: [], overrides: {} }; }
  async _saveState(patch) {
    const cur = foundry.utils.deepClone(this._state());
    await game.settings.set(MODULE_ID, "tokenArtManager", foundry.utils.mergeObject(cur, patch, { inplace: false }));
  }

  async _prepareContext() {
    if (!this._catalog) this._catalog = await TokenArtCatalog.build();
    const cat = this._catalog;
    const state = this._state();
    const overrides = state.overrides ?? {};
    const order = TokenArtCatalog.resolvePriority(cat.sources.map((s) => s.id));
    const sourceById = Object.fromEntries(cat.sources.map((s) => [s.id, s]));
    const orderedSources = order.map((id) => sourceById[id]).filter(Boolean);

    // resolved choice + per-source tally
    const res = TokenArtCatalog.resolve(cat);
    const enabled = game.settings.get(MODULE_ID, "tokenArtCompendium");

    const q = this._filter.trim().toLowerCase();
    const rows = [];
    for (const m of cat.byMonster) {
      if (!m.options.length) continue;
      if (q && !m.name.toLowerCase().includes(q)) continue;
      if (this._conflictsOnly && m.options.length < 2) continue;
      const chosen = res.chosen[m.id];
      const isOverride = !!overrides[m.id];
      rows.push({
        id: m.id,
        name: m.name,
        multi: m.options.length > 1,
        isOverride,
        options: m.options.map((o) => ({
          source: o.source,
          label: sourceById[o.source]?.label ?? o.source,
          thumb: o.token,
          ring: !!o.tokenObj?.ring?.enabled,
          chosen: o.source === chosen,
        })),
      });
    }

    return {
      sources: orderedSources.map((s, i) => ({
        ...s,
        used: res.stats.perSource[s.id] ?? 0,
        isFirst: i === 0,
        isLast: i === orderedSources.length - 1,
      })),
      rows,
      stats: res.stats,
      enabled,
      filter: this._filter,
      conflictsOnly: this._conflictsOnly,
      shown: rows.length,
      total: cat.byMonster.length,
    };
  }

  _onRender(_ctx, _opts) {
    const root = this.element;
    const search = root.querySelector('input[name="filter"]');
    if (search && !search._sdeWired) {
      search._sdeWired = true;
      search.addEventListener("input", foundry.utils.debounce((ev) => {
        this._filter = ev.target.value ?? "";
        this.render({ parts: ["body"] });
        // keep focus + caret at end after re-render
        const s = this.element.querySelector('input[name="filter"]');
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      }, 200));
    }
  }

  // ---- actions --------------------------------------------------------------
  static async _onSourceMove(event, target) {
    const id = target.dataset.source;
    const dir = target.dataset.action === "sourceUp" ? -1 : 1;
    const cat = this._catalog ?? (this._catalog = await TokenArtCatalog.build());
    const order = TokenArtCatalog.resolvePriority(cat.sources.map((s) => s.id));
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    await this._saveState({ priority: order });
    this.render({ parts: ["body"] });
  }

  static async _onChoose(event, target) {
    const { monster, source } = target.dataset;
    const overrides = foundry.utils.deepClone(this._state().overrides ?? {});
    overrides[monster] = source;
    await this._saveState({ overrides });
    this.render({ parts: ["body"] });
  }

  static async _onClearRow(event, target) {
    const overrides = foundry.utils.deepClone(this._state().overrides ?? {});
    delete overrides[target.dataset.monster];
    await this._saveState({ overrides });
    this.render({ parts: ["body"] });
  }

  static async _onResetAll() {
    await this._saveState({ overrides: {} });
    this.render({ parts: ["body"] });
  }

  static async _onToggleConflicts() {
    this._conflictsOnly = !this._conflictsOnly;
    this.render({ parts: ["body"] });
  }

  static async _onRefresh() {
    this._catalog = null;
    ui.notifications.info("Rescanning art sources…");
    await this.render({ parts: ["body"] });
  }

  static async _onApply() {
    const cat = this._catalog ?? (this._catalog = await TokenArtCatalog.build());
    const { table, stats } = TokenArtCatalog.resolve(cat);
    await MonsterTokenArt.applyResolvedMapping(table);
    const per = Object.entries(stats.perSource).map(([s, n]) => `${n} ${s.replace(/-tokens.*|-monster.*|dnd-/g, "").replace(/-/g, " ").trim()}`).join(", ");
    ui.notifications.info(`Applied token art to ${stats.mapped}/${stats.total} monsters (${per}). Every drag now uses your picks.`);
    this.render({ parts: ["body"] });
  }

  static async _onReskinPlaced() {
    const r = await MonsterTokenArt.apply({ scene: true, actors: true, portraits: true });
    if (r && !r.missing) {
      ui.notifications.info(`Re-skinned ${r.tokens} placed tokens, ${r.portraits} portraits (${r.kept} kept, ${r.skipped.length} unmatched).`);
    }
  }

  static async _onTurnOff() {
    await MonsterTokenArt.disableCompendiumMapping();
    ui.notifications.info("Compendium art turned off — monsters show their default art again.");
    this.render({ parts: ["body"] });
  }
}
