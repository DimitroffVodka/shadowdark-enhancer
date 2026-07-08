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
 * When `actor` is supplied (the builder was launched from an existing Player
 * sheet), the character is written back onto THAT actor — system data updated,
 * its items replaced with the freshly built set — instead of creating a new
 * one. This is the common path: a blank actor is made, the builder fills it in,
 * and no orphan duplicate is left behind.
 *
 * @param {CharBuilderState} state
 * @param {Actor|null} [actor]  Existing actor to edit in place; null = create.
 * @returns the created/updated Actor, `true` when handed off to the GM socket,
 *          or `null` when the operation failed.
 */
export async function commitCharacter(state, actor = null) {
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
      // Talent-granted HP bonuses (Dwarf Stout +2) re-apply on the actor via
      // the embedded talent's ActiveEffect — base max excludes them so they
      // aren't counted twice; value is the full total (clamps to derived max).
      attributes: {
        hp: {
          value: state.hp.max || 1,
          max: Math.max(1, (state.hp.max || 1) - (state.hp.bonus || 0)),
        },
      },
      languages,
      // Match the system generator: a fresh character has no luck token available.
      luck: { remaining: 0, available: false },
    },
  };

  applyArt(actorData, state);

  const allItems = await gatherItems(state, classSys);

  // Editing an existing actor in place — the launch-from-sheet path.
  if (actor) return updateExistingActor(actor, actorData, allItems, state);

  // Player without create permission → hand off to the GM via the system socket.
  if (!(shadowdark.utils?.canCreateCharacter?.() ?? game.user.can("ACTOR_CREATE"))) {
    // Fire-and-forget over a socket only a GM answers — if none is online the
    // character is silently lost. Guard so the UI doesn't falsely report success.
    if (!game.users.activeGM) {
      ui.notifications.error(game.i18n.localize("SDE.charBuilder.commit.noGm"));
      return null;
    }
    game.socket.emit("system.shadowdark", {
      type: "createCharacter",
      // level0: true — the system only uses this flag to set `showLevelUp`,
      // which would re-prompt for the HP roll + talent the builder already applied.
      payload: { characterData: actorData, characterItems: allItems, userId: game.userId, level0: true },
    });
    ui.notifications.info(game.i18n.localize("SDE.charBuilder.commit.sentToGm"));
    return true;
  }

  const created = await Actor.create(actorData);
  if (!created) return null;
  // Embed items in a second step, but roll the actor back if it fails — a
  // character with no talents/gear is broken, and leaving it behind makes the
  // player retry and accumulate orphaned half-actors.
  if (allItems.length) {
    try {
      await created.createEmbeddedDocuments("Item", allItems);
    } catch (err) {
      console.error(`${game.i18n.localize("SDE.charBuilder.title")} | item embedding failed, rolling back actor`, err);
      await created.delete().catch(() => {});
      return null;
    }
  }
  created.sheet?.render(true);
  ui.notifications.info(game.i18n.format("SDE.charBuilder.commit.created", { name: created.name }));
  return created;
}

/**
 * Write the built character back onto an existing actor: update system data,
 * clear its current items, embed the freshly built set. Rolls nothing back on
 * partial failure the way create does — the actor already existed, so a failed
 * item pass leaves the actor updated but item-light rather than orphaned; we
 * surface the error instead of deleting the user's actor.
 */
async function updateExistingActor(actor, actorData, allItems, state) {
  if (!actor.isOwner) {
    ui.notifications.error(game.i18n.localize("SDE.charBuilder.commit.notOwner"));
    return null;
  }
  // Only overwrite the name when the builder was given an explicit one —
  // otherwise keep whatever the player already named the actor.
  const update = { system: actorData.system };
  if (state.name) update.name = actorData.name;
  // Art fields only exist on actorData when the Preview step set them, so an
  // art-less build leaves the actor's current portrait/token alone.
  if (actorData.img) update.img = actorData.img;
  if (actorData.prototypeToken) update.prototypeToken = actorData.prototypeToken;
  if (actorData.flags) update.flags = actorData.flags;

  try {
    await actor.update(update);
    const existingIds = actor.items.map((i) => i.id);
    if (existingIds.length) await actor.deleteEmbeddedDocuments("Item", existingIds);
    if (allItems.length) await actor.createEmbeddedDocuments("Item", allItems);
  } catch (err) {
    console.error(`${game.i18n.localize("SDE.charBuilder.title")} | actor update failed`, err);
    return null;
  }
  actor.sheet?.render(true);
  ui.notifications.info(game.i18n.format("SDE.charBuilder.commit.updated", { name: actor.name }));
  return actor;
}

/**
 * Fold the Preview step's art choices into the actor data.
 *
 * Both fields are optional: an untouched slot writes nothing, so a build with no
 * art keeps the system defaults (and, on the edit-in-place path, whatever art the
 * actor already had).
 */
function applyArt(actorData, state) {
  const art = state.art;
  if (!art) return;

  if (art.portrait) actorData.img = art.portrait;
  if (art.token) foundry.utils.setProperty(actorData, "prototypeToken.texture.src", art.token);
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
  const addTalent = async (uuid, choice = null) => {
    const doc = await fromUuid(uuid).catch(() => null);
    // Skip non-Item docs (e.g. a nested "Distribute to Stats" RollTable) — they
    // aren't embeddable and would throw in createItemWithEffect / be dropped.
    if (!doc || doc.documentName !== "Item") return;
    // A choice made in the builder pre-fills the REPLACEME effect keys exactly
    // like the system's modifyEffectChangesWithInput would — no dialog.
    if (choice?.slug) {
      const obj = doc.toObject();
      obj.name += ` (${choice.label})`;
      for (const eff of (obj.effects ?? [])) {
        for (const c of (eff.changes ?? [])) c.key = c.key.replace("REPLACEME", choice.slug);
      }
      items.push(obj);
      return;
    }
    try {
      items.push(await shadowdark.effects.createItemWithEffect(doc));
    } catch (_e) {
      items.push(doc.toObject());
    }
  };

  // Ancestry talents: only the chosen subset (multi-talent ancestries like Elf
  // grant a choice, tracked in state.ancestryTalents).
  const choice = (key) => state.talentChoices?.[key] ?? null;
  for (const uuid of (state.ancestryTalents || [])) await addTalent(uuid);
  for (const uuid of (classSys?.talents || [])) await addTalent(uuid, choice(`fixed:${uuid}`));
  for (const t of (state.classTalents || [])) await addTalent(t.uuid, choice(`rolled:${t.uuid}`));
  // Bonus creation rolls (Ambitious extra talent, Black Lotus, patron boons…) —
  // text-only results have no embeddable item; the fixed talent's own text
  // stays on the sheet for those.
  for (const b of (state.bonusRolls || [])) {
    if (b.chosenUuid) await addTalent(b.chosenUuid, choice(`bonus:${b.key}`));
  }
  for (const uuid of (classSys?.classAbilities || [])) await addSource(uuid);
  for (const sp of (state.spells || [])) await addSource(sp.uuid);

  // A Crawling Kit is a bundle, not an item — the sheet gets its contents
  // (core rules pg 36), once per kit purchased.
  const CRAWLING_KIT = [["Backpack", 1], ["Flint and Steel", 1], ["Torch", 2], ["Rations", 3], ["Iron Spikes", 10], ["Grappling Hook", 1], ["Rope, 60'", 1]];
  const addGearByName = async (name, qty) => {
    const found = Array.from(await shadowdark.compendiums.basicItems()).find((i) => i.name.toLowerCase() === name.toLowerCase());
    const doc = found ? await fromUuid(found.uuid).catch(() => null) : null;
    if (!doc) return;
    const obj = doc.toObject();
    if (qty > 1) obj.system.quantity = qty;
    items.push(obj);
  };
  for (const g of (state.gear || [])) {
    if (g.name === "Crawling Kit") {
      for (let k = 0; k < g.qty; k++) for (const [n, q] of CRAWLING_KIT) await addGearByName(n, q);
      continue;
    }
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
