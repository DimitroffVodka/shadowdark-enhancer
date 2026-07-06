import { ListStep } from "./list-step.mjs";
import { LanguagesStep } from "./languages-step.mjs";
import { classArt } from "../art.mjs";
import { enrich, resultText, findTableByName } from "../data.mjs";
import { builderDiceAnimation, EXTRA_CLASS_TALENT_ROLL_UUIDS } from "../constants.mjs";

/** Rulebook-style inline description: enrich, then strip the wrapper <p> so
 *  the bold name and text flow on one line (same treatment as ancestry traits). */
async function inlineDesc(html) {
  return (await enrich(html)).replace(/^\s*<p>/i, "").replace(/<\/p>\s*$/i, "").trim();
}

/** Option sources for REPLACEME-effect choices, mirroring the system's
 *  handlePredefinedEffect switch (matched on the EFFECT's name). Effects with
 *  no spec here fall back to the system's dialog at actor creation. */
const CHOICE_SPECS = [
  { names: ["Weapon Mastery", "Increased Weapon Damage Die", "Trusty Gear"], loader: () => shadowdark.compendiums.baseWeapons() },
  { names: ["Armor Mastery"], loader: () => shadowdark.compendiums.baseArmor() },
  { names: ["Spellcasting Advantage on Spell"], loader: () => shadowdark.compendiums.spells() },
];
const _choiceOptionCache = new Map();   // spec → [{ slug, label }]

function choiceSpecFor(effectName) {
  return CHOICE_SPECS.find((s) => s.names.includes(effectName)) ?? null;
}

async function choiceOptions(spec) {
  if (_choiceOptionCache.has(spec)) return _choiceOptionCache.get(spec);
  const map = await shadowdark.utils.getSlugifiedItemList(await spec.loader());
  const opts = Object.entries(map).map(([slug, label]) => ({ slug, label }));
  _choiceOptionCache.set(spec, opts);
  return opts;
}

/** The first REPLACEME effect on a talent doc that has a known option source. */
function choosableEffect(doc) {
  for (const effect of (doc?.effects ?? [])) {
    if (!effect.changes?.some((c) => String(c.key).includes("REPLACEME"))) continue;
    const spec = choiceSpecFor(effect.name);
    return { effect, spec };   // spec null = REPLACEME but unsupported (system dialog)
  }
  return null;
}

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
    this._traitsCache = {};             // class uuid → [{ name, descInline }]
    this._expandedSpells = new Set();   // uuids with the preview open
    this._spellDetail = new Map();      // uuid → { description, tier, range, duration } (enriched once)
    // Language choice lives on this tab (ancestry + class both contribute once
    // a class is picked) — delegate to the retained LanguagesStep, which keeps
    // its combo-keyed cache, need-counts and state._sync logic.
    this.langStep = new LanguagesStep(app);
  }

  get id() { return "class"; }
  get label() { return "SDE.charBuilder.step.class"; }
  get icon() { return "fa-solid fa-hat-wizard"; }
  get partial() { return "sde-cb-class"; }
  get lockedTypes() { return ["Class"]; }
  get stateKey() { return "class"; }

  /** Use a bundled class portrait when one exists, else the system icon. */
  portrait(item) { return classArt(item?.name); }
  /** The art shows only as the header-corner portrait — list rows keep their icons. */
  get showPortraitInList() { return false; }

  async loadItems() {
    return Array.from(await shadowdark.compendiums.classes())
      .filter((c) => !c.name.toLowerCase().includes("level 0"))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async _onSelect() {
    // Class-dependent choices reset when the class changes.
    this.state.classTalents = [];
    this.state.classTalentRoll = null;
    this.state.bonusRolls = [];
    this.state.talentChoices = {};
    this._bonusCache = null;
    this._pendingChoiceKeys = null;
    this.state.spells = [];
    this.state.patron = null;
    // HP was rolled from the old class's hit die; languages may include the
    // old class's fixed/chosen picks — both must be redone for the new class.
    this.state.hp = { max: 0, rolled: null };
    this.state.languages = [];
    this.state.languageChoices = { common: [], rare: [], select: [] };
    // Warm the language cache for the new combo so isComplete() (sync) can
    // read slot counts immediately.
    await this.langStep._data();
  }

  /** Complete once patron / spells-known / bonus-roll / language requirements are met. */
  isComplete() {
    const item = this.selected?.item;
    if (!this.selected?.uuid || !item) return false;
    if (item.system.patron?.required && !this.state.patron?.uuid) return false;
    if (this._isCaster(item)) {
      const known = item.system.spellcasting.spellsknown?.[1] || {};
      const need = Object.values(known).reduce((a, b) => a + (Number(b) || 0), 0);
      if ((this.state.spells?.length || 0) < need) return false;
    }
    // Bonus rolls: sync check against the last computed sources (extraContext
    // recomputes them every render; cold cache counts as complete-so-far).
    if (this._bonusCache?.sources?.length && !this._bonusComplete(this._bonusCache.sources)) return false;
    if (!this._choicesComplete()) return false;
    // A class with a talent table must have rolled its level-1 talent —
    // committing without one produced sheet-incomplete characters (Orgarrin).
    if (this.selected?.item?.system?.classTalentTable && !this.state.classTalentRoll) return false;
    return this._languagesComplete();
  }

  /** Language slots filled — cold or stale (ancestry/class changed) cache counts as incomplete. */
  _languagesComplete() {
    const ls = this.langStep;
    return !!ls._cache && ls._comboKey === ls._combo() && ls.isComplete();
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

  // ---- Extra: info lines + talent + spells + patron -------------------------
  async extraContext(item) {
    if (!item) return {};
    const pending = await this._pendingChoices(item);
    return {
      infoLines: await this._infoLines(item),
      traits: await this._traits(item),
      talent: await this._talentContext(item),
      choices: pending.map((p) => ({
        key: p.key,
        talentName: p.talentName,
        options: p.options.map((o) => ({ ...o, selected: this.state.talentChoices[p.key]?.slug === o.slug })),
        chosen: !!this.state.talentChoices[p.key],
      })),
      bonusRolls: await this._bonusContext(item),
      spells: await this._spellContext(item),
      patron: await this._patronContext(item),
      // Also warms the combo cache _languagesComplete() reads.
      languages: await this.langStep.prepareContext(),
    };
  }

  /** Template context for the extra creation rolls. */
  async _bonusContext(item) {
    const sources = await this._bonusSources(item);
    return sources.map((s) => {
      const e = this._bonusEntry(s.key);
      return {
        key: s.key,
        label: s.label,
        tableName: s.tableName,
        rolled: !!e,
        total: e?.total ?? null,
        needsChoice: (e?.options?.length ?? 0) > 1,
        options: (e?.options || []).map((o) => ({ uuid: o.uuid, name: o.name, selected: o.uuid === e?.chosenUuid })),
        chosenName: e?.chosenName ?? null,
        textResult: e?.textResult ?? null,
      };
    });
  }

  /** The class's level-1 features — fixed talents + class abilities — shown
   *  like the ancestry tab's traits (bold name, inline description). */
  async _traits(item) {
    const key = item.uuid;
    if (this._traitsCache[key]) return this._traitsCache[key];
    const traits = [];
    for (const uuid of [...(item.system.talents || []), ...(item.system.classAbilities || [])]) {
      // eslint-disable-next-line no-await-in-loop
      const doc = await fromUuid(uuid).catch(() => null);
      if (!doc || doc.documentName !== "Item") continue;
      // Talents needing a choice: supported ones (Weapon Mastery…) get an
      // inline picker on this tab; only UNSUPPORTED REPLACEME effects still
      // fall back to the system dialog at actor creation.
      const found = choosableEffect(doc);
      const asksOnCreate = !!found && !found.spec;
      // eslint-disable-next-line no-await-in-loop
      traits.push({ name: doc.name, descInline: await inlineDesc(doc.system?.description), asksOnCreate });
    }
    this._traitsCache[key] = traits;
    return traits;
  }

  /** Rulebook-style stat lines shown under the description (no aside column). */
  async _infoLines(item) {
    const info = await this._classInfo(item);
    const L = (k) => game.i18n.localize(k);
    return [
      { label: L("SDE.charBuilder.class.weaponsPermitted"), value: info.weapons },
      { label: L("SDE.charBuilder.class.armorPermitted"), value: info.armor },
      { label: L("SDE.charBuilder.class.hitDie"), value: item.system.hitPoints || "—" },
      {
        label: L("SDE.charBuilder.class.spellcaster"),
        value: this._isCaster(item)
          ? (item.system.spellcasting.ability || "").toUpperCase()
          : L("SDE.charBuilder.class.no"),
      },
    ];
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
    // Casters with NO spells due at level 1 (Green Knight, Knight of St.
    // Ydris — spells arrive on level-up) get no picker at all.
    const due = Object.values(known).reduce((a, b) => a + (Number(b) || 0), 0);
    if (!due) return { caster: false };
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
          .map((s) => ({
            uuid: s.uuid, name: s.name,
            selected: this.state.spells.some((x) => x.uuid === s.uuid),
            expanded: this._expandedSpells.has(s.uuid),
            detail: this._spellDetail.get(s.uuid) ?? null,
          })),
      });
    }
    return { caster: true, ability: (sc.ability || "").toUpperCase(), tiers };
  }

  async _loadSpells(classUuid) {
    // Alignment-restricted spells (WR priest/wizard lists) carry a
    // shadowdark-extras alignment flag; the pool depends on the PC's alignment,
    // so it's part of the cache key.
    const align = this.state.alignment || "";
    const cacheKey = `${classUuid}|${align}`;
    if (this._spellCache[cacheKey]) return this._spellCache[cacheKey];
    const all = Array.from(await shadowdark.compendiums.spells());
    // The class filter is cheap (system.class is in the compendium index), but
    // the shadowdark-extras alignment flag is NOT indexed — the aggregator
    // returns plain index objects with no `flags`. Resolve the class-matched
    // subset to full documents so the alignment gate can actually read it.
    const candidates = all.filter((s) => {
      const c = s.system.class;
      const arr = Array.isArray(c) ? c : (c ? [c] : []);
      return arr.includes(classUuid);
    });
    const docs = await Promise.all(candidates.map((s) => fromUuid(s.uuid).catch(() => null)));
    const list = docs.filter((d) => {
      if (!d) return false;
      // Only offer an alignment-tagged spell to a matching-alignment character;
      // untagged spells are universal (standard class list).
      const spellAlign = d.flags?.["shadowdark-extras"]?.alignment || "";
      return !spellAlign || spellAlign === align;
    }).sort((a, b) => (a.system.tier - b.system.tier) || a.name.localeCompare(b.name));
    this._spellCache[cacheKey] = list;
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

  /** Roll a table and structurally extract the outcome: linked Item rows in
   *  the rolled range are the options (several = a choice); text rows beside
   *  them are headers; text-only ranges surface as textResult. */
  async _rollOnTable(table) {
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
    const textResult = options.length === 0 ? (texts.join("; ") || null) : null;
    return { roll, total, options, textResult };
  }

  async rollTalent() {
    const item = this.selected?.item;
    const tableUuid = item?.system?.classTalentTable;
    if (!tableUuid) return;
    const table = await fromUuid(tableUuid);
    if (!table?.roll) return;

    const { roll, total, options, textResult } = await this._rollOnTable(table);
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
    // Cache is keyed classUuid|align (see _loadSpells) — match that here or the
    // lookup misses and no spell is ever added.
    const align = this.state.alignment || "";
    const spell = (this._spellCache[`${classUuid}|${align}`] || []).find((s) => s.uuid === uuid);
    if (!spell) return;
    const tier = spell.system.tier;
    const count = item.system.spellcasting.spellsknown?.[1]?.[tier] || 0;
    if (this.state.spells.filter((s) => s.tier === tier).length >= count) return; // tier full
    this.state.spells.push({ uuid, name: spell.name, tier });
  }

  choosePatron(uuid) {
    const p = (this._patrons || []).find((x) => x.uuid === uuid);
    if (p) this.state.patron = { uuid, name: p.name, item: p };
    // Boons come from the patron's own table — a new patron means new rolls.
    this.state.bonusRolls = this.state.bonusRolls.filter((b) => !b.key.startsWith("boon-"));
  }

  // ---- Bonus creation rolls --------------------------------------------------
  // Extra table rolls due at level 1 beyond the standard class-talent roll:
  //  • fixed class talents that point at a RollTable ("Black Lotus",
  //    "Corruption" via the "<Class> <Talent>" naming convention),
  //  • an ancestry talent granting an extra class-talent roll (Human
  //    "Ambitious", keyed by UUID in constants),
  //  • the patron's starting boons.

  /** The bonus-roll sources for the current class/ancestry/patron combo. */
  async _bonusSources(item) {
    const comboKey = [
      item.uuid,
      (this.state.ancestryTalents || []).join(","),
      this.state.patron?.uuid ?? "",
    ].join("|");
    if (this._bonusCache?.key === comboKey) return this._bonusCache.sources;

    const sources = [];

    // Fixed class talents that reference a roll table.
    for (const uuid of (item.system.talents || [])) {
      // eslint-disable-next-line no-await-in-loop
      const doc = await fromUuid(uuid).catch(() => null);
      if (!doc) continue;
      const link = String(doc.system?.description || "")
        .match(/@UUID\[((?:[^\]]*?)RollTable(?:[^\]]*?))\]/)?.[1] ?? null;
      let table = link ? await fromUuid(link).catch(() => null) : null;
      // No link → try the "<Class> <Talent>" / "<Talent>" table-name convention.
      if (!table) table = await findTableByName([`${item.name} ${doc.name}`, `${doc.name} Table`], []);
      if (table?.roll) sources.push({ key: `talent-${doc.uuid}`, label: doc.name, tableUuid: table.uuid, tableName: table.name });
    }

    // Ancestry-granted extra class-talent roll (e.g. Human "Ambitious").
    const extra = (this.state.ancestryTalents || []).find((u) => EXTRA_CLASS_TALENT_ROLL_UUIDS.has(u));
    if (extra && item.system.classTalentTable) {
      const doc = await fromUuid(extra).catch(() => null);
      sources.push({
        key: "extra-talent",
        label: `${game.i18n.localize("SDE.charBuilder.class.talent")}${doc ? ` (${doc.name})` : ""}`,
        tableUuid: item.system.classTalentTable,
        tableName: null,
      });
    }

    // Patron starting boons.
    const boons = item.system.patron?.required ? (item.system.patron.startingBoons || 0) : 0;
    const boonTable = this.state.patron?.item?.system?.boonTable;
    if (boons > 0 && boonTable) {
      for (let i = 0; i < boons; i++) {
        sources.push({
          key: `boon-${i}`,
          label: game.i18n.localize("SDE.charBuilder.class.patronBoon"),
          tableUuid: boonTable,
          tableName: this.state.patron.name,
        });
      }
    }

    this._bonusCache = { key: comboKey, sources };
    // Reconcile stored rolls: drop entries whose source vanished (ancestry/
    // patron changed) so stale results never reach commit.
    const valid = new Set(sources.map((s) => s.key));
    this.state.bonusRolls = this.state.bonusRolls.filter((b) => valid.has(b.key));
    return sources;
  }

  _bonusEntry(key) { return this.state.bonusRolls.find((b) => b.key === key) ?? null; }

  async rollBonus(key) {
    const item = this.selected?.item;
    if (!item) return;
    const src = (await this._bonusSources(item)).find((s) => s.key === key);
    if (!src) return;
    const table = await fromUuid(src.tableUuid).catch(() => null);
    if (!table?.roll) return;
    const { roll, total, options, textResult } = await this._rollOnTable(table);
    const entry = {
      key, label: src.label, tableUuid: src.tableUuid, total, options, textResult,
      chosenUuid: options.length === 1 ? options[0].uuid : null,
      chosenName: options.length === 1 ? options[0].name : null,
    };
    this.state.bonusRolls = [...this.state.bonusRolls.filter((b) => b.key !== key), entry];
    await this._talentCard(roll, options, textResult);
    await this.app.render();
  }

  chooseBonus(key, uuid) {
    const entry = this._bonusEntry(key);
    const opt = entry?.options.find((o) => o.uuid === uuid);
    if (opt) { entry.chosenUuid = opt.uuid; entry.chosenName = opt.name; }
  }

  /** A bonus roll is settled once rolled and, if it offered a choice, chosen. */
  _bonusComplete(sources) {
    return sources.every((s) => {
      const e = this._bonusEntry(s.key);
      return e && (e.chosenUuid || e.textResult || e.options.length === 0);
    });
  }

  // ---- Talent choices (REPLACEME effects) ------------------------------------
  // Talents like Weapon Mastery carry an effect whose change keys contain
  // REPLACEME — the system would prompt a dialog when the actor is created.
  // The builder surfaces those choices inline instead; commit pre-fills the
  // keys the same way the dialog would, so no modal ever appears.

  /** Every talent INSTANCE headed to the actor that needs a supported choice:
   *  fixed class talents, the rolled class talent, and bonus-roll picks. */
  async _pendingChoices(item) {
    const instances = [
      ...(item.system.talents || []).map((u) => ({ key: `fixed:${u}`, uuid: u })),
      ...this.state.classTalents.map((t) => ({ key: `rolled:${t.uuid}`, uuid: t.uuid })),
      ...this.state.bonusRolls.filter((b) => b.chosenUuid).map((b) => ({ key: `bonus:${b.key}`, uuid: b.chosenUuid })),
    ];
    const pending = [];
    for (const inst of instances) {
      // eslint-disable-next-line no-await-in-loop
      const doc = await fromUuid(inst.uuid).catch(() => null);
      const found = doc ? choosableEffect(doc) : null;
      if (!found?.spec) continue;   // no choice, or unsupported → system dialog
      // eslint-disable-next-line no-await-in-loop
      let options = await choiceOptions(found.spec);
      // Weapon picks are limited to what the CLASS can wield (book: "you can
      // wield") — unless it has blanket weapon training like the Fighter.
      const s = item.system;
      if (found.spec.loader === CHOICE_SPECS[0].loader && !s.allWeapons && !s.allMeleeWeapons && !s.allRangedWeapons) {
        const permitted = new Set();
        for (const wu of (s.weapons || [])) {
          // eslint-disable-next-line no-await-in-loop
          const w = await fromUuid(wu).catch(() => null);
          if (w) permitted.add(shadowdark.utils.slugify?.(w.name) ?? w.name.slugify?.() ?? w.name.toLowerCase());
        }
        if (permitted.size) options = options.filter((o) => permitted.has(o.slug));
      }
      pending.push({ key: inst.key, talentName: doc.name, options });
    }
    // Prune picks whose instance vanished (talent rerolled, class changed).
    const valid = new Set(pending.map((p) => p.key));
    for (const k of Object.keys(this.state.talentChoices)) {
      if (!valid.has(k)) delete this.state.talentChoices[k];
    }
    this._pendingChoiceKeys = pending.map((p) => p.key);
    return pending;
  }

  chooseTalentOption(key, slug, label) {
    if (!slug) delete this.state.talentChoices[key];
    else this.state.talentChoices[key] = { slug, label };
  }

  _choicesComplete() {
    return (this._pendingChoiceKeys ?? []).every((k) => this.state.talentChoices[k]);
  }

  // ---- Spell preview ---------------------------------------------------------
  /** Toggle a spell's inline preview; enrich its description once, then cache. */
  async toggleSpellPreview(uuid) {
    if (this._expandedSpells.has(uuid)) { this._expandedSpells.delete(uuid); return; }
    if (!this._spellDetail.has(uuid)) {
      const doc = await fromUuid(uuid).catch(() => null);
      if (doc) {
        const sys = doc.system || {};
        this._spellDetail.set(uuid, {
          description: await enrich(sys.description),
          tier: sys.tier,
          range: game.i18n.localize(CONFIG.SHADOWDARK?.RANGES?.[sys.range] ?? sys.range ?? ""),
          duration: this._durationLabel(sys.duration),
        });
      }
    }
    this._expandedSpells.add(uuid);
  }

  /** "Instant" / "Focus" / "5 Rounds" from a spell's {type, value} duration. */
  _durationLabel(d) {
    if (!d?.type) return "";
    const label = game.i18n.localize(CONFIG.SHADOWDARK?.SPELL_DURATIONS?.[d.type] ?? d.type);
    const n = Number(d.value);
    return (["instant", "focus", "permanent"].includes(d.type) || !n || n < 0) ? label : `${d.value} ${label}`;
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
    // Bonus creation rolls (Ambitious extra talent, Black Lotus, boons…),
    // auto-picking when a roll offers a choice.
    this._bonusCache = null;
    for (const src of await this._bonusSources(item)) {
      await this.rollBonus(src.key);
      const e = this._bonusEntry(src.key);
      if (e && !e.chosenUuid && e.options.length > 1) {
        const pick = e.options[Math.floor(Math.random() * e.options.length)];
        e.chosenUuid = pick.uuid; e.chosenName = pick.name;
      }
    }
    // Auto-pick any REPLACEME talent choices (Weapon Mastery weapon…).
    for (const p of await this._pendingChoices(item)) {
      if (!this.state.talentChoices[p.key] && p.options.length) {
        const o = p.options[Math.floor(Math.random() * p.options.length)];
        this.state.talentChoices[p.key] = { slug: o.slug, label: o.label };
      }
    }
    await this.langStep.randomize();
  }

  _onRenderExtra(root) {
    root.querySelectorAll("[data-cb-talent-choice]").forEach((el) => el.addEventListener("change", async (ev) => {
      const opt = ev.target.selectedOptions[0];
      this.chooseTalentOption(el.dataset.cbTalentChoice, ev.target.value, opt?.textContent ?? "");
      await this.app.render();
    }));
    const langRoot = root.querySelector("[data-cb-class-langs]");
    if (langRoot) this.langStep.onRender(langRoot);
    root.querySelector("[data-cb-roll-talent]")?.addEventListener("click", async () => { await this.rollTalent(); });
    root.querySelectorAll("[data-cb-talent-opt]").forEach((el) => el.addEventListener("click", async () => {
      const opt = (this.state.classTalentRoll?.options || []).find((o) => o.uuid === el.dataset.cbTalentOpt);
      if (opt) { this.state.classTalents = [{ uuid: opt.uuid, name: opt.name }]; await this.app.render(); }
    }));
    root.querySelectorAll("[data-cb-spell]").forEach((el) => el.addEventListener("click", async () => {
      this.toggleSpell(el.dataset.cbSpell); await this.app.render();
    }));
    root.querySelectorAll("[data-cb-spell-expand]").forEach((el) => el.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      await this.toggleSpellPreview(el.dataset.cbSpellExpand);
      await this.app.render();
    }));
    root.querySelectorAll("[data-cb-patron]").forEach((el) => el.addEventListener("click", async () => {
      this.choosePatron(el.dataset.cbPatron); await this.app.render();
    }));
    root.querySelectorAll("[data-cb-roll-bonus]").forEach((el) => el.addEventListener("click", async () => {
      await this.rollBonus(el.dataset.cbRollBonus);
    }));
    root.querySelectorAll("[data-cb-bonus-opt]").forEach((el) => el.addEventListener("click", async () => {
      this.chooseBonus(el.dataset.cbBonusKey, el.dataset.cbBonusOpt);
      await this.app.render();
    }));
  }
}
