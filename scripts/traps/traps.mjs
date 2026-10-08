/**
 * Shadowdark Enhancer — traps for map making.
 *
 * A trap is a Scene Region with a `shadowdark-enhancer.trap` behavior. The Region
 * is the trigger area, so the GM draws and reshapes it with Foundry's own Region
 * tools and gives it the trap behavior from its config like any other; the
 * behavior's form carries a "Roll a random trap" button that fills it from the
 * Shadowdark system's own Trap tables (the Core Rulebook's generator). The trap fires when a token moves in (once), on entry and
 * every round after (a crawl round, or a combat round in a fight), or only when the GM springs it. One
 * GM client (the active GM's working tab, `isActiveGM`) posts the card to chat. With a check the card has a Roll link for each character caught: their
 * owners roll, the card shows who passed and who failed, and each who failed takes the damage. An entry trap
 * is then marked sprung unless it resets. Re-arm it by clearing "Sprung". Regions are GM-only unless made always visible,
 * so a trap stays hidden by default.
 *
 * Registered in `i18nInit` (see shadowdark-enhancer.mjs), before the world's
 * documents are built; module sub-types are declared in module.json.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { postRollRequest, takeTrapDamage } from "../party/party-roll.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";
import { trapFromTexts, canSpring, trapCard, trapIntro, chanceOf, checkOf, blocksHeldMove, TRAP_FIELDS } from "./trap-core.mjs";

export const TRAP_TYPE = `${MODULE_ID}.trap`;
const loc = (key) => game.i18n.localize(key);

/** The Shadowdark system's own trap generator: one table per column, in the order of a trap record. */
const SYSTEM_TRAP_TABLES = ["Trap: Trap", "Trap: Trigger", "Trap: Damage or Effect"];

/**
 * Roll the Core trap generator (the system's three Trap tables) without posting to chat.
 * @returns {Promise<{trap:string, trigger:string, effect:string, damage:string}|null>} null, with a warning, when the tables are missing
 */
export async function rollTrap() {
  const pack = game.packs.get("shadowdark.rollable-tables");
  const index = pack ? await pack.getIndex() : [];
  const texts = [];
  for (const name of SYSTEM_TRAP_TABLES) {
    const hit = index.find((e) => e.name === name);
    const table = hit ? await pack.getDocument(hit._id) : null;
    const result = table ? (await table.draw({ displayChat: false })).results[0] : null;
    if (!result) { ui.notifications?.warn(loc("SDE.trap.notify.noTable")); return null; }
    texts.push(result.description || result.name);
  }
  return trapFromTexts(texts);
}

/** The labels the card needs, localized. */
const cardLabels = () => ({
  trigger: loc("SDE.trap.card.trigger"), effect: loc("SDE.trap.card.effect"),
  damage: loc("SDE.trap.card.damage"), fallbackName: loc("SDE.trap.label"), held: loc("SDE.trap.card.held"),
  check: (ability, dc) => game.i18n.format("SDE.trap.card.check", { ability, dc }),
});

/** Post a trap's plain card, for a trap with no check or when nobody is there to ask (the check is then a request link). */
const postCard = (trap, tokenName) => ChatMessage.create({
  content: trapCard(trap, tokenName ?? "", cardLabels()),
  flags: { [MODULE_ID]: { trap: { region: trap.region?.id ?? null } } },
});

/** Is this token held by this trap? A hold is a flag on the token naming the trap's behavior. */
const heldBy = (trap, token) => (token.document ?? token).getFlag(MODULE_ID, "held")?.behavior === trap.parent?.id;

/**
 * A trap goes off for these tokens. With a check, the card has a Roll link for each character: their owners roll,
 * the card shows who passed and who failed, and (if the trap applies damage) each who failed takes it. Without
 * a check, or with no character to ask, it is the plain card.
 * A trap that holds (quicksand) works the other way round: each character is caught where they stand and takes the damage
 * at once, pass or fail; the check on the card is their escape roll, and a pass frees them.
 * @param {object} trap       the behavior's data model
 * @param {Array<TokenDocument|Token>} tokens
 */
async function springCard(trap, tokens) {
  const check = checkOf(trap);
  const name = trap.trap || loc("SDE.trap.label");
  const damageNow = trap.holds && trap.applyDamage && trap.damage;
  if (trap.holds) {
    for (const token of tokens.filter((t) => t.actor)) {
      await replaceModuleFlag(token.document ?? token, "held", { region: trap.region?.id ?? null, behavior: trap.parent?.id ?? null });
      if (damageNow) await takeTrapDamage(token.actor, trap.damage, name);
    }
  }
  const targets = tokens.map((token) => (token.actor ? { uuid: token.actor.uuid, name: token.name, token: (token.document ?? token).uuid } : null)).filter(Boolean);
  // A trap that has already dealt its damage shows it on the plain card as words, not a second roll.
  if (!check || !targets.length) return postCard(damageNow ? { ...trap, damage: "" } : trap, tokens.map((token) => token.name).join(", "));
  return postRollRequest({
    stat: check.ability, dc: check.dc, targets, heading: name, intro: trapIntro(trap, cardLabels()),
    damage: !trap.holds && trap.applyDamage ? trap.damage : "", source: name, hold: !!trap.holds,
  }, { speaker: loc("SDE.trap.label") });
}

/** A trap with a chance (1:6) fires only when its die comes up in range. */
async function chanceHolds(trap) {
  const chance = chanceOf(trap.chance);
  return !chance || (await new Roll(`1d${chance.d}`).evaluate()).total <= chance.n;
}

/**
 * A token moves into the area; `this` is the behavior's data model. Every client sees the event;
 * only the active GM's working tab acts, so a card posts (and damage lands) once.
 */
export async function onTokenMoveIn(event) {
  if (!isActiveGM() || this.when === "manual") return;
  if (this.when === "enter" && !this.holds && !canSpring(this)) return;
  // A fires-once trap is claimed before the first wait: a group entering together raises one event per token, all
  // before `sprung` is saved, and each used to post its own card and deal its own damage.
  const once = this.when === "enter" && !this.holds && !this.resets ? this.parent?.uuid ?? this.parent?.id : null;
  if (once) {
    if (springing.has(once)) return;
    springing.add(once);
  }
  try {
    if (!(await chanceHolds(this))) return;
    await springCard(this, [event.data.token]);
    if (once) await this.parent.update({ "system.sprung": true });
  } finally {
    if (once) springing.delete(once);
  }
}

/** Fires-once traps going off right now, by behavior: the claim `onTokenMoveIn` takes. */
const springing = new Set();

/** A combat round starts with a token inside the area. */
export async function onTokenRound(event) {
  if (!isActiveGM() || this.when !== "round" || (this.holds && !heldBy(this, event.data.token)) || !(await chanceHolds(this))) return;
  await springCard(this, [event.data.token]);
}

/** The crawl round advances: every token inside a round trap on the viewed scene takes it, unless a fight's own rounds are running. */
async function onCrawlRound() {
  const scene = canvas?.scene;
  if (!scene || game.combat?.started) return;
  for (const region of scene.regions) {
    for (const behavior of region.behaviors) {
      if (behavior.type !== TRAP_TYPE || behavior.disabled || behavior.system.when !== "round") continue;
      const tokens = [...region.tokens].filter((token) => !behavior.system.holds || heldBy(behavior.system, token));
      if (tokens.length && (await chanceHolds(behavior.system))) await springCard(behavior.system, tokens);
    }
  }
}

/**
 * Spring a trap by hand, whatever its setting: the shrine that fires when touched, the door that fires
 * when opened. Posts the card; nothing is marked sprung.
 * @param {RegionDocument|string} region  the region or its id (on the viewed scene)
 * @param {object} [options]
 * @param {TokenDocument} [options.token]  the one it goes off for; by default every token in the region
 * @returns {Promise<boolean>} whether a trap was found
 */
export async function springTrap(region, { token } = {}) {
  if (!game.user?.isGM) return false;
  const doc = typeof region === "string" ? canvas?.scene?.regions.get(region) : region;
  const behavior = doc?.behaviors.find((b) => b.type === TRAP_TYPE);
  if (!behavior) return false;
  await springCard(behavior.system, token ? [token] : [...doc.tokens]);
  return true;
}

/**
 * A held token cannot be moved by a player: the move is cancelled with a word to whoever tried. A hold on a trap that is gone,
 * disabled, or that the token is no longer inside lets go instead, so a stale flag never pins a character for good. The GM can
 * always move a token. A GM who moves one out of the area has freed it for the same reason (it is no longer inside, so the
 * flag is stale and the next player move clears it); one who drags a token in does not, because the trap catches it as it
 * arrives and the rest of the same drag must not undo that.
 */
function onPreUpdateToken(doc, change, options, userId) {
  const held = doc.getFlag(MODULE_ID, "held");
  if (!held || (change.x === undefined && change.y === undefined)) return undefined;
  const region = doc.parent?.regions.get(held.region), behavior = region?.behaviors.get(held.behavior);
  const stillInside = !!behavior && !behavior.disabled && region.tokens.has(doc);
  if (!stillInside && userId === game.user.id) doc.unsetFlag(MODULE_ID, "held");
  if (!blocksHeldMove({ held: true, stillInside, isGM: !!game.users.get(userId)?.isGM, movesPosition: true })) return undefined;
  if (userId === game.user.id) ui.notifications.warn(game.i18n.format("SDE.trap.held.stuck", { name: doc.name }));
  return false;
}

/** Free a held token by hand. GM only. */
export async function releaseToken(token) {
  const doc = token?.document ?? token;
  if (!game.user?.isGM || !doc?.getFlag(MODULE_ID, "held")) return false;
  await doc.unsetFlag(MODULE_ID, "held");
  return true;
}

function buildTrapModel() {
  const { fields } = foundry.data;
  return class TrapBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
    static events = {
      [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: onTokenMoveIn,
      [CONST.REGION_EVENTS.TOKEN_ROUND_START]: onTokenRound,
    };

    static defineSchema() {
      // Keys written out in full, as the i18n check requires (a LOCALIZATION_PREFIXES would build them).
      const text = (label, hint) => new fields.StringField({ required: true, label, hint });
      return {
        trap: text("SDE.trap.field.trap.label", "SDE.trap.field.trap.hint"),
        trigger: text("SDE.trap.field.trigger.label", "SDE.trap.field.trigger.hint"),
        effect: text("SDE.trap.field.effect.label", "SDE.trap.field.effect.hint"),
        // "none" is not an ability, so checkOf reads it as no check.
        checkAbility: new fields.StringField({
          required: true, initial: "dex", label: "SDE.trap.field.checkAbility.label", hint: "SDE.trap.field.checkAbility.hint",
          choices: {
            none: "SDE.trap.ability.none", str: "SDE.trap.ability.str", dex: "SDE.trap.ability.dex", con: "SDE.trap.ability.con",
            int: "SDE.trap.ability.int", wis: "SDE.trap.ability.wis", cha: "SDE.trap.ability.cha",
          },
        }),
        checkDc: new fields.NumberField({
          required: true, nullable: false, integer: true, min: 1, initial: 12,
          label: "SDE.trap.field.checkDc.label", hint: "SDE.trap.field.checkDc.hint",
        }),
        damage: text("SDE.trap.field.damage.label", "SDE.trap.field.damage.hint"),
        gmNotes: text("SDE.trap.field.gmNotes.label", "SDE.trap.field.gmNotes.hint"),
        when: new fields.StringField({
          required: true, initial: "enter", label: "SDE.trap.field.when.label", hint: "SDE.trap.field.when.hint",
          choices: { enter: "SDE.trap.when.enter", round: "SDE.trap.when.round", manual: "SDE.trap.when.manual" },
        }),
        chance: text("SDE.trap.field.chance.label", "SDE.trap.field.chance.hint"),
        holds: new fields.BooleanField({ label: "SDE.trap.field.holds.label", hint: "SDE.trap.field.holds.hint" }),
        applyDamage: new fields.BooleanField({ initial: true, label: "SDE.trap.field.applyDamage.label", hint: "SDE.trap.field.applyDamage.hint" }),
        resets: new fields.BooleanField({ label: "SDE.trap.field.resets.label", hint: "SDE.trap.field.resets.hint" }),
        sprung: new fields.BooleanField({ label: "SDE.trap.field.sprung.label", hint: "SDE.trap.field.sprung.hint" }),
      };
    }
  };
}

/** The behavior form's "Roll a random trap" button: fills the text fields in place, saved with the form's own Save. */
function addRollButton(app, html) {
  if (app.document?.type !== TRAP_TYPE) return;
  const form = html.querySelector?.("form") ?? html;
  const first = form?.querySelector?.('[name="system.trap"]');
  if (!first || form.querySelector(".sde-trap-roll")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sde-trap-roll";
  button.innerHTML = `<i class="fa-solid fa-dice"></i> ${loc("SDE.trap.roll")}`;
  button.addEventListener("click", async () => {
    const rolled = await rollTrap();
    if (!rolled) return;
    for (const key of TRAP_FIELDS) {
      const input = form.querySelector(`[name="system.${key}"]`);
      if (input && key in rolled) input.value = rolled[key];
    }
  });
  (first.closest(".form-group") ?? first).before(button);

  const spring = document.createElement("button");
  spring.type = "button";
  spring.className = "sde-trap-spring";
  spring.innerHTML = `<i class="fa-solid fa-bolt"></i> ${loc("SDE.trap.spring")}`;
  spring.addEventListener("click", () => springTrap(app.document.parent));
  button.after(spring);
}

export function registerTraps() {
  CONFIG.RegionBehavior.dataModels[TRAP_TYPE] = buildTrapModel();
  CONFIG.RegionBehavior.typeLabels[TRAP_TYPE] = "SDE.trap.label";
  CONFIG.RegionBehavior.typeIcons[TRAP_TYPE] = "fa-solid fa-triangle-exclamation";
  Hooks.on("renderRegionBehaviorConfig", addRollButton);
  Hooks.on(`${MODULE_ID}.crawlRound`, onCrawlRound);
  Hooks.on("preUpdateToken", onPreUpdateToken);
}

/**
 * Make a trap: a Region with the trap behavior on the scene. Anything not given
 * is left blank; `generate` rolls the Core table first and the given fields win.
 * @param {object} [options]
 * @param {Scene} [options.scene]       defaults to the viewed scene
 * @param {Array<{x:number,y:number}>|number[]} [options.points]  polygon corners in scene pixels; default is one square at the scene's center
 * @param {boolean} [options.generate]  fill from the system's Trap tables
 * @param {object} [options.trap]       trap, trigger, effect, checkAbility, checkDc, damage, applyDamage, holds, when, chance, gmNotes, resets
 * @returns {Promise<RegionDocument|null>}
 */
export async function createTrap({ scene = canvas?.scene, points, generate = false, trap = {} } = {}) {
  if (!game.user?.isGM || !scene) return null;
  const rolled = generate ? await rollTrap() : {};
  if (!rolled) return null;
  let shape = points;
  if (!shape?.length) {
    const size = scene.grid.size, x = scene.dimensions.sceneX + scene.dimensions.sceneWidth / 2, y = scene.dimensions.sceneY + scene.dimensions.sceneHeight / 2;
    shape = [x, y, x + size, y, x + size, y + size, x, y + size];
  }
  const flat = typeof shape[0] === "number" ? shape : shape.flatMap((p) => [p.x, p.y]);
  const system = { ...rolled, ...trap };
  const [region] = await scene.createEmbeddedDocuments("Region", [{
    name: system.trap || loc("SDE.trap.label"),
    color: "#c0392b",
    shapes: [{ type: "polygon", points: flat }],
    behaviors: [{ type: TRAP_TYPE, name: system.trap || loc("SDE.trap.label"), system }],
  }]);
  return region ?? null;
}

/**
 * Add the traps an adventure's book prints to its scene, as hidden Regions (importer/adventure/adventure-traps.mjs), and say
 * what happened. It touches no pins, creatures or walls and leaves a trap that is already there as it is, so it is safe on a
 * scene whose walls have been corrected by hand. GM only.
 * @param {Scene} [scene]  defaults to the viewed scene
 * @returns {Promise<{status:string, placed:number, existing:number, skipped:object[]}|null>}
 */
export async function placeAdventureTraps(scene = canvas?.scene) {
  if (!game.user?.isGM || !scene) return null;
  const { addSiteTraps } = await import("../importer/adventure/adventure-book-import.mjs");
  const built = await addSiteTraps(scene);
  const say = (key, data) => game.i18n.format(key, data ?? {});
  if (built.status === "not-adventure") ui.notifications.warn(say("SDE.trap.notify.notAdventure"));
  else if (built.status === "no-book") ui.notifications.warn(say("SDE.importer.pdf.bookNotLinked"));
  else if (built.status === "none") ui.notifications.info(say("SDE.adventure.placer.trapsNoData"));
  else if (built.status === "mismatch") ui.notifications.warn(say("SDE.adventure.placer.trapsMismatch"));
  else {
    if (built.placed) ui.notifications.info(say("SDE.adventure.placer.trapsDone", { placed: built.placed }));
    if (built.skipped.length) ui.notifications.warn(say("SDE.adventure.placer.trapsSkipped", { n: built.skipped.length, pins: built.skipped.map((x) => x.pin).join(", ") }));
    if (!built.placed && !built.skipped.length) ui.notifications.info(say("SDE.adventure.placer.trapsNone"));
  }
  return built;
}

export const trapsApi = () => ({
  type: TRAP_TYPE, roll: () => rollTrap(), create: (options) => createTrap(options), spring: (region, options) => springTrap(region, options),
  placeAdventure: (scene) => placeAdventureTraps(scene),
  release: (token) => releaseToken(token),
});
