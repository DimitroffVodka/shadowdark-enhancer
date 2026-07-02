import { ListStep } from "./list-step.mjs";
import {
  loadAncestries, enrich, tableOptions, rollTableDoc,
  TABLE_SOURCES, enabledSourceIds,
} from "../data.mjs";
import { ancestryArt } from "../art.mjs";

/**
 * Step — Ancestry.
 *
 * List/detail/aside pick of an ancestry, plus two extra choices on this tab: a
 * **Name** and a **Trinket**. Each offers all three inputs — a dropdown to
 * choose from the ancestry's table, a dice button to roll it, and a free-text
 * field to type your own.
 *
 * Name tables: the system pack `shadowdark.rollable-tables` ("Character Names:
 * <Ancestry>"), pointed to by `ancestry.system.nameTable`.
 * Trinket tables: per-ancestry "<Ancestry> Trinket" tables (resolved by name).
 */
export class AncestryStep extends ListStep {
  constructor(app) {
    super(app);
    this._tableCache = {};
  }

  get id() { return "ancestry"; }
  get label() { return "SDE.charBuilder.step.ancestry"; }
  get icon() { return "fa-solid fa-people-group"; }
  get partial() { return "sde-cb-ancestry"; }
  get stateKey() { return "ancestry"; }
  get weightPath() { return "system.randomWeight"; }

  async loadItems() { return loadAncestries(); }

  /** Use a bundled ancestry portrait when one exists, else the system icon. */
  portrait(item) { return ancestryArt(item?.name); }

  /** Resolve (and cache) one source's name/trinket table for an ancestry.
   *  Empty tables (present but with no results — e.g. an uninstalled WR pack)
   *  resolve to null so that source drops out of the available list. */
  async _tableFor(item, sourceId, kind) {
    if (!item?.uuid || !sourceId) return null;
    const key = `${item.uuid}:${sourceId}:${kind}`;
    if (key in this._tableCache) return this._tableCache[key];
    const src = TABLE_SOURCES.find((s) => s.id === sourceId);
    let doc = src ? await src[kind](item) : null;
    if (doc && !(doc.results?.size > 0)) doc = null;   // ignore present-but-empty tables
    this._tableCache[key] = doc;
    return doc;
  }

  /** Enabled sources (localized) that actually have a `kind` table for this ancestry. */
  async _availableSources(item, kind) {
    const avail = [];
    for (const id of enabledSourceIds()) {
      // eslint-disable-next-line no-await-in-loop
      if (await this._tableFor(item, id, kind)) {
        const src = TABLE_SOURCES.find((s) => s.id === id);
        avail.push({ id, label: game.i18n.localize(src.label) });
      }
    }
    return avail;
  }

  /** Initialise the ancestry talent choice on selection: all when granted, else the first N. */
  async _onSelect(item) {
    const talents = item.system.talents || [];
    const count = item.system.talentChoiceCount || 0;
    this.state.ancestryTalents = talents.length <= count ? [...talents] : talents.slice(0, count);
    // Languages may include the old ancestry's fixed/chosen picks — redo them.
    this.state.languages = [];
    this.state.languageChoices = { common: [], rare: [], select: [] };
  }

  _needsTalentChoice(item) {
    return (item.system.talents || []).length > (item.system.talentChoiceCount || 0);
  }

  /** Toggle an ancestry talent choice, respecting talentChoiceCount. */
  toggleTalent(uuid) {
    const item = this.selected?.item;
    if (!item) return;
    const count = item.system.talentChoiceCount || 0;
    const chosen = this.state.ancestryTalents;
    const idx = chosen.indexOf(uuid);
    if (idx >= 0) chosen.splice(idx, 1);
    else if (chosen.length < count) chosen.push(uuid);
  }

  async asideContext(item) {
    const chosen = this.state.ancestryTalents || [];
    const traits = [];
    for (const uuid of (item.system.talents || [])) {
      const t = await fromUuid(uuid);
      if (!t) continue;
      // Inline-format like the rulebook: **Stout.** description… — strip the
      // enrich() wrapper <p> so the bold name and text sit on one flowing line.
      const descInline = (await enrich(t.system?.description))
        .replace(/^\s*<p>/i, "").replace(/<\/p>\s*$/i, "").trim();
      traits.push({ uuid, name: t.name, descInline, selected: chosen.includes(uuid) });
    }
    return {
      traits,
      needsTalentChoice: this._needsTalentChoice(item),
      talentChoiceCount: item.system.talentChoiceCount || 0,
      languageText: await this._languageText(item),
    };
  }

  /** A rulebook-style sentence naming the ancestry's known + choosable languages. */
  async _languageText(item) {
    const lang = item.system?.languages || {};
    const names = [];
    for (const uuid of (lang.fixed || [])) {
      const d = await fromUuid(uuid).catch(() => null);
      if (d?.name) names.push(d.name);
    }
    names.sort((a, b) => (a === "Common" ? -1 : b === "Common" ? 1 : 0)); // Common first, like the book
    const word = (n) => ["", "one", "two", "three", "four", "five"][n] || String(n);
    const items = [...names];
    if (lang.common > 0) items.push(`${word(lang.common)} additional common language${lang.common > 1 ? "s" : ""} of your choice`);
    if (lang.rare > 0) items.push(`${word(lang.rare)} rare language${lang.rare > 1 ? "s" : ""} of your choice`);
    if (lang.select > 0) items.push(`${word(lang.select)} more language${lang.select > 1 ? "s" : ""} of your choice`);
    if (!items.length) return "";
    const join = (a) => a.length <= 1 ? (a[0] || "")
      : a.length === 2 ? `${a[0]} and ${a[1]}`
        : `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`;
    return `You know ${join(items)}.`;
  }

  async extraContext(item) {
    if (!item) return { charName: this.state.name || "", trinket: this.state.trinket || "" };
    const nameSources = await this._availableSources(item, "name");
    const trinketSources = await this._availableSources(item, "trinket");
    // Keep the player's source choice if still available, else default to the first.
    if (!nameSources.find((s) => s.id === this.state.nameSource)) this.state.nameSource = nameSources[0]?.id ?? null;
    if (!trinketSources.find((s) => s.id === this.state.trinketSource)) this.state.trinketSource = trinketSources[0]?.id ?? null;
    const nameTable = await this._tableFor(item, this.state.nameSource, "name");
    const trinketTable = await this._tableFor(item, this.state.trinketSource, "trinket");
    const mark = (opts, cur) => opts.map((o) => ({ ...o, selected: o.value === cur }));
    const markSrc = (list, cur) => list.map((s) => ({ ...s, selected: s.id === cur }));
    return {
      charName: this.state.name || "",
      trinket: this.state.trinket || "",
      nameSources: markSrc(nameSources, this.state.nameSource),
      trinketSources: markSrc(trinketSources, this.state.trinketSource),
      multiNameSource: nameSources.length > 1,
      multiTrinketSource: trinketSources.length > 1,
      canRollName: !!nameTable,
      canRollTrinket: !!trinketTable,
      nameOptions: mark(nameTable ? tableOptions(nameTable) : [], this.state.name),
      trinketOptions: mark(trinketTable ? tableOptions(trinketTable) : [], this.state.trinket),
    };
  }

  async randomize() {
    await super.randomize();        // pick a (weighted) random ancestry (sets ancestryTalents to the first N)
    const item = this.selected?.item;
    if (item && this._needsTalentChoice(item)) {
      const count = item.system.talentChoiceCount || 0;
      this.state.ancestryTalents = [...(item.system.talents || [])].sort(() => Math.random() - 0.5).slice(0, count);
    }
    await this.rollName();
    await this.rollTrinket();
  }

  async rollName() {
    const item = this.selected?.item;
    if (!this.state.nameSource) this.state.nameSource = (await this._availableSources(item, "name"))[0]?.id ?? null;
    const v = await rollTableDoc(await this._tableFor(item, this.state.nameSource, "name"));
    if (v) this.state.name = v;
  }

  async rollTrinket() {
    const item = this.selected?.item;
    if (!this.state.trinketSource) this.state.trinketSource = (await this._availableSources(item, "trinket"))[0]?.id ?? null;
    const v = await rollTableDoc(await this._tableFor(item, this.state.trinketSource, "trinket"));
    if (v) this.state.trinket = v;
  }

  _onRenderExtra(root) {
    root.querySelectorAll("[data-cb-anc-talent]").forEach((el) => el.addEventListener("click", async () => {
      this.toggleTalent(el.dataset.cbAncTalent);
      await this.app.render();
    }));
    root.querySelector("[data-cb-name-source]")?.addEventListener("change", async (ev) => {
      this.state.nameSource = ev.target.value;
      await this.app.render();
    });
    root.querySelector("[data-cb-trinket-source]")?.addEventListener("change", async (ev) => {
      this.state.trinketSource = ev.target.value;
      await this.app.render();
    });
    root.querySelector("[data-cb-name-choice]")?.addEventListener("change", async (ev) => {
      if (ev.target.value) { this.state.name = ev.target.value; await this.app.render(); }
    });
    root.querySelector("[data-cb-trinket-choice]")?.addEventListener("change", async (ev) => {
      if (ev.target.value) { this.state.trinket = ev.target.value; await this.app.render(); }
    });
    root.querySelector("[data-cb-name]")?.addEventListener("change", (ev) => {
      this.state.name = ev.target.value;
    });
    root.querySelector("[data-cb-trinket]")?.addEventListener("change", (ev) => {
      this.state.trinket = ev.target.value;
    });
    root.querySelector("[data-cb-roll-name]")?.addEventListener("click", async () => {
      await this.rollName();
      await this.app.render();
    });
    root.querySelector("[data-cb-roll-trinket]")?.addEventListener("click", async () => {
      await this.rollTrinket();
      await this.app.render();
    });
  }
}
