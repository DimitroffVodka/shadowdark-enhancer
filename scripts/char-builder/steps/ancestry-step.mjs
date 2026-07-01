import { ListStep } from "./list-step.mjs";
import {
  loadAncestries, enrich, findTrinketTable, tableOptions, rollTableDoc, resolveTable,
} from "../data.mjs";

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

  /** Resolve (and cache) an ancestry's name + trinket tables. */
  async _tablesFor(item) {
    if (!item?.uuid) return { nameTable: null, trinketTable: null };
    if (this._tableCache[item.uuid]) return this._tableCache[item.uuid];
    const t = {
      nameTable: await resolveTable(item.system?.nameTable),
      trinketTable: await findTrinketTable(item.name),
    };
    this._tableCache[item.uuid] = t;
    return t;
  }

  /** Initialise the ancestry talent choice on selection: all when granted, else the first N. */
  async _onSelect(item) {
    const talents = item.system.talents || [];
    const count = item.system.talentChoiceCount || 0;
    this.state.ancestryTalents = talents.length <= count ? [...talents] : talents.slice(0, count);
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
      if (t) traits.push({ uuid, name: t.name, desc: await enrich(t.system?.description), selected: chosen.includes(uuid) });
    }
    const lang = item.system.languages || {};
    return {
      traits,
      needsTalentChoice: this._needsTalentChoice(item),
      talentChoiceCount: item.system.talentChoiceCount || 0,
      languages: (lang.fixed?.length || 0) + (lang.common || 0) + (lang.rare || 0) + (lang.select || 0),
    };
  }

  async extraContext(item) {
    if (!item) return { charName: this.state.name || "", trinket: this.state.trinket || "" };
    const { nameTable, trinketTable } = await this._tablesFor(item);
    const mark = (opts, cur) => opts.map((o) => ({ ...o, selected: o.value === cur }));
    return {
      charName: this.state.name || "",
      trinket: this.state.trinket || "",
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
    const { nameTable } = await this._tablesFor(this.selected?.item);
    const v = await rollTableDoc(nameTable);
    if (v) this.state.name = v;
  }

  async rollTrinket() {
    const { trinketTable } = await this._tablesFor(this.selected?.item);
    const v = await rollTableDoc(trinketTable);
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
