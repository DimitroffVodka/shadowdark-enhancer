/**
 * Shadowdark Enhancer — Magic Item Forge core.
 * Assembles a magic item from the GM's loaded attribute tables (Type/Base/
 * Feature/Benefit/Curse/Personality). Descriptive text is drawn from those
 * tables at runtime; the count/bonus curves below are our own (GM-overridable
 * in the panel). Ships no table contents.
 */
import { MODULE_ID } from "../module-id.mjs";
import { esc } from "../util/esc.mjs";

export const TYPE_LABELS = { armor: "Armor", weapon: "Weapon", potion: "Potion", scroll: "Scroll", wand: "Wand", utility: "Utility" };
export const TYPE_IDS = Object.keys(TYPE_LABELS);

// logical attribute -> the GM table's distinctive name fragment, per type.
export const TYPE_TABLES = {
  weapon:  { base: "Magic Weapon: Weapon Type", feature: "Magic Weapon: Weapon Feature", benefit: "Magic Weapon: Weapon Benefit", curse: "Magic Weapon: Weapon Curse", hasBonus: true },
  armor:   { base: "Magic Armor: Armor Type",  feature: "Magic Armor: Armor Feature",   benefit: "Magic Armor: Armor Benefit",  curse: "Magic Armor: Armor Curse",  hasBonus: true },
  potion:  { base: null, feature: "Magic Potion: Potion Features", benefit: "Magic Potion: Potion Benefit", curse: "Magic Potion: Potion Curse", hasBonus: false },
  utility: { base: "Magic Utility: Utility Type", feature: "Magic Utility: Utility Feature", benefit: "Magic Utility: Utility Benefit", curse: "Magic Utility: Utility Curse", hasBonus: false },
  scroll:  { base: null, feature: "Magic Scrolls and Wands: Scroll Feature", benefit: "Magic Scrolls and Wands: Curses/Benefits", curse: "Magic Scrolls and Wands: Curses/Benefits", hasBonus: false },
  wand:    { base: null, feature: "Magic Scrolls and Wands: Wand Feature",   benefit: "Magic Scrolls and Wands: Curses/Benefits", curse: "Magic Scrolls and Wands: Curses/Benefits", hasBonus: false },
};
export const PERSONALITY_TABLES = { virtue: "Magic Item Personality: Item Virtue", flaw: "Magic Item Personality: Item Flaw", trait: "Magic Item Personality: Personality Trait" };

// Our own count/bonus curves (pure; GM-overridable in the panel).
export function benefitCountFromRoll(d6) { return d6 <= 1 ? 0 : d6 >= 6 ? 2 : 1; }
export function curseFromRoll(d6) { return d6 <= 2; }
export function bonusFromRoll(d12) { return d12 <= 2 ? 0 : d12 <= 9 ? 1 : d12 <= 11 ? 2 : 3; }
export function personalityFromRoll(d6) { return d6 === 1; }

/** `+N Base` / `Base` / type label fallback (pure). */
export function composeName({ type, baseItem, bonus }) {
  const base = (baseItem && baseItem.trim()) || TYPE_LABELS[type] || "Magic Item";
  return bonus > 0 ? `+${bonus} ${base}` : base;
}

/** Infer a forge seed {type, bonus} from a placeholder item name (pure). */
export function inferSeedFromName(name) {
  const s = String(name || "").toLowerCase();
  const m = s.match(/\+(\d)/);
  const bonus = m ? Number(m[1]) : 0;
  let type = "utility";
  if (/armor|mail|plate|shield|chainmail|leather/.test(s)) type = "armor";
  else if (/weapon|sword|axe|mace|bow|dagger|spear|blade|hammer|flail/.test(s)) type = "weapon";
  else if (/scroll/.test(s)) type = "scroll";
  else if (/wand/.test(s)) type = "wand";
  else if (/potion/.test(s)) type = "potion";
  return { type, bonus };
}

/** Draft -> Foundry Item creation data (pure; +N mechanic applied by the app). */
export function assembleItemData(draft) {
  const sdType = ({ weapon: "Weapon", armor: "Armor" })[draft.type] ?? "Basic";
  const parts = [];
  if (draft.feature) parts.push(`<p><strong>Feature:</strong> ${esc(draft.feature)}</p>`);
  for (const b of draft.benefits ?? []) if (b) parts.push(`<p><strong>Benefit:</strong> ${esc(b)}</p>`);
  if (draft.curse) parts.push(`<p><strong>Curse:</strong> ${esc(draft.curse)}</p>`);
  const p = draft.personality;
  if (p?.present) {
    if (p.virtue) parts.push(`<p><strong>Virtue:</strong> ${esc(p.virtue)}</p>`);
    if (p.flaw) parts.push(`<p><strong>Flaw:</strong> ${esc(p.flaw)}</p>`);
    if (p.trait) parts.push(`<p><strong>Personality:</strong> ${esc(p.trait)}</p>`);
  }
  return {
    name: draft.name,
    type: sdType,
    system: { description: parts.join("\n"), treasure: true },
    flags: { [MODULE_ID]: { forged: true, bonus: draft.bonus ?? 0 } },
  };
}

// ── Foundry-bound (live-verified) ──

function _table(name) {
  const overrides = game.settings.get(MODULE_ID, "forgeTableOverrides") ?? {};
  if (overrides[name]) { const t = fromUuidSync(overrides[name]); if (t?.documentName === "RollTable") return t; }
  const lc = name.toLowerCase();
  return game.tables.contents.find(t => t.name.toLowerCase().includes(lc)) ?? null;
}
async function _drawText(table) {
  if (!table) return "";
  const draw = await table.draw({ displayChat: false }).catch(() => null);
  // v13 split TableResult#text → name + description; the legacy getter returns
  // the empty description. Read name first (where TEXT-row content lives).
  const r = draw?.results?.[0];
  return (r?.name || r?.description || "").trim();
}
const d = async (sides) => (await new Roll(`1d${sides}`).evaluate()).total;

export const MagicForge = {
  TYPE_TABLES, PERSONALITY_TABLES,
  _table, _drawText,

  async rollDraft({ type, bonus: seedBonus } = {}) {
    type = TYPE_IDS.includes(type) ? type : TYPE_IDS[(await d(6)) - 1];
    const tt = TYPE_TABLES[type];
    const baseItem = tt.base ? await _drawText(_table(tt.base)) : "";
    const feature = await _drawText(_table(tt.feature));
    const bonus = tt.hasBonus ? (typeof seedBonus === "number" ? seedBonus : bonusFromRoll(await d(12))) : 0;
    const benefitN = benefitCountFromRoll(await d(6));
    const benefits = [];
    for (let i = 0; i < benefitN; i++) benefits.push(await _drawText(_table(tt.benefit)));
    const curse = curseFromRoll(await d(6)) ? await _drawText(_table(tt.curse)) : null;
    const present = personalityFromRoll(await d(6));
    const personality = present
      ? { present: true, virtue: await _drawText(_table(PERSONALITY_TABLES.virtue)), flaw: await _drawText(_table(PERSONALITY_TABLES.flaw)), trait: await _drawText(_table(PERSONALITY_TABLES.trait)) }
      : { present: false, virtue: "", flaw: "", trait: "" };
    const draft = { type, baseItem, feature, bonus, benefits, curse, personality };
    draft.name = composeName(draft);
    return draft;
  },

  async rerollPart(draft, partKey) {
    const autoName = composeName(draft);
    const tt = TYPE_TABLES[draft.type];
    if (partKey === "type") return this.rollDraft({ type: draft.type });
    else if (partKey === "base") draft.baseItem = tt.base ? await _drawText(_table(tt.base)) : "";
    else if (partKey === "feature") draft.feature = await _drawText(_table(tt.feature));
    else if (partKey === "bonus") draft.bonus = tt.hasBonus ? bonusFromRoll(await d(12)) : 0;
    else if (partKey === "curse") draft.curse = await _drawText(_table(tt.curse));
    else if (partKey === "virtue") draft.personality.virtue = await _drawText(_table(PERSONALITY_TABLES.virtue));
    else if (partKey === "flaw") draft.personality.flaw = await _drawText(_table(PERSONALITY_TABLES.flaw));
    else if (partKey === "trait") draft.personality.trait = await _drawText(_table(PERSONALITY_TABLES.trait));
    else if (partKey.startsWith("benefit:")) {
      const i = Number(partKey.split(":")[1]);
      if (draft.benefits[i] !== undefined) draft.benefits[i] = await _drawText(_table(tt.benefit));
    }
    if (draft.name === autoName) draft.name = composeName(draft);
    return draft;
  },
};
