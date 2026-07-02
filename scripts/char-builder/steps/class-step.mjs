import { ListStep } from "./list-step.mjs";
import { classArt } from "../art.mjs";
import { resultText } from "../data.mjs";
import { builderDiceAnimation } from "../constants.mjs";

/**
 * Step — Class.
 *
 * List/detail/aside pick, plus the class's level-1 choices in the detail column:
 *   • Talent — ROLLED on the class's 2d6 talent table (per the user's rule);
 *     if the rolled range offers a "Choose 1", the options are shown to pick.
 *     Effect choices (Weapon Mastery weapon, +2 stat) are applied at commit via
 *     the system's `createItemWithEffect`.
 *   • Spells — spellcasting classes choose `spellsknown[1]` spells per tier.
 *   • Patron — patron-required classes (e.g. Warlock) pick a patron.
 */
export class ClassStep extends ListStep {
  constructor(app) {
    super(app);
    this._spellCache = {};
    this._patrons = null;
    this._classInfoCache = {};
  }

  get id() { return "class"; }
  get label() { return "SDE.charBuilder.step.class"; }
  get icon() { return "fa-solid fa-hat-wizard"; }
  get partial() { return "sde-cb-class"; }
  get stateKey() { return "class"; }

  /** Use a bundled class portrait when one exists, else the system icon. */
  portrait(item) { return classArt(item?.name); }

  async loadItems() {
    return Array.from(await shadowdark.compendiums.classes())
      .filter((c) => !c.name.toLowerCase().includes("level 0"))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async _onSelect() {
    // Class-dependent choices reset when the class changes.
    this.state.classTalents = [];
    this.state.classTalentRoll = null;
    this.state.spells = [];
    this.state.patron = null;
    // HP was rolled from the old class's hit die; languages may include the
    // old class's fixed/chosen picks — both must be redone for the new class.
    this.state.hp = { max: 0, rolled: null };
    this.state.languages = [];
    this.state.languageChoices = { common: [], rare: [], select: [] };
  }

  /** A class is only complete once its patron / spells-known requirements are met. */
  isComplete() {
    const item = this.selected?.item;
    if (!this.selected?.uuid || !item) return false;
    if (item.system.patron?.required && !this.state.patron?.uuid) return false;
    if (this._isCaster(item)) {
      const known = item.system.spellcasting.spellsknown?.[1] || {};
      const need = Object.values(known).reduce((a, b) => a + (Number(b) || 0), 0);
      if ((this.state.spells?.length || 0) < need) return false;
    }
    return true;
  }

  _isCaster(item) {
    const sc = item?.system?.spellcasting;
    return !!sc && sc.class !== "__not_spellcaster__" && sc.ability !== "";
  }

  _spellClassUuid(item) {
    const sc = item.system.spellcasting;
    return sc.class && sc.class !== "" ? sc.class : item.uuid;
  }

  /** Resolve (and cache) a class's concrete weapon/armor lists + talent table. */
  async _classInfo(item) {
    const key = item.uuid;
    if (this._classInfoCache[key]) return this._classInfoCache[key];
    const s = item.system;
    const L = (k) => game.i18n.localize(k);

    const names = async (uuids) => {
      const out = [];
      for (const u of (uuids || [])) {
        // eslint-disable-next-line no-await-in-loop
        const d = await fromUuid(u).catch(() => null);
        if (d) out.push(d.name);
      }
      return out;
    };

    let weapons;
    if (s.allWeapons) weapons = L("SDE.charBuilder.class.allWeapons");
    else {
      const parts = [];
      if (s.allMeleeWeapons) parts.push(L("SDE.charBuilder.class.allMelee"));
      if (s.allRangedWeapons) parts.push(L("SDE.charBuilder.class.allRanged"));
      parts.push(...await names(s.weapons));
      weapons = parts.length ? parts.join(", ") : L("SDE.charBuilder.class.noneList");
    }

    let armor;
    if (s.allArmor) armor = L("SDE.charBuilder.class.allArmor");
    else { const a = await names(s.armor); armor = a.length ? a.join(", ") : L("SDE.charBuilder.class.noneList"); }

    const table = await this._buildTalentTable(s.classTalentTable);

    const info = { weapons, armor, table };
    this._classInfoCache[key] = info;
    return info;
  }

  /** Group a class talent table into { range, outcome } rows for display. */
  async _buildTalentTable(tableUuid) {
    if (!tableUuid) return null;
    const t = await fromUuid(tableUuid).catch(() => null);
    if (!t?.results) return null;
    const groups = {};
    for (const r of t.results.contents) {
      const rk = r.range[0] === r.range[1] ? `${r.range[0]}` : `${r.range[0]}–${r.range[1]}`;
      if (!groups[rk]) groups[rk] = { range: rk, min: r.range[0], docs: [], texts: [] };
      if (r.documentUuid) {
        // eslint-disable-next-line no-await-in-loop
        const d = await fromUuid(r.documentUuid).catch(() => null);
        if (d) { groups[rk].docs.push(d.name); continue; }
      }
      const txt = resultText(r);
      if (txt) groups[rk].texts.push(txt);
    }
    const choose = game.i18n.localize("SDE.charBuilder.class.tableChoose");
    return Object.values(groups).sort((a, b) => a.min - b.min).map((g) => {
      // Linked-document rows are the real outcomes; a text row sharing their
      // range is a "choose one of…" header. Several outcomes in one range is
      // structurally a choice — the same signal rollTalent uses to offer picks.
      const outcomes = g.docs.length ? g.docs : g.texts;
      return {
        range: g.range,
        outcome: outcomes.length > 1 ? `${choose} ${outcomes.join(", ")}` : outcomes.join(", "),
      };
    });
  }

  // ---- Aside: class summary ------------------------------------------------
  async asideContext(item) {
    const info = await this._classInfo(item);
    return {
      hitDie: item.system.hitPoints,
      caster: this._isCaster(item),
      spellAbility: this._isCaster(item) ? (item.system.spellcasting.ability || "").toUpperCase() : null,
      weapons: info.weapons,
      armor: info.armor,
    };
  }

  // ---- Extra: titles + talent + spells + patron ----------------------------
  async extraContext(item) {
    if (!item) return {};
    return {
      talent: await this._talentContext(item),
      spells: await this._spellContext(item),
      patron: await this._patronContext(item),
    };
  }

  async _talentContext(item) {
    const roll = this.state.classTalentRoll;
    const chosen = this.state.classTalents[0]?.uuid ?? null;
    return {
      hasTable: !!item.system.classTalentTable,
      table: (await this._classInfo(item)).table,
      rolled: !!roll,
      total: roll?.total ?? null,
      needsChoice: (roll?.options?.length ?? 0) > 1,
      options: (roll?.options || []).map((o) => ({ uuid: o.uuid, name: o.name, selected: o.uuid === chosen })),
      chosenName: this.state.classTalents[0]?.name ?? null,
      textResult: roll?.textResult ?? null,
    };
  }

  async _spellContext(item) {
    if (!this._isCaster(item)) return { caster: false };
    const sc = item.system.spellcasting;
    const known = sc.spellsknown?.[1] || {};
    const classUuid = this._spellClassUuid(item);
    const all = await this._loadSpells(classUuid);
    const tiers = [];
    for (const tier of [1, 2, 3, 4, 5]) {
      const count = known[tier];
      if (!count) continue;
      const chosen = this.state.spells.filter((s) => s.tier === tier).length;
      tiers.push({
        tier, count, chosen, full: chosen >= count,
        options: all.filter((s) => s.system.tier === tier)
          .map((s) => ({ uuid: s.uuid, name: s.name, selected: this.state.spells.some((x) => x.uuid === s.uuid) })),
      });
    }
    return { caster: true, ability: (sc.ability || "").toUpperCase(), tiers };
  }

  async _loadSpells(classUuid) {
    if (this._spellCache[classUuid]) return this._spellCache[classUuid];
    const all = Array.from(await shadowdark.compendiums.spells());
    const list = all.filter((s) => {
      const c = s.system.class;
      const arr = Array.isArray(c) ? c : (c ? [c] : []);
      return arr.includes(classUuid);
    }).sort((a, b) => (a.system.tier - b.system.tier) || a.name.localeCompare(b.name));
    this._spellCache[classUuid] = list;
    return list;
  }

  async _patronContext(item) {
    if (!item.system.patron?.required) return { required: false };
    const patrons = await this._loadPatrons();
    return {
      required: true,
      startingBoons: item.system.patron.startingBoons || 0,
      options: patrons.map((p) => ({ uuid: p.uuid, name: p.name, selected: p.uuid === this.state.patron?.uuid })),
      chosenName: this.state.patron?.name ?? null,
    };
  }

  async _loadPatrons() {
    if (!this._patrons) this._patrons = Array.from(await shadowdark.compendiums.patrons()).sort((a, b) => a.name.localeCompare(b.name));
    return this._patrons;
  }

  // ---- Talent roll ---------------------------------------------------------
  async rollTalent() {
    const item = this.selected?.item;
    const tableUuid = item?.system?.classTalentTable;
    if (!tableUuid) return;
    const table = await fromUuid(tableUuid);
    if (!table?.roll) return;

    const res = await table.roll();
    const roll = res.roll;
    const total = roll.total;
    const options = [];
    const texts = [];
    for (const r of table.results.contents) {
      if (total < r.range[0] || total > r.range[1]) continue;
      const uuid = r.documentUuid ?? null;
      if (uuid) {
        // eslint-disable-next-line no-await-in-loop
        const doc = await fromUuid(uuid).catch(() => null);
        // Only linked Talent Items are embeddable (skip nested "Distribute to
        // Stats" RollTables etc.).
        if (doc && doc.documentName === "Item") options.push({ uuid, name: doc.name });
      } else {
        const txt = resultText(r);
        if (txt) texts.push(txt);
      }
    }
    // Some classes (often homebrew) use text-only talent tables with no linked
    // items — surface the rolled text so the player can apply it manually.
    // When linked items exist, text rows in the range are "choose one of…"
    // headers and the options themselves carry the outcome.
    const textResult = options.length === 0 ? (texts.join("; ") || null) : null;
    this.state.classTalentRoll = { total, options, textResult };
    this.state.classTalents = options.length === 1 ? [{ uuid: options[0].uuid, name: options[0].name }] : [];
    await this._talentCard(roll, options, textResult);
    await this.app.render();
  }

  async _talentCard(roll, options, textResult) {
    const names = options.map((o) => o.name).join(" / ") || textResult || game.i18n.localize("SDE.charBuilder.class.noTalent");
    const content = `<div class="sde-cb-rollcard"><h4>${game.i18n.localize("SDE.charBuilder.class.talentCard")}</h4>`
      + `<div class="method">${this.selected?.name} — 2d6 = ${roll.total}: <b>${names}</b></div></div>`;
    const animate = builderDiceAnimation();
    try {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker(),
        flavor: game.i18n.localize("SDE.charBuilder.title"),
        content,
        rolls: animate ? [roll] : [],
        sound: animate ? CONFIG.sounds.dice : undefined,
      });
    } catch (e) {
      console.error("shadowdark-enhancer | char-builder talent card failed:", e);
    }
  }

  toggleSpell(uuid) {
    const item = this.selected?.item;
    if (!item) return;
    const existing = this.state.spells.find((s) => s.uuid === uuid);
    if (existing) { this.state.spells = this.state.spells.filter((s) => s.uuid !== uuid); return; }
    const classUuid = this._spellClassUuid(item);
    const spell = (this._spellCache[classUuid] || []).find((s) => s.uuid === uuid);
    if (!spell) return;
    const tier = spell.system.tier;
    const count = item.system.spellcasting.spellsknown?.[1]?.[tier] || 0;
    if (this.state.spells.filter((s) => s.tier === tier).length >= count) return; // tier full
    this.state.spells.push({ uuid, name: spell.name, tier });
  }

  choosePatron(uuid) {
    const p = (this._patrons || []).find((x) => x.uuid === uuid);
    if (p) this.state.patron = { uuid, name: p.name, item: p };
  }

  // ---- Random --------------------------------------------------------------
  async randomize() {
    await super.randomize();
    const item = this.selected?.item;
    if (!item) return;
    if (item.system.classTalentTable) await this.rollTalent();
    if (this._isCaster(item)) {
      const known = item.system.spellcasting.spellsknown?.[1] || {};
      const all = await this._loadSpells(this._spellClassUuid(item));
      this.state.spells = [];
      for (const tier of [1, 2, 3, 4, 5]) {
        const count = known[tier];
        if (!count) continue;
        const pool = all.filter((s) => s.system.tier === tier).sort(() => Math.random() - 0.5).slice(0, count);
        pool.forEach((s) => this.state.spells.push({ uuid: s.uuid, name: s.name, tier }));
      }
    }
    if (item.system.patron?.required) {
      const patrons = await this._loadPatrons();
      const p = patrons[Math.floor(Math.random() * patrons.length)];
      if (p) this.state.patron = { uuid: p.uuid, name: p.name, item: p };
    }
  }

  _onRenderExtra(root) {
    root.querySelector("[data-cb-roll-talent]")?.addEventListener("click", async () => { await this.rollTalent(); });
    root.querySelectorAll("[data-cb-talent-opt]").forEach((el) => el.addEventListener("click", async () => {
      const opt = (this.state.classTalentRoll?.options || []).find((o) => o.uuid === el.dataset.cbTalentOpt);
      if (opt) { this.state.classTalents = [{ uuid: opt.uuid, name: opt.name }]; await this.app.render(); }
    }));
    root.querySelectorAll("[data-cb-spell]").forEach((el) => el.addEventListener("click", async () => {
      this.toggleSpell(el.dataset.cbSpell); await this.app.render();
    }));
    root.querySelectorAll("[data-cb-patron]").forEach((el) => el.addEventListener("click", async () => {
      this.choosePatron(el.dataset.cbPatron); await this.app.render();
    }));
  }
}
