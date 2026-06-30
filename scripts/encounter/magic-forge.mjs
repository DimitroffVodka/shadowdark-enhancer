/**
 * Shadowdark Enhancer — Magic Item Forge core (working-items engine).
 *
 * Builds Foundry Item creation data for items that actually FUNCTION in the
 * Shadowdark system:
 *   - Weapon / Armor with a working +N bonus
 *   - Scroll / Wand that reference a real Spell so the system's own casting
 *     pipeline (DC = spell tier + 10, scroll expend, wand fail/break) runs.
 *
 * The +N weapon mechanic uses the CURRENT SD 4.x effect keys
 * `system.roll.attack.bonus.this` / `system.roll.attack.damage.this` (mode ADD).
 * The legacy `system.bonuses.*` keys are now rejected by ActiveEffectSD.applyRules
 * on SD 4.0.6, so forged weapons that used them silently did nothing — this is
 * the bug this rebuild fixes. Armor uses the direct `system.ac.modifier` slot.
 *
 * Pure module: no Foundry globals are touched at module scope or inside
 * `assembleItemData`, so the engine stays unit-testable under `node --test`.
 * Ships no table contents.
 */
import { MODULE_ID } from "../module-id.mjs";
import { esc } from "../util/esc.mjs";

export const TYPE_LABELS = { weapon: "Weapon", armor: "Armor", scroll: "Scroll", wand: "Wand", potion: "Potion", utility: "Utility" };
export const TYPE_IDS = Object.keys(TYPE_LABELS);

/** Forge types that produce a fully working item in this rebuild. */
export const WORKING_TYPES = ["weapon", "armor", "scroll", "wand"];

/** Logical forge type → Shadowdark Item type. Unhandled types fall back to "Basic". */
const SD_TYPE = { weapon: "Weapon", armor: "Armor", scroll: "Scroll", wand: "Wand" };

// CONST.ACTIVE_EFFECT_MODES.ADD — kept as a literal so this module stays pure
// (no Foundry globals) and the AE shape is assertable under node --test.
const AE_MODE_ADD = 2;

// Legacy count/bonus curves. No longer on the create path (the rebuild does not
// auto-roll flavor), but retained as exports because the unit tests pin them and
// removing them would be a silent breaking change.
export function benefitCountFromRoll(d6) { return d6 <= 1 ? 0 : d6 >= 6 ? 2 : 1; }
export function curseFromRoll(d6) { return d6 <= 2; }
export function bonusFromRoll(d12) { return d12 <= 2 ? 0 : d12 <= 9 ? 1 : d12 <= 11 ? 2 : 3; }
export function personalityFromRoll(d6) { return d6 === 1; }

/** `+N Base` / `Base` / type-label fallback (pure). */
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

/**
 * Apply the +N bonus mechanic to itemData in-place (pure).
 *
 * Weapon → two transferring Active Effects on the item using the current SD keys
 *          `system.roll.attack.bonus.this` and `system.roll.attack.damage.this`
 *          (mode ADD). This mirrors the system's own `weaponAttackBonus` /
 *          `weaponDamageBonus` predefined effects.
 * Armor  → `system.ac.modifier = N` (the dedicated magic-bonus slot; no AE).
 */
function applyBonus(itemData, type, bonus) {
  if (!bonus || bonus <= 0) return;

  if (type === "weapon") {
    itemData.effects = itemData.effects ?? [];
    itemData.effects.push(
      {
        name: `Magic Weapon Attack Bonus (+${bonus})`,
        img: "icons/skills/melee/strike-polearm-glowing-white.webp",
        disabled: false,
        transfer: true,
        changes: [{ key: "system.roll.attack.bonus.this", value: bonus, mode: AE_MODE_ADD }],
        flags: { [MODULE_ID]: { forgeBonus: true } },
      },
      {
        name: `Magic Weapon Damage Bonus (+${bonus})`,
        img: "icons/weapons/ammunition/arrow-head-war-flight.webp",
        disabled: false,
        transfer: true,
        changes: [{ key: "system.roll.attack.damage.this", value: bonus, mode: AE_MODE_ADD }],
        flags: { [MODULE_ID]: { forgeBonus: true } },
      },
    );
  } else if (type === "armor") {
    itemData.system.ac = { attribute: "", base: 0, ...(itemData.system.ac ?? {}), modifier: bonus };
  }
}

/**
 * Draft → Foundry Item creation data (pure).
 *
 * Draft fields:
 *   type          "weapon" | "armor" | "scroll" | "wand" (others → "Basic")
 *   name          final item name (falls back to composeName)
 *   baseItem      base label, for composeName when no name given
 *   baseItemData  optional Item.toObject() of a base Weapon/Armor to carry
 *                 through (damage die, AC, properties, slots…)
 *   bonus         0–3 (weapon/armor +N)
 *   spellUuids    array of Spell uuids (scroll uses [0]; wand uses all)
 *   identified    default true (forged items work immediately)
 *   feature/benefits/curse/personality  optional flavor → description
 */
export function assembleItemData(draft) {
  const sdType = SD_TYPE[draft.type] ?? "Basic";

  // Carry through a chosen base item's data; otherwise a minimal shell.
  const data = draft.baseItemData
    ? structuredClone(draft.baseItemData)
    : { type: sdType, system: {} };
  delete data._id;
  delete data.ownership;
  data.type = sdType;
  data.system = data.system ?? {};
  data.name = draft.name || composeName(draft);

  // ── Optional forged flavor text (appended to any carried-through description) ──
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
  const flavor = parts.join("\n");
  const baseDesc = data.system.description ?? "";
  data.system.description = flavor ? [baseDesc, flavor].filter(Boolean).join("\n") : baseDesc;

  // ── Identification: identified by default so bonuses/effects apply at once
  //    (the SD AE model suppresses effects on unidentified items). ──
  data.system.identification = {
    description: data.system.identification?.description ?? "",
    name: data.system.identification?.name ?? "",
    identified: draft.identified !== false,
  };

  // ── Type-specific working mechanics ──
  const bonus = Number(draft.bonus) || 0;
  if (draft.type === "scroll") {
    data.system.spellUuid = (draft.spellUuids ?? []).filter(Boolean)[0] ?? null;
    data.system.magicItem = true;
  } else if (draft.type === "wand") {
    data.system.spells = (draft.spellUuids ?? []).filter(Boolean).map(uuid => ({ uuid, lost: false }));
    data.system.magicItem = true;
  } else if (draft.type === "weapon" || draft.type === "armor") {
    data.system.treasure = true;
    if (bonus > 0) {
      data.system.magicItem = true;
      applyBonus(data, draft.type, bonus);
    }
  }

  // ── Forge flags (contract: loot delivery/generator read forged + bonus) ──
  data.flags = {
    ...(data.flags ?? {}),
    [MODULE_ID]: { ...(data.flags?.[MODULE_ID] ?? {}), forged: true, bonus },
  };

  return data;
}
