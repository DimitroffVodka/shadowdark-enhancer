/**
 * Shadowdark Enhancer — Magic Item Forge window (working-items rebuild).
 *
 * A focused builder for items that actually function in the Shadowdark system:
 *   Weapon / Armor — forge a +N onto a real base item (carries its damage die /
 *                    AC / properties). +N rides the current SD effect keys.
 *   Scroll / Wand  — pick a real Spell; the item references it so the system's
 *                    own casting pipeline runs (DC = tier + 10, scroll expend,
 *                    wand fail/break).
 *
 * All item-shape correctness lives in the pure `assembleItemData` (magic-forge.mjs);
 * this file owns only the ApplicationV2 shell, selectors, live preview, and the
 * create flow. Public API (`open({seed, onCreate})`) and the forged-flag contract
 * are preserved for the loot generator / loot delivery integrations.
 */
import { assembleItemData, composeName, parseBonusValue, resolveSelectedBonus, resolveForgeType, WORKING_TYPES, TYPE_LABELS } from "./magic-forge.mjs";
import {
  MAGIC_SET_DEFS, catalog, resolveResultRefs, buildForgeProvenance,
  buildChildSeed, buildSetSeed, roleIsMechanical, roleIsHint, toPlainText,
} from "./magic-table-runtime.mjs";
import { esc } from "../shared/esc.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TYPE_ICON = { weapon: "fa-gavel", armor: "fa-shield-halved", scroll: "fa-scroll", wand: "fa-wand-sparkles" };

/** Applicable Core set keys per gear type (Phase 1 = weapon + armor only). */
const CORE_SETS_BY_TYPE = {
  weapon: ["magic-weapon-base", "magic-weapon-benefit", "magic-weapon-curse", "magic-personality-detail"],
  armor:  ["magic-armor-base", "magic-armor-benefit", "magic-armor-curse", "magic-personality-detail"],
};

/** State → readiness badge presentation. */
const STATE_BADGE = {
  ready:     { label: "Ready", cls: "ready", icon: "fa-circle-check" },
  locked:    { label: "Not imported", cls: "locked", icon: "fa-lock" },
  partial:   { label: "Incomplete", cls: "partial", icon: "fa-circle-half-stroke" },
  ambiguous: { label: "Ambiguous", cls: "bad", icon: "fa-clone" },
  invalid:   { label: "Invalid", cls: "bad", icon: "fa-triangle-exclamation" },
};

export class MagicForgeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-magic-forge",
    tag: "form",
    window: { title: "Magic Item Forge", icon: "fas fa-hammer", resizable: true },
    position: { width: 720, height: "auto" },
    actions: {
      setType:     MagicForgeApp.prototype._onSetType,
      setMode:     MagicForgeApp.prototype._onSetMode,
      setBonus:    MagicForgeApp.prototype._onSetBonus,
      pickBase:    MagicForgeApp.prototype._onPickBase,
      clearBase:   MagicForgeApp.prototype._onClearBase,
      toggleSpell: MagicForgeApp.prototype._onToggleSpell,
      setTier:     MagicForgeApp.prototype._onSetTier,
      openSpell:   MagicForgeApp.prototype._onOpenSpell,
      coreRoll:    MagicForgeApp.prototype._onCoreRoll,
      coreClear:   MagicForgeApp.prototype._onCoreClear,
      coreImport:  MagicForgeApp.prototype._onCoreImport,
      createItem:  MagicForgeApp.prototype._onCreateItem,
    },
  };

  static PARTS = {
    body: { template: "modules/shadowdark-enhancer/templates/magic-forge.hbs" },
  };

  // ─── Singleton ───

  static _instance = null;

  static open({ seed = null, onCreate = null } = {}) {
    if (!this._instance) this._instance = new MagicForgeApp();
    const inst = this._instance;
    inst._onCreate = onCreate;
    if (seed) inst._applySeed(seed);
    inst._coreStates = null; // reload readiness on (re)open
    MagicForgeApp._installReadinessHooks();
    if (!inst.rendered) inst.render(true);
    else { inst.bringToFront(); inst.render(); }
    return inst;
  }

  /**
   * Refresh Core readiness when the managed tables change. Lifecycle-safe: a
   * single set of hooks for the singleton, guarded on the live instance's
   * rendered state — never re-registered, never fires against a torn-down app.
   */
  static _installReadinessHooks() {
    if (this._readinessHooksInstalled) return;
    this._readinessHooksInstalled = true;
    const refresh = () => {
      const inst = MagicForgeApp._instance;
      if (inst?.rendered && inst._mode === "core") { inst._coreStates = null; inst.render(); }
    };
    for (const h of ["createRollTable", "updateRollTable", "deleteRollTable",
      "createTableResult", "updateTableResult", "deleteTableResult"]) Hooks.on(h, refresh);
  }

  constructor(options = {}) {
    super(options);
    this._type = "weapon";
    this._bonus = 1;
    this._name = "";          // manual name override ("" = derive)
    this._baseUuid = null;
    this._baseData = null;    // toObject() of the chosen base Weapon/Armor
    this._spellUuids = [];    // selected spell uuids (scroll: [0]; wand: all)
    this._identified = true;
    this._onCreate = null;
    // Core mode (imported Core Rulebook tables) — Phase 1: weapon/armor only.
    this._mode = "manual";            // "manual" | "core"
    this._coreStates = null;          // cached catalog() result
    this._coreSelections = new Map(); // manifestId → { manifestId, tableUuid, resultId, range, role, text }
    // search queries (DOM-filtered, no re-render)
    this._baseQuery = "";
    this._spellQuery = "";
    this._openClasses = new Set(); // expanded class folders in the spell selector
    this._tierFilter = null;       // null = all tiers, else a tier number
    // caches
    this._baseLists = null;   // { weapon: [...], armor: [...] }
    this._spellList = null;   // [{ uuid, name, tier, img }]
    this._spellByUuid = new Map();
  }

  /**
   * Preset type + bonus from a forge seed. A stable `forgeType` hint (threaded
   * from a loot placeholder's classification) wins over the loosely-inferred
   * `type`; legacy cards supply only `{type, bonus}` via inferSeedFromName.
   */
  _applySeed(seed) {
    const t = resolveForgeType(seed);
    if (t) this._type = t;
    if (typeof seed.bonus === "number") this._bonus = Math.max(0, Math.min(3, seed.bonus));
    // reset per-forge selections so a fresh seed starts clean
    this._name = ""; this._baseUuid = null; this._baseData = null; this._spellUuids = [];
    this._coreSelections = new Map();
  }

  async close(options = {}) {
    MagicForgeApp._instance = null;
    return super.close(options);
  }

  // ─── Data ───

  async _ensureCaches() {
    if (!this._baseLists) {
      const map = async (coll) => [...coll.contents]
        .map(i => ({ uuid: i.uuid, name: i.name, img: i.img }))
        .sort((a, b) => a.name.localeCompare(b.name));
      this._baseLists = {
        weapon: await map(await shadowdark.compendiums.baseWeapons()),
        armor:  await map(await shadowdark.compendiums.baseArmor()),
      };
    }
    if (!this._spellList) {
      // class uuid → name, so spells can be grouped by class in the selector.
      // Spellcasting classes first; fall back to the full class list for any
      // uuid not in that set (e.g. third-party classes).
      const nameByUuid = new Map();
      for (const helper of ["spellcastingClasses", "classes"]) {
        try {
          const coll = await shadowdark.compendiums[helper]?.();
          if (coll) for (const c of coll.contents) if (!nameByUuid.has(c.uuid)) nameByUuid.set(c.uuid, c.name);
        } catch (_) { /* helper absent — ignore */ }
      }
      const spells = [...(await shadowdark.compendiums.spells()).contents];
      this._spellList = spells
        .map(s => ({
          uuid: s.uuid, name: s.name, tier: s.system?.tier ?? 1, img: s.img,
          classes: (s.system?.class ?? []).map(u => nameByUuid.get(u)).filter(Boolean),
        }))
        .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
      this._spellByUuid = new Map(this._spellList.map(s => [s.uuid, s]));
    }
  }

  /**
   * Group the spell list into per-class folders for the selector. A multi-class
   * spell appears under each of its classes; class-less spells fall into "Other".
   * Within a group, spells keep the cache's tier→name order.
   */
  _buildSpellGroups() {
    const OTHER = "Other";
    const groups = new Map();
    for (const s of this._spellList) {
      const row = {
        uuid: s.uuid, name: s.name, img: s.img, tier: s.tier, dc: s.tier + 10,
        nameLower: s.name.toLowerCase(), selected: this._spellUuids.includes(s.uuid),
      };
      for (const cn of (s.classes.length ? s.classes : [OTHER])) {
        if (!groups.has(cn)) groups.set(cn, []);
        groups.get(cn).push(row);
      }
    }
    return [...groups.entries()]
      .sort((a, b) => (a[0] === OTHER) - (b[0] === OTHER) || a[0].localeCompare(b[0]))
      .map(([className, spells]) => ({
        className, count: spells.length, open: this._openClasses.has(className), spells,
      }));
  }

  async _prepareContext() {
    await this._ensureCaches();
    const isGear = this._type === "weapon" || this._type === "armor";
    const isSpellItem = this._type === "scroll" || this._type === "wand";

    // Core mode is Phase-1 weapon/armor only; spell items force manual.
    const coreAvailable = isGear;
    if (!coreAvailable && this._mode === "core") this._mode = "manual";
    const isCore = this._mode === "core" && coreAvailable;
    if (isCore && !this._coreStates) this._coreStates = await catalog();
    const coreSets = isCore ? this._buildCoreSets() : [];

    const types = WORKING_TYPES.map(id => ({
      id, label: TYPE_LABELS[id], icon: TYPE_ICON[id], active: id === this._type,
    }));

    const baseList = isGear ? (this._baseLists[this._type] ?? []) : [];
    const bases = baseList.map(b => ({ ...b, nameLower: b.name.toLowerCase(), selected: b.uuid === this._baseUuid }));

    const spellGroups = isSpellItem ? this._buildSpellGroups() : [];
    const tiers = isSpellItem ? [...new Set(this._spellList.map(s => s.tier))].sort((a, b) => a - b) : [];
    const tierChips = isSpellItem
      ? [{ label: "All", tier: "all", active: this._tierFilter == null },
         ...tiers.map(t => ({ label: `T${t}`, tier: t, active: this._tierFilter === t }))]
      : [];

    return {
      types,
      isGear, isSpellItem,
      isWand: this._type === "wand",
      typeLabel: TYPE_LABELS[this._type],
      mode: this._mode,
      isCore,
      coreAvailable,
      coreSets,
      coreBonusHint: isCore ? this._coreBonusValue() : null,
      typeHint: isCore ? this._coreTypeHint() : null,
      bonus: this._bonus,
      bonusOptions: [0, 1, 2, 3].map(n => ({ n, active: n === this._bonus })),
      name: this._name,
      identified: this._identified,
      baseSelected: this._baseData ? { name: this._baseData.name, img: this._baseData.img } : null,
      bases,
      spellGroups,
      tierChips,
      preview: this._preview(),
      canForge: this._canForge(),
    };
  }

  // ─── Core mode (imported Core Rulebook tables) ───

  /** Applicable Core set keys for the current gear type. */
  _coreSetKeys() {
    return CORE_SETS_BY_TYPE[this._type] ?? [];
  }

  /** The bonus child manifestId for the current gear type. */
  _coreBonusChildId() {
    return this._type === "weapon" ? "core-weapon-bonus" : this._type === "armor" ? "core-armor-bonus" : null;
  }

  /** The parsed numeric bonus from the selected bonus-table result (or null). */
  _coreBonusValue() {
    const sel = this._coreSelections.get(this._coreBonusChildId());
    return sel ? parseBonusValue(sel.text) : null;
  }

  /** Display-only hint text from the selected Type result (never persisted). */
  _coreTypeHint() {
    const id = this._type === "weapon" ? "core-weapon-type" : "core-armor-type";
    return this._coreSelections.get(id)?.text ?? null;
  }

  /** Find a requirement (child) in the cached states by manifestId. */
  _findReq(manifestId) {
    for (const key of this._coreSetKeys()) {
      const st = this._coreStates?.[key];
      const req = st?.requirements.find(r => r.manifestId === manifestId);
      if (req) return req;
    }
    return null;
  }

  /** Build the Core readiness/selection view-model for each applicable set. */
  _buildCoreSets() {
    return this._coreSetKeys().map(key => {
      const def = MAGIC_SET_DEFS[key];
      const st = this._coreStates[key];
      const badge = STATE_BADGE[st.state] ?? STATE_BADGE.locked;
      const fields = st.requirements.map(req => {
        const sel = this._coreSelections.get(req.manifestId) ?? null;
        const roleClass = roleIsMechanical(req.role) ? "mechanical" : roleIsHint(req.role) ? "hint" : "descriptive";
        const roleLabel = roleIsMechanical(req.role) ? "mechanical +N" : roleIsHint(req.role) ? "base hint" : "descriptive";
        return {
          manifestId: req.manifestId,
          label: req.label,
          role: req.role,
          roleClass, roleLabel,
          ready: req.valid && req.count === 1,
          page: req.page,
          setKey: key,
          perTable: def.perTable,
          results: req.results.map(r => ({
            resultId: r.resultId, tableUuid: r.tableUuid,
            rangeLabel: r.range[0] === r.range[1] ? `${r.range[0]}` : `${r.range[0]}–${r.range[1]}`,
            text: r.text, selected: sel?.resultId === r.resultId,
          })),
          selectedText: sel?.text ?? "",
          hasSelection: !!sel,
        };
      });
      return {
        key, label: def.label, role: def.role, perTable: def.perTable,
        state: st.state, ready: st.ready, badge,
        diagnostics: st.diagnostics,
        pageLabel: st.pages.length > 1 ? `pp.${st.pages.join("/")}` : `p.${st.page}`,
        fields,
      };
    });
  }

  /**
   * The bonus that will actually be forged. In Core mode the mechanical +N is
   * driven ENTIRELY by the imported Bonus table (0 until a numeric result is
   * picked); Manual mode uses the +N row.
   */
  _effectiveBonus() {
    if (this._mode === "core" && (this._type === "weapon" || this._type === "armor")) {
      return this._coreBonusValue() ?? 0;
    }
    return this._bonus;
  }

  /** Derive the item name shown in the preview / used on create. */
  _deriveName() {
    if (this._name.trim()) return this._name.trim();
    if (this._type === "scroll" || this._type === "wand") {
      const first = this._spellByUuid.get(this._spellUuids[0]);
      const word = this._type === "scroll" ? "Scroll" : "Wand";
      return first ? `${word} of ${first.name}` : word;
    }
    return composeName({ type: this._type, baseItem: this._baseData?.name ?? "", bonus: this._effectiveBonus() });
  }

  _canForge() {
    if (this._type === "weapon" || this._type === "armor") return !!this._baseData;
    if (this._type === "scroll") return this._spellUuids.length === 1;
    if (this._type === "wand") return this._spellUuids.length >= 1;
    return false;
  }

  /** Build the live-preview view-model. */
  _preview() {
    const name = this._deriveName();
    const lines = [];
    if (this._type === "weapon" || this._type === "armor") {
      lines.push(this._baseData ? `Base: ${this._baseData.name}` : "Pick a base item");
      const eb = this._effectiveBonus();
      if (eb > 0) lines.push(`Magic bonus: +${eb}${this._mode === "core" && this._coreBonusValue() != null ? " (from Core table)" : ""}`);
      if (this._mode === "core") {
        const riders = [...this._coreSelections.values()].filter(s => this._coreSetKeys().some(k => MAGIC_SET_DEFS[k].children.some(c => c.manifestId === s.manifestId)) && s.role !== "bonus" && s.role !== "type");
        if (riders.length) lines.push(`${riders.length} descriptive rider(s) selected`);
        const hint = this._coreTypeHint();
        if (hint) lines.push(`Type hint: ${hint}`);
      }
    } else {
      const spells = this._spellUuids.map(u => this._spellByUuid.get(u)).filter(Boolean);
      if (!spells.length) lines.push("Pick a spell");
      for (const s of spells) lines.push(`${s.name} — cast DC ${s.tier + 10} (tier ${s.tier})`);
    }
    return { name, typeLabel: TYPE_LABELS[this._type], icon: TYPE_ICON[this._type], lines };
  }

  // ─── Render / wiring ───

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    this._renderAbort?.abort();
    this._renderAbort = new AbortController();
    const signal = this._renderAbort.signal;

    // Name override — commit without re-render (preserve focus); patch preview.
    const nameInput = el.querySelector("input[name='name']");
    nameInput?.addEventListener("input", () => { this._name = nameInput.value; this._refreshPreviewDOM(); }, { signal });

    // Identified toggle.
    const ident = el.querySelector("input[name='identified']");
    ident?.addEventListener("change", () => { this._identified = ident.checked; }, { signal });

    // Base-item search — DOM filter, focus-preserving.
    const baseSearch = el.querySelector(".sde-forge-base-search");
    baseSearch?.addEventListener("input", () => {
      this._baseQuery = baseSearch.value.toLowerCase();
      this._filterList(el, ".sde-forge-base-row", this._baseQuery);
    }, { signal });

    // Spell search — group-aware DOM filter (auto-expands classes with matches).
    const spellSearch = el.querySelector(".sde-forge-spell-search");
    spellSearch?.addEventListener("input", () => {
      this._spellQuery = spellSearch.value.toLowerCase();
      this._filterSpells(el);
    }, { signal });

    // Persist class-folder open/closed state across renders (ignore search-driven
    // auto-open so collapsing a folder by hand sticks once the search clears).
    for (const group of el.querySelectorAll(".sde-forge-spell-group")) {
      group.addEventListener("toggle", () => {
        if (this._spellQuery) return;
        if (group.open) this._openClasses.add(group.dataset.class);
        else this._openClasses.delete(group.dataset.class);
      }, { signal });
    }

    // Core result <select> — manual selection (never fabricates a roll).
    for (const sel of el.querySelectorAll(".sde-forge-core-select")) {
      sel.addEventListener("change", () => {
        const manifestId = sel.dataset.manifestId;
        const req = this._findReq(manifestId);
        if (!req) return;
        const resultId = sel.value;
        if (!resultId) { this._coreSelections.delete(manifestId); this.render(); return; }
        const hit = req.results.find(r => r.resultId === resultId);
        if (hit) this._selectCoreResult(req, hit);
        this.render();
      }, { signal });
    }

    // Re-apply standing queries/filters after a render.
    if (this._baseQuery) this._filterList(el, ".sde-forge-base-row", this._baseQuery);
    if (el.querySelector(".sde-forge-spell-group")) this._filterSpells(el);
  }

  /** Toggle row visibility by a substring of its data-name. No re-render. */
  _filterList(el, rowSel, query) {
    for (const row of el.querySelectorAll(rowSel)) {
      const name = row.dataset.name ?? "";
      row.toggleAttribute("hidden", !!query && !name.includes(query));
    }
  }

  /**
   * Filter spell rows by name AND tier, then hide empty class folders.
   * No re-render. Only a TEXT query auto-expands matching folders (you typed
   * a name, you want to see it); the tier filter narrows the rows in place and
   * leaves each folder's open/closed state alone, so picking a tier doesn't
   * fling every class open.
   */
  _filterSpells(el) {
    const q = this._spellQuery;
    const tier = this._tierFilter;
    for (const group of el.querySelectorAll(".sde-forge-spell-group")) {
      let anyVisible = false;
      for (const row of group.querySelectorAll(".sde-forge-spell-row")) {
        const matchName = !q || (row.dataset.name ?? "").includes(q);
        const matchTier = tier == null || row.dataset.tier === String(tier);
        const match = matchName && matchTier;
        row.toggleAttribute("hidden", !match);
        if (match) anyVisible = true;
      }
      group.toggleAttribute("hidden", !anyVisible);
      group.open = q ? anyVisible : this._openClasses.has(group.dataset.class);
    }
  }

  /** Re-sync spell-row selection + preview after an in-place pick (no render). */
  _syncSpellRows() {
    const el = this.element; if (!el) return;
    for (const row of el.querySelectorAll(".sde-forge-spell-row"))
      row.classList.toggle("selected", this._spellUuids.includes(row.dataset.uuid));
  }

  /** Patch the live-preview pane (name, lines, Forge-button enabled) in place. */
  _refreshPreviewDOM() {
    const el = this.element; if (!el) return;
    const pv = this._preview();
    const nameNode = el.querySelector(".sde-forge-preview-name");
    if (nameNode) nameNode.textContent = pv.name;
    const linesNode = el.querySelector(".sde-forge-preview-lines");
    if (linesNode) linesNode.innerHTML = pv.lines.map(l => `<li>${esc(l)}</li>`).join("");
    const createBtn = el.querySelector(".sde-forge-create");
    if (createBtn) createBtn.disabled = !this._canForge();
  }

  // ─── Actions ───

  _onSetType(event, target) {
    const t = target.dataset.type;
    if (!WORKING_TYPES.includes(t) || t === this._type) return;
    this._type = t;
    // selections are type-specific — reset on switch
    this._baseUuid = null; this._baseData = null; this._spellUuids = [];
    this._baseQuery = ""; this._spellQuery = ""; this._tierFilter = null;
    this.render();
  }

  /** Switch Manual ⇄ Core mode (Core is weapon/armor only). No auto-rolls. */
  _onSetMode(event, target) {
    const m = target.dataset.mode === "core" ? "core" : "manual";
    if (m === this._mode) return;
    if (m === "core" && !(this._type === "weapon" || this._type === "armor")) return;
    this._mode = m;
    if (m === "core") this._coreStates = null; // lazy reload
    this.render();
  }

  _onSetBonus(event, target) {
    this._bonus = Math.max(0, Math.min(3, Number(target.dataset.bonus) || 0));
    this.render();
  }

  /** Roll a Core child table with a real Foundry Roll; select the covering row. */
  async _onCoreRoll(event, target) {
    if (!this._coreStates) this._coreStates = await catalog();
    const manifestId = target.dataset.manifestId;
    const req = this._findReq(manifestId);
    if (!req || !req.results?.length) { ui.notifications.warn("Import this table first."); return; }
    const roll = await (new Roll(req.formula)).evaluate();
    const total = roll.total;
    const hit = req.results.find(r => total >= r.range[0] && total <= r.range[1]) ?? req.results[req.results.length - 1];
    this._selectCoreResult(req, hit);
    // For a Bonus table, show the EXACT mechanical value the strict parser will
    // apply (or a clear "not a usable +N" note) — never leave it ambiguous.
    let mech = "";
    if (req.role === "bonus") {
      const parsed = parseBonusValue(hit.text);
      mech = parsed != null
        ? ` <strong>[applies +${parsed}]</strong>`
        : ` <strong>[not a usable +N — pick again]</strong>`;
    }
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker(),
      flavor: `<strong>Magic Item Forge — ${esc(req.label)}</strong> (${esc(req.formula)})<br>${esc(hit.text)}${mech}`,
    });
    this.render();
  }

  /** Store a Core selection keyed by its table's manifestId. */
  _selectCoreResult(req, result) {
    this._coreSelections.set(req.manifestId, {
      manifestId: req.manifestId, tableUuid: result.tableUuid, resultId: result.resultId,
      range: [...result.range], role: req.role, text: result.text,
    });
  }

  /** Clear a Core selection (leaves the imported table intact). */
  _onCoreClear(event, target) {
    this._coreSelections.delete(target.dataset.manifestId);
    this.render();
  }

  /** Open the Importer Hub seeded to import this set/table from the Core PDF. */
  async _onCoreImport(event, target) {
    const seed = target.dataset.child ? buildChildSeed(target.dataset.child) : buildSetSeed(target.dataset.set);
    const { ImporterHubApp } = await import("../importer/importer-hub-app.mjs");
    ImporterHubApp.open(null, seed);
  }

  async _onPickBase(event, target) {
    const uuid = target.dataset.uuid;
    const item = await fromUuid(uuid);
    if (!item) { ui.notifications.warn("Could not load that base item."); return; }
    this._baseUuid = uuid;
    this._baseData = item.toObject();
    this.render();
  }

  _onClearBase() {
    this._baseUuid = null; this._baseData = null;
    this.render();
  }

  _onToggleSpell(event, target) {
    const uuid = target.dataset.uuid;
    if (this._type === "scroll") {
      this._spellUuids = this._spellUuids[0] === uuid ? [] : [uuid];
    } else { // wand — multi
      const i = this._spellUuids.indexOf(uuid);
      if (i >= 0) this._spellUuids.splice(i, 1);
      else this._spellUuids.push(uuid);
    }
    // Update in place so open class folders / scroll position aren't lost.
    this._syncSpellRows();
    this._refreshPreviewDOM();
  }

  /** Tier (level) filter chip — applied in place, no re-render. */
  _onSetTier(event, target) {
    const raw = target.dataset.tier;
    this._tierFilter = raw === "all" ? null : Number(raw);
    const el = this.element;
    for (const chip of el.querySelectorAll(".sde-forge-tier"))
      chip.classList.toggle("active", chip.dataset.tier === raw);
    this._filterSpells(el);
  }

  /** Pop out a spell's sheet so the GM can read it before picking. */
  async _onOpenSpell(event, target) {
    const item = await fromUuid(target.dataset.uuid);
    if (item?.sheet) item.sheet.render(true);
    else ui.notifications.warn("Could not open that spell.");
  }

  /** The applicable set key owning a child manifestId (for provenance recipe). */
  _setKeyForChild(manifestId) {
    return this._coreSetKeys().find(k => MAGIC_SET_DEFS[k].children.some(c => c.manifestId === manifestId)) ?? null;
  }

  /**
   * Build the forge draft. Manual mode uses the +N row directly. Core mode
   * re-resolves every selected imported-result reference against the live pack
   * (throws on any stale/invalid/changed selection — fail-closed) and maps the
   * bonus row (numeric mechanic) + descriptive riders + refs-only provenance.
   */
  async _buildForgeDraft(isGear) {
    const base = {
      type: this._type,
      name: this._deriveName(),
      baseItem: this._baseData?.name ?? "",
      baseItemData: isGear ? this._baseData : null,
      spellUuids: this._spellUuids,
      identified: this._identified,
    };
    if (!(this._mode === "core" && isGear)) return { ...base, bonus: this._bonus };

    const selections = [...this._coreSelections.values()].filter(s =>
      this._coreSetKeys().some(k => MAGIC_SET_DEFS[k].children.some(c => c.manifestId === s.manifestId)));
    const refs = selections.map(s => ({ manifestId: s.manifestId, tableUuid: s.tableUuid, resultId: s.resultId }));
    const live = refs.length ? await resolveResultRefs(refs) : [];

    // Integrity guard: a table can be edited in place (same result id, changed
    // text). Compare each selection's remembered text (ephemeral, never
    // persisted) to the live resolved text and BLOCK on any mismatch — the
    // semantics changed under the selection, so fail closed rather than swap.
    for (const sel of selections) {
      const hit = live.find(r => r.manifestId === sel.manifestId && r.tableUuid === sel.tableUuid && r.resultId === sel.resultId);
      if (hit && toPlainText(hit.text) !== toPlainText(sel.text)) {
        throw new Error(`A selected “${hit.label ?? sel.manifestId}” result changed since you picked it — re-roll or re-select it. Nothing was created.`);
      }
    }

    const descriptors = live.filter(r => r.role !== "bonus" && r.role !== "type").map(r => ({ role: r.role, text: r.text }));
    const bonusResult = live.find(r => r.role === "bonus");
    // A picked Bonus result that isn't a usable whole +N fails closed (never
    // silently becomes +0 or disappears).
    const coreBonus = bonusResult ? resolveSelectedBonus(bonusResult.text) : null;
    const bonus = coreBonus ?? 0; // Core mode: mechanic comes only from the Bonus table
    const automation = [];
    if (coreBonus != null && coreBonus > 0) automation.push({ kind: `${this._type}-bonus`, value: coreBonus });
    const forge = buildForgeProvenance({
      recipe: { mode: "core", type: this._type, sets: [...new Set(selections.map(s => this._setKeyForChild(s.manifestId)).filter(Boolean))] },
      results: live, automation, nonAutomated: descriptors.length > 0,
    });
    return { ...base, bonus, descriptors, forge };
  }

  async _onCreateItem() {
    if (!game.user.isGM) { ui.notifications.warn("GM only."); return; }
    if (!this._canForge()) {
      const need = (this._type === "weapon" || this._type === "armor")
        ? "Pick a base item first." : "Pick a spell first.";
      ui.notifications.warn(need);
      return;
    }

    const isGear = this._type === "weapon" || this._type === "armor";
    let draft;
    try {
      draft = await this._buildForgeDraft(isGear);
    } catch (err) {
      // Fail-closed: a stale/invalid/changed Core selection blocks creation and
      // leaves all state intact (nothing persisted).
      ui.notifications.error(`Forge blocked: ${err.message}`);
      this._coreStates = null;
      this.render();
      return;
    }
    const data = assembleItemData(draft);
    if (!data.img && this._baseData?.img) data.img = this._baseData.img;

    const folder = await this._ensureForgedFolder();
    data.folder = folder.id;

    const item = await Item.create(data);
    if (!item) { ui.notifications.error("Forge failed — see console."); return; }

    await this._onCreate?.(item);
    this._onCreate = null;
    await this._postChatCard(item);
    ui.notifications.info(`Forged "${item.name}".`);
  }

  // ─── Helpers ───

  async _postChatCard(item) {
    const sub = this._previewSubtitle(item);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker(),
      content: `<div class="shadowdark-enhancer sde-forge-card" style="display:flex;align-items:center;gap:8px;">
        <img src="${esc(item.img)}" alt="" width="36" height="36" style="border:none;flex:0 0 auto;">
        <div><strong>Forged:</strong> ${esc(item.name)}<br><span style="opacity:0.8;">${esc(sub)}</span></div>
      </div>`,
    });
  }

  _previewSubtitle(_item) {
    if (this._type === "weapon" || this._type === "armor") {
      const eb = this._effectiveBonus(); // the +N that was actually forged (Core wins)
      return eb > 0 ? `Magic ${TYPE_LABELS[this._type]} +${eb}` : `Magic ${TYPE_LABELS[this._type]}`;
    }
    const spells = this._spellUuids.map(u => this._spellByUuid.get(u)).filter(Boolean);
    return spells.map(s => `${s.name} (DC ${s.tier + 10})`).join(", ");
  }

  async _ensureForgedFolder() {
    return (
      game.folders.find(f => f.type === "Item" && f.name === "Forged Items" && !f.folder)
      ?? await Folder.create({ name: "Forged Items", type: "Item" })
    );
  }
}
