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
      coins: {
        gp: state.coins.gp || 0,
        sp: state.coins.sp || 0,
        cp: state.coins.cp || 0,
      },
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
      payload: { characterData: actorData, characterItems: allItems, userId: game.userId, level0: false },
    });
    ui.notifications.info(game.i18n.localize("SDE.charBuilder.commit.sentToGm"));
    return null;
  }

  const actor = await Actor.create(actorData);
  if (!actor) return null;
  if (allItems.length) await actor.createEmbeddedDocuments("Item", allItems);
  actor.sheet?.render(true);
  ui.notifications.info(game.i18n.format("SDE.charBuilder.commit.created", { name: actor.name }));
  return actor;
}

/** Languages known — the Languages step's result if present, else a fixed+Common fallback. */
async function gatherLanguages(state) {
  if (Array.isArray(state.languages) && state.languages.length) {
    return [...new Set(state.languages)];
  }
  const langs = new Set();
  const addFixed = (sys) => { for (const u of (sys?.languages?.fixed || [])) langs.add(u); };
  addFixed(state.ancestry?.item?.system);
  addFixed(state.class?.item?.system);
  try {
    const wantsCommon = (state.ancestry?.item?.system?.languages?.common || 0) > 0;
    if (wantsCommon) {
      const all = Array.from(await shadowdark.compendiums.languages());
      const common = all.find((l) => l.name === "Common");
      if (common) langs.add(common.uuid);
    }
  } catch (_e) { /* no language pack — skip Common */ }
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

  return items;
}
