/** Tables imported from the Manage tree carry no manifestId; the Forge and the Monster Creator still find them. */
import test from "node:test";
import assert from "node:assert/strict";
import { adoptUnstamped, findById, importNameFor } from "../scripts/importer/tables/table-manifest.mjs";
import { buildSetStates, SET_DEFS } from "../scripts/monster-creator/monster-table-runtime.mjs";

const W = [{ manifestId: "core-weapon-type", name: "Weapon Type", sources: ["core", "Core Rulebook"] }];

test("the only unstamped table under the name is adopted", () => {
  const out = adoptUnstamped([{ name: "Weapon Type", source: "CORE", manifestId: null }, { name: "Other" }], W);
  assert.equal(out[0].manifestId, "core-weapon-type", "the book recorded by id");
  assert.equal(adoptUnstamped([{ name: "Weapon Type", source: "Core Rulebook" }], W)[0].manifestId, "core-weapon-type", "or by label");
  assert.equal(out[1].manifestId, undefined);
});

test("two candidates adopt neither, and a stamped table is never taken twice", () => {
  const two = adoptUnstamped([{ name: "Weapon Type" }, { name: "weapon type " }], W);
  assert.deepEqual(two.map((t) => t.manifestId), [undefined, undefined]);
  const stamped = adoptUnstamped([{ name: "Weapon Type", manifestId: "core-weapon-type" }, { name: "Weapon Type" }], W);
  assert.equal(stamped[1].manifestId, undefined);
});

test("a table from another book under the same name is not adopted", () => {
  const out = adoptUnstamped([{ name: "Weapon Type", source: "Cursed Scroll 3" }], W);
  assert.equal(out[0].manifestId, undefined);
});

test("the Mutations set is ready from tables imported without a stamp", () => {
  const entry = findById("core-monster-mutations");
  const tables = SET_DEFS.mutations.identities.map((idn, i) => ({
    uuid: `u${i}`, name: `${importNameFor(entry)} - ${idn.columnLabel}`, source: "CORE", manifestId: null,
    formula: "1d12", results: Array.from({ length: 12 }, (_, n) => ({ id: `r${n}`, range: [n + 1, n + 1], text: `Text ${n}` })),
  }));
  const wanted = SET_DEFS.mutations.identities.map((idn) => ({ manifestId: idn.manifestId, name: `${importNameFor(entry)} - ${idn.columnLabel}`, sources: [entry.source, entry.sourceLabel] }));
  assert.equal(buildSetStates(adoptUnstamped(tables, wanted)).mutations.state, "ready");
  assert.equal(buildSetStates(tables).mutations.state, "locked", "without adoption it is the bug");
});
