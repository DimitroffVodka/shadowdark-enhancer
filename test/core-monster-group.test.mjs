import test from "node:test";
import assert from "node:assert/strict";
import { CORE_TABLE_GROUPS } from "../scripts/importer/tables/core-table-groups.mjs";
import { findById, isMatrix } from "../scripts/importer/tables/table-manifest.mjs";

test("the Monster Generator and Make It Weird matrices are in the Manage tree, so Import everything reaches them", () => {
  const rows = CORE_TABLE_GROUPS.filter((g) => g.section === "rolltables").flatMap((g) => g.tables);
  for (const id of ["core-monster-generator", "core-monster-mutations"]) {
    const row = rows.find((t) => t.manifestId === id);
    assert.ok(row, `${id} has a row`);
    assert.ok(isMatrix(findById(id)), `${id} is split as a matrix`);
    assert.equal(row.page, findById(id).page);
  }
});
