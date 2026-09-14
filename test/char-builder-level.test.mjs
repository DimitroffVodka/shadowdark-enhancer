import test from "node:test";
import assert from "node:assert/strict";
import {
  CharBuilderState,
  applyLevelChange,
  extraTalentLevels,
  levelTalentKey,
} from "../scripts/char-builder/state.mjs";
import { hpFromDice, MAX_CHAR_LEVEL } from "../scripts/char-builder/constants.mjs";

/** A build sitting at `level` with its talent rolls made and spells picked. */
function buildAt(level, { spells = [], memo = false } = {}) {
  const st = new CharBuilderState({});
  st.level = level;
  st.hp = { max: 22, rolled: 16, bonus: 0, dice: [6, 5, 5] };
  st.classTalentRoll = { total: 7, options: [], textResult: "+1 to melee attacks" };
  st.classTalents = [{ uuid: "Compendium.x.Item.lvl1", name: "Level 1 Talent" }];
  st.bonusRolls = [
    { key: "extra-talent", total: 4, options: [], chosenUuid: "u-amb", chosenName: "Ambitious" },
    ...extraTalentLevels(level).map((l) => ({
      key: levelTalentKey(l), total: 8, options: [], chosenUuid: `u-${l}`, chosenName: `Talent ${l}`,
    })),
  ];
  st.spells = spells;
  if (memo) {
    st.talentMemo = {
      "Compendium.x.Item.otherClass": {
        classTalents: [], classTalentRoll: null, talentChoices: {},
        hp: { max: 19, rolled: 13, bonus: 0, dice: [5, 4, 4] },
        bonusRolls: extraTalentLevels(level).map((l) => ({ key: levelTalentKey(l), chosenUuid: `m-${l}` })),
      },
    };
  }
  return st;
}

const keys = (st) => st.bonusRolls.map((b) => b.key);

test("a talent roll is due at every odd level, level 1's living outside the bonus rolls", () => {
  assert.deepEqual(extraTalentLevels(1), []);
  assert.deepEqual(extraTalentLevels(2), []);
  assert.deepEqual(extraTalentLevels(3), [3]);
  assert.deepEqual(extraTalentLevels(5), [3, 5]);
  assert.deepEqual(extraTalentLevels(MAX_CHAR_LEVEL), [3, 5, 7, 9]);
  // Level 5 = three rolls in total: level 1's own, plus these two.
  assert.equal(extraTalentLevels(5).length + 1, 3);
});

test("dropping 5 → 3 trims the rolls and spells the lower level no longer allows", () => {
  const st = buildAt(5, {
    spells: [
      { uuid: "s1", name: "Magic Missile", tier: 1 },
      { uuid: "s2", name: "Light", tier: 1 },
      { uuid: "s3", name: "Sleep", tier: 1 },
      { uuid: "s4", name: "Web", tier: 2 },
      { uuid: "s5", name: "Fireball", tier: 3 },
    ],
    memo: true,
  });

  // Level-3 wizard: three tier-1, one tier-2, no tier-3 yet.
  applyLevelChange(st, 3, { 1: 3, 2: 1, 3: 0, 4: 0, 5: 0 });

  assert.equal(st.level, 3);
  assert.deepEqual(keys(st), ["extra-talent", levelTalentKey(3)]);
  assert.deepEqual(st.spells.map((s) => s.uuid), ["s1", "s2", "s3", "s4"]);
  // Level 1's own roll is untouched — it is due at every level.
  assert.equal(st.classTalents.length, 1);
  assert.ok(st.classTalentRoll);
  // HP must be re-rolled for the new number of hit dice.
  assert.deepEqual(st.hp, { max: 0, rolled: null });
  // …and the remembered other-class snapshot is trimmed the same way, or
  // switching back to it would restore the level-5 rolls just dropped.
  const memo = st.talentMemo["Compendium.x.Item.otherClass"];
  assert.deepEqual(memo.bonusRolls.map((b) => b.key), [levelTalentKey(3)]);
  assert.deepEqual(memo.hp, { max: 0, rolled: null });
});

test("raising 3 → 5 keeps what was rolled and leaves the new rolls outstanding", () => {
  const st = buildAt(3, { spells: [{ uuid: "s1", name: "Light", tier: 1 }] });

  applyLevelChange(st, 5, { 1: 4, 2: 2, 3: 1, 4: 0, 5: 0 });

  assert.equal(st.level, 5);
  // Nothing dropped; the level-5 roll simply isn't there yet, so the class
  // step's bonus-roll gate keeps Finish blocked until it is made.
  assert.deepEqual(keys(st), ["extra-talent", levelTalentKey(3)]);
  assert.ok(!keys(st).includes(levelTalentKey(5)));
  assert.deepEqual(st.spells.map((s) => s.uuid), ["s1"]);
  assert.deepEqual(st.hp, { max: 0, rolled: null });
});

test("a non-caster level change leaves spells alone", () => {
  const st = buildAt(5, { spells: [{ uuid: "s1", name: "Light", tier: 1 }] });
  applyLevelChange(st, 3, null);
  assert.deepEqual(st.spells.map((s) => s.uuid), ["s1"]);
});

test("a fresh build starts at level 1", () => {
  assert.equal(new CharBuilderState({}).level, 1);
});

test("CON lands on the first hit die only, floored at 1", () => {
  // Level 1, pg 14: one die + CON, minimum 1 total.
  assert.equal(hpFromDice([5], 2), 7);
  assert.equal(hpFromDice([1], -3), 1);
  assert.equal(hpFromDice([2], -4), 1);
  // Levels after, pg 39: "roll your class's hit points die and add it to your
  // maximum HP" — no CON, which is what the system's LevelUpSD does too.
  assert.equal(hpFromDice([5, 3, 7], 2), 7 + 3 + 7);
  assert.equal(hpFromDice([1, 1, 1], -3), 1 + 1 + 1);
  assert.equal(hpFromDice([], 2), 0);
});
