import { test } from "node:test";
import assert from "node:assert/strict";
import { compareVersions, headline, readNotes, notesBetween, checkWhatsNew } from "../scripts/shared/whats-new.mjs";

const CHANGELOG = `# Changelog

## [Unreleased]
### Added
- **Not shipped yet.** Nobody should see this.

## [0.18.0] — 2026-10-20
### Added
- **Ride a mount on the map.** A horse button on the Token HUD
  climbs onto the nearest free mount.
- Plain bullet without a lead-in. It has a second sentence.
### Changed
- The crawl bar is slimmer.
### Fixed
- Camp: a camp made before dawn no longer runs until evening.
- Chat: a dice card showed only its formula.

## [0.17.3] — 2026-09-16
### Fixed
- **Window header icons.** Restored.

## [0.17.2] — 2026-09-16
### Added
- **Patrons reach the builder.** Importing a boon table creates the Patron.
`;

test("versions compare as dotted numbers", () => {
  assert.equal(compareVersions("0.17.3", "0.18.0"), -1);
  assert.equal(compareVersions("0.18.0", "0.18"), 0);
  assert.equal(compareVersions("0.100.0", "0.18.0"), 1);
});

test("a headline is the bold lead-in, else the first sentence", () => {
  assert.equal(headline("**Ride a mount on the map.** A horse button"), "Ride a mount on the map");
  assert.equal(headline("Plain bullet without a lead-in. A second."), "Plain bullet without a lead-in.".replace(/\.$/, ""));
  assert.match(headline(`**${"x".repeat(200)}** tail`), /…$/);
});

test("notes count Changed and Fixed and headline Added, wrapped bullets included", () => {
  const section = CHANGELOG.split("## [0.18.0] — 2026-10-20\n")[1].split("## [0.17.3]")[0].split("\n");
  assert.deepEqual(readNotes(section), {
    added: ["Ride a mount on the map", "Plain bullet without a lead-in"], changed: 1, fixed: 2,
  });
});

test("a Highlights section replaces the Added headlines", () => {
  const n = readNotes(["### Highlights", "- **The big one.** Why.", "### Added", "- **Small.** x", "### Fixed", "- a"]);
  assert.deepEqual(n, { added: ["The big one"], changed: 0, fixed: 1 });
});

test("a range excludes Unreleased and what the user already has", () => {
  assert.deepEqual(notesBetween(CHANGELOG, "0.17.3", "0.18.0").added.length, 2);
  const all = notesBetween(CHANGELOG, "0.17.1", "0.18.0");
  assert.equal(all.added.length, 3);
  assert.equal(all.fixed, 3);
  assert.deepEqual(notesBetween(CHANGELOG, null, "0.18.0").fixed, 2);   // no record: just this version
});

const deps = (over = {}) => {
  const calls = { wrote: [], shown: [] };
  return {
    calls,
    deps: {
      version: "0.18.0", seen: "0.17.3", history: true,
      write: async (v) => { calls.wrote.push(v); },
      load: async () => CHANGELOG,
      show: async (v, n) => { calls.shown.push([v, n]); },
      ...over,
    },
  };
};

test("an update is shown once and stamped", async () => {
  const { calls, deps: d } = deps();
  const notes = await checkWhatsNew(d);
  assert.equal(calls.shown.length, 1);
  assert.equal(notes.added.length, 2);
  assert.deepEqual(calls.wrote, ["0.18.0"]);
});

test("the same version is silent", async () => {
  const { calls, deps: d } = deps({ seen: "0.18.0" });
  assert.equal(await checkWhatsNew(d), null);
  assert.deepEqual([calls.shown.length, calls.wrote.length], [0, 0]);
});

test("a fresh install is seeded without a window", async () => {
  const { calls, deps: d } = deps({ seen: "", history: false });
  assert.equal(await checkWhatsNew(d), null);
  assert.deepEqual([calls.shown.length, calls.wrote], [0, ["0.18.0"]]);
});

test("an existing world's first load with this feature shows the current release", async () => {
  const { calls, deps: d } = deps({ seen: "", history: true });
  await checkWhatsNew(d);
  assert.equal(calls.shown.length, 1);
  assert.equal(calls.shown[0][1].fixed, 2);
});

test("a changelog that will not load is not stamped, so the next load retries", async () => {
  const { calls, deps: d } = deps({ load: async () => { throw new Error("404"); } });
  await assert.rejects(checkWhatsNew(d));
  assert.deepEqual(calls.wrote, []);
});

test("a version with no changelog section is stamped and silent", async () => {
  const { calls, deps: d } = deps({ version: "0.19.0", seen: "0.18.0" });
  assert.equal(await checkWhatsNew(d), null);
  assert.deepEqual([calls.shown.length, calls.wrote], [0, ["0.19.0"]]);
});

// The entry script cannot be imported in Node, so this reads its source (as ancestry-adopt.test.mjs does).
// The What's new check was once written inside the GM-only block of the ready hook, where no player's
// browser ever ran it; the unit tests above inject everything and could not see that.
test("the ready hook runs What's new for every user, then the importer prompts for the active GM only", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../scripts/shadowdark-enhancer.mjs", import.meta.url), "utf8");
  const gmStart = src.indexOf("\n  if (game.user.isGM) {\n");
  const gmEnd = src.indexOf("\n  }\n});", gmStart);
  const check = src.indexOf("await checkWhatsNew({");
  const read = src.indexOf('const ranBefore = !!game.settings.get(MODULE_ID, "backfillVersion")');
  assert.ok(gmStart > -1 && gmEnd > gmStart, "the GM-only block of the ready hook was not found");
  assert.ok(check > -1 && read > -1, "the ready hook no longer runs the What's new check");
  const outside = (at) => at < gmStart || at > gmEnd;
  assert.ok(outside(check) && outside(read), "What's new must run on every client, outside the GM-only block");
  // One timer, so an update shows one dialog at a time: What's new, then (active GM only) the importer prompts.
  const timer = src.slice(check, src.indexOf("}, 2500);", check));
  assert.match(timer, /checkWhatsNew[\s\S]*if \(!isActiveGM\(\)\) return;[\s\S]*checkImporterNews[\s\S]*checkFirstImport/);
});
