import test from "node:test";
import assert from "node:assert/strict";
import { extrasHexApi, handoffDataset } from "../scripts/importer/hex/hex-handoff.mjs";

const clean = () => {
  delete globalThis.game;
  delete globalThis.ui;
  delete globalThis.foundry;
  delete globalThis.saveDataToFile;
};

test.afterEach(clean);

test("handoff is GM-only even when a builder is exposed", async () => {
  let calls = 0;
  globalThis.game = { user: { isGM: false }, shadowdarkExtras: { hex: { buildHexcrawl: async () => { calls++; } } } };
  globalThis.ui = { notifications: { warn: () => {} } };
  assert.deepEqual(await handoffDataset({ name: "Test" }), { via: "none", reason: "not-gm" });
  assert.equal(calls, 0);
});

test("compatible namespace receives a GM handoff", async () => {
  globalThis.game = { user: { isGM: true }, shadowdarkExtras: { hex: { buildHexcrawl: async (ds) => ({ name: ds.name }) } } };
  const result = await handoffDataset({ name: "Test" });
  assert.deepEqual(result, { via: "extras", summary: { name: "Test" } });
});

test("raw module.api is not treated as the compatible builder", async () => {
  let saved;
  globalThis.game = { user: { isGM: true }, modules: { get: () => ({ api: { buildHexcrawl: () => { throw new Error("wrong contract"); } } }) } };
  globalThis.foundry = { utils: { saveDataToFile: (body, type, filename) => { saved = { body, type, filename }; } } };
  assert.equal(extrasHexApi(), null);
  assert.deepEqual(await handoffDataset({ name: "Test Map" }), { via: "download", filename: "test-map-hexcrawl.json" });
  assert.equal(saved.type, "text/json");
  assert.match(saved.body, /Test Map/);
});

test("a failed compatible handoff falls back to the JSON download", async () => {
  let saved;
  globalThis.game = { user: { isGM: true }, shadowdarkExtras: { hex: { buildHexcrawl: async () => { throw new Error("builder failed"); } } } };
  globalThis.foundry = { utils: { saveDataToFile: (body, type, filename) => { saved = { body, type, filename }; } } };
  globalThis.ui = { notifications: { error: () => {} } };
  assert.deepEqual(await handoffDataset({ name: "Test" }), { via: "download", filename: "test-hexcrawl.json", reason: "extras-error" });
  assert.ok(saved);
});
