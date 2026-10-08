import test from "node:test";
import assert from "node:assert/strict";
import { damageOf, plainEffect, trapFromTexts, canSpring, checkOf, trapCard, chanceOf, parseTrapText, trapIntro, blocksHeldMove } from "../scripts/traps/trap-core.mjs";

test("damageOf finds the first dice expression", () => {
  assert.equal(damageOf("2d6 damage, DC 12 save"), "2d6");
  assert.equal(damageOf("[[/r 3d10]] / petrify"), "3d10");
  assert.equal(damageOf("1d8 + 2 fire"), "1d8+2");
  assert.equal(damageOf("The floor drops away"), "");
  assert.equal(damageOf(undefined), "");
});

test("plainEffect drops the rolls and keeps a link's label", () => {
  assert.equal(plainEffect("[[/r 1d6]]"), "");
  assert.equal(plainEffect("[[/r 1d6]] / @UUID[Compendium.shadowdark.spell-effects.abc]{Sleep}"), "Sleep");
  assert.equal(plainEffect("[[/r 2d8]] / confuse"), "confuse");
  assert.equal(plainEffect("Falls away"), "Falls away");
});

test("one row of each system table becomes a trap record", () => {
  assert.deepEqual(
    trapFromTexts([" Hail of needles ", "Opening a door", "[[/r 2d8]] / @UUID[Compendium.x.y.z]{Paralyze}"]),
    { trap: "Hail of needles", trigger: "Opening a door", effect: "Paralyze", damage: "2d8" },
  );
  assert.deepEqual(trapFromTexts(), { trap: "", trigger: "", effect: "", damage: "" });
});

test("a sprung trap stays quiet unless it resets", () => {
  assert.equal(canSpring({ sprung: false, resets: false }), true);
  assert.equal(canSpring({ sprung: true, resets: false }), false);
  assert.equal(canSpring({ sprung: true, resets: true }), true);
});

test("a check needs a known ability and a DC above zero", () => {
  assert.deepEqual(checkOf({ checkAbility: "dex", checkDc: 12 }), { ability: "dex", dc: 12 });
  assert.deepEqual(checkOf({ checkAbility: "wis", checkDc: "15" }), { ability: "wis", dc: 15 });
  assert.equal(checkOf({ checkAbility: "", checkDc: 12 }), null);
  assert.equal(checkOf({ checkAbility: "luck", checkDc: 12 }), null);
  assert.equal(checkOf({ checkAbility: "dex", checkDc: 0 }), null);
  assert.equal(checkOf({ checkAbility: "dex" }), null);
});

const l = { trigger: "Trigger", effect: "Effect", damage: "Damage", fallbackName: "Trap", check: (a, dc) => `${a} check, DC ${dc}` };

test("the card escapes text, asks for the check, rolls the damage, and omits GM notes", () => {
  const html = trapCard({
    trap: "<b>Pit</b>", trigger: "Step", effect: "Fall", damage: "2d6", gmNotes: "secret", checkAbility: "dex", checkDc: 12,
  }, "Brak", l);
  assert.match(html, /&lt;b&gt;Pit&lt;\/b&gt;/);
  assert.match(html, /DEX check, DC 12/);
  assert.match(html, /\[\[request 12 dex\]\]/);
  assert.match(html, /\[\[\/r 2d6\]\]/);
  assert.match(html, /Brak/);
  assert.doesNotMatch(html, /secret/);
  assert.match(trapCard({}, "", l), /Trap/);
});

test("no check line when the trap asks for none", () => {
  assert.doesNotMatch(trapCard({ trap: "Pit", checkAbility: "" , checkDc: 12 }, "", l), /request/);
});

test("a chance is read the way the books write it", () => {
  assert.deepEqual(chanceOf("1:6"), { n: 1, d: 6 });
  assert.deepEqual(chanceOf(" 2 : 6 "), { n: 2, d: 6 });
  for (const bad of ["", "always", "6:6", "0:6", "1:", undefined]) assert.equal(chanceOf(bad), null, String(bad));
});

// Invented lines in the shapes adventures print their traps in (the repo carries no book text).
test("a trap that repeats each round is read with its check, damage and name", () => {
  const t = parseTrapText("Floor. Mossy sinkhole trap. The stone is slick over the area. DC 13 DEX to escape, 1d6 damage/round.");
  assert.deepEqual(
    { name: t.trap, ability: t.checkAbility, dc: t.checkDc, damage: t.damage, when: t.when, chance: t.chance },
    { name: "Mossy sinkhole trap", ability: "dex", dc: 13, damage: "1d6", when: "round", chance: "" },
  );
});

test("a label that names the trap is kept, a generic one is replaced by the next sentence", () => {
  assert.equal(parseTrapText("Stalagmites. Spitting and bubbling.").trap, "Stalagmites");
  assert.equal(parseTrapText("Trap. The door locks and gas fills the room. DC 15 CON or 1d4/round.").trap, "The door locks and gas fills the room");
  assert.equal(parseTrapText("Trap.").trap, "Trap");
});

test("an 'X or damage' check and a per-round chance are both read", () => {
  const t = parseTrapText("Trap. Steam vents hiss, 1:6 chance per round of a scalding gout (DC 12 DEX or 1d4 damage).");
  assert.equal(t.checkAbility, "dex");
  assert.equal(t.checkDc, 12);
  assert.equal(t.damage, "1d4");
  assert.equal(t.when, "round");
  assert.equal(t.chance, "1:6");
});

test("a trap with no check or damage keeps the defaults and the whole line as its effect", () => {
  const line = "River. 10' deep, with a fast current that carries swimmers off.";
  assert.deepEqual(parseTrapText(line), {
    trap: "River", trigger: "", effect: line, checkAbility: "none", checkDc: 12, damage: "", holds: false, when: "enter", chance: "",
  });
});

test("a long name is cut and empty text is harmless", () => {
  assert.ok(parseTrapText(`Trap. ${"A".repeat(80)}.`).trap.length <= 60);
  assert.equal(parseTrapText(undefined).trap, "");
});

test("the intro of a roll card lists the trigger, effect and damage, leaving out what is blank", () => {
  assert.deepEqual(trapIntro({ trigger: "A lever", effect: " Gas ", damage: "1d4" }, l), ["Trigger: A lever", "Effect: Gas", "Damage: 1d4"]);
  assert.deepEqual(trapIntro({ effect: "Gas" }, l), ["Effect: Gas"]);
  assert.deepEqual(trapIntro(undefined, l), []);
});

test("a check given 'to escape' makes a trap that holds whoever it catches; an 'or damage' check does not", () => {
  const sink = parseTrapText("Floor. Sticky tar pit trap. DC 12 DEX to escape, 1d6 damage/round.");
  assert.deepEqual({ holds: sink.holds, when: sink.when, damage: sink.damage, ability: sink.checkAbility, dc: sink.checkDc }, { holds: true, when: "round", damage: "1d6", ability: "dex", dc: 12 });
  assert.equal(parseTrapText("Trap. Gas seeps in. DC 15 CON or 1d4/round.").holds, false);
  assert.equal(parseTrapText("Trap. Falling net. DC 13 DEX to avoid.").holds, false);
});

test("the intro says so when a trap holds", () => {
  const l2 = { ...l, held: "Caught." };
  assert.deepEqual(trapIntro({ effect: "Tar", holds: true }, l2), ["Effect: Tar", "Caught."]);
  assert.deepEqual(trapIntro({ effect: "Tar" }, l2), ["Effect: Tar"]);
});

test("a held token's move is blocked only for a player, only while the trap still has it inside", () => {
  const held = { held: true, stillInside: true, isGM: false, movesPosition: true };
  assert.equal(blocksHeldMove(held), true);
  assert.equal(blocksHeldMove({ ...held, isGM: true }), false, "a GM can always move it");
  assert.equal(blocksHeldMove({ ...held, stillInside: false }), false, "a trap that is gone or left behind lets go");
  assert.equal(blocksHeldMove({ ...held, movesPosition: false }), false, "only a change of position");
  assert.equal(blocksHeldMove({ ...held, held: false }), false);
  assert.equal(blocksHeldMove(), false);
});
