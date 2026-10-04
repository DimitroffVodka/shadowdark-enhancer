import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TAGGER_TABS, resolveTab } from "../scripts/hex-map/hex-tagger-tabs.mjs";

const template = readFileSync(new URL("../templates/hex-tagger.hbs", import.meta.url), "utf8");
const app = readFileSync(new URL("../scripts/hex-map/hex-tagger-app.mjs", import.meta.url), "utf8");

test("a chosen tab is kept when the scene still offers it", () => {
  const all = { origin: true, showMore: true };
  for (const { id } of TAGGER_TABS) assert.equal(resolveTab(id, all), id);
});

test("a tab the scene does not offer, or an unknown one, falls back to Sheet", () => {
  assert.equal(resolveTab(undefined, {}), "sheet");
  assert.equal(resolveTab("nope", { origin: true, showMore: true }), "sheet");
  assert.equal(resolveTab("terrains", { origin: false, showMore: true }), "sheet");
  assert.equal(resolveTab("data", { origin: true, showMore: false }), "sheet");
  assert.equal(resolveTab("settings", {}), "sheet");
  assert.equal(resolveTab("map", {}), "map");
});

test("the template renders the remembered tab's radio checked and no other", () => {
  for (const { id } of TAGGER_TABS) {
    assert.match(template, new RegExp(`data-hxt-tab="${id}" \\{\\{#if \\(eq tab "${id}"\\)\\}\\}checked\\{\\{/if\\}\\}`));
  }
  assert.equal((template.match(/name="_hxtTab"/g) ?? []).length, TAGGER_TABS.length);
});

test("the app records a tab change and passes the resolved tab to the template", () => {
  assert.match(app, /input\[name='_hxtTab'\]/);
  assert.match(app, /this\._tab = radio\.dataset\.hxtTab/);
  assert.match(app, /resolveTab\(this\._tab,/);
});
