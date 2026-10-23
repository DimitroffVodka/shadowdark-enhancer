/**
 * Design-harness engine resolution — the wrappers must find a real engine and
 * never resolve to themselves.
 *
 * `engine.mjs` exits the process when no candidate is a usable engine, so each
 * case runs in a child with HOME pointed at an empty directory: the fallback
 * candidates then cannot resolve to a real checkout on the machine running the
 * suite. A candidate needs both `shot.mjs` and `serve.mjs`; accepting this
 * checkout's own folder made the wrapper import itself and die as an unsettled
 * top-level await (exit 13, no PNG, no message of ours).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE = path.join(ROOT, "tools", "design-harness");
const ENGINE_URL = pathToFileURL(path.join(ENGINE, "engine.mjs")).href;

/** Resolve one candidate in a child process: a rejected engine exits that process. */
function resolve(candidate) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sde-engine-home-"));
  try {
    const probe = `import(${JSON.stringify(ENGINE_URL)}).then((m) => console.log(m.engineUrl("shot.mjs")))`;
    return spawnSync(process.execPath, ["--input-type=module", "-e", probe], {
      cwd: home,
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home, FOUNDRY_DESIGN_HARNESS: candidate },
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test("this checkout's own wrapper folder is not accepted as the engine", () => {
  const run = resolve(ENGINE);
  assert.equal(run.status, 2, run.stderr || run.stdout);
  assert.match(run.stderr, /design harness engine not found/);
  assert.match(run.stderr, /set FOUNDRY_DESIGN_HARNESS/);
});

test("a candidate engine with shot.mjs but no serve.mjs is not accepted", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sde-engine-partial-"));
  try {
    fs.writeFileSync(path.join(dir, "shot.mjs"), "// no serve.mjs beside it\n");
    const run = resolve(dir);
    assert.equal(run.status, 2, run.stderr || run.stdout);
    assert.match(run.stderr, /design harness engine not found/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a folder carrying both files resolves to its own shot.mjs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sde-engine-real-"));
  try {
    fs.writeFileSync(path.join(dir, "shot.mjs"), "// engine stand-in\n");
    fs.writeFileSync(path.join(dir, "serve.mjs"), "// engine stand-in\n");
    const run = resolve(dir);
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.equal(run.stdout.trim(), pathToFileURL(path.join(dir, "shot.mjs")).href);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
