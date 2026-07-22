import { BaseStep } from "./base-step.mjs";

/**
 * Step — Languages (after Class, so both ancestry and class contribute).
 *
 * Known languages = the ancestry's + class's `fixed` list (auto), plus chosen
 * languages: `common`/`rare` counts pick from the common/rare pools, and
 * `select` counts pick from the ancestry/class `selectOptions`. Choices reset
 * when the ancestry or class changes.
 */
export class LanguagesStep extends BaseStep {
  constructor(app) {
    super(app);
    this._cache = null;
    this._comboKey = null;
  }

  get id() { return "languages"; }
  get label() { return "SDE.charBuilder.step.languages"; }
  get icon() { return "fa-solid fa-language"; }
  get partial() { return "sde-cb-languages"; }

  _combo() { return `${this.state.ancestry?.uuid || ""}|${this.state.class?.uuid || ""}`; }

  async _data() {
    const key = this._combo();
    if (this._cache && this._comboKey === key) return this._cache;

    // Ancestry/class changed → reset chosen languages.
    this.state.languageChoices = { common: [], rare: [], select: [] };

    const ancL = this.state.ancestry?.item?.system?.languages || {};
    const clsL = this.state.class?.item?.system?.languages || {};
    const fixedUuids = [...new Set([...(ancL.fixed || []), ...(clsL.fixed || [])])];
    const fixed = [];
    for (const u of fixedUuids) {
       
      const d = await fromUuid(u).catch(() => null);
      if (d) fixed.push({ uuid: u, name: d.name });
    }
    const slots = {
      common: (ancL.common || 0) + (clsL.common || 0),
      rare: (ancL.rare || 0) + (clsL.rare || 0),
      select: (ancL.select || 0) + (clsL.select || 0),
    };
    const commonPool = Array.from(await shadowdark.compendiums.commonLanguages());
    const rarePool = Array.from(await shadowdark.compendiums.rareLanguages());
    const selectUuids = [...new Set([...(ancL.selectOptions || []), ...(clsL.selectOptions || [])])];
    const selectPool = [];
    for (const u of selectUuids) {
       
      const d = await fromUuid(u).catch(() => null);
      if (d) selectPool.push({ uuid: u, name: d.name });
    }
    const fixedSet = new Set(fixedUuids);
    const filt = (arr) => arr.filter((l) => !fixedSet.has(l.uuid)).map((l) => ({ uuid: l.uuid, name: l.name }));

    this._cache = { fixed, slots, pools: { common: filt(commonPool), rare: filt(rarePool), select: filt(selectPool) } };
    this._comboKey = key;
    this._sync();
    return this._cache;
  }

  /** Rebuild the flat known-languages list the commit consumes. */
  _sync() {
    if (!this._cache) return;
    const ch = this.state.languageChoices;
    this.state.languages = [...new Set([...this._cache.fixed.map((f) => f.uuid), ...ch.common, ...ch.rare, ...ch.select])];
  }

  isComplete() {
    if (!this._cache) return true;
    const ch = this.state.languageChoices;
    const s = this._cache.slots;
    return ch.common.length >= s.common && ch.rare.length >= s.rare && ch.select.length >= s.select;
  }

  async prepareContext() {
    const d = await this._data();
    const ch = this.state.languageChoices;
    const cat = (key, labelKey) => {
      const need = d.slots[key];
      if (!need) return null;
      const chosen = ch[key];
      return {
        key, labelKey, need, chosenCount: chosen.length, full: chosen.length >= need,
        options: d.pools[key].map((l) => ({
          uuid: l.uuid, name: l.name,
          selected: chosen.includes(l.uuid),
          disabled: !chosen.includes(l.uuid) && chosen.length >= need,
        })),
      };
    };
    return {
      fixed: d.fixed,
      categories: [
        cat("common", "SDE.charBuilder.languages.common"),
        cat("rare", "SDE.charBuilder.languages.rare"),
        cat("select", "SDE.charBuilder.languages.select"),
      ].filter(Boolean),
      noChoices: d.slots.common + d.slots.rare + d.slots.select === 0,
    };
  }

  supportsRandom() { return true; }

  async randomize() {
    const d = await this._data();
    this.state.languageChoices = { common: [], rare: [], select: [] };
    for (const key of ["common", "rare", "select"]) {
      const pool = [...d.pools[key]].sort(() => Math.random() - 0.5).slice(0, d.slots[key]);
      this.state.languageChoices[key] = pool.map((l) => l.uuid);
    }
    this._sync();
  }

  toggle(key, uuid) {
    const ch = this.state.languageChoices[key];
    const idx = ch.indexOf(uuid);
    if (idx >= 0) ch.splice(idx, 1);
    else if (ch.length < (this._cache?.slots[key] ?? 0)) ch.push(uuid);
    this._sync();
  }

  onRender(root) {
    root.querySelectorAll("[data-cb-lang]").forEach((el) => el.addEventListener("click", async () => {
      this.toggle(el.dataset.cbLangCat, el.dataset.cbLang);
      await this.app.render();
    }));
  }
}
