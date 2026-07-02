import { ABILITY_ORDER } from "./constants.mjs";

/**
 * Turn a completed builder state into a Shadowdark PlayerSD actor.
 *
 * Mirrors the system generator's data shape — `system.ancestry/class/background/
 * deity/patron` hold the source UUIDs (references), while talents, class
 * abilities, spells and gear are embedded items. Talents route through
 * `shadowdark.effects.createItemWithEffect` so their effect choices (Weapon
 * Mastery weapon, +2 stat, …) are honoured, exactly like the native generator.
 *
 * Unlike the generator we build a COMPLETE level-1 character (HP + rolled talent
 * already chosen), so we do NOT set the `showLevelUp` flag — no re-prompt.
 *
 * @returns the created Actor, `true` when handed off to the GM socket, or
 *          `null` when creation failed.
 */
export async function commitCharacter(state) {
  const classSys = state.class?.item?.system;

  const abilities = {};
  for (const k of ABILITY_ORDER) abilities[k] = { value: state.stats.values[k] || 10 };

  const languages = await gatherLanguages(state);

  const actorData = {
    name: state.name || game.i18n.localize("SDE.charBuilder.defaultName"),
    type: "Player",
    system: {
      abilities,
      level: { value: 1, xp: 0 },
      alignment: state.alignment || "neutral",
      ancestry: state.ancestry?.uuid || "",
      class: state.class?.uuid || "",
      background: state.background?.uuid || "",
      deity: state.deity?.uuid || "",
      patron: state.patron?.uuid || "",
      coins: coinsAfterGear(state),
      attributes: { hp: { value: state.hp.max || 1, max: state.hp.max || 1 } },
      languages,
      // Match the system generator: a fresh character has no luck token available.
      luck: { remaining: 0, available: false },
    },
  };

  const allItems = await gatherItems(state, classSys);

  // Player without create permission → hand off to the GM via the system socket.
  if (!(shadowdark.utils?.canCreateCharacter?.() ?? game.user.can("ACTOR_CREATE"))) {
    game.socket.emit("system.shadowdark", {
      type: "createCharacter",
      // level0: true — the system only uses this flag to set `showLevelUp`,
      // which would re-prompt for the HP roll + talent the builder already applied.
      payload: { characterData: actorData, characterItems: allItems, userId: game.userId, level0: true },
    });
    ui.notifications.info(game.i18n.localize("SDE.charBuilder.commit.sentToGm"));
    return true;
  }

  const actor = await Actor.create(actorData);
  if (!actor) return null;
  if (allItems.length) await actor.createEmbeddedDocuments("Item", allItems);
  actor.sheet?.render(true);
  ui.notifications.info(game.i18n.format("SDE.charBuilder.commit.created", { name: actor.name }));
  return actor;
}

/** Starting coins minus the gear-cart cost (clamped at zero). */
export function coinsAfterGear(state) {
  const c = state.coins;
  let cp = (c.gp || 0) * 100 + (c.sp || 0) * 10 + (c.cp || 0);
  for (const g of (state.gear || [])) cp -= (g.costCp || 0) * (g.qty || 1);
  cp = Math.max(0, cp);
  return { gp: Math.floor(cp / 100), sp: Math.floor((cp % 100) / 10), cp: cp % 10 };
}

/**
 * Languages known — the Languages step's result if present. If the tab was
 * never visited, fall back to the fixed lists and fill the choice slots
 * (`common`/`rare`/`select` are choose-N counts) randomly, like the system
 * generator does.
 */
async function gatherLanguages(state) {
  if (Array.isArray(state.languages) && state.languages.length) {
    return [...new Set(state.languages)];
  }
  const ancL = state.ancestry?.item?.system?.languages || {};
  const clsL = state.class?.item?.system?.languages || {};
  const langs = new Set([...(ancL.fixed || []), ...(clsL.fixed || [])]);
  const fill = (pool, count) => {
    const avail = pool.filter((u) => !langs.has(u));
    for (let i = 0; i < count && avail.length; i++) {
      langs.add(avail.splice(Math.floor(Math.random() * avail.length), 1)[0]);
    }
  };
  try {
    const uuids = (docs) => Array.from(docs).map((d) => d.uuid);
    fill(uuids(await shadowdark.compendiums.commonLanguages()), (ancL.common || 0) + (clsL.common || 0));
    fill(uuids(await shadowdark.compendiums.rareLanguages()), (ancL.rare || 0) + (clsL.rare || 0));
    fill([...new Set([...(ancL.selectOptions || []), ...(clsL.selectOptions || [])])],
      (ancL.select || 0) + (clsL.select || 0));
  } catch (_e) { /* language packs unavailable — fixed languages only */ }
  return [...langs];
}

/** Embedded items: ancestry + class talents (with effect choices), class abilities, spells, gear. */
async function gatherItems(state, classSys) {
  const items = [];

  const addSource = async (uuid) => {
    const doc = await fromUuid(uuid).catch(() => null);
    if (doc) items.push(doc.toObject());
  };
  const addTalent = async (uuid) => {
    const doc = await fromUuid(uuid).catch(() => null);
    // Skip non-Item docs (e.g. a nested "Distribute to Stats" RollTable) — they
    // aren't embeddable and would throw in createItemWithEffect / be dropped.
    if (!doc || doc.documentName !== "Item") return;
    try {
      items.push(await shadowdark.effects.createItemWithEffect(doc));
    } catch (_e) {
      items.push(doc.toObject());
    }
  };

  // Ancestry talents: only the chosen subset (multi-talent ancestries like Elf
  // grant a choice, tracked in state.ancestryTalents).
  for (const uuid of (state.ancestryTalents || [])) await addTalent(uuid);
  for (const uuid of (classSys?.talents || [])) await addTalent(uuid);
  for (const t of (state.classTalents || [])) await addTalent(t.uuid);
  for (const uuid of (classSys?.classAbilities || [])) await addSource(uuid);
  for (const sp of (state.spells || [])) await addSource(sp.uuid);

  for (const g of (state.gear || [])) {
    const doc = await fromUuid(g.uuid).catch(() => null);
    if (!doc) continue;
    const obj = doc.toObject();
    if (g.qty > 1) obj.system.quantity = g.qty;
    items.push(obj);
  }

  // Rolled/typed trinket → a weightless Basic item.
  if (state.trinket) {
    items.push({
      name: state.trinket,
      type: "Basic",
      system: { slots: { slots_used: 0, free_carry: 0, per_slot: 1 } },
    });
  }

  return items;
}
