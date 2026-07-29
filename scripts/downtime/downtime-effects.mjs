/**
 * Downtime effects — the appliers behind a successful downtime check.
 *
 * Two exports form the frozen contract with the downtime session layer:
 *   effectPlanFor(slotKey, actor)          → what (if anything) must be chosen
 *   applyDowntimeEffect({actor, slotKey, choice}) → validate + write + summarize
 *
 * EXECUTION CONTEXT: **GM-side only.** Every path here writes actor documents,
 * embedded items and Active Effects, which a player client cannot do for a
 * document it does not own. Nothing is gated inside this module on purpose —
 * the session layer owns the activeGM / relay decision, exactly as
 * merchant-shop.mjs owns it for shop transactions. Calling these on a player
 * client will simply fail the underlying Foundry permission check.
 *
 * The pure decision half (slot → kind, the per-weapon limit counters, the
 * extortion math, the XP threshold) lives in downtime-effects-core.mjs so it
 * runs under `node --test` with plain object stubs.
 *
 * Ships no rules text: outcome sentences still come from the GM's own paste.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { assembleItemData } from "../magic-forge/magic-forge.mjs";
import { Renown } from "../renown/renown.mjs";
import {
  ARCANE_POTION_NAMES,
  EXTORTION_PCT,
  HEALING_POTION_NAME,
  MAX_CRAFT_TIER,
  SLOT_EFFECTS,
  applyExtortion,
  canGrantTraining,
  canStepDie,
  consumeExtortion,
  extortionFlagValue,
  hasExtortion,
  isCraftableTier,
  planKindFor,
  shouldPromptLevelUp,
  slotEffectSpec,
  stepDamageDie,
  trainingGrantKey,
  trainingModeFlags,
  trainingState,
  withDieStep,
  withTrainingGrant,
} from "./downtime-effects-core.mjs";

export {
  ARCANE_POTION_NAMES,
  EXTORTION_PCT,
  HEALING_POTION_NAME,
  applyExtortion,
  consumeExtortion,
  extortionFlagValue,
  hasExtortion,
  planKindFor,
};

/** v14 string change type. Numeric `mode` is deprecated since v14, gone in v16. */
const AE_CHANGE_ADD = "add";

/** Per-weapon training bookkeeping lives on the ITEM, not the actor. */
const TRAINING_FLAG = "downtimeTraining";
/** The one-shot merchant swing lives on the ACTOR. */
const EXTORTION_FLAG = "downtimeExtortion";
/** Reminder Active Effects created on the actor by the two ADV slots. */
const BUFF_FLAG = "downtimeBuff";
/** Effects the module is willing to call a curse (Shadowdark models none). */
const CURSE_FLAG = "curse";

const ICON_ATTACK = "icons/skills/melee/strike-polearm-glowing-white.webp";
const ICON_DAMAGE = "icons/weapons/ammunition/arrow-head-war-flight.webp";
const ICON_TRAINING = "icons/skills/melee/weapons-crossed-swords-white-blue.webp";
const ICON_BUFF = "icons/magic/light/explosion-star-glow-blue.webp";
const ICON_POTION = "icons/consumables/potions/bottle-round-corked-red.webp";

/** Only this many compendium spells are offered for a trade, alphabetically. */
const MAX_SPELL_OPTIONS = 250;
/** Only this many gear rows are offered for a "new weapon/armor" training. */
const MAX_GEAR_OPTIONS = 300;

const ok = (summary) => ({ ok: true, summary });
const fail = (error) => ({ ok: false, summary: "", error });

/* ────────────────────────────────────────────────────────────────────────── */
/* Small Foundry readers                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The COMPENDIUM source of an embedded item, so a fabricated scroll/wand
 * points at the real spell rather than the actor-local copy (which would
 * dangle the moment the character is deleted).
 */
function sourceUuidOf(item) {
  return item?._stats?.compendiumSource
    ?? item?.getFlag?.("core", "sourceId")
    ?? item?.uuid
    ?? null;
}

function ownedWeapons(actor) {
  return (actor?.items ?? []).filter((i) => i.type === "Weapon");
}

/** Spell items embedded on the character — Shadowdark's "spells known". */
function knownSpells(actor) {
  return (actor?.items ?? []).filter((i) => i.type === "Spell");
}

/** The actor's class UUID (`system.class` is a DocumentUUIDField). */
function actorClassUuid(actor) {
  const uuid = actor?.system?.class;
  return typeof uuid === "string" && uuid ? uuid : null;
}

/** Effects this module is willing to treat as a removable curse. */
function curseEffects(actor) {
  return (actor?.effects ?? []).filter((e) => !!e.getFlag?.(MODULE_ID, CURSE_FLAG));
}

function trainingFlagOf(item) {
  return trainingState(item?.getFlag?.(MODULE_ID, TRAINING_FLAG));
}

/** Wands already holding this spell block a second one until they break. */
function wandsHolding(actor, spellUuid) {
  return (actor?.items ?? []).filter((i) =>
    i.type === "Wand"
    && !i.system?.broken
    && (i.system?.spells ?? []).some((s) => s?.uuid === spellUuid),
  );
}

/** The damage dice printed on a weapon index row / item, in schema order. */
function diceOf(system) {
  return [system?.damage?.oneHanded, system?.damage?.twoHanded].filter(Boolean);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Compendium option builders                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Spells of one tier the actor could legally learn: class-linked (via the
 * spell's own `system.class` UUID array), not already known by name.
 * Index-only — no documents are loaded to build the list.
 */
async function spellCandidates({ tier, classUuid, excludeNames }) {
  const seen = new Map();
  const packs = (game.packs ?? []).filter((p) => p.documentName === "Item");
  for (const pack of packs) {
    let index;
    try {
      index = await pack.getIndex({ fields: ["system.tier", "system.class"] });
    } catch (err) {
      console.warn(`${MODULE_ID} | downtime: could not index ${pack.collection}`, err);
      continue;
    }
    const fromSystemPack = pack.collection.startsWith("shadowdark.");
    for (const entry of index) {
      if (entry.type !== "Spell") continue;
      if (Number(entry.system?.tier) !== Number(tier)) continue;
      const key = String(entry.name ?? "").toLowerCase();
      if (!key || excludeNames.has(key)) continue;
      // Class linkage: the spell must list the character's class. A spell with
      // no class links at all is never offered — that is an import gap, not a
      // universal spell.
      if (!classUuid || !(entry.system?.class ?? []).includes(classUuid)) continue;
      // Prefer the system's own packs when the same spell name exists twice.
      if (seen.has(key) && !fromSystemPack) continue;
      const uuid = entry.uuid ?? `Compendium.${pack.collection}.Item.${entry._id}`;
      seen.set(key, { id: uuid, label: entry.name, tier: Number(entry.system?.tier) });
    }
  }
  return [...seen.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, MAX_SPELL_OPTIONS);
}

/**
 * Weapons (and optionally armor) from the system gear pack, for the
 * "train with a new weapon/armor" slots. Bounded and index-only; the applier
 * also accepts a typed name, so a missing pack is never a dead end.
 */
async function gearCandidates({ includeArmor = false, dieCap = null } = {}) {
  const pack = game.packs?.get("shadowdark.gear");
  if (!pack) return [];
  let index;
  try {
    index = await pack.getIndex({
      fields: ["system.damage.oneHanded", "system.damage.twoHanded"],
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | downtime: could not index shadowdark.gear`, err);
    return [];
  }
  const capIdx = dieCap ? ["d4", "d6", "d8", "d10", "d12"].indexOf(dieCap) : -1;
  const out = [];
  for (const entry of index) {
    const isWeapon = entry.type === "Weapon";
    const isArmor = entry.type === "Armor";
    if (!isWeapon && !(includeArmor && isArmor)) continue;
    if (isWeapon && capIdx >= 0) {
      const dice = diceOf(entry.system);
      const best = dice.reduce(
        (m, d) => Math.max(m, ["d4", "d6", "d8", "d10", "d12"].indexOf(String(d).toLowerCase())),
        -1,
      );
      if (best > capIdx) continue;
    }
    out.push({ id: entry.name, label: `${entry.name}${isArmor ? " (armor)" : ""}` });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label)).slice(0, MAX_GEAR_OPTIONS);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* effectPlanFor                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Enumerate what the session layer must collect before this slot can be
 * applied. Never throws: an unreadable actor or a missing pack degrades to a
 * narrative plan rather than blocking the roll's result card.
 *
 * @param {string} slotKey — a downtime-skeleton slot key
 * @param {Actor}  actor   — the character the outcome lands on
 * @returns {Promise<{kind:"auto"|"choice"|"narrative", choiceType?:string,
 *   options?:Array<{id:string,label:string}>, prompt?:string}>}
 */
export async function effectPlanFor(slotKey, actor) {
  const spec = slotEffectSpec(slotKey);
  if (!spec) return { kind: "narrative", prompt: "The GM adjudicates this outcome." };
  if (spec.kind !== "choice") return { kind: spec.kind };

  try {
    switch (spec.choiceType) {
      case "weapon":       return await weaponPlan(slotKey, spec, actor);
      case "spell-new":    return await craftPlan(slotKey, spec, actor);
      case "spell-trade":  return await tradePlan(actor);
      case "potion":       return potionPlan();
      case "effect-remove": return cursePlan(actor);
      default:             return { kind: "narrative", prompt: "The GM adjudicates this outcome." };
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | downtime: could not build an effect plan for "${slotKey}"`, err);
    return { kind: "narrative", prompt: "Options could not be read — the GM applies this by hand." };
  }
}

async function weaponPlan(slotKey, spec, actor) {
  // "Train with a new weapon/armor" — a descriptive Talent, so the option list
  // is a convenience, not a constraint (a typed name is always accepted).
  if (spec.weaponMode === "train") {
    const options = await gearCandidates({
      includeArmor: !!spec.includeArmor,
      dieCap: spec.dieCap ?? null,
    });
    return {
      kind: "choice",
      choiceType: "weapon",
      // Additive hint for the session UI: unlike the other weapon slots the
      // option ids here are NAMES, not owned-item ids, and a typed name is
      // accepted (`choice.name`) when the gear pack has no matching row.
      freeText: true,
      options,
      prompt: spec.includeArmor
        ? "Pick the weapon or armor trained with (or type a name)."
        : `Pick the weapon trained with (or type a name)${spec.dieCap ? ` — ${spec.dieCap} damage or smaller` : ""}.`,
    };
  }

  const weapons = ownedWeapons(actor);
  if (!weapons.length) {
    return { kind: "narrative", prompt: `${actor?.name ?? "This character"} carries no weapon to train with.` };
  }

  // Step the damage die up.
  if (spec.weaponMode === "die") {
    const options = weapons.map((w) => {
      const state = trainingFlagOf(w);
      const dice = diceOf(w.system);
      const check = canStepDie(state, dice[0]);
      return {
        id: w.id,
        label: dice.length ? `${w.name} (${dice.join(" / ")})` : w.name,
        disabled: !check.ok,
        reason: check.ok ? null : check.error,
      };
    });
    return { kind: "choice", choiceType: "weapon", options, prompt: "Step one weapon's damage die up." };
  }

  // +1 to hit and/or damage.
  const options = [];
  for (const w of weapons) {
    const state = trainingFlagOf(w);
    const modes = spec.weaponMode === "either"
      ? [{ mode: "hit", suffix: "+1 to hit" }, { mode: "damage", suffix: "+1 damage" }]
      : [{ mode: "both", suffix: "+1 hit and damage" }];
    for (const m of modes) {
      const check = canGrantTraining(state, slotKey, m.mode);
      options.push({
        id: `${w.id}:${m.mode}`,
        label: `${w.name} — ${m.suffix}`,
        disabled: !check.ok,
        reason: check.ok ? null : check.error,
      });
    }
  }
  return {
    kind: "choice",
    choiceType: "weapon",
    options,
    prompt: spec.weaponMode === "either"
      ? "Pick one weapon and whether the bonus is to hit or to damage."
      : "Pick the weapon that gains +1 to hit and damage.",
  };
}

async function craftPlan(slotKey, spec, actor) {
  const spells = knownSpells(actor).filter((s) => isCraftableTier(s.system?.tier));
  if (!spells.length) {
    return {
      kind: "narrative",
      prompt: `${actor?.name ?? "This character"} knows no spell of tier ${MAX_CRAFT_TIER} or lower to inscribe.`,
    };
  }
  const options = spells.map((s) => {
    const uuid = sourceUuidOf(s);
    let disabled = false;
    let reason = null;
    if (spec.craft === "wand" && wandsHolding(actor, uuid).length) {
      disabled = true;
      reason = "A wand of this spell is already carried and unbroken.";
    }
    return { id: s.id, label: `${s.name} (Tier ${s.system?.tier})`, disabled, reason };
  });
  return {
    kind: "choice",
    choiceType: "spell-new",
    options,
    prompt: `Pick the spell to bind into the ${spec.craft === "wand" ? "wand" : "scroll"}.`,
  };
}

/**
 * Trade one known spell for another of the SAME tier on the same class list.
 * Each drop option carries its own legal replacements in `gain` — additive to
 * the contract's `{id,label}` shape so a two-step picker needs no second call.
 */
async function tradePlan(actor) {
  const spells = knownSpells(actor);
  if (!spells.length) {
    return { kind: "narrative", prompt: `${actor?.name ?? "This character"} knows no spell to trade away.` };
  }
  const classUuid = actorClassUuid(actor);
  if (!classUuid) {
    return { kind: "narrative", prompt: "No class is set on this character, so no spell list can be resolved." };
  }
  const knownNames = new Set(spells.map((s) => String(s.name ?? "").toLowerCase()));
  const byTier = new Map();
  const options = [];
  for (const s of spells) {
    const tier = Number(s.system?.tier);
    if (!byTier.has(tier)) {
      byTier.set(tier, await spellCandidates({ tier, classUuid, excludeNames: knownNames }));
    }
    const gain = byTier.get(tier);
    options.push({
      id: s.id,
      label: `${s.name} (Tier ${tier})`,
      tier,
      gain,
      disabled: !gain.length,
      reason: gain.length ? null : "No other spell of this tier is available on this class list.",
    });
  }
  return {
    kind: "choice",
    choiceType: "spell-trade",
    options,
    prompt: "Pick the spell to give up, then its same-tier replacement.",
  };
}

function potionPlan() {
  return {
    kind: "choice",
    choiceType: "potion",
    options: ARCANE_POTION_NAMES.map((n) => ({ id: n, label: n })),
    prompt: "Pick which potion was brewed.",
  };
}

function cursePlan(actor) {
  const curses = curseEffects(actor);
  if (!curses.length) {
    // Shadowdark has no curse item, status or field — nothing to clear.
    return {
      kind: "narrative",
      prompt: "Shadowdark models no curse mechanically — the GM ends the curse at the table.",
    };
  }
  return {
    kind: "choice",
    choiceType: "effect-remove",
    options: curses.map((e) => ({ id: e.id, label: e.name })),
    prompt: "Pick the curse to lift.",
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* applyDowntimeEffect                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Validate a chosen outcome against the actor's real state, apply it, and
 * return a one-line summary for the result card.
 *
 * GM-side only (see the file header) — the caller gates, not this function.
 *
 * @param {{actor:Actor, slotKey:string, choice?:object}} args
 * @returns {Promise<{ok:boolean, summary:string, error?:string}>}
 */
export async function applyDowntimeEffect({ actor, slotKey, choice = null } = {}) {
  if (!actor) return fail("No character was supplied.");
  const spec = slotEffectSpec(slotKey);
  if (!spec) return fail(`"${slotKey}" is not a downtime slot this build knows.`);

  try {
    const handler = HANDLERS[slotKey];
    if (!handler) {
      return ok("The GM adjudicates this outcome at the table.");
    }
    return await handler(actor, choice ?? {}, slotKey, spec);
  } catch (err) {
    console.error(`${MODULE_ID} | downtime: applying "${slotKey}" failed`, err);
    return fail(err?.message ? `Could not apply it: ${err.message}` : "Could not apply it.");
  }
}

/* ── Renown / XP ──────────────────────────────────────────────────────────── */

/**
 * Renown goes through the single write path in renown.mjs so the change is
 * logged like any other. `chat: false` — the downtime result card already tells
 * the table what happened, and a second card would just repeat it.
 */
async function bumpRenown(actor, delta) {
  const result = await Renown.award({
    actor, delta, source: "downtime", chat: false,
    reason: "Downtime",
  });
  if (!result.ok) return fail(result.error ?? "Renown could not be changed.");
  const sign = delta < 0 ? String(delta) : `+${delta}`;
  return ok(`${actor.name}: renown ${sign} → ${result.after}.`);
}

async function grantXp(actor, delta) {
  const next = (Number(actor.system?.level?.xp) || 0) + delta;
  const level = Number(actor.system?.level?.value) || 0;
  await actor.update({ "system.level.xp": next });
  // Polite level-up: the system's own sheet consumes this flag on next render
  // (PlayerSheetSD reads `showLevelUp`), so only raise it once the character
  // is actually at the threshold `level.value * 10`.
  let note = "";
  if (shouldPromptLevelUp(next, level)) {
    await actor.setFlag("shadowdark", "showLevelUp", true);
    note = " Level-up is ready on their sheet.";
  }
  return ok(`${actor.name}: +${delta} XP → ${next}.${note}`);
}

/* ── Martial training ─────────────────────────────────────────────────────── */

function parseWeaponChoice(choice) {
  const raw = String(choice?.id ?? choice?.itemId ?? "");
  const [itemId, mode] = raw.split(":");
  return { itemId: itemId || null, mode: mode || choice?.mode || null };
}

async function applyWeaponBonus(actor, choice, slotKey, spec) {
  const { itemId, mode } = parseWeaponChoice(choice);
  const item = itemId ? actor.items.get(itemId) : null;
  if (!item || item.type !== "Weapon") return fail("Pick a weapon this character carries.");

  const wantMode = spec.weaponMode === "either" ? mode : "both";
  if (spec.weaponMode === "either" && wantMode !== "hit" && wantMode !== "damage") {
    return fail("Pick whether the bonus is to hit or to damage.");
  }

  const state = trainingFlagOf(item);
  const check = canGrantTraining(state, slotKey, wantMode);
  if (!check.ok) return fail(check.error);

  const flags = trainingModeFlags(slotKey, wantMode);
  const provenance = { [MODULE_ID]: { [TRAINING_FLAG]: { slotKey, grant: trainingGrantKey(slotKey, wantMode) } } };
  const effects = [];
  if (flags.hit) {
    effects.push({
      name: "Weapon Training (+1 to hit)",
      img: ICON_ATTACK,
      disabled: false,
      transfer: true,
      changes: [{ key: "system.roll.attack.bonus.this", value: 1, type: AE_CHANGE_ADD }],
      flags: provenance,
    });
  }
  if (flags.damage) {
    effects.push({
      name: "Weapon Training (+1 damage)",
      img: ICON_DAMAGE,
      disabled: false,
      transfer: true,
      changes: [{ key: "system.roll.attack.damage.this", value: 1, type: AE_CHANGE_ADD }],
      flags: provenance,
    });
  }
  if (!effects.length) return fail("That slot grants no weapon bonus.");

  await item.createEmbeddedDocuments("ActiveEffect", effects);
  await item.setFlag(MODULE_ID, TRAINING_FLAG, withTrainingGrant(state, slotKey, wantMode));

  const what = flags.hit && flags.damage ? "+1 to hit and damage" : flags.hit ? "+1 to hit" : "+1 damage";
  return ok(`${item.name}: ${what}.${suppressionNote(item)}`);
}

/**
 * Shadowdark suppresses an item's effects while it is stashed, unequipped or
 * unidentified — worth saying only when it actually applies right now.
 */
function suppressionNote(item) {
  if (item.system?.stashed) return " (stashed — the bonus is suppressed until it is carried).";
  if (item.system?.canBeEquipped && item.system?.equipped === false) {
    return " (not equipped — the bonus applies once it is).";
  }
  return "";
}

async function stepWeaponDie(actor, choice) {
  const { itemId } = parseWeaponChoice(choice);
  const item = itemId ? actor.items.get(itemId) : null;
  if (!item || item.type !== "Weapon") return fail("Pick a weapon this character carries.");

  const state = trainingFlagOf(item);
  const oneHanded = item.system?.damage?.oneHanded ?? "";
  const twoHanded = item.system?.damage?.twoHanded ?? "";
  const check = canStepDie(state, oneHanded || twoHanded);
  if (!check.ok) return fail(check.error);

  // Direct edit of `system.damage.*` rather than the AE
  // `system.roll.attack.upgrade-damage-die` key: the die then reads correctly
  // on the sheet and in the item's own subtext, and there is no ambiguity
  // about how two upgrade effects stack.
  const update = {};
  const parts = [];
  if (oneHanded) {
    const next = stepDamageDie(oneHanded);
    if (next) { update["system.damage.oneHanded"] = next; parts.push(`${oneHanded}→${next}`); }
  }
  if (twoHanded) {
    const next = stepDamageDie(twoHanded);
    if (next) { update["system.damage.twoHanded"] = next; parts.push(`${twoHanded}→${next}`); }
  }
  if (!parts.length) return fail("That weapon's damage die is already d12.");

  await item.update(update);
  await item.setFlag(MODULE_ID, TRAINING_FLAG, withDieStep(state));
  return ok(`${item.name}: damage die stepped up (${parts.join(", ")}).`);
}

async function trainNewProficiency(actor, choice, slotKey, spec) {
  const name = String(choice?.name ?? choice?.id ?? "").trim();
  if (!name) return fail("Name the weapon or armor trained with.");

  // Shadowdark has no proficiency field of any kind, so this is recorded as a
  // Talent the GM can point at — honestly descriptive, not a fake mechanic.
  const what = spec.includeArmor ? "weapon or armor" : "weapon";
  await actor.createEmbeddedDocuments("Item", [{
    name: `Training: ${name}`,
    type: "Talent",
    img: ICON_TRAINING,
    system: {
      description: `<p>Downtime martial training: this character may now use <strong>${esc(name)}</strong>.</p>`
        + `<p><em>Recorded from the ${esc(what)} training downtime activity — the GM applies it at the table; `
        + "Shadowdark has no proficiency field to set.</em></p>",
    },
    flags: { [MODULE_ID]: { [TRAINING_FLAG]: { slotKey } } },
  }]);
  return ok(`${actor.name} is now trained with ${name}.`);
}

/* ── Magical research ─────────────────────────────────────────────────────── */

async function craftSpellItem(actor, choice, slotKey, spec) {
  const spellId = String(choice?.id ?? choice?.spellItemId ?? "");
  const spell = spellId ? actor.items.get(spellId) : null;
  if (!spell || spell.type !== "Spell") return fail("Pick a spell this character knows.");
  if (!isCraftableTier(spell.system?.tier)) {
    return fail(`Only spells of tier ${MAX_CRAFT_TIER} or lower can be inscribed.`);
  }
  const spellUuid = sourceUuidOf(spell);
  if (!spellUuid) return fail("That spell has no resolvable source to bind.");

  const isWand = spec.craft === "wand";
  if (isWand && wandsHolding(actor, spellUuid).length) {
    return fail("A wand of that spell is already carried and unbroken.");
  }

  // magic-forge's pure builder produces the working shape: a Scroll with
  // `system.spellUuid`, a Wand with `system.spells[]`, both identified so the
  // system's own casting pipeline runs (DC = tier + 10).
  const data = assembleItemData({
    type: isWand ? "wand" : "scroll",
    name: `${isWand ? "Wand" : "Scroll"} of ${spell.name}`,
    spellUuids: [spellUuid],
    identified: true,
  });
  data.flags = data.flags ?? {};
  data.flags[MODULE_ID] = { ...(data.flags[MODULE_ID] ?? {}), downtimeCrafted: { slotKey } };
  await actor.createEmbeddedDocuments("Item", [data]);
  return ok(`${actor.name} created ${data.name}.`);
}

async function brewPotion(actor, choice, slotKey, { fixedName = null } = {}) {
  const name = fixedName ?? String(choice?.id ?? choice?.name ?? "").trim();
  if (!name) return fail("Pick which potion was brewed.");
  if (!fixedName && !ARCANE_POTION_NAMES.includes(name)) {
    return fail("That potion is not on this activity's list.");
  }
  // Shadowdark ships no potion documents at all (its `magic-items` pack holds
  // only the named uniques), so the item is fabricated. `system.spellName` is
  // the model's only linkage field; the effect itself stays descriptive.
  await actor.createEmbeddedDocuments("Item", [{
    name,
    type: "Potion",
    img: ICON_POTION,
    system: {
      spellName: name,
      magicItem: true,
      description: `<p><em>Brewed during downtime. Its effect is resolved from the book at the table.</em></p>`,
    },
    flags: { [MODULE_ID]: { downtimeCrafted: { slotKey } } },
  }]);
  return ok(`${actor.name} brewed ${name}. Its effect is resolved from the book.`);
}

async function tradeSpell(actor, choice) {
  const dropId = String(choice?.dropSpellItemId ?? choice?.id ?? "");
  const gainUuid = String(choice?.gainSpellUuid ?? choice?.gain ?? "");
  const drop = dropId ? actor.items.get(dropId) : null;
  if (!drop || drop.type !== "Spell") return fail("Pick a spell this character knows to give up.");
  if (!gainUuid) return fail("Pick the replacement spell.");

  const gainDoc = await fromUuid(gainUuid).catch(() => null);
  if (!gainDoc || gainDoc.type !== "Spell") return fail("That replacement is not a spell.");

  if (Number(gainDoc.system?.tier) !== Number(drop.system?.tier)) {
    return fail("A traded spell must be the same tier as the one given up.");
  }
  const classUuid = actorClassUuid(actor);
  if (!classUuid || !(gainDoc.system?.class ?? []).includes(classUuid)) {
    return fail("That spell is not on this character's class list.");
  }
  if (knownSpells(actor).some((s) => s.name === gainDoc.name)) {
    return fail(`${actor.name} already knows ${gainDoc.name}.`);
  }

  const dropName = drop.name;
  const gainData = gainDoc.toObject();
  // The compendium copy carries its own id/ownership; both belong to the
  // source document, not to this character's new embedded copy.
  delete gainData._id;
  delete gainData.ownership;
  await actor.deleteEmbeddedDocuments("Item", [drop.id]);
  await actor.createEmbeddedDocuments("Item", [gainData]);
  return ok(`${actor.name} traded ${dropName} for ${gainDoc.name} (Tier ${gainDoc.system.tier}).`);
}

/**
 * The two "advantage on your next …" slots. A real advantage change is written
 * so the bonus actually lands, but nothing decrements it — the effect is
 * labelled and the summary says to remove it after use.
 */
async function grantAdvantageBuff(actor, slotKey, { label, uses }) {
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: label,
    img: ICON_BUFF,
    disabled: false,
    changes: [{ key: "system.roll.spell.advantage.all", value: 1, type: AE_CHANGE_ADD }],
    flags: { [MODULE_ID]: { [BUFF_FLAG]: { slotKey, uses } } },
  }]);
  const which = uses > 1 ? `the next ${uses} casts` : "the next cast";
  return ok(`${actor.name} gains "${label}" — advantage on ${which}. Delete the effect once it is used.`);
}

async function liftCurse(actor, choice) {
  const id = String(choice?.id ?? choice?.effectId ?? "");
  const effect = id ? actor.effects.get(id) : null;
  if (!effect) return fail("Pick a curse on this character.");
  if (!effect.getFlag(MODULE_ID, CURSE_FLAG)) {
    return fail("That effect is not flagged as a curse.");
  }
  const name = effect.name;
  await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
  return ok(`${actor.name} is free of ${name}.`);
}

/* ── Skulduggery ──────────────────────────────────────────────────────────── */

async function armExtortion(actor) {
  await actor.setFlag(MODULE_ID, EXTORTION_FLAG, extortionFlagValue());
  return ok(
    `${actor.name} has leverage over the merchant: their next purchase costs ${EXTORTION_PCT}% less, `
    + `or their next sale earns ${EXTORTION_PCT}% more — whichever comes first.`,
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Dispatch                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

const HANDLERS = {
  // Spiritualism
  "church-favor": (actor) => bumpRenown(actor, 1),
  "spiritual-strengthening": (actor) => grantXp(actor, 2),
  "spiritual-cleansing": (actor, choice) =>
    (curseEffects(actor).length
      ? liftCurse(actor, choice)
      : Promise.resolve(ok("The GM ends one curse afflicting this character — Shadowdark models none mechanically."))),

  // Skulduggery
  "rumor": (actor, choice) => {
    const target = choice?.targetActorId ? game.actors.get(choice.targetActorId) : null;
    const sign = choice?.sign === "-" || Number(choice?.sign) < 0 ? -1 : 1;
    return bumpRenown(target ?? actor, sign);
  },
  "extortion": (actor) => armExtortion(actor),

  // Martial training
  "d4-hit-or-damage": (actor, choice, slotKey, spec) => applyWeaponBonus(actor, choice, slotKey, spec),
  "d6-hit-and-damage": (actor, choice, slotKey, spec) => applyWeaponBonus(actor, choice, slotKey, spec),
  "d8-hit-and-damage": (actor, choice, slotKey, spec) => applyWeaponBonus(actor, choice, slotKey, spec),
  "d8-damage-die": (actor, choice) => stepWeaponDie(actor, choice),
  "d4-new-weapon": (actor, choice, slotKey, spec) => trainNewProficiency(actor, choice, slotKey, spec),
  "d6-new-weapon": (actor, choice, slotKey, spec) => trainNewProficiency(actor, choice, slotKey, spec),
  "d8-new-armor-weapon": (actor, choice, slotKey, spec) => trainNewProficiency(actor, choice, slotKey, spec),

  // Magical research
  "arcane-scroll-adv": (actor, choice, slotKey) =>
    grantAdvantageBuff(actor, slotKey, { label: "Downtime Research: next scroll", uses: 1 }),
  "divine-spell-adv": (actor, choice, slotKey) =>
    grantAdvantageBuff(actor, slotKey, { label: "Downtime Research: next three spells", uses: 3 }),
  "arcane-create-scroll": (actor, choice, slotKey, spec) => craftSpellItem(actor, choice, slotKey, spec),
  "divine-create-scroll": (actor, choice, slotKey, spec) => craftSpellItem(actor, choice, slotKey, spec),
  "arcane-create-wand": (actor, choice, slotKey, spec) => craftSpellItem(actor, choice, slotKey, spec),
  "arcane-create-potion": (actor, choice, slotKey) => brewPotion(actor, choice, slotKey),
  "divine-potion-healing": (actor, choice, slotKey) =>
    brewPotion(actor, choice, slotKey, { fixedName: HEALING_POTION_NAME }),
  "divine-trade-spell": (actor, choice) => tradeSpell(actor, choice),
};

/** Slot keys with a real mechanical writer (the rest are GM-adjudicated). */
export const MECHANICAL_SLOT_KEYS = Object.keys(HANDLERS);

/* ────────────────────────────────────────────────────────────────────────── */
/* Merchant-side extortion consumption helpers                                */
/* ────────────────────────────────────────────────────────────────────────── */

/** Read an actor's pending extortion swing, or null. */
export function readExtortion(actor) {
  const flag = actor?.getFlag?.(MODULE_ID, EXTORTION_FLAG) ?? null;
  return hasExtortion(flag) ? flag : null;
}

/** Spend one use after a transaction actually landed. */
export async function spendExtortion(actor) {
  const flag = readExtortion(actor);
  if (!flag) return false;
  const next = consumeExtortion(flag);
  if (next) await actor.setFlag(MODULE_ID, EXTORTION_FLAG, next);
  else await actor.unsetFlag(MODULE_ID, EXTORTION_FLAG);
  return true;
}

export { SLOT_EFFECTS, EXTORTION_FLAG, TRAINING_FLAG, BUFF_FLAG, CURSE_FLAG };
