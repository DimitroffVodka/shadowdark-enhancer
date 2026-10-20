import test from "node:test";
import assert from "node:assert/strict";
import { loadPropertyNames, propName, factsOf, clearPropertyNames } from "../scripts/merchant/property-names.mjs";

const t = (key, data) => (data ? `${key}:${JSON.stringify(data)}` : key);

test("property names are read once and then served from the cache", async () => {
  clearPropertyNames();
  let calls = 0;
  const read = async (link) => { calls++; return link === "bad" ? null : { name: `N-${link}` }; };
  const items = [{ system: { properties: ["a", "b", "bad"] } }, { system: { properties: ["a"] } }, { system: {} }];
  await loadPropertyNames(items, read);
  await loadPropertyNames(items, read);
  assert.equal(propName("a"), "N-a");
  assert.equal(propName("bad"), "");
  assert.equal(calls, 3);   // a, b, bad: an unreadable link is cached too
});

test("a link that throws is skipped", async () => {
  clearPropertyNames();
  await loadPropertyNames([{ system: { properties: ["x"] } }], () => { throw new Error("no"); });
  assert.equal(propName("x"), "");
});

test("factsOf gives the chips, with property names, and a short plain description", async () => {
  clearPropertyNames();
  await loadPropertyNames([{ system: { properties: ["p"] } }], async () => ({ name: "Finesse" }));
  const out = factsOf({ type: "Weapon", system: { type: "melee", damage: { oneHanded: "d6" }, properties: ["p"], description: "<p>A  fine <b>blade</b>.</p>" } }, t);
  assert.ok(out.facts.includes("Finesse"));
  assert.equal(out.blurb, "A fine blade .");
});

test("factsOf reads an index-row-shaped Weapon and Armor", async () => {
  clearPropertyNames();
  await loadPropertyNames([{ system: { properties: ["f"] } }], async () => ({ name: "Finesse" }));
  const weapon = factsOf({ name: "Dagger", type: "Weapon", system: { type: "melee", range: "close", damage: { oneHanded: "d4" }, properties: ["f"] } }, t).facts;
  assert.deepEqual(weapon, ["SDE.town.fact.melee", "SDE.town.fact.close", `SDE.town.fact.damage:{"dice":"d4"}`, "Finesse"]);
  const armor = factsOf({ name: "Leather", type: "Armor", system: { ac: { base: 11, attribute: "dex" } } }, t).facts;
  assert.deepEqual(armor, [`SDE.town.fact.acStat:{"n":11,"stat":"DEX"}`]);
});
