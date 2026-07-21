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

// Generic label for a Core-mode descriptive rider role (never book prose).
const DESCRIPTOR_LABELS = {
  feature: "Feature", benefit: "Benefit", curse: "Curse",
  virtue: "Virtue", flaw: "Flaw", trait: "Personality", type: "Type",
};

/** A visible marker that a descriptive rider is NOT mechanized by the system. */
const NON_AUTO_MARKER = `<em class="sde-forge-nonauto">(descriptive — apply at the table)</em>`;

// Legacy count/bonus curves. No longer on the create path (the rebuild does not
// auto-roll flavor), but retained as exports because the unit tests pin them and
// removing them would be a silent breaking change.
export function benefitCountFromRoll(d6) { return d6 <= 1 ? 0 : d6 >= 6 ? 2 : 1; }
export function curseFromRoll(d6) { return d6 <= 2; }
export function bonusFromRoll(d12) { return d12 <= 2 ? 0 : d12 <= 9 ? 1 : d12 <= 11 ? 2 : 3; }
export function personalityFromRoll(d6) { return d6 === 1; }

/**
 * Strict, generic numeric bonus parser (Core-mode). Accepts ONLY a WHOLE-result
 * numeric `+N` in the allowed 0..3 range, optionally trailed by a single generic
 * "bonus" label — e.g. "+2", "2", "+3", "+2 bonus". Everything else yields null:
 * ranges ("1-3"), currency/commas ("3,000 gp"), dice ("2d6"), decimals ("1.5"),
 * multi-digit ("12"), out-of-range ("4"/"+4"), signs other than `+` ("-1"), and
 * any arbitrary trailing prose ("+2 to attacks"). The forge never maps
 * descriptive text to a mechanic.
 * @param {string} text
 * @returns {number|null} 0..3, or null when not an unambiguous whole numeric bonus
 */
export function parseBonusValue(text) {
  const s = String(text ?? "").trim();
  const m = s.match(/^\+?([0-3])(?:\s+bonus)?$/i);
  return m ? Number(m[1]) : null;
}

/**
 * Resolve a SELECTED Core Bonus result's numeric value or FAIL CLOSED. A bonus
 * result the GM explicitly picked must be a usable whole `+N`; if it isn't, this
 * throws so the forge blocks before Item.create with a clear message — it never
 * silently degrades to +0 or drops the selection. (Pure — the app catches it.)
 * @param {string} text
 * @returns {number} 0..3
 */
export function resolveSelectedBonus(text) {
  const n = parseBonusValue(text);
  if (n == null) {
    throw new Error("The selected Bonus result is not a usable +N value (expected +0 to +3). Clear it or pick a numeric bonus result.");
  }
  return n;
}

/**
 * Strip any leading `+N ` bonus prefixes a base name already carries (pure).
 * Forging FROM a forged item is a supported path (`assembleItemData` strips the
 * old bonus effects for exactly that case), so the name must be re-derived from
 * the plain base rather than stacked: `+2 Longsword` re-forged at +3 is
 * `+3 Longsword`, not `+3 +2 Longsword`. Repeats to also heal names already
 * doubled by the pre-fix behaviour. Leading-anchored only — a `+1` elsewhere in
 * a name is part of that name and is left alone.
 * @param {string} name
 * @returns {string}
 */
function stripBonusPrefix(name) {
  let s = String(name ?? "").trim();
  let prev;
  do { prev = s; s = s.replace(/^\+\d+\s+/, "").trim(); } while (s !== prev);
  return s;
}

/** `+N Base` / `Base` / type-label fallback (pure). */
export function composeName({ type, baseItem, bonus }) {
  const base = stripBonusPrefix(baseItem) || TYPE_LABELS[type] || "Magic Item";
  return bonus > 0 ? `+${bonus} ${base}` : base;
}

/**
 * Resolve the forge type a seed should open at (pure). A stable `forgeType`
 * hint (threaded from a loot placeholder's classification) wins over the
 * loosely-inferred `type`; a potion/utility hint maps to the nearest working
 * type (wand). Returns null when neither yields a usable type (leave as-is).
 * @param {{forgeType?:string, type?:string}} [seed]
 * @returns {string|null}
 */
export function resolveForgeType(seed) {
  const known = (v) => WORKING_TYPES.includes(v) || v === "potion" || v === "utility";
  const preferred = known(seed?.forgeType) ? seed.forgeType : seed?.type;
  if (WORKING_TYPES.includes(preferred)) return preferred;
  if (preferred === "potion" || preferred === "utility") return "wand";
  return null;
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

  // Cloning a base that was ITSELF forged (or any doc carrying SDE forge bonus
  // effects) must not stack a second pair — strip our prior bonus effects and
  // prior forge id before re-applying. Base damage/AC/properties are preserved.
  if (Array.isArray(data.effects)) {
    data.effects = data.effects.filter((e) => !e?.flags?.[MODULE_ID]?.forgeBonus);
  }

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
  // ── Core-mode descriptive riders (Feature/Benefit/Curse/Virtue/Flaw/Trait) ──
  // Each is escaped and carries a visible non-automated marker; "type" rows are
  // a base-selector HINT only and are never written into the item description.
  for (const d of draft.descriptors ?? []) {
    const text = String(d?.text ?? "").trim();
    if (!text || d?.role === "type") continue;
    const label = DESCRIPTOR_LABELS[d.role] ?? (d.role ? d.role[0].toUpperCase() + d.role.slice(1) : "Detail");
    parts.push(`<p><strong>${esc(label)}:</strong> ${esc(text)} ${NON_AUTO_MARKER}</p>`);
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
    // A +0 item that still carries Core magic (a descriptive rider or refs-only
    // provenance) is a magic item too — flag it. Only a real +N ever applies the
    // mechanic (weapon effects / armor modifier).
    const hasMagicFlavor = !!(
      draft.feature || draft.curse || (draft.benefits?.length) ||
      draft.personality?.present || (draft.descriptors?.length) || draft.forge
    );
    if (bonus > 0 || hasMagicFlavor) data.system.magicItem = true;
    if (bonus > 0) applyBonus(data, draft.type, bonus);
  }

  // ── Forge flags ──
  // Keep the existing forged/bonus contract (loot delivery/generator read it),
  // and add the Core-mode provenance v2 flag when supplied. `draft.forge` is a
  // refs-only object built by buildForgeProvenance (magic-table-runtime) — it
  // never carries result text/name/summaries.
  const sdeFlags = { ...(data.flags?.[MODULE_ID] ?? {}), forged: true, bonus };
  // Always drop any INHERITED provenance from a carried-through base — a manual
  // re-forge must not retain stale Core refs — then stamp fresh provenance only
  // when this forge supplied it.
  delete sdeFlags.forge;
  if (draft.forge) sdeFlags.forge = draft.forge;
  data.flags = { ...(data.flags ?? {}), [MODULE_ID]: sdeFlags };

  return data;
}
