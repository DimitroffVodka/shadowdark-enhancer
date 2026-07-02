import { ListStep } from "./list-step.mjs";
import {
  loadAncestries, enrich, tableOptions, rollTableDoc,
  configuredTables, tableMatchesAncestry, coreNameTable, findTableByName,
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

  /** All tables this ancestry may draw a `kind` roll from: the GM-configured
   *  tables (per-ancestry filtered), or the built-in resolution (ancestry
   *  `system.nameTable` → name-convention lookup) when nothing is configured.
   *  The player never picks a table — the dice button rolls a random one and
   *  the choose-dropdown merges every table's options. */
  async _tablesFor(item, kind) {
    if (!item?.uuid) return [];
    const key = `${item.uuid}:${kind}`;
    if (this._tableCache[key]) return this._tableCache[key];
    const configured = await configuredTables(kind);
    const allNames = (await this.items()).map((a) => a.name);
    let docs = configured
      .filter((t) => tableMatchesAncestry(t.name, item.name, allNames))
      .map((t) => t.doc);
    if (!docs.length) {
      const fb = kind === "name"
        ? await coreNameTable(item)
        : await findTableByName([`${item.name} Trinket`], ["shadowdark-enhancer"]);
      if (fb?.results?.size > 0) docs = [fb];
    }
    this._tableCache[key] = docs;
    return docs;
  }

  /** Choose-dropdown options merged (deduped) across every available table. */
  async _mergedOptions(item, kind) {
    const opts = [];
    const seen = new Set();
    for (const t of await this._tablesFor(item, kind)) {
      for (const o of tableOptions(t)) {
        if (!seen.has(o.value)) { seen.add(o.value); opts.push(o); }
      }
    }
    return opts;
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

  /** Toggle an ancestry talent choice. At capacity, picking a new option
   *  replaces the oldest pick — no need to deselect first. */
  toggleTalent(uuid) {
    const item = this.selected?.item;
    if (!item) return;
    const count = item.system.talentChoiceCount || 0;
    const chosen = this.state.ancestryTalents;
    const idx = chosen.indexOf(uuid);
    if (idx >= 0) { chosen.splice(idx, 1); return; }
    if (chosen.length >= count) chosen.splice(0, chosen.length - count + 1);
    chosen.push(uuid);
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
    const nameTables = await this._tablesFor(item, "name");
    const trinketTables = await this._tablesFor(item, "trinket");
    const mark = (opts, cur) => opts.map((o) => ({ ...o, selected: o.value === cur }));
    return {
      charName: this.state.name || "",
      trinket: this.state.trinket || "",
      canRollName: nameTables.length > 0,
      canRollTrinket: trinketTables.length > 0,
      nameOptions: mark(await this._mergedOptions(item, "name"), this.state.name),
      trinketOptions: mark(await this._mergedOptions(item, "trinket"), this.state.trinket),
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

  /** Roll a random one of the available tables for the kind. */
  async _rollKind(kind) {
    const tables = await this._tablesFor(this.selected?.item, kind);
    if (!tables.length) return null;
    return rollTableDoc(tables[Math.floor(Math.random() * tables.length)]);
  }

  async rollName() {
    const v = await this._rollKind("name");
    if (v) this.state.name = v;
  }

  async rollTrinket() {
    const v = await this._rollKind("trinket");
    if (v) this.state.trinket = v;
  }

  _onRenderExtra(root) {
    root.querySelectorAll("[data-cb-anc-talent]").forEach((el) => el.addEventListener("click", async () => {
      this.toggleTalent(el.dataset.cbAncTalent);
      await this.app.render();
    }));
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
