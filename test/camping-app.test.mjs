import test from "node:test";
import assert from "node:assert/strict";
globalThis.foundry = { applications: { api: { ApplicationV2: class { render() {} }, HandlebarsApplicationMixin: base => base } } };
const { CampingApp } = await import("../scripts/camping/camping-app.mjs");
test("owner input made while the previous choice is saving is queued, never silently dropped", async () => {
  const calls = []; let release;
  const held = new Promise(resolve => { release = resolve; });
  globalThis.game = { user: { isGM: false, hasPermission: () => true }, users: { activeGM: { query: async (_name, data) => { calls.push(data); if (calls.length === 1) await held; return { ok: true }; } } } };
  const app = new CampingApp({ id: "party" });
  const first = app.change("select", { uuid: "pc", patch: { task: "craft" } });
  await new Promise(resolve => setImmediate(resolve));
  const second = app.change("select", { uuid: "pc", patch: { craft: "repair" } });
  release(); await Promise.all([first, second]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(c => c.patch), [{ task: "craft" }, { craft: "repair" }]);
});
