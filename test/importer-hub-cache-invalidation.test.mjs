import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../scripts/importer/importer-hub-commit.mjs", import.meta.url),
  "utf8",
);
const manageSource = readFileSync(
  new URL("../scripts/importer/importer-hub-manage.mjs", import.meta.url),
  "utf8",
);

test("monster commit invalidates census and Manage-tree caches before rendering", () => {
  const body = source.match(
    /async _onHubCommitMonsters\(\) \{(?<body>[\s\S]*?)\n\s{2}\}\n\n\s{2}\/\*\* Commit: create all pending boats/,
  )?.groups?.body;

  assert.ok(body, "monster commit handler not found");
  const invalidateAt = body.indexOf("this._invalidateMonstersCache()");
  const renderAt = body.indexOf("this.render()");
  assert.ok(invalidateAt >= 0, "monster commit must invalidate its live census/Manage cache");
  assert.ok(renderAt > invalidateAt, "cache invalidation must happen before the post-commit render");
});

test("mount unlock preserves its type and the monster commit routes mounts", () => {
  assert.match(manageSource, /const type = target\.dataset\.type/);
  assert.match(manageSource, /this\._importSeed = \{ name, src, type,/);

  const body = source.match(
    /async _onHubCommitMonsters\(\) \{(?<body>[\s\S]*?)\n\s{2}\}\n\n\s{2}\/\*\* Commit: create all pending boats/,
  )?.groups?.body;
  assert.ok(body, "monster commit handler not found");
  assert.match(body, /this\._importSeed\?\.type === "Mount"/);
  assert.match(body, /MountImporter\.createMounts/);
});
