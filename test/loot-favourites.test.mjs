import test from "node:test";
import assert from "node:assert/strict";
import { splitFavourites } from "../scripts/loot/loot-table-catalog.mjs";

const T = (uuid) => ({ uuid, name: uuid });

test("starred tables lead, the rest keep their order, and a star on a deleted table lists nothing", () => {
  const tables = [T("a"), T("b"), T("c"), T("d")];
  const { favourites, others } = splitFavourites(tables, ["c", "a", "gone"]);
  assert.deepEqual(favourites.map((t) => t.uuid), ["a", "c"]);
  assert.deepEqual(others.map((t) => t.uuid), ["b", "d"]);
});

test("with nothing starred every table is in the other list", () => {
  const tables = [T("a"), T("b")];
  assert.deepEqual(splitFavourites(tables, []).others, tables);
  assert.deepEqual(splitFavourites(tables, undefined).favourites, []);
});
