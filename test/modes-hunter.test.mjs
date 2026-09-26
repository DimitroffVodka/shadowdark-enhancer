import test from "node:test";
import assert from "node:assert/strict";
import { hunterXp, hunterAward } from "../scripts/modes-of-play/hunter.mjs";

test("a monster is worth half its level rounded down, level 1 is worth 1, level 0 nothing", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(hunterXp), [0, 1, 1, 1, 2, 2, 4]);
  assert.equal(hunterXp(undefined), 0);
  assert.equal(hunterXp(-1), 0);
});

const pc = (id) => ({ type: "Player", name: id, actorId: id, defeated: false });
const npc = (name, level, defeated = true) => ({ type: "NPC", name, level, defeated, actorId: `a-${name}` });

test("a level 5 and a level 1 defeated pay each PC in the fight 3, listed by name", () => {
  const out = hunterAward([pc("ana"), pc("bo"), npc("Ogre", 5), npc("Goblin", 1)]);
  assert.equal(out.total, 3);
  assert.deepEqual(out.pcIds, ["ana", "bo"]);
  assert.deepEqual(out.monsters, [{ name: "Ogre", count: 1, xp: 2 }, { name: "Goblin", count: 1, xp: 1 }]);
});

test("only monsters still defeated at the end, and never a level 0 one, count", () => {
  const out = hunterAward([pc("ana"), npc("Goblin", 1), npc("Goblin", 1), npc("Goblin", 1, false), npc("Rat", 0)]);
  assert.equal(out.total, 2);
  assert.deepEqual(out.monsters, [{ name: "Goblin", count: 2, xp: 2 }]);
});

test("a PC listed twice is paid once; defeated PCs are not monsters", () => {
  const out = hunterAward([pc("ana"), pc("ana"), { ...pc("bo"), defeated: true }, npc("Wolf", 2)]);
  assert.deepEqual(out.pcIds, ["ana", "bo"]);
  assert.equal(out.total, 1);
});

test("a dead PC is paid nothing; a dying one still is (#181)", () => {
  const out = hunterAward([pc("ana"), { ...pc("bo"), defeated: true, dead: true }, { ...pc("cy"), defeated: true }, npc("Wolf", 2)]);
  assert.deepEqual(out.pcIds, ["ana", "cy"]);
  assert.equal(out.total, 1);
});

test("nothing defeated pays nothing", () => {
  assert.deepEqual(hunterAward([pc("ana"), npc("Troll", 7, false)]), { total: 0, monsters: [], pcIds: ["ana"] });
  assert.deepEqual(hunterAward(), { total: 0, monsters: [], pcIds: [] });
});

test("friendly and hidden combatants pay nothing, even when down", () => {
  const out = hunterAward([pc("ana"), { ...npc("Skeleton", 2), friendly: true }, { ...npc("Lurker", 4), hidden: true }, npc("Orc", 2)]);
  assert.equal(out.total, 1);
  assert.deepEqual(out.monsters.map((m) => m.name), ["Orc"]);
});
