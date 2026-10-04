/**
 * Destructive confirmations default to the safe button: pressing Enter on a
 * delete / clear / overwrite prompt must not do the destructive thing, and the
 * buttons name their action. Source-level guard (no Foundry to render a dialog).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const en = JSON.parse(read("languages/en.json"));

// file → [yes label key, no label key] pairs the file's destructive confirms must carry.
const CONFIRMS = {
  "scripts/session-recap/session-recap-app.mjs": [["SDE.sessionRecap.dialog.deleteYes", "SDE.sessionRecap.dialog.keep"], ["SDE.sessionRecap.dialog.clearYes", "SDE.sessionRecap.dialog.keep"]],
  "scripts/hex-map/hex-tagger-app.mjs": [["SDE.hexMap.clear.yes", "SDE.hexMap.clear.keep"], ["SDE.hexMap.renumber.yes", "SDE.hexMap.renumber.no"], ["SDE.hexMap.playable.rebuildYes", "SDE.hexMap.playable.rebuildNo"]],
  "scripts/overland/overland.mjs": [["SDE.overland.day.restartYes", "SDE.overland.day.restartNo"]],
  "scripts/bastion/bastion-sheet.mjs": [["SDE.bastion.takeDown.yes", "SDE.bastion.takeDown.keep"]],
  "scripts/monster-art/token-art-manager-app.mjs": [["SDE.tokenArt.folder.removeYes", "SDE.tokenArt.folder.removeKeep"]],
  "scripts/rules-data/rules-data-app.mjs": [["SDE.rulesData.set.delete", "SDE.rulesData.set.keep"]],
  "scripts/merchant/merchant-shop.mjs": [["SDE.merchant.dialog.sellJunkYes", "SDE.merchant.dialog.cancel"], ["SDE.merchant.dialog.clearLogYes", "SDE.merchant.dialog.keep"], ["SDE.merchant.dialog.deleteConfigYes", "SDE.merchant.dialog.keep"]],
  "scripts/crawl-strip/crawl-tracker.mjs": [["SDE.crawlStrip.tracker.endCrawlYes", "SDE.crawlStrip.tracker.endCrawlNo"]],
  "scripts/monster-creator/level-guidelines-app.mjs": [["SDE.settings.levelGuidelines.reset", "SDE.settings.levelGuidelines.resetKeep"]],
};

test("destructive confirms name their buttons and default to the safe one", () => {
  for (const [file, pairs] of Object.entries(CONFIRMS)) {
    const src = read(file);
    for (const [yes, no] of pairs) {
      assert.ok(en[yes], `${yes} is in en.json`);
      assert.ok(en[no], `${no} is in en.json`);
      const at = src.indexOf(`"${yes}"`);
      assert.ok(at > -1, `${file} uses ${yes}`);
      const block = src.slice(at, src.indexOf("rejectClose", at) > -1 ? src.indexOf("rejectClose", at) : at + 400);
      assert.ok(block.includes(`"${no}"`), `${file}: ${yes} is paired with ${no}`);
      // the safe (no) button carries the autofocus; the destructive (yes) one never does
      const near = src.slice(at, at + 500);
      assert.match(near, new RegExp(`no: \\{[^\\n]*"${no}"[^\\n]*default: true`), `${file}: ${yes} confirm focuses ${no}`);
      assert.doesNotMatch(near, /yes: \{[^\n]*default: true/, `${file}: ${yes} is not the default button`);
    }
  }
});

test("the crawl bar's shared confirm passes labels and focuses the safe button", () => {
  const src = read("scripts/crawl-bar/crawl-bar.mjs");
  const at = src.indexOf("async _confirm(");
  assert.match(src.slice(at, at + 600), /no: \{[^\n]*default: true/);
  for (const k of ["endCrawlYes", "endCrawlNo"]) assert.ok(en[`SDE.crawlBar.confirm.${k}`]);
  for (const k of ["deleteEncounterYes", "deleteEncounterNo"]) assert.ok(en[`SDE.crawlBar.${k}`]);
  assert.match(src, /SDE\.crawlBar\.confirm\.endCrawlYes/);
  assert.match(src, /SDE\.crawlBar\.deleteEncounterYes/);
});

test("the importer's delete-copies dialogs default to Cancel", () => {
  const src = read("scripts/importer/importer-hub-manage.mjs");
  assert.doesNotMatch(src, /deleteCopies"\), default: true/);
  const cancels = src.match(/action: "cancel", label: t\("SDE\.importer\.btn\.cancel"\), default: true/g) ?? [];
  assert.equal(cancels.length, 2);
});

test("undoing a character-builder save defaults to Back", () => {
  const src = read("scripts/char-builder/existing-finish.mjs");
  assert.match(src, /no: \{ label: no, default: safeDefault \}/);
  assert.doesNotMatch(src, /defaultYes/);
  assert.match(src, /undoYes`\),[\s\S]{0,120}safeDefault: true/);
});
