import test from "node:test";
import assert from "node:assert/strict";
import { TASKS, taskDefinitions, selectTask, carryOver, lockCamp, torchPlan, fireDecision, fireAlive, cookGrant, cookHp, cookExpiry } from "../scripts/camping/camping-core.mjs";

test("eight optional tasks, correct stat choices and no-fire disadvantage", () => {
  assert.deepEqual(TASKS.map(t => [t.key, t.abilities, t.campfire]), [
    ["battenDown", ["wis", "con"], true], ["cook", ["int", "wis"], true], ["craft", ["dex"], true],
    ["entertain", ["cha"], true], ["firewood", ["str", "con"], false], ["hunt", ["str", "dex"], false],
    ["keepWatch", ["wis"], true], ["predict", ["int", "wis"], false],
  ]);
  assert.ok(TASKS.every(t => t.dc === 12));
});
test("custom definitions are retained without mutating their input", () => {
  const custom = [{ key: "sing", name: "Sing", description: "Custom", abilities: ["CHA"], dc: 9 }];
  const tasks = taskDefinitions(custom);
  assert.equal(tasks.length, 9); assert.equal(tasks[8].description, "Custom"); assert.deepEqual(custom[0].abilities, ["CHA"]);
});
const setup = () => ({ phase: "setup", tasks: taskDefinitions(), participants: ["A", "B"].map(uuid => ({ uuid, confirmed: true, participate: true, task: "" })) });
test("one task per PC; duplicates allowed; task fields lock before rolls", () => {
  let camp = selectTask(setup(), "A", { task: "cook", ability: "wis" });
  camp = selectTask(camp, "B", { task: "cook", ability: "int" });
  camp = lockCamp(camp); assert.equal(camp.phase, "firewood");
  assert.throws(() => selectTask(camp, "A", { task: "hunt" }));
  assert.throws(() => selectTask(setup(), "A", { task: "cook", ability: "str" }));
  assert.throws(() => selectTask(setup(), "A", { task: "entertain", recipientUuid: "A" }));
  assert.throws(() => lockCamp(selectTask(setup(), "A", { task: "craft", craft: "repair" })));
});
test("shared-first exact torch cost then the PC holding the most, never partial", () => {
  const stacks = [{ actorUuid: "P", id: "s", quantity: 1 }, { actorUuid: "A", id: "a", quantity: 3 }, { actorUuid: "B", id: "b", quantity: 4 }];
  assert.deepEqual(torchPlan(stacks, "P", [{ uuid: "A" }, { uuid: "B" }]).deductions, [
    { actorUuid: "P", id: "s", quantity: 1 }, { actorUuid: "B", id: "b", quantity: 2 },
  ]);
  assert.deepEqual(torchPlan(stacks.slice(0, 1), "P", [{ uuid: "A" }]).deductions, []);
  assert.equal(torchPlan(stacks.slice(0, 1), "P", [{ uuid: "A" }]).available, 1);
  assert.equal(torchPlan(stacks.slice(0, 1), "P", []).ok, false);
});
test("fire expires after eight hours or when no PC remains near", () => {
  assert.equal(fireAlive({ started: 10, lit: true }, 11, true), true);
  assert.equal(fireAlive({ started: 10, lit: true }, 28810, true), false);
  assert.equal(fireAlive({ started: 10, lit: true }, 11, false), false);
});
test("Firewood success is free and failure explicitly waits for fallback", () => {
  const c = setup(); c.fuel = "wood"; c.participants[0].task = "firewood";
  assert.equal(fireDecision(c, [{ task: "firewood", success: true }]), "wood");
  assert.equal(fireDecision(c, [{ task: "firewood", success: false }]), "fuel");
  c.fuel = "none"; assert.equal(fireDecision(c, [{ task: "firewood", success: false }]), "fuel");
  c.participants[0].task = ""; assert.equal(fireDecision(c, []), "none");
});
test("every owner's participation choice is required before locking", () => {
  const c = setup(); c.participants[1].confirmed = false;
  assert.throws(() => lockCamp(c));
  assert.equal(lockCamp(selectTask(c, "B", { task: "" })).phase, "firewood");
});
test("Cook grants once only after eligible rest with unchanged max", () => {
  assert.equal(cookGrant({ value: 3, max: 3 }, null, "camp", 10, false), null);
  const grant = cookGrant({ value: 3, max: 3 }, null, "camp", 10, true);
  assert.equal(grant.value, 5); assert.equal(grant.benefit.remaining, 2); assert.equal(grant.benefit.expires, 86410);
  assert.equal(cookGrant({ value: 5, max: 3 }, grant.benefit, "camp", 11, true), null);
  assert.equal(cookGrant({ value: 5, max: 3 }, grant.benefit, "next", 11, true), null);
});
test("on a calendar with other hours or days the meal lasts its day and the fire eight of its hours", () => {
  const hour = 100 * 60, day = 26 * hour;   // 100-minute hours, 26-hour days
  assert.equal(cookGrant({ value: 3, max: 3 }, null, "camp", 10, true, day).benefit.expires, 10 + day);
  assert.equal(fireAlive({ started: 10, lit: true }, 28810, true, hour), true, "8 of its hours, not 8 of ours");
  assert.equal(fireAlive({ started: 10, lit: true }, 9 + 8 * hour, true, hour), true);
  assert.equal(fireAlive({ started: 10, lit: true }, 10 + 8 * hour, true, hour), false, "not a third of a 26-hour day");
});
test("Cook surplus spends first; healing preserves unspent but cannot restore spent bonus", () => {
  const b = cookGrant({ value: 3, max: 3 }, null, "camp", 10, true).benefit;
  const one = cookHp({ value: 5, max: 3 }, b, 1); assert.equal(one.value, 4); assert.equal(one.benefit.remaining, 1);
  const heal = cookHp({ value: 4, max: 3 }, one.benefit, -5); assert.equal(heal.value, 4);
  const spent = cookHp({ value: 4, max: 3 }, one.benefit, 3); assert.equal(spent.value, 1);
  assert.equal(cookHp({ value: 1, max: 3 }, spent.benefit, -9).value, 3);
  assert.equal(cookExpiry({ value: 4, max: 3 }, one.benefit, 86410).value, 3);
  assert.equal(cookExpiry({ value: 1, max: 3 }, spent.benefit, 86410).value, 1);
  assert.equal(cookExpiry({ value: 4, max: 3 }, one.benefit, 86409), null);
});

test("a new camp starts from the last night's fuel and tasks, and drops what no longer fits", () => {
  const tasks = taskDefinitions();
  const person = (uuid, extra = {}) => ({ uuid, actorId: uuid, confirmed: true, task: "", ability: null, craft: "torch", watchHalf: "first", ...extra });
  const fresh = { phase: "setup", fuel: "none", tasks, participants: [person("a"), person("b"), person("c"), person("d")] };
  const last = { phase: "complete", fuel: "torches", participants: [
    person("a", { task: "hunt", ability: "dex" }),
    person("b", { task: "craft", craft: "repair", repairItemId: "gone" }),
    person("c", { task: "entertain", ability: "cha", recipientUuid: "left" }),
    person("e", { task: "keepWatch", ability: "wis", watchHalf: "second" }),
  ] };
  const next = carryOver(fresh, last);
  assert.equal(next.fuel, "torches");
  assert.deepEqual([next.participants[0].task, next.participants[0].ability], ["hunt", "dex"]);
  assert.deepEqual([next.participants[1].task, next.participants[1].craft, next.participants[1].repairItemId], ["craft", "torch", undefined]);
  assert.equal(next.participants[2].task, "", "a recipient who left the party means the task is chosen again");
  assert.equal(next.participants[3].task, "");
  assert.equal(carryOver(fresh, null), fresh);
});
