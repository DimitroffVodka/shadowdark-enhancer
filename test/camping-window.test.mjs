import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, ROOT), "utf8");

test("the Camping template is built on the UI kit and keeps the hooks the JS uses", async () => {
  const hbs = await read("templates/camping/camping.hbs");
  assert.match(hbs, /^<section class="sde-ui ui-body sde-camping-body/);
  assert.ok(!/<fieldset|<legend/.test(hbs), "rows are hairline articles, not fieldsets");
  for (const hook of ['data-choice="task"', "data-fuel", "data-dc=", 'data-action="confirmChoice"', 'data-action="resolve"', 'data-action="night"', 'data-action="begin"']) assert.ok(hbs.includes(hook), hook);
  assert.ok(!/participate|partyRations|data-food|usePartyRations/.test(hbs));
});

test("the ration counter is the own-ration number next to the ham hock icon, with a tooltip", async () => {
  const [hbs, lang] = await Promise.all([read("templates/camping/camping.hbs"), read("languages/en.json").then(JSON.parse)]);
  assert.match(hbs, /data-tooltip="\{\{localize 'SDE\.camping\.rationsTip'\}\}"><b>\{\{meal\.own\}\}<\/b><img class="cp-ration" src="\/icons\/consumables\/food\/cooked-grilled-ham-hock-glazed-brown\.webp"/);
  assert.equal(lang["SDE.camping.rationsTip"], "Ration count");
});

test("every string the Camping template localizes exists in en.json, and no proposal keys leak in", async () => {
  const [hbs, lang] = await Promise.all([read("templates/camping/camping.hbs"), read("languages/en.json").then(JSON.parse)]);
  const keys = [...hbs.matchAll(/localize ['"]([^'"]+)['"]/g)].map(m => m[1]);
  assert.ok(keys.length > 20);
  for (const key of keys) assert.ok(key in lang, key);
  assert.ok(!hbs.includes("SDE.proposed"));
});

test("Camping uses no gold and no leftover party-sheet camping rules", async () => {
  const [css, party] = await Promise.all([read("styles/shadowdark-enhancer.css"), read("styles/party-sheet.css")]);
  const start = css.indexOf("/* Camping window");
  const block = css.slice(start, css.indexOf("/* Carousing window", start));
  assert.ok(block.length > 200 && !/gold|#c9aa58/i.test(block));
  assert.ok(!party.includes(".sde-camping-body"), "the old Camping selectors are gone from the Party sheet stylesheet");
});

test("the camping window context no longer builds the dropped food and rest status lines", async () => {
  const src = await read("scripts/camping/camping-app.mjs");
  assert.ok(!/foodStatus|restStatus/.test(src));
  assert.ok(src.includes('"sde-ui"'));
});

test("the embedded camping and carousing bodies hide the party-name title and keep the small text", async () => {
  const { readFile } = await import("node:fs/promises");
  const camping = await readFile(new URL("../templates/camping/camping.hbs", import.meta.url), "utf8");
  const carousing = await readFile(new URL("../templates/carousing/carousing.hbs", import.meta.url), "utf8");
  assert.match(camping, /\{\{#unless embedded\}\}\{\{title\}\} \{\{\/unless\}\}<small>\{\{phase\}\}/);
  assert.match(carousing, /\{\{#unless embedded\}\}\{\{title\}\} \{\{\/unless\}\}\{\{#if holiday\}\}<small>/);
});

test("the camping and carousing bodies declare no gap the kit's ui-body would override", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../styles/shadowdark-enhancer.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.sde-(camping|carousing)-body \{[^}]*\bgap:/);
});
