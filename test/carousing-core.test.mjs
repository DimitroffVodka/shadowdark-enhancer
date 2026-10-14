import test from "node:test";
import assert from "node:assert/strict";
import { eventTiers, outcomeRows, outcomeAt, outcomeEffects, splitCost, preflight, recapNight, matrixRows, d100Rows, d100Formula, rollExpanded, expandedEffects, resultLine, carousingFirst, bookChoices, COOLDOWN_DAYS, BOOKS } from "../scripts/carousing/carousing-core.mjs";
const tiers = [{ id: "t1", cost: 10, bonus: 0, description: "Test outing" }, { id: "t2", cost: 20, bonus: 2, description: "Test feast" }];
const outcomes = [{ range: [1, 10], description: "Synthetic night", benefit: "Gain 2 XP and a luck token" }];
const people = [{ uuid: "Actor.a", actorId: "a", confirmed: true, participate: true, coins: { gp: 10 } }, { uuid: "Actor.b", actorId: "b", confirmed: true, participate: false, coins: { gp: 0 } }];
const check = patch => preflight({ participants: people, tierId: "t1", tiers, outcomes, limit: Infinity, now: 2000000000, ...patch });
test("event and outcome adapters consume imported pipe rows, never seed prose", () => {
  assert.deepEqual(eventTiers([{ _id: "e", description: "10 gp | Synthetic party | +2", range: [1, 1] }]), [{ id: "e", cost: 10, description: "Synthetic party", bonus: 2 }]);
  assert.deepEqual(outcomeRows([{ description: "Synthetic event | Gain 2 XP", range: [1, 8] }]), [{ range: [1, 8], description: "Synthetic event", benefit: "Gain 2 XP" }]);
  assert.deepEqual(eventTiers([{ description: "malformed" }]), []);
  assert.equal(eventTiers([{ id: "v14", name: "10 gp | Synthetic party | +2", description: "" }])[0].cost, 10);
  assert.deepEqual(outcomeRows([]), []);
});
test("only confirmed participating recipients; a lone joiner pays the whole tier cost", () => {
  const r = check(); assert.equal(r.ok, true); assert.deepEqual(r.participants.map(p => p.actorId), ["a"]); assert.equal(r.participants[0].cost, 10);
  assert.equal(check({ participants: [] }).error, "SDE.carousing.noParticipants");
  assert.equal(check({ participants: people.map(p => ({ ...p, confirmed: false })) }).error, "SDE.carousing.confirm");
});
test("all-or-nothing funds, missing tables, holes and settlement checks", () => {
  assert.equal(check({ participants: people.map(p => ({ ...p, coins: { gp: 9 } })) }).error, "SDE.carousing.funds");
  assert.equal(check({ outcomes: [] }).error, "SDE.carousing.tablesMissing");
  assert.equal(check({ outcomes: [{ ...outcomes[0], range: [1, 2] }, { ...outcomes[0], range: [6, 10] }] }).error, "SDE.carousing.tablesMissing");
  assert.equal(check({ limit: 9 }).error, "SDE.carousing.limit");
  assert.equal(check({ downtime: true }).error, "SDE.carousing.downtime");
  assert.equal(check({ participants: people.map(p => ({ ...p, lastAt: 1999999999 })) }).error, "SDE.carousing.cooldown");
  assert.equal(check({ participants: people.map(p => ({ ...p, lastAt: 0 })) }).ok, true);
});
test("the wait between outings is 14 game days, in seconds, and the GM's switch skips it", () => {
  const day = 86400, now = 100 * day, at = days => people.map(p => ({ ...p, lastAt: now - days * day }));
  const run = patch => preflight({ participants: people, tierId: "t1", tiers, outcomes, now, ...patch });
  assert.equal(run({ participants: at(13) }).error, "SDE.carousing.cooldown");
  assert.equal(run({ participants: at(14) }).ok, true);
  assert.equal(run({ participants: at(5), ignoreCooldown: true }).ok, true);
  assert.equal(run({ participants: at(13), cooldown: 10 * day }).ok, true, "the calendar's own day length is the caller's");
  assert.equal(COOLDOWN_DAYS, 14);
});
test("the tier cost is a group total split in whole coins; the remainder goes to the first in list order", () => {
  assert.deepEqual(splitCost(100, 3), [34, 33, 33]);
  assert.deepEqual(splitCost(10, 4), [3, 3, 2, 2]);
  assert.deepEqual(splitCost(20, 2), [10, 10]);
  assert.deepEqual(splitCost(7, 1), [7]);
  assert.deepEqual(splitCost(5, 0), []);
  for (const [total, n] of [[100, 3], [10, 7], [3, 5], [250, 6]]) assert.equal(splitCost(total, n).reduce((a, b) => a + b, 0), total);
  const three = ["a", "b", "c"].map(id => ({ uuid: `Actor.${id}`, actorId: id, confirmed: true, participate: true, coins: { gp: 40 } }));
  const r = preflight({ participants: three, tierId: "big", tiers: [{ id: "big", cost: 100, bonus: 0, description: "Big" }], outcomes, now: 2000000000 });
  assert.equal(r.ok, true); assert.deepEqual(r.participants.map(p => p.cost), [34, 33, 33]);
  assert.equal(r.participants.every(p => p.tier.id === "big"), true);
});
test("preflight checks each person's share, not the full tier cost", () => {
  const two = [{ ...people[0], coins: { gp: 5 } }, { ...people[0], uuid: "Actor.c", actorId: "c", coins: { gp: 5 } }];
  assert.equal(check({ participants: two }).ok, true, "10 gp split in two is 5 each");
  assert.equal(check({ participants: [two[0], { ...two[1], coins: { gp: 4 } }] }).error, "SDE.carousing.funds");
  assert.equal(check({ tierId: "missing" }).error, "SDE.carousing.tablesMissing");
});
test("holiday garb no longer admits or changes the roll; the event bonus still applies", () => {
  const h = { garb: [{ key: "dress", required: true, modifier: 1 }], carousing: { eventBonus: 2 } };
  const r = check({ holiday: h, participants: people.map(p => ({ ...p, garb: { dress: true } })) });
  assert.equal(r.ok, true); assert.equal(r.participants[0].bonus, 2);
});
test("clamps extremes to actual rows without fabricating gaps; concrete effects only", () => {
  assert.deepEqual(outcomeAt(-3, outcomes), outcomes[0]); assert.deepEqual(outcomeAt(99, outcomes), outcomes[0]);
  assert.equal(outcomeAt(4, [{ range: [1, 2] }, { range: [6, 8] }]), undefined);
  assert.deepEqual(outcomeEffects("Lose 5% of your total wealth and +2 Renown", "Gain 4 XP and a luck token"), { xp: 4, luck: 1, renown: 2 });
  assert.deepEqual(outcomeEffects("Gain 5% of your total wealth", "Gain 4 XP"), { xp: 4, luck: 0, renown: 0 });
  assert.equal(outcomeEffects("A mysterious friend", "").xp, 0);
});
test("XP and Luck automate only explicit unconditional positive rewards", () => {
  for (const text of ["Lose 2 XP and lose a luck token", "-2 XP and -1 luck token", "Do not gain 2 XP or a luck token", "No 2 XP or luck token", "Gain 2 XP and a luck token if you win", "If you win, gain 2 XP", "You may gain 2 XP and a luck token", "Gain 2 XP for completing the GM's task", "2 XP and a luck token", "Gain -2 XP and lose one luck token"]) {
    const effects = outcomeEffects("Synthetic custom outcome", text);
    assert.equal(effects.xp, 0, text); assert.equal(effects.luck, 0, text);
  }
  for (const text of ["Gain 2 XP and a luck token", "You gain 2 XP and gain one luck token", "+2 XP and +1 luck token", "Receive 2 XP. Gain a luck token."]) {
    const effects = outcomeEffects("Synthetic reward", text);
    assert.equal(effects.xp, 2, text); assert.equal(effects.luck, 1, text);
  }
  assert.equal(outcomeEffects("Lose 2 XP", "Gain a luck token").xp, 0);
  assert.equal(outcomeEffects("Lose 2 XP", "Gain a luck token").luck, 1);
});
test("recap stable id and each person's share, totalling the tier cost, history-only rows never become recipients", () => {
  const night = { logId: "night", at: 1, participants: [{ actorId: "a", name: "Test PC", cost: 4 }, { actorId: "b", name: "Other PC", cost: 3 }], results: { a: { total: 7, description: "Test result", benefit: "Gain 2 XP", effects: { xp: 2, renown: 0 } }, b: { total: 5, description: "Quiet", benefit: "", effects: { xp: 0, renown: 0 } } } };
  const row = recapNight(night); assert.equal(row.logId, "night"); assert.equal(row.tierCost, 7); assert.deepEqual(row.entries.map(e => e.cost), [4, 3]); assert.equal(row.entries[0].xp, 2);
  assert.equal(recapNight({ ...night, historyOnly: true }), null);
});

// Expanded carousing. Every table below is invented; no book text is stored here.
const matrix = [{ range: [1, 2], description: "2 | - | -20 | 2" }, { range: [3, 6], description: "1 | 1 | -10% | 3" }, { range: [7, 25], description: "- | 2 | +15 | 5" }];
const hundred = n => Array.from({ length: n }, (_, i) => ({ range: [i + 1, i + 1], text: `row ${i + 1}` }));
const scripted = totals => { const queue = [...totals], seen = []; return { seen, roll: async type => { seen.push(type); return queue.shift(); } }; };
test("an outcome matrix row reads Mishaps | Benefits | % modifier | XP, a dash meaning none", () => {
  assert.deepEqual(matrixRows(matrix), [
    { range: [1, 2], mishapRolls: 2, benefitRolls: 0, modifier: -20, xp: 2 },
    { range: [3, 6], mishapRolls: 1, benefitRolls: 1, modifier: -10, xp: 3 },
    { range: [7, 25], mishapRolls: 0, benefitRolls: 2, modifier: 15, xp: 5 }]);
  assert.equal(matrixRows([{ range: [1, 1], description: "\u2014 | 1 | \u221215 | 1" }])[0].modifier, -15);
});
test("a basic outcome row is never mistaken for a matrix row, and a ragged matrix row is dropped", () => {
  assert.deepEqual(matrixRows([{ range: [1, 8], description: "Synthetic result | Gain 2 XP" }]), []);
  assert.deepEqual(matrixRows([{ range: [1, 1], description: "1 | 1 | x | 2" }, { range: [2, 2], description: "1 | 1 | -5" }, { range: [3, 3], description: "-1 | 1 | -5 | 1" }, { range: [4, 4], description: "1.5 | 1 | -5 | 1" }]), []);
});
test("benefit and mishap rows keep their whole text, a stray pipe included", () => {
  assert.deepEqual(d100Rows([{ range: [1, 1], description: "One | two" }, { range: [2, 2], name: "Plain" }]), [{ range: [1, 1], text: "One | two" }, { range: [2, 2], text: "Plain" }]);
});
test("the row's % modifier shifts each d100, clamped to 1-100, and the row decides how many are rolled", async () => {
  const row = { mishapRolls: 1, benefitRolls: 2, modifier: -20 }, dice = scripted([50, 10, 90]);
  const found = await rollExpanded({ row, benefits: hundred(100), mishaps: hundred(100), roll: dice.roll });
  assert.deepEqual(dice.seen, ["benefit", "benefit", "mishap"]);
  assert.deepEqual(found.benefits.map(e => [e.dice, e.roll, e.text]), [[50, 30, "row 30"], [10, 1, "row 1"]]);
  assert.deepEqual(found.mishaps.map(e => [e.dice, e.roll]), [[90, 70]]);
  const high = await rollExpanded({ row: { mishapRolls: 0, benefitRolls: 1, modifier: 30 }, benefits: hundred(100), mishaps: hundred(100), roll: scripted([95]).roll });
  assert.equal(high.benefits[0].roll, 100);
});
test("a re-roll-as-the-other row rolls on the other table and lands in that table's list, at most four times", async () => {
  const benefits = hundred(100), mishaps = hundred(100);
  benefits[0].text = "The tide turns on you at the harbour wall; re-roll this benefit as a mishap"; mishaps[99].text = "A leaking barrel soaks your cloak on the quay and the cooper only shrugs. Re-roll this mishap as a benefit";
  const once = await rollExpanded({ row: { mishapRolls: 0, benefitRolls: 1, modifier: 0 }, benefits, mishaps, roll: scripted([1, 40]).roll });
  assert.deepEqual([once.benefits.length, once.mishaps.map(e => e.text)], [0, ["row 40"]]);
  const dice = scripted([1, 100, 1, 100, 77]);
  const loop = await rollExpanded({ row: { mishapRolls: 0, benefitRolls: 1, modifier: 0 }, benefits, mishaps, roll: dice.roll });
  assert.deepEqual(dice.seen, ["benefit", "mishap", "benefit", "mishap"], "four rolls, then it stops");
  assert.equal(loop.mishaps[0].text, "A leaking barrel soaks your cloak on the quay and the cooper only shrugs. Re-roll this mishap as a benefit");
});
test("a holiday adds one benefit and one mishap, and touches only benefit dice", async () => {
  const dice = scripted([5, 5, 5, 5]);
  const found = await rollExpanded({ row: { mishapRolls: 0, benefitRolls: 0, modifier: 0 }, benefits: hundred(100), mishaps: hundred(100), roll: dice.roll, holiday: { extraBenefit: true, extraMishap: true } });
  assert.deepEqual([found.benefits.length, found.mishaps.length], [1, 1]);
  assert.equal(d100Formula("benefit", { benefitAdvantage: true, benefitBonus: 15 }), "2d100kh + 15");
  assert.equal(d100Formula("mishap", { benefitAdvantage: true, benefitBonus: 15 }), "1d100");
  assert.equal(d100Formula("benefit"), "1d100");
});
test("expanded effects are the row's XP plus what each benefit and mishap states in the automated grammar", () => {
  const entries = [{ text: "A ferryman blesses your boots and rows you across the harbour at dawn. Gain a luck token" }, { text: "You offended a clerk at the toll house and he struck your name from the ledger; -3 renown" }, { text: "The bar brawl bill is yours: pay 15% of your coin" }, { text: "A friend owes you a favour from the winter fair; +1 renown if the bell rings" }];
  assert.deepEqual(expandedEffects(3, entries), { xp: 3, luck: 1, renown: -3 });
  assert.equal(outcomeEffects("Gain 1 renown if you are seen", "").renown, 0, "a conditional renown stays prose");
});
test("an expanded night needs both d100 tables to cover 1-100 before anyone is charged", () => {
  const rows = matrixRows(matrix), pcs = [{ uuid: "Actor.a", actorId: "a", confirmed: true, participate: true, coins: { gp: 50 } }];
  const run = patch => preflight({ participants: pcs, tierId: "t1", tiers, outcomes: rows, expanded: true, benefits: hundred(100), mishaps: hundred(100), now: 2000000000, ...patch });
  assert.equal(run().ok, true);
  assert.equal(run({ mishaps: [] }).error, "SDE.carousing.tablesMissing");
  assert.equal(run({ benefits: hundred(100).filter(r => r.range[0] !== 50) }).error, "SDE.carousing.tablesMissing");
  assert.equal(run({ expanded: false, benefits: [], mishaps: [] }).ok, true, "a basic night does not look at them");
});
test("the recap row of an expanded night is mode expanded with benefits and mishaps listed", () => {
  const night = { logId: "n", date: "d", participants: [{ actorId: "a", name: "A", cost: 10 }], results: { a: { mode: "expanded", total: 6, xp: 3, benefits: [{ text: "Free ale", roll: 12 }], mishaps: [{ text: "Lost purse; -2 renown", roll: 4 }], effects: { xp: 3, luck: 0, renown: -2 } } } };
  const [entry] = recapNight(night).entries;
  assert.deepEqual([entry.mode, entry.outcome, entry.roll, entry.xp, entry.renownDelta], ["expanded", "3 XP", 6, 3, -2]);
  assert.deepEqual(entry.benefits, [{ text: "Free ale", roll: 12, renownDelta: 0 }]);
  assert.deepEqual(entry.mishaps, [{ text: "Lost purse; -2 renown", roll: 4, renownDelta: -2 }]);
});
test("history lines read an expanded result as its XP and its texts, a basic one as before", () => {
  const result = { mode: "expanded", xp: 2, benefits: [{ text: "Free ale" }], mishaps: [{ text: "Lost purse" }] };
  assert.deepEqual(resultLine(result, n => `${n} XP`), { outcome: "2 XP", benefit: "Free ale · Lost purse" });
  assert.deepEqual(resultLine({ description: "Night", benefit: "Gain 2 XP" }), { outcome: "Night", benefit: "Gain 2 XP" });
});
test("tables with carousing in their name, or in their manifest id, come first; each group is in name order", () => {
  const rows = [{ name: "Zebra Names" }, { name: "Pack: Carousing Outcome", bare: "Carousing Outcome" }, { name: "Armor Benefit" }, { name: "Pack: Cursed Scroll #6 - Mishap", bare: "Cursed Scroll #6 - Mishap", manifestId: "cs6-carousing-mishap" }, { name: "Pack: Dwarf Names", bare: "Dwarf Names" }, { name: "A Carousing Event" }];
  assert.deepEqual(carousingFirst(rows).map(r => r.name), ["A Carousing Event", "Pack: Carousing Outcome", "Pack: Cursed Scroll #6 - Mishap", "Armor Benefit", "Pack: Dwarf Names", "Zebra Names"]);
  assert.equal(rows[0].name, "Zebra Names", "the input is left alone");
  assert.ok(carousingFirst([{ name: "Pack: Carousing Tools", bare: "Hammers" }])[0].bare === "Hammers");
});
test("a world copy of a carousing table stays ahead of the compendium copy, whatever its name", () => {
  const rows = [{ name: "Book: Carousing Outcome", bare: "Carousing Outcome", pack: true, manifestId: "core-carousing-outcome" }, { name: "Zed Carousing Outcome", bare: "Zed Carousing Outcome", manifestId: "core-carousing-outcome" }];
  assert.equal(carousingFirst(rows).find(r => r.manifestId === "core-carousing-outcome").name, "Zed Carousing Outcome");
});
test("each book names the outcome, event, benefit and mishap tables that go together", () => {
  assert.deepEqual(BOOKS.map(b => b.outcome.split("-")[0]), ["core", "pgwr", "cs6"]);
  assert.ok(BOOKS.slice(1).every(b => b.event && b.benefit && b.mishap));
  assert.equal(BOOKS[0].benefit, undefined);
});
test("the rulebook question lists the imported books only, picks the saved one or the first, and keeps a table of the GM's own", () => {
  const t = (uuid, manifestId, name = uuid) => ({ uuid, manifestId, name });
  const both = [t("w.cs6", "cs6-carousing-outcome"), t("p.core", "core-carousing-outcome"), t("w.other", undefined, "Harwick Outcomes")];
  const pick = (rows, outcome) => { const c = bookChoices(rows, outcome); return [c.books.map(b => `${b.label.split(".").at(-1)}${b.selected ? "*" : ""}`), c.own?.name]; };
  assert.deepEqual(pick(both, ""), [["core*", "cs6"], undefined], "nothing saved: the first imported book, in book order");
  assert.deepEqual(pick(both, "w.cs6"), [["core", "cs6*"], undefined]);
  assert.deepEqual(pick(both, "w.other"), [["core", "cs6"], "Harwick Outcomes"], "a table that is no book's keeps its own row and no book is selected");
  assert.deepEqual(pick(both, "gone"), [["core", "cs6"], "gone"], "a deleted table still shows, by its id");
  assert.deepEqual(pick([t("w.o", "core-carousing-outcome"), t("w.x", "armor-benefit")], ""), [["core*"], undefined]);
  assert.deepEqual(pick([], ""), [[], undefined], "nothing imported: no books to ask about");
  assert.equal(bookChoices(both, "").books.find(b => b.book === "core-carousing-outcome").value, "p.core", "the value is the table's uuid, so the outcome follows the book");
});
