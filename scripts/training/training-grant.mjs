/**
 * Regional Training — the impure half: find the GM's imported benefits table,
 * read the book's own line out of it, and put a Talent on the character.
 *
 * The split from training-core.mjs is the usual one in this module: recipes and
 * "once each" bookkeeping are pure and node-tested; everything that touches a
 * document lives here.
 *
 * Every benefit grants a Talent, mechanical or not. A benefit this module can
 * compute also carries Active Effect changes and may run a one-time action; a
 * benefit it cannot carries the trainer's name, the book's line, and a plain
 * sentence saying what the GM still does by hand. Nothing is silently dropped
 * and nothing is silently invented — the same contract pit-fighting keeps when
 * an imported table is missing.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";
import { esc } from "../shared/esc.mjs";
import { benefitFor, trainerByKey } from "./training-core.mjs";
import { trainerArt } from "./training-art.mjs";

/** Our bookkeeping block on a granted Talent. One flag, one shape. */
export const TRAINING_FLAG = "regionTraining";

const ICON = "icons/sundries/scrolls/scroll-writing-tan-red.webp";

/* ────────────────────────────────────────────────────────────────────────── */
/* The GM's own tables                                                        */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Find an imported benefits table by the name the importer gives it.
 *
 * By NAME, not by manifest id, and that is deliberate: a suite import stamps no
 * per-member manifest id, so only a handful of tables in a real world carry one
 * (3 of 207 in the world this was built against). The tolerated prefix is the
 * suite's `Source - Name` form, which contested table names still keep.
 *
 * The pack is searched before world tables so a GM's own copy wins only when
 * the managed pack has none — same precedence as findBoutTable.
 *
 * @param {string} name
 * @returns {Promise<RollTable|null>}
 */
export async function findBenefitsTable(name) {
  const wanted = String(name ?? "").trim();
  if (!wanted) return null;
  const matches = (n) => n === wanted || n.endsWith(` - ${wanted}`);

  const pack = findSuitePack("sde-tables");
  if (pack) {
    const index = pack.index?.size ? pack.index : await pack.getIndex();
    const hit = index.find((e) => matches(String(e.name ?? "")));
    if (hit) return pack.getDocument(hit._id);
  }
  return game.tables?.find((t) => matches(String(t.name ?? ""))) ?? null;
}

/**
 * The text a TableResult shows.
 *
 * `name` first, then `description`: v14 maps a legacy `text` field onto
 * `description`, so a table imported by an older path carries its row in one
 * field and a table imported by a newer path carries it in the other. Reading
 * `_source.text` instead would fire the deprecation getter.
 */
function _resultText(result) {
  return String(result?.name || result?.description || "").trim();
}

/**
 * The book's own line for one d4 face, read out of the GM's table.
 *
 * Returns "" when the table is missing or the face has no row. The caller shows
 * our own compressed label in that case rather than inventing the book's words.
 */
export async function benefitText(trainer, roll) {
  const table = await findBenefitsTable(trainer?.table);
  if (!table) return "";
  const face = Number(roll);
  const hit = table.results.find((r) => {
    const [lo, hi] = r.range ?? [];
    return Number(lo) <= face && face <= Number(hi ?? lo);
  });
  return _resultText(hit);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* "Once each"                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The d4 faces this character has already been taught by one trainer.
 *
 * Read off the Talents themselves rather than a counter on the actor: the
 * Talent IS the record, so deleting it correctly frees the benefit to be
 * learned again, and nothing can drift out of step with what the sheet shows.
 */
export function takenRolls(actor, trainerKey) {
  const out = [];
  for (const item of actor?.items ?? []) {
    const flag = item.getFlag?.(MODULE_ID, TRAINING_FLAG);
    if (flag?.trainer === trainerKey && Number.isFinite(Number(flag.roll))) {
      out.push(Number(flag.roll));
    }
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* One-time actions                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

/** Roll a formula and return the integer total. */
async function _total(formula) {
  const roll = await new Roll(String(formula)).evaluate();
  return Math.trunc(Number(roll.total) || 0);
}

/**
 * Run one recipe action against the actor, returning a line for the chat card.
 *
 * Each action is a write the granted Talent cannot express as an effect: a
 * permanent HP gain, a renown award, or an item the character now owns. They
 * are separated from `changes` so that re-granting is impossible to do by
 * accident — an action runs once, on the grant, and "once each" is what stops
 * it running twice.
 */
async function _runAction(actor, action) {
  switch (action?.type) {
    case "hp": {
      // `hp.max`, not `hp.base`: base is a LEGACY field that PlayerSD.migrateData
      // folds into max, and it is not in the schema — writing it is silently
      // dropped. Current HP moves with max, because a character who trains for
      // three extra hit points has them now, not after the next rest.
      const gained = await _total(action.formula);
      const hp = actor.system?.attributes?.hp ?? {};
      await actor.update({
        "system.attributes.hp.max": Number(hp.max ?? 0) + gained,
        "system.attributes.hp.value": Number(hp.value ?? 0) + gained,
      });
      return `+${gained} max HP (${action.formula}).`;
    }

    case "renown": {
      // Through the module's own award path, never `system.renown` directly, so
      // the change lands in the renown ledger with its provenance.
      const api = game.shadowdarkEnhancer?.renown;
      if (!api?.award) return `Renown +${action.value} — award it by hand.`;
      await api.award({
        actor,
        delta: Number(action.value),
        reason: "Regional training",
        source: "training",
      });
      return `+${action.value} renown.`;
    }

    case "statRoll": {
      // An ability is `{value}` and nothing else — there is no `base` to write.
      const rolled = await _total(action.formula);
      const abl = String(action.ability);
      await actor.update({ [`system.abilities.${abl}.value`]: rolled });
      return `${abl.toUpperCase()} rerolled to ${rolled} (${action.formula}).`;
    }

    case "ensureWeapon": {
      // Load-bearing for Moon Fist: its three mechanical rows key their effects
      // off this item's slugified NAME, so without the item they are inert.
      if (actor.items.some((i) => i.name === action.name)) return "";
      await actor.createEmbeddedDocuments("Item", [{
        name: action.name,
        type: "Weapon",
        img: ICON,
        // `damage` holds exactly `{oneHanded, twoHanded}`, both die strings.
        system: { damage: { oneHanded: action.damage }, range: "close", equipped: true },
        flags: { [MODULE_ID]: { [TRAINING_FLAG]: { granted: true } } },
      }]);
      return `Gained ${action.name} (${action.damage}).`;
    }

    case "ensureGear": {
      if (actor.items.some((i) => i.name === action.name)) return "";
      await actor.createEmbeddedDocuments("Item", [{
        name: action.name,
        type: "Basic",
        img: ICON,
        system: { equipped: true },
        effects: action.changes?.length
          ? [{ name: action.name, img: ICON, transfer: true, changes: action.changes }]
          : [],
        flags: { [MODULE_ID]: { [TRAINING_FLAG]: { granted: true } } },
      }]);
      return `Gained ${action.name}.`;
    }

    default:
      return "";
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* The grant                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The effective recipe once a choice is resolved.
 *
 * A `choice` benefit carries no changes of its own — the branch does. Picking
 * no branch on a two-branch benefit is a caller error, not a silent default:
 * "+2 CHA or +4 renown" has no correct guess.
 */
export function resolveChoice(benefit, choiceKey) {
  if (!benefit?.choice?.length) return benefit;
  const branch = benefit.choice.find((c) => c.key === choiceKey);
  if (!branch) return null;
  return { ...benefit, ...branch, label: `${benefit.label} — ${branch.label}` };
}

/**
 * Teach one benefit to one character.
 *
 * @param {Actor} actor
 * @param {string} trainerKey
 * @param {number} roll        the d4 face, already resolved against "once each"
 * @param {string} [choiceKey] which branch, for a two-branch benefit
 * @returns {Promise<{ok:boolean, error?:string, item?:Item, notes?:string[]}>}
 */
export async function grantBenefit(actor, trainerKey, roll, choiceKey = null) {
  const trainer = trainerByKey(trainerKey);
  const raw = benefitFor(trainerKey, roll);
  if (!trainer || !raw) return { ok: false, error: "UnknownBenefit" };

  if (takenRolls(actor, trainerKey).includes(Number(roll))) {
    return { ok: false, error: "AlreadyTaught" };
  }

  const benefit = resolveChoice(raw, choiceKey);
  if (!benefit) return { ok: false, error: "ChoiceRequired" };

  // The book's own wording when the GM has imported the table; our compressed
  // label when they have not. Never both, and never a sentence we made up and
  // presented as the book's.
  const printed = await benefitText(trainer, roll);
  const body = printed || benefit.label;

  const description = [
    `<p>${esc(body)}</p>`,
    `<p><em>Taught by ${esc(trainer.trainer)} — ${esc(trainer.topic)} training`
      + `${trainer.region ? `, ${esc(trainer.region)}` : ""} (pg. ${trainer.page}).</em></p>`,
    benefit.todo ? `<p><strong>At the table:</strong> ${esc(benefit.todo)}</p>` : "",
  ].filter(Boolean).join("");

  // The Talent goes on BEFORE the actions: it is the once-each record that
  // takenRolls reads. Created after them, a failure here would leave the HP or
  // renown paid with the face still open, and a retry would pay it twice.
  // The trainer's own emblem, so a sheet full of trainings reads at a glance
  // instead of showing the same scroll four times over.
  const [item] = await actor.createEmbeddedDocuments("Item", [{
    name: `${trainer.topic} Training: ${benefit.label}`,
    type: "Talent",
    img: trainerArt(trainerKey) ?? ICON,
    system: { talentClass: "level", description },
    effects: benefit.changes?.length
      ? [{
        name: `${trainer.topic} Training`,
        img: ICON,
        transfer: true,
        changes: benefit.changes,
      }]
      : [],
    flags: {
      [MODULE_ID]: {
        [TRAINING_FLAG]: {
          trainer: trainerKey,
          roll: Number(roll),
          choice: choiceKey ?? null,
          page: trainer.page,
        },
      },
    },
  }]);

  // An action that fails now leaves the face spent and the reward unpaid: the
  // chat card says which, and the GM applies it by hand. Never a double grant.
  const notes = [];
  for (const action of benefit.actions ?? []) {
    try {
      const line = await _runAction(actor, action);
      if (line) notes.push(line);
    } catch (err) {
      console.error(`${MODULE_ID} | training action failed`, action, err);
      notes.push(`Could not apply "${esc(benefit.label)}" automatically `
        + `(${esc(err?.message ?? err)}); apply it by hand.`);
    }
  }

  return { ok: true, item, notes };
}
