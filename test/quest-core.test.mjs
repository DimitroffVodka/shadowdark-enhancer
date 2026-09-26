import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  OWNERSHIP, STATUSES,
  addObjective, canSee, defaultRecipients, makeQueue, matchesFilter, mergeQuest, normalizeQuest, objectiveProgress,
  ownershipFor, payoutPlan, pickPin, planStatusChange, playerPageHtml, removeObjective, setObjectiveDone,
  setObjectiveText, shouldPay, summarize, trainerTaskQuests, visibleStatuses,
} from "../scripts/quests/quest-core.mjs";

let n = 0;
const newId = () => `o${++n}`;
/** A stand-in translator: the key, then its data, so assertions can see both. */
const t = (key, data) => (data ? `${key}${JSON.stringify(data)}` : key);

const quest = (over = {}) => normalizeQuest({
  status: "active",
  objectives: ["Find the mill", "Burn the mill"],
  rewards: { xp: 3 },
  ...over,
}, { newId });

describe("normalizeQuest", () => {
  test("a bare call is a Hidden quest from the GM", () => {
    const q = normalizeQuest();
    assert.equal(q.status, "hidden");
    assert.deepEqual(q.source, { kind: "gm", uuid: null });
    assert.deepEqual(q.rewards, { xp: 0, renown: 0, items: [], training: null });
    assert.equal(q.paid, false);
    assert.equal(q.hex, null);
  });

  test("a bad status or source can only make a quest players cannot see", () => {
    const q = normalizeQuest({ status: "secret", source: { kind: "prophecy", uuid: "X" } });
    assert.equal(q.status, "hidden");
    assert.equal(q.source.kind, "gm");
  });

  test("a trainer task keeps its trainer and task; other sources do not grow those keys", () => {
    const q = normalizeQuest({ source: { kind: "trainer", uuid: "Compendium.x", trainer: "gladiator", task: 2 } });
    assert.deepEqual(q.source, { kind: "trainer", uuid: "Compendium.x", trainer: "gladiator", task: 2 });
    assert.deepEqual(normalizeQuest({ source: { kind: "rumor", uuid: "JournalEntry.r", trainer: "x" } }).source,
      { kind: "rumor", uuid: "JournalEntry.r" });
  });

  test("objectives from strings get ids; blank ones are dropped", () => {
    const q = normalizeQuest({ objectives: ["  Go  ", "", { text: "Return", done: true, id: "keep" }] }, { newId: () => "new" });
    assert.deepEqual(q.objectives, [{ id: "new", text: "Go", done: false }, { id: "keep", text: "Return", done: true }]);
  });

  test("rewards: XP is never negative, renown may be, and an unknown trainer is no training", () => {
    const q = normalizeQuest({ rewards: { xp: -4, renown: "-2", training: "nobody", items: [{ uuid: "Item.a", name: "Rope" }, { name: "no uuid" }] } });
    assert.deepEqual(q.rewards, { xp: 0, renown: -2, training: null, items: [{ uuid: "Item.a", name: "Rope", img: "" }] });
    assert.equal(normalizeQuest({ rewards: { training: "gladiator" } }).rewards.training, "gladiator");
  });

  test("hex is a positive whole number or null", () => {
    assert.equal(normalizeQuest({ hex: "353" }).hex, 353);
    for (const bad of ["", null, 0, -1, 3.5, "abc"]) assert.equal(normalizeQuest({ hex: bad }).hex, null, String(bad));
  });
});

describe("status transitions", () => {
  test("every status is a valid target; anything else is refused", () => {
    for (const s of STATUSES) assert.equal(planStatusChange(quest(), s).ok, true);
    assert.deepEqual(planStatusChange(quest(), "done"), { ok: false, error: "badStatus" });
  });

  test("moving to the same status changes nothing and pays nothing", () => {
    const p = planStatusChange(quest({ status: "completed" }), "completed");
    assert.equal(p.changed, false);
    assert.equal(p.pay, false);
  });

  test("ownership follows the status: Hidden is the GM's, the rest are readable", () => {
    assert.equal(planStatusChange(quest({ status: "hidden" }), "active").ownership, OWNERSHIP.OBSERVER);
    assert.equal(planStatusChange(quest(), "hidden").ownership, OWNERSHIP.NONE);
    for (const s of ["available", "active", "completed", "failed"]) assert.equal(ownershipFor(s), OWNERSHIP.OBSERVER);
  });

  test("an edit cannot move the status, the source or the paid mark", () => {
    const q = quest({ source: { kind: "rumor", uuid: "JournalEntry.r" }, paid: true });
    const m = mergeQuest(q, { status: "completed", source: { kind: "gm" }, paid: false, description: "New" });
    assert.equal(m.status, "active");
    assert.equal(m.source.kind, "rumor");
    assert.equal(m.paid, true);
    assert.equal(m.description, "New");
  });

  test("an edit to one reward keeps the others", () => {
    const m = mergeQuest(quest({ rewards: { xp: 3, renown: 1 } }), { rewards: { xp: 5 } });
    assert.equal(m.rewards.xp, 5);
    assert.equal(m.rewards.renown, 1);
  });
});

describe("objectives", () => {
  test("ticking and unticking by id; the others stay as they were", () => {
    const q = quest();
    const [a, b] = q.objectives;
    const ticked = setObjectiveDone(q, a.id, true);
    assert.deepEqual(ticked.objectives.map((o) => o.done), [true, false]);
    assert.deepEqual(setObjectiveDone(ticked, a.id, false).objectives.map((o) => o.done), [false, false]);
    assert.deepEqual(setObjectiveDone(q, "nope", true).objectives, q.objectives);
    assert.equal(b.done, false);
  });

  test("progress counts ticked ones and is complete only when all are ticked", () => {
    const q = quest();
    assert.deepEqual(objectiveProgress(q), { done: 0, total: 2, complete: false });
    const one = setObjectiveDone(q, q.objectives[0].id, true);
    assert.deepEqual(objectiveProgress(one), { done: 1, total: 2, complete: false });
    const both = setObjectiveDone(one, q.objectives[1].id, true);
    assert.deepEqual(objectiveProgress(both), { done: 2, total: 2, complete: true });
    assert.equal(objectiveProgress(quest({ objectives: [] })).complete, false);
  });

  test("adding a blank objective does nothing; blanking one removes it", () => {
    const q = quest();
    assert.equal(addObjective(q, "   ", newId), q);
    assert.equal(addObjective(q, "Report back", () => "r").objectives.at(-1).id, "r");
    assert.equal(setObjectiveText(q, q.objectives[0].id, "").objectives.length, 1);
    assert.equal(setObjectiveText(q, q.objectives[0].id, "Find the old mill").objectives[0].text, "Find the old mill");
    assert.equal(removeObjective(q, q.objectives[1].id).objectives.length, 1);
  });
});

describe("reward payout", () => {
  test("pays on the way into Completed, when something is on offer, once", () => {
    assert.equal(shouldPay(quest(), "completed"), true);
    assert.equal(planStatusChange(quest(), "completed").pay, true);
    assert.equal(shouldPay(quest({ paid: true }), "completed"), false, "Completed → Active → Completed pays once");
    assert.equal(shouldPay(quest({ rewards: {} }), "completed"), false, "nothing to pay");
    assert.equal(shouldPay(quest(), "failed"), false);
    assert.equal(shouldPay(quest({ status: "completed" }), "completed"), false);
    assert.equal(shouldPay(quest({ rewards: { training: "gladiator" } }), "completed"), true, "a training benefit is a reward");
  });

  test("default recipients: the quest's characters, else its party, else everyone", () => {
    assert.deepEqual(defaultRecipients({ characters: ["A"], partyMembers: ["B"], everyone: ["C"] }), ["A"]);
    assert.deepEqual(defaultRecipients({ partyMembers: ["B"], everyone: ["C"] }), ["B"]);
    assert.deepEqual(defaultRecipients({ everyone: ["C", "D"] }), ["C", "D"]);
  });

  test("XP and renown go in full to each recipient, items to the one picked for each", () => {
    const q = quest({ rewards: { xp: 3, renown: 2, training: "gladiator", items: [{ uuid: "Item.a", name: "A" }, { uuid: "Item.b", name: "B" }] } });
    const plan = payoutPlan(q, { recipients: ["X", "Y", "X"], itemTo: { 0: "Y", 1: "" }, trainingFor: "X" });
    assert.deepEqual(plan.xp, { amount: 3, to: ["X", "Y"] });
    assert.deepEqual(plan.renown, { delta: 2, to: ["X", "Y"] });
    assert.deepEqual(plan.items.map((i) => [i.uuid, i.to]), [["Item.a", "Y"]]);
    assert.deepEqual(plan.training, { trainer: "gladiator", actor: "X" });
  });

  test("nobody ticked pays nothing: how a GM completes a quest paid by hand", () => {
    const plan = payoutPlan(quest({ rewards: { xp: 3, renown: 1, training: "gladiator" } }), {});
    assert.deepEqual(plan, { xp: null, renown: null, items: [], training: null });
  });
});

describe("what players can see", () => {
  test("the GM sees everything, Hidden included", () => {
    assert.equal(canSee(quest({ status: "hidden" }), { isGM: true }), true);
    assert.deepEqual(visibleStatuses(true), STATUSES);
  });

  test("a player never sees Hidden, even with a permission left open by hand", () => {
    assert.equal(canSee(quest({ status: "hidden" }), { observer: true }), false);
    assert.equal(visibleStatuses(false).includes("hidden"), false);
  });

  test("a player needs the entry's own permission as well as a visible status", () => {
    assert.equal(canSee(quest({ status: "active" }), { observer: true }), true);
    assert.equal(canSee(quest({ status: "active" }), { observer: false }), false);
    assert.equal(canSee(null, { isGM: true }), false);
  });

  test("the player page escapes the GM's text, strikes ticked objectives and links item rewards", () => {
    const q = quest({
      description: "Beware <script>alert(1)</script>\n\nSee @UUID[JournalEntry.x]{the map}",
      rewards: { xp: 3, renown: 1, items: [{ uuid: "Item.a", name: "Rope & hook" }], training: "gladiator" },
    });
    const ticked = setObjectiveDone(q, q.objectives[0].id, true);
    const html = playerPageHtml(ticked, t);
    assert.ok(!html.includes("<script>"));
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /<p>See @UUID\[JournalEntry\.x\]\{the map\}<\/p>/);
    assert.match(html, /☑ <s>Find the mill<\/s>/);
    assert.match(html, /☐ Burn the mill/);
    assert.match(html, /@UUID\[Item\.a\]\{Rope &amp; hook\}/);
    assert.match(html, /SDE\.quests\.reward\.xp/);
    assert.match(html, /SDE\.quests\.reward\.training/);
  });

  test("no rewards, no rewards heading", () => {
    assert.ok(!playerPageHtml(quest({ rewards: {} }), t).includes("SDE.quests.rewards"));
  });
});

describe("list filters", () => {
  const q = (over) => summarize({ id: over.id, uuid: `JournalEntry.${over.id}`, name: over.id }, over);
  const all = [
    q({ id: "a", status: "active", party: "Actor.p1" }),
    q({ id: "b", status: "available", characters: ["Actor.m1"] }),
    q({ id: "c", status: "active", party: "Actor.p2", source: { kind: "rumor", uuid: "JournalEntry.r" } }),
  ];
  const ids = (filter, opts) => all.filter((x) => matchesFilter(x, filter, opts)).map((x) => x.id);

  test("status, as one or several", () => {
    assert.deepEqual(ids({ status: "active" }), ["a", "c"]);
    assert.deepEqual(ids({ status: ["available", "active"] }), ["a", "b", "c"]);
  });

  test("party matches the assignment; the log adds its members' personal quests", () => {
    assert.deepEqual(ids({ party: "Actor.p1" }), ["a"]);
    assert.deepEqual(ids({ party: "Actor.p1" }, { partyMembers: ["Actor.m1"] }), ["a", "b"]);
  });

  test("character, source kind and source uuid", () => {
    assert.deepEqual(ids({ character: "Actor.m1" }), ["b"]);
    assert.deepEqual(ids({ sourceKind: "rumor" }), ["c"]);
    assert.deepEqual(ids({ sourceUuid: "JournalEntry.r" }), ["c"]);
    assert.deepEqual(ids({}), ["a", "b", "c"]);
  });
});

describe("trainer tasks", () => {
  const task = (id, over) => summarize({ id }, {
    status: "available", characters: ["Actor.hero"], source: { kind: "trainer", trainer: "gladiator", task: 0 }, ...over,
  });

  test("a task taken by this character, for this trainer, is found by its index", () => {
    const map = trainerTaskQuests([
      task("a"),
      task("b", { source: { kind: "trainer", trainer: "gladiator", task: 2 }, status: "completed" }),
      task("c", { characters: ["Actor.other"], source: { kind: "trainer", trainer: "gladiator", task: 1 } }),
      task("d", { source: { kind: "trainer", trainer: "swashbuckler", task: 3 } }),
    ], { actorUuid: "Actor.hero", trainer: "gladiator" });
    assert.deepEqual([...map.keys()].sort(), [0, 2]);
  });

  test("a failed task can be taken again", () => {
    const map = trainerTaskQuests([task("a", { status: "failed" })], { actorUuid: "Actor.hero", trainer: "gladiator" });
    assert.equal(map.size, 0);
  });
});

describe("the write queue", () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  test("a double click files one quest: the second check waits for the first create", async () => {
    const queue = makeQueue();
    const store = new Map();
    let creates = 0;
    // The shape of takeTrainerTask: look for the quest, else make it, in one job.
    const take = (key) => queue(async () => {
      if (store.has(key)) return store.get(key);
      await tick();                     // the server round trip
      creates++;
      store.set(key, { id: `q${creates}` });
      return store.get(key);
    });
    const [a, b] = await Promise.all([take("gladiator:0"), take("gladiator:0")]);
    assert.equal(creates, 1);
    assert.equal(a, b);
  });

  test("jobs run in order, and one that throws does not stop the next", async () => {
    const queue = makeQueue();
    const order = [];
    const failed = queue(async () => { await tick(); order.push(1); throw new Error("boom"); });
    const next = queue(async () => { order.push(2); return "ran"; });
    await assert.rejects(failed, /boom/);
    assert.equal(await next, "ran");
    assert.deepEqual(order, [1, 2]);
  });

  test("without the queue the same double click files two (why it exists)", async () => {
    const store = new Map();
    let creates = 0;
    const take = async (key) => {
      if (store.has(key)) return store.get(key);
      await tick();
      creates++;
      store.set(key, {});
    };
    await Promise.all([take("k"), take("k")]);
    assert.equal(creates, 2);
  });
});

describe("map pins", () => {
  test("the quest's own note beats its hex pin; the scene in view beats another", () => {
    const pins = [
      { sceneId: "s2", noteId: "hexElsewhere", own: false },
      { sceneId: "s1", noteId: "hexHere", own: false },
      { sceneId: "s2", noteId: "ownElsewhere", own: true },
    ];
    assert.equal(pickPin(pins, "s1").noteId, "ownElsewhere");
    assert.equal(pickPin(pins.slice(0, 2), "s1").noteId, "hexHere");
    assert.equal(pickPin([], "s1"), null);
  });
});
