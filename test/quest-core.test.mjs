import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  OWNERSHIP, STATUSES,
  addObjective, addSubStep, canSee, dateLabel, dayChanged, deadlineState, dueChanges, timeToDate, hasNotes, hasRewards, noteLines, defaultRecipients, makeQueue, matchesFilter, mergeQuest, normalizeQuest, objectiveProgress,
  ownershipFor, payoutPlan, pickPin, planStatusChange, playerPageHtml, playerView, removeObjective, setObjectiveDone, setObjectiveSecret,
  questsAtHex, setObjectiveText, shouldPay, summarize, trainerTaskQuests, visibleStatuses,
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
    assert.deepEqual(q.rewards, { xp: 0, renown: 0, items: [], training: null, notes: [] });
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
    assert.deepEqual(q.objectives, [{ id: "new", text: "Go", done: false, parent: null, secret: false }, { id: "keep", text: "Return", done: true, parent: null, secret: false }]);
  });

  test("rewards: XP is never negative, renown may be, and an unknown trainer is no training", () => {
    const q = normalizeQuest({ rewards: { xp: -4, renown: "-2", training: "nobody", items: [{ uuid: "Item.a", name: "Rope" }, { name: "no uuid" }] } });
    assert.deepEqual(q.rewards, { xp: 0, renown: -2, training: null, notes: [], items: [{ uuid: "Item.a", name: "Rope", img: "" }] });
    assert.equal(normalizeQuest({ rewards: { training: "gladiator" } }).rewards.training, "gladiator");
  });

  test("hex is a positive whole number or null", () => {
    assert.equal(normalizeQuest({ hex: "353" }).hex, 353);
    for (const bad of ["", null, 0, -1, 3.5, "abc"]) assert.equal(normalizeQuest({ hex: bad }).hex, null, String(bad));
  });
});

describe("hex links", () => {
  test("a hex's scene is kept only with a hex, and only as text", () => {
    assert.equal(normalizeQuest({ hex: 12, hexScene: "Scene.a" }).hexScene, "Scene.a");
    assert.equal(normalizeQuest({ hex: 12 }).hexScene, null);
    assert.equal(normalizeQuest({ hex: null, hexScene: "Scene.a" }).hexScene, null);
    assert.equal(mergeQuest({ hex: 12, hexScene: "Scene.a" }, { hex: null }).hexScene, null);
  });

  test("questsAtHex: a scene-bound quest matches its own scene, an unbound one any scene", () => {
    const qs = [
      normalizeQuest({ hex: 101, hexScene: "Scene.a" }),
      normalizeQuest({ hex: 101 }),
      normalizeQuest({ hex: 101, hexScene: "Scene.b" }),
      normalizeQuest({ hex: 102, hexScene: "Scene.a" }),
      normalizeQuest({}),
    ];
    const at = (num, sceneUuid) => questsAtHex(qs, { num, sceneUuid }).map((q) => qs.indexOf(q));
    assert.deepEqual(at(101, "Scene.a"), [0, 1]);
    assert.deepEqual(at(101, "Scene.b"), [1, 2]);
    assert.deepEqual(at(null, "Scene.a"), []);
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
    assert.equal(addObjective(q, "Report back", { newId: () => "r" }).objectives.at(-1).id, "r");
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

describe("sub-steps and secret steps", () => {
  const steps = (q) => q.objectives.map((o) => `${o.parent ? "  " : ""}${o.text}${o.secret ? "*" : ""}${o.done ? "+" : ""}`);
  /** A: [A1, A2], B, C (all fixed ids). */
  const nested = (over = {}) => normalizeQuest({
    status: "active",
    objectives: [
      { id: "a", text: "A" }, { id: "a1", text: "A1", parent: "a" }, { id: "a2", text: "A2", parent: "a" },
      { id: "b", text: "B" }, { id: "c", text: "C" },
    ],
    ...over,
  });

  test("an old quest reads with parent null, secret false and reveal all", () => {
    const q = normalizeQuest({ objectives: ["x", { id: "k", text: "y", done: true }] }, { newId });
    assert.ok(q.objectives.every((o) => o.parent === null && o.secret === false));
    assert.equal(q.reveal, "all");
    assert.deepEqual(normalizeQuest(q, { newId }), q, "normalizing twice changes nothing");
    assert.equal(normalizeQuest({ reveal: "bogus" }).reveal, "all");
    assert.equal(normalizeQuest({ reveal: "next" }).reveal, "next");
  });

  test("unknown top-level keys ride through; known ones are still cleaned", () => {
    const q = normalizeQuest({ status: "bogus", mood: { name: "Mara" }, deadline: 99, objectives: [{ id: "a", text: "A", secret: "yes" }] });
    assert.deepEqual(q.mood, { name: "Mara" });
    assert.equal(q.deadline, 99);
    assert.equal(q.status, "hidden");
    assert.equal(q.objectives[0].secret, false, "only a true boolean is secret");
    const merged = mergeQuest(q, { description: "d" });
    assert.equal(merged.deadline, 99);
    assert.equal(merged.description, "d");
  });

  test("mergeQuest still never moves status, source or paid, and carries reveal and secrets", () => {
    const q = nested({ paid: true });
    const m = mergeQuest(q, { status: "completed", paid: false, source: { kind: "rumor" }, reveal: "next" });
    assert.equal(m.status, "active");
    assert.equal(m.paid, true);
    assert.equal(m.source.kind, "gm");
    assert.equal(m.reveal, "next");
  });

  test("a parent must be an earlier top-level step of the same quest, checked after empty steps drop", () => {
    const q = normalizeQuest({
      objectives: [
        { id: "late", text: "Late child", parent: "p" },
        { id: "p", text: "Parent" },
        { id: "k", text: "Kid", parent: "p" },
        { id: "gk", text: "Grandkid", parent: "k" },
        { id: "gone", text: "   " },
        { id: "orphan", text: "Orphan", parent: "gone" },
        { id: "nope", text: "Nowhere", parent: "missing" },
      ],
    });
    const parents = Object.fromEntries(q.objectives.map((o) => [o.id, o.parent]));
    assert.deepEqual(parents, { late: null, p: null, k: "p", gk: null, orphan: null, nope: null });
  });

  test("a repeated step id gets a fresh id and children never multiply", () => {
    const input = { objectives: [{ id: "p", text: "P" }, { id: "p", text: "P again" }, { id: "c", text: "C", parent: "p" }] };
    const once = normalizeQuest(input);
    assert.equal(once.objectives.length, 3);
    assert.equal(new Set(once.objectives.map((o) => o.id)).size, 3);
    assert.equal(once.objectives.find((o) => o.id === "c").parent, "p", "attaches to the first step with that id");
    assert.deepEqual(normalizeQuest(once), once);
    let q = once;
    for (let i = 0; i < 4; i++) q = mergeQuest(q, { description: String(i) });
    assert.equal(q.objectives.length, 3);
  });

  test("a promoted sub-step stays secret when its later parent is secret", () => {
    const q = normalizeQuest({ status: "active", objectives: [{ id: "c", text: "C", parent: "p" }, { id: "p", text: "P", secret: true }] });
    assert.equal(q.objectives.find((o) => o.id === "c").secret, true);
    assert.deepEqual(playerView(q).objectives, []);
  });

  test("addSubStep goes after the parent's last child; a sub-step cannot be a parent", () => {
    const q = addSubStep(nested(), "a", "A3", { newId: () => "a3" });
    assert.deepEqual(steps(q), ["A", "  A1", "  A2", "  A3", "B", "C"]);
    assert.deepEqual(steps(addSubStep(nested(), "b", "B1", { newId: () => "b1" })), ["A", "  A1", "  A2", "B", "  B1", "C"]);
    const bad = nested();
    assert.equal(addSubStep(bad, "a1", "deeper"), bad);
    assert.equal(addSubStep(bad, "nope", "x"), bad);
    assert.equal(addSubStep(bad, "a", "  "), bad);
  });

  test("a step can be created secret on a live quest, top level or sub-step", () => {
    const q = addObjective(nested(), "Twist", { secret: true, newId: () => "t" });
    assert.equal(q.objectives.at(-1).secret, true);
    assert.equal(addSubStep(q, "b", "Hidden kid", { secret: true }).objectives.find((o) => o.text === "Hidden kid").secret, true);
    assert.equal(addObjective(nested(), "Plain").objectives.at(-1).secret, false);
    assert.equal(normalizeQuest(q).objectives.at(-1).secret, true, "survives normalizing");
  });

  test("removing a parent removes its sub-steps; removing a sub-step removes only it", () => {
    assert.deepEqual(steps(removeObjective(nested(), "a")), ["B", "C"]);
    assert.deepEqual(steps(removeObjective(nested(), "a1")), ["A", "  A2", "B", "C"]);
    assert.deepEqual(steps(setObjectiveText(nested(), "a", "")), ["B", "C"]);
  });

  test("playerView hides secret steps, and the sub-steps of a secret parent", () => {
    let q = setObjectiveSecret(nested(), "b", true);
    assert.deepEqual(steps(playerView(q)), ["A", "  A1", "  A2", "C"]);
    q = setObjectiveSecret(nested(), "a2", true);
    assert.deepEqual(steps(playerView(q)), ["A", "  A1", "B", "C"]);
    q = setObjectiveSecret(nested(), "a", true);
    assert.deepEqual(steps(playerView(q)), ["B", "C"], "children of a secret parent go with it");
    assert.equal(nested().objectives.length, 5, "the quest itself is untouched");
  });

  test("playerView with reveal next shows done top-level steps and the first undone one", () => {
    let q = nested({ reveal: "next" });
    assert.deepEqual(steps(playerView(q)), ["A", "  A1", "  A2"]);
    q = setObjectiveDone(q, "a", true);
    assert.deepEqual(steps(playerView(q)), ["A+", "  A1", "  A2", "B"]);
    q = setObjectiveSecret(setObjectiveDone(q, "b", true), "c", true);
    assert.deepEqual(steps(playerView(q)), ["A+", "  A1", "  A2", "B+"], "a secret step is never the next one");
    q = setObjectiveSecret(nested({ reveal: "next" }), "a1", true);
    assert.deepEqual(steps(playerView(q)), ["A", "  A2"], "a shown parent keeps only its non-secret sub-steps");
  });

  test("progress counts what the viewer sees; a player gets none on a next quest", () => {
    const q = setObjectiveDone(setObjectiveSecret(nested(), "c", true), "a1", true);
    assert.deepEqual(objectiveProgress(q), { done: 1, total: 5, complete: false }, "the GM sees every step");
    assert.deepEqual(objectiveProgress(playerView(q), { isGM: false }), { done: 1, total: 4, complete: false });
    const nx = nested({ reveal: "next" });
    assert.deepEqual(objectiveProgress(playerView(nx), { isGM: false }), { done: 0, total: 0, complete: false });
    assert.equal(objectiveProgress(nx).total, 5, "the GM still sees the count");
  });

  test("the player page nests sub-steps and carries no secret text", () => {
    let q = setObjectiveSecret(setObjectiveSecret(nested(), "b", true), "a2", true);
    q = { ...q, objectives: q.objectives.map((o) => (o.id === "b" ? { ...o, text: "The duke is the traitor" } : o.id === "a2" ? { ...o, text: "Poison the well" } : o)) };
    const html = playerPageHtml(q, t);
    assert.match(html, /<li>☐ A<ul><li>☐ A1<\/li><\/ul><\/li>/);
    assert.ok(!html.includes("traitor") && !html.includes("Poison"));
    const nx = playerPageHtml(nested({ reveal: "next" }), t);
    assert.ok(nx.includes("A2") && !nx.includes(">☐ B") && !nx.includes("C<"));
  });

  test("summarize keeps the entry's own id and name over an unknown key of the same name", () => {
    const s = summarize({ id: "i", uuid: "u", name: "n" }, { id: "evil", name: "evil" });
    assert.equal(s.id, "i");
    assert.equal(s.name, "n");
  });

  test("unknown keys ride through, but entry fields and junk do not", () => {
    const q = normalizeQuest({ name: "x", id: "y", uuid: "u", created: 1, mood: { npc: "Bob" }, fn: () => 1 }, { newId });
    assert.deepEqual(q.mood, { npc: "Bob" });
    for (const k of ["name", "id", "uuid", "created", "fn"]) assert.equal(k in q, false, k);
    assert.deepEqual(normalizeQuest(q, { newId }), q);
    assert.doesNotThrow(() => normalizeQuest({ foo: () => 1, bar: 2 }));
  });

  test("unknown keys inside rewards and steps ride through, known keys win", () => {
    const q = normalizeQuest({
      rewards: { xp: 2, bonus: "n", name: "no" },
      objectives: [{ id: "a", text: "A", hint: "h", done: true, name: "no" }],
    }, { newId });
    assert.equal(q.rewards.bonus, "n");
    assert.equal(q.rewards.xp, 2);
    assert.equal("name" in q.rewards, false);
    assert.equal(q.objectives[0].hint, "h");
    assert.equal(q.objectives[0].done, true);
    assert.equal("name" in q.objectives[0], false);
  });

  test("a sub-step saved out of order moves under its parent", () => {
    const q = normalizeQuest({ objectives: [{ id: "p", text: "P" }, { id: "q", text: "Q" }, { id: "c", text: "C", parent: "p" }] });
    assert.deepEqual(q.objectives.map((o) => o.id), ["p", "c", "q"]);
    assert.deepEqual(normalizeQuest(q).objectives.map((o) => o.id), ["p", "c", "q"]);
  });

  test("toggling secret flips what is stored", () => {
    const q = nested();
    const once = setObjectiveSecret(q, "b", !q.objectives.find((o) => o.id === "b").secret);
    assert.equal(once.objectives.find((o) => o.id === "b").secret, true);
    assert.equal(setObjectiveSecret(once, "b", !once.objectives.find((o) => o.id === "b").secret).objectives.find((o) => o.id === "b").secret, false);
  });
});

describe("giver and other rewards", () => {
  const giver = { uuid: "Actor.g1", name: " Old Maren ", img: " a.webp " };

  test("a giver is trimmed, and without a uuid it is no giver", () => {
    assert.deepEqual(normalizeQuest({ giver }).giver, { uuid: "Actor.g1", name: "Old Maren", img: "a.webp" });
    assert.deepEqual(normalizeQuest({ giver: { uuid: "Actor.g1" } }).giver, { uuid: "Actor.g1", name: "", img: "" });
    for (const junk of [undefined, null, {}, { uuid: "  " }, { name: "x" }, "Actor.g1", 7, []]) assert.equal(normalizeQuest({ giver: junk }).giver, null);
  });

  test("notes are trimmed, empties dropped, clamped to 200 and capped at 10", () => {
    const q = normalizeQuest({ rewards: { notes: ["  free lodging  ", "", "   ", 5, "x".repeat(300)] } });
    assert.deepEqual(q.rewards.notes, ["free lodging", "5", "x".repeat(200)]);
    const many = normalizeQuest({ rewards: { notes: Array.from({ length: 14 }, (_, i) => `n${i}`) } });
    assert.equal(many.rewards.notes.length, 10);
    assert.equal(many.rewards.notes[9], "n9");
    assert.deepEqual(normalizeQuest({ rewards: { notes: "not a list" } }).rewards.notes, []);
  });

  test("notes are not rewards the log pays: hasRewards and shouldPay ignore them", () => {
    const q = normalizeQuest({ status: "active", rewards: { notes: ["free lodging"] } });
    assert.equal(hasNotes(q.rewards), true);
    assert.equal(hasRewards(q.rewards), false);
    assert.equal(shouldPay(q, "completed"), false);
    assert.equal(planStatusChange(q, "completed").pay, false);
    assert.equal(hasNotes(normalizeQuest().rewards), false);
    assert.deepEqual(noteLines(q.rewards), ["free lodging"]);
  });

  test("payoutPlan passes silver and copper through", () => {
    const q = normalizeQuest({ rewards: { coins: { gp: 1, sp: 20, cp: 5 } } });
    assert.deepEqual(payoutPlan(q, { recipients: ["X"] }).coins, { amount: { gp: 1, sp: 20, cp: 5 }, to: ["X"] });
    assert.equal(hasRewards(normalizeQuest({ rewards: { coins: { sp: 3 } } }).rewards), true);
  });

  test("mergeQuest takes a notes patch and a giver patch, and keeps the other rewards", () => {
    const base = normalizeQuest({ rewards: { xp: 4, notes: ["a"] } });
    const m = mergeQuest(base, { rewards: { notes: ["b", "c"] }, giver });
    assert.deepEqual(m.rewards.notes, ["b", "c"]);
    assert.equal(m.rewards.xp, 4);
    assert.equal(m.giver.name, "Old Maren");
    assert.equal(mergeQuest(m, { giver: null }).giver, null);
  });

  test("an old quest without either field reads as none and survives a round trip", () => {
    const old = { status: "active", rewards: { xp: 2, coins: { gp: 5 } }, objectives: [] };
    const q = normalizeQuest(old);
    assert.equal(q.giver, null);
    assert.deepEqual(q.rewards.notes, []);
    assert.deepEqual(normalizeQuest(q), q);
  });

  test("the player page shows Given by (escaped) and a notes-only Rewards section, and nothing secret", () => {
    const q = normalizeQuest({
      status: "active", giver: { uuid: "Actor.g1", name: "Maren <b>" },
      objectives: [{ id: "a", text: "Open step" }, { id: "s", text: "Hidden twist", secret: true }],
      rewards: { notes: ["free <i>lodging</i>"] },
    });
    const html = playerPageHtml(q, t);
    assert.ok(html.includes('SDE.quests.page.givenBy{"name":"Maren &lt;b&gt;"}') || html.includes("Maren &lt;b&gt;"));
    assert.ok(html.includes("SDE.quests.rewards"));
    assert.ok(html.includes("free &lt;i&gt;lodging&lt;/i&gt;"));
    assert.ok(!html.includes("<i>lodging"));
    assert.ok(!html.includes("Hidden twist"));
    const plain = playerPageHtml(normalizeQuest({ status: "active" }), t);
    assert.ok(!plain.includes("givenBy") && !plain.includes("SDE.quests.rewards"));
  });

  test("the player view keeps the giver and the notes", () => {
    const q = normalizeQuest({ giver, rewards: { notes: ["a"] } });
    const v = playerView(q);
    assert.equal(v.giver.uuid, "Actor.g1");
    assert.deepEqual(v.rewards.notes, ["a"]);
  });
});

describe("quest dates", () => {
  const D = 86400;
  const day = (n) => n * D;

  test("an old quest has no dates and round-trips", () => {
    const q = normalizeQuest({ status: "active", objectives: ["a"] });
    assert.equal(q.startsAt, null);
    assert.equal(q.deadline, null);
    assert.equal(q.autoFail, false);
    assert.deepEqual(normalizeQuest(q), q);
  });

  test("a date is a finite worldTime from 0 up, floored; anything else is no date", () => {
    for (const junk of ["100", "", NaN, -1, Infinity, -Infinity, {}, [], true, undefined]) {
      const q = normalizeQuest({ startsAt: junk, deadline: junk, autoFail: true });
      assert.equal(q.startsAt, null, String(junk));
      assert.equal(q.deadline, null, String(junk));
      assert.equal(q.autoFail, false, "no deadline, no auto-fail");
    }
    const q = normalizeQuest({ startsAt: 0, deadline: 99.9, autoFail: true });
    assert.deepEqual([q.startsAt, q.deadline, q.autoFail], [0, 99, true]);
  });

  test("autoFail is only true when it is exactly true and a deadline stands", () => {
    assert.equal(normalizeQuest({ deadline: 5, autoFail: "yes" }).autoFail, false);
    assert.equal(normalizeQuest({ deadline: 5, autoFail: true }).autoFail, true);
    assert.equal(mergeQuest(normalizeQuest({ deadline: 5, autoFail: true }), { deadline: null }).autoFail, false);
  });

  test("deadlineState: the quest runs through the end of the deadline day", () => {
    const q = (deadline) => normalizeQuest({ deadline });
    assert.equal(deadlineState(q(null), 1e9, D), "none");
    assert.equal(deadlineState(q(day(10)), day(10), D), "open");
    assert.equal(deadlineState(q(day(10)), day(11) - 1, D), "open");
    assert.equal(deadlineState(q(day(10)), day(11), D), "overdue");
  });

  const mk = (id, over) => ({ ...normalizeQuest(over), id });

  test("dueChanges: a fail comes at deadline + a day, not one second sooner", () => {
    const qs = [mk("a", { status: "active", deadline: day(10), autoFail: true })];
    assert.deepEqual(dueChanges(qs, day(11) - 1, D), []);
    assert.deepEqual(dueChanges(qs, day(11), D), [{ id: "a", status: "failed", clear: ["autoFail"] }]);
    const open = [mk("b", { status: "available", deadline: day(10), autoFail: true })];
    assert.equal(dueChanges(open, day(11), D)[0].status, "failed");
  });

  test("dueChanges: no autoFail, no fail; completed, failed and hidden quests never fail", () => {
    const base = { deadline: day(10), autoFail: true };
    assert.deepEqual(dueChanges([mk("a", { status: "active", deadline: day(10) })], day(50), D), []);
    for (const status of ["completed", "failed", "hidden"]) {
      assert.deepEqual(dueChanges([mk("a", { ...base, status })], day(50), D), [], status);
    }
  });

  test("dueChanges: a reopened quest (autoFail switched off) stays open", () => {
    const q = mk("a", { status: "active", deadline: day(10), autoFail: false });
    assert.deepEqual(dueChanges([q], day(50), D), []);
  });

  test("dueChanges: a Hidden quest appears on the first second of its day, clearing startsAt", () => {
    const q = mk("h", { status: "hidden", startsAt: day(5) });
    assert.deepEqual(dueChanges([q], day(5) - 1, D), []);
    assert.deepEqual(dueChanges([q], day(5), D), [{ id: "h", status: "available", clear: ["startsAt"] }]);
    assert.equal(dueChanges([mk("h", { status: "hidden" })], day(5), D).length, 0, "no date, no reveal");
    assert.deepEqual(dueChanges([mk("x", { status: "active", startsAt: day(1) })], day(5), D), [], "only a Hidden quest appears");
  });

  test("dueChanges: a Hidden quest whose deadline is over stays Hidden and keeps startsAt; one still open appears", () => {
    const over = mk("h", { status: "hidden", startsAt: day(5), deadline: day(6), autoFail: true });
    assert.deepEqual(dueChanges([over], day(7), D), []);
    assert.deepEqual(dueChanges([over], day(7) - 1, D)[0].status, "available", "the deadline day is not over yet");
    assert.equal(over.startsAt, day(5));
  });

  test("dueChanges: one pass never reveals and fails the same quest", () => {
    const q = mk("h", { status: "hidden", startsAt: day(5), deadline: day(6), autoFail: true });
    assert.equal(dueChanges([q], day(6), D).length, 1);
  });

  test("dayChanged only when the day number moves", () => {
    assert.equal(dayChanged(day(3), day(3) + 5, D), false);
    assert.equal(dayChanged(day(4) - 1, day(4), D), true);
    assert.equal(dayChanged(day(9), day(2), D), true, "back in time is another day too");
  });

  test("timeToDate and dateLabel read the calendar's own names", () => {
    const cal = { years: { yearZero: 100 }, months: { values: [{ name: "M.Jan" }, { name: "M.Feb" }] },
      timeToComponents: () => ({ year: 1248, month: 1, dayOfMonth: 13 }) };
    assert.deepEqual(timeToDate(cal, 0), { day: 14, month: 2, year: 1348 });
    assert.equal(dateLabel(cal, 0, t), 'SDE.quests.dateFormat{"day":14,"month":"M.Feb","year":1348}');
  });

  test("the player page shows the Due line, never a start date", () => {
    const cal = { timeToComponents: () => ({ year: 1348, month: 2, dayOfMonth: 13 }), months: { values: [] } };
    const q = normalizeQuest({ status: "active", deadline: 777, startsAt: 123456 });
    const html = playerPageHtml(q, t, cal);
    assert.ok(html.includes("SDE.quests.page.due"));
    assert.ok(!html.includes("123456"));
    assert.ok(!playerPageHtml(normalizeQuest({ status: "active" }), t, cal).includes("page.due"));
  });
});
