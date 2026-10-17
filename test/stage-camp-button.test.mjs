import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the template has the Show camp picture button twice (empty and camp states), each behind isGM, a secondary button", () => {
  const hbs = read("templates/camping/camping.hbs");
  const buttons = hbs.match(/<button[^>]*data-action="showCampPicture"[^>]*>/g) ?? [];
  assert.equal(buttons.length, 2);
  for (const b of buttons) assert.doesNotMatch(b, /primary/);
  assert.equal((hbs.match(/\{\{#if isGM\}\}<button[^>]*showCampPicture/g) ?? []).length, 2);
});

test("the action is on CampingApp (the Party sheet routes the embedded button to it), refuses a non-GM and raises for the window's party", async () => {
  globalThis.foundry = { applications: { api: { ApplicationV2: class { constructor() {} }, HandlebarsApplicationMixin: (B) => B } } };
  globalThis.game = { user: { isGM: false } };
  const { CampingApp } = await import("../scripts/camping/camping-app.mjs");
  const action = CampingApp.DEFAULT_OPTIONS.actions.showCampPicture;
  assert.equal(typeof action, "function");
  const party = { id: "p1" };
  const stage = await import("../scripts/stage/stage.mjs");
  let written = null;
  globalThis.game.settings = { get: () => null, set: async (m, k, v) => { written = v; } };
  globalThis.game.actors = { contents: [] };
  await action.call({ party });
  assert.equal(written, null, "a player does nothing");
  globalThis.game.user.isGM = true;
  await action.call({ party });
  assert.equal(written.shown, true);
  assert.equal(written.partyId, "p1");
  void stage;
});

test("the party sheet routes embedded camping actions to CampingApp's actions", () => {
  assert.match(read("scripts/party/party-app.mjs"), /DEFAULT_OPTIONS\.actions\[el\.dataset\.activityAction\]\?\.call\(app/);
});
