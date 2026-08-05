/**
 * Shadowdark Enhancer — Spell Mishap Auto-Roll
 *
 * Detects natural 1s on spellcasting checks and automatically rolls
 * the class-appropriate mishap table.
 *
 * Mishap triggers when:
 *   1. A chat message has a spell check (type "spell" in rollConfig)
 *   2. The d20 result is a natural 1
 *   3. The total is below the spell DC (10 + tier)
 *   4. The casting class is not divine (Priest, Green Knight, Seer)
 *
 * Table sets are keyed by spellcasting class:
 *   wizard/necromancer → Wizard Mishap (system pack, tiers 1-2, 3-4, 5)
 *   witch              → Diabolical Mishap (enhancer suite, tiers 1-3, 4-5)
 *
 * Tables are resolved by NAME, not by document id: the suite tables are created
 * fresh per world (table-importer's RollTable.create assigns a new _id each
 * time), so a hard-coded id only ever matches the world it was copied from.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";
import { esc } from "../shared/esc.mjs";

/**
 * Class slugs as they appear in `actor.system.spellcasting.classes` — the
 * enabler talents write a slugified class name, so Green Knight arrives as
 * "green-knight". Spaces are normalized so either spelling matches.
 */
const normalizeClass = (c) => String(c || "").toLowerCase().trim().replace(/\s+/g, "-");

/** Divine spellcasters that do penance or lose the spell — no mishap table */
const DIVINE_CLASSES = new Set(["priest", "green-knight", "seer"].map(normalizeClass));

/**
 * Per-class mishap table configuration.
 * Key = spellcasting class slug (matches actor.system.spellcasting.classes);
 * `suite` names a managed world pack, `pack` a fixed compendium id.
 */
const MISHAP_SETS = {
  wizard: {
    pack: "shadowdark.rollable-tables",
    tiers: [
      { max: 2, name: "Wizard Mishap Tier 1-2" },
      { max: 4, name: "Wizard Mishap Tier 3-4" },
      { max: 5, name: "Wizard Mishap Tier 5" },
    ],
  },
  witch: {
    suite: "sde-tables",
    tiers: [
      { max: 3, name: "Diabolical Mishap 1-3" },
      { max: 5, name: "Diabolical Mishap 4-5" },
    ],
  },
  // Necromancer uses its own mishap tables (Western Reaches pg. 186-187)
  necromancer: {
    suite: "sde-tables",
    tiers: [
      { max: 3, name: "Necromancer Mishap 1-3" },
      { max: 5, name: "Necromancer Mishap 4-5" },
    ],
  },
};

/** Setting key */
const SETTING = "spellMishapAutoRoll";

/**
 * Resolve the mishap table document for a casting class and spell tier.
 * Suite tables may carry the "<Source> - <Name>" prefix the table censuses use,
 * so match the bare name or that suffix form.
 */
async function findMishapTable(classSlug, tier) {
  const set = MISHAP_SETS[classSlug];
  if (!set) return null;

  const entry = set.tiers.find(t => tier <= t.max);
  if (!entry) return null;

  const pack = set.suite ? findSuitePack(set.suite) : game.packs.get(set.pack);
  if (!pack) return null;

  const index = await pack.getIndex();
  const wanted = entry.name.toLowerCase();
  const hit = index.find(e => {
    const name = String(e.name || "").toLowerCase();
    return name === wanted || name.endsWith(` - ${wanted}`);
  });
  return hit ? pack.getDocument(hit._id) : null;
}

/**
 * Check if a roll is a natural 1 on a d20.
 */
function isNatural1(roll) {
  if (!roll?.dice?.length) return false;
  return roll.dice.some(die =>
    die.faces === 20 &&
    die.results.some(r => r.active !== false && r.result === 1)
  );
}

/**
 * The class actually casting this spell.
 *
 * The actor's whole class list can't answer this: a Wizard/Witch would take
 * whichever sorted first, and a single divine class would exempt every other.
 * The spell's own class links do — intersected with the classes the actor
 * really casts as. A spell with no usable link falls back to the actor's list.
 */
async function castingClasses(spell, actorClasses) {
  const owned = actorClasses.map(normalizeClass);
  const ownedSet = new Set(owned);

  const linked = [];
  for (const uuid of spell.system?.class ?? []) {
    const cls = await fromUuid(uuid).catch(() => null);
    if (cls?.name) linked.push(normalizeClass(cls.name));
  }

  const shared = linked.filter(c => ownedSet.has(c));
  return shared.length ? shared : owned;
}

/**
 * Detect a spell mishap from a chat message.
 * Returns { tier, actor, classSlug } if a mishap is due, null otherwise.
 */
async function detectMishap(message) {
  const config = message.flags?.shadowdark?.rollConfig;
  if (!config) return null;

  if (config.type !== "spell") return null;

  const mainRoll = message.rolls?.[0];
  if (!mainRoll || !isNatural1(mainRoll)) return null;

  // A wand or scroll cast puts the WAND in itemUuid; cast.spellUuid is always
  // the spell itself, so read that first or those casts never mishap.
  const spellUuid = config.cast?.spellUuid ?? config.itemUuid;
  if (!spellUuid) return null;

  const spell = await fromUuid(spellUuid).catch(() => null);
  if (!spell || spell.type !== "Spell") return null;

  const tier = spell.system?.tier ?? null;
  if (tier == null) return null;

  const dc = 10 + tier;
  if (mainRoll.total >= dc) return null;

  const actor = config.actorUuid
    ? await fromUuid(config.actorUuid).catch(() => null)
    : null;

  if (!actor) return null;

  const classes = actor.system?.spellcasting?.classes ?? [];
  if (!classes.length) return null;

  const casting = await castingClasses(spell, classes);

  // Divine casters don't get mishap tables — judged on the casting class, not
  // on every class the actor happens to hold.
  if (casting.every(c => DIVINE_CLASSES.has(c))) return null;

  const classSlug = casting.find(c => MISHAP_SETS[c] && !DIVINE_CLASSES.has(c));
  if (!classSlug) return null;

  return { tier, actor, classSlug };
}

/**
 * Roll the mishap table and post the result as ONE card.
 *
 * The old code posted two messages — the table's own draw card plus a separate
 * flavor line. The no-actor flavor branch below is defensive totality: this
 * function is exported, so its contract must hold on its own. In production it
 * is only called from init()'s hook through detectMishap, which returns null
 * when the actor is missing — so a null actor never actually arrives. It is
 * not a fix for an observed defect.
 */
export async function rollMishapTable(tier, actor, classSlug) {
  const tableDoc = await findMishapTable(classSlug, tier);
  if (!tableDoc) return;

  // Draw silently, then fold the flavor line and the drawn result into ONE
  // card.
  const draw = await tableDoc.draw({ displayChat: false });

  // A TableResult's display text lives on `name`/`description`. Never read
  // `.text` (or `._source.text`) here — the removed-in-v15 deprecation shim
  // fires on this Foundry version.
  //
  // Result text is CONTENT, and it is NOT plain: the system's own mishap
  // tables store real markup in `description` with an empty `name` — e.g.
  // `<b>Explosion!</b> You take [[/r 1d8]] damage`. Escaping it printed the
  // tags at the player verbatim (`<b>Explosion!</b>`).
  //
  // The per-field split mirrors core's own result template
  // (templates/sheets/roll-table/result-details.hbs): `name` is rendered
  // escaped (`{{result.name}}`) and only `description` is enriched
  // (`{{{result.description}}}`). So markup in a `name` still cannot inject.
  //
  // `secrets: false` because a chat card is ONE stored HTML blob shared by
  // every reader — enriching with the roller's ownership would publish
  // GM-only secret blocks to the table. v14 REMOVES those sections rather
  // than hiding them (foundry.mjs:35233), so a secret-only row enriches to
  // nothing; the `.filter(Boolean)` below drops it instead of leaving a
  // blank line in the card.
  //
  // Settled per result, as core does (foundry.mjs:58295): a bad `@UUID[…]`
  // in a world table rejects enrichment, and one broken row must degrade to
  // nothing rather than take the whole card down with it.
  //
  // This is not a hole: the values carrying untrusted input are the
  // interpolated NAMES below, and those are still escaped. Table content is
  // authored by the GM or shipped by the system — exactly what core renders
  // unescaped in its own table card.
  const settled = await Promise.allSettled((draw.results ?? []).map(async r => {
    if (r.name) return esc(r.name);
    if (!r.description) return "";
    return foundry.applications.ux.TextEditor.implementation
      .enrichHTML(String(r.description), { relativeTo: r, secrets: false });
  }));
  const drawn = [];
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      console.warn(`${MODULE_ID} | mishap result could not be enriched; dropping that row`,
        outcome.reason);
      continue;
    }
    const html = String(outcome.value ?? "").trim();
    if (html) drawn.push(html);
  }

  // The flavor line still interpolates actor/table names into the card's HTML.
  const flavor = game.i18n.format(actor ? "SDE.mishap.rolled" : "SDE.mishap.rolledNoActor", {
    name: esc(actor?.name),
    tier: esc(tier),
    tableName: esc(tableDoc.name),
  });
  const content = [`<p>${flavor}</p>`,
    ...drawn.map(html => `<div class="sde-mishap-result">${html}</div>`)].join("");

  const messageData = { content };
  // Set the speaker from the actor when there is one; otherwise the message
  // posts under the current user.
  if (actor) messageData.speaker = ChatMessage.getSpeaker({ actor });
  // Attach the evaluated draw roll so Dice So Nice still animates it.
  if (draw.roll) messageData.rolls = [draw.roll];
  ChatMessage.applyRollMode(messageData, game.settings.get("core", "rollMode"));
  await ChatMessage.create(messageData);
}

export function init() {
  Hooks.on("createChatMessage", async (message) => {
    if (!game.settings.get(MODULE_ID, SETTING)) return;
    // createChatMessage fires on every client — only the one GM that owns
    // world writes may draw, or each connected GM posts its own mishap.
    if (!(game.user.isGM && game.users.activeGM?.id === game.user.id)) return;

    const mishap = await detectMishap(message);
    if (!mishap) return;

    await rollMishapTable(mishap.tier, mishap.actor, mishap.classSlug);
  });
}
