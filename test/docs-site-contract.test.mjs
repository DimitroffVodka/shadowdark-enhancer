/**
 * Documentation-site contract — keeps the published manual and its Pages
 * workflow explicit. The manual source remains docs/wiki/; this suite checks
 * that the static-site configuration does not silently drop a page or deploy
 * a pull request/non-master build.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIKI = path.join(ROOT, "docs", "wiki");
const CONFIG = path.join(ROOT, "mkdocs.yml");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "docs-pages.yml");
const LEGACY_HOME = ["Home", "md"].join(".");

const read = file => fs.readFileSync(file, "utf8");

function markdownFiles(dir, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(dir, relative));
    else if (entry.name.endsWith(".md")) files.push(relative.split(path.sep).join("/"));
  }
  return files;
}

function configuredMarkdownPages(config) {
  return [...config.matchAll(/^\s+-\s+[^:\n]+:\s+([^\s#]+\.md)\s*$/gm)]
    .map(match => match[1])
    .filter(target => !target.includes("://"));
}

describe("documentation site contract", () => {
  test("every manual Markdown page is present in explicit navigation", () => {
    const config = read(CONFIG);
    const manual = markdownFiles(WIKI).sort();
    const navigated = configuredMarkdownPages(config).sort();

    assert.ok(config.includes("nav:"), "mkdocs.yml must define explicit nav");
    assert.deepEqual(
      navigated,
      manual,
      "mkdocs.yml navigation must list every docs/wiki Markdown page exactly once",
    );
  });

  test("the root page is index.md and no stale legacy-home reference remains", () => {
    assert.ok(fs.existsSync(path.join(WIKI, "index.md")), "docs/wiki/index.md is required");
    assert.equal(fs.existsSync(path.join(WIKI, LEGACY_HOME)), false, "the legacy home page must be renamed");

    const files = [
      ...markdownFiles(WIKI).map(file => path.join(WIKI, file)),
      path.join(ROOT, "README.md"),
      ...fs.readdirSync(path.join(ROOT, "test"))
        .filter(file => file.endsWith(".mjs"))
        .map(file => path.join(ROOT, "test", file)),
      CONFIG,
      WORKFLOW,
    ];
    const stale = files.filter(file => read(file).includes(LEGACY_HOME));
    assert.deepEqual(stale, [], `stale legacy-home references:\n  ${stale.join("\n  ")}`);
  });

  test("Pages deployment is strict, PR-safe, and master-only", () => {
    const workflow = read(WORKFLOW);
    assert.match(workflow, /pull_request:/, "PR validation trigger is required");
    assert.match(workflow, /workflow_dispatch:/, "manual recovery trigger is required");
    assert.match(workflow, /mkdocs build --strict/, "the build must fail on warnings");

    const deploy = workflow.match(/\n\s{2}deploy:\n([\s\S]*)$/)?.[1] ?? "";
    assert.match(deploy, /if:\s+.*github\.event_name\s*!=\s*['"]pull_request['"]/);
    assert.match(deploy, /github\.ref\s*==\s*['"]refs\/heads\/master['"]/);
    assert.match(workflow, /push:\n\s+branches:\n\s+-\s+master/);
    assert.match(deploy, /uses:\s+actions\/deploy-pages@v4/);
    assert.match(deploy, /pages:\s+write/);
    assert.match(deploy, /id-token:\s+write/);
  });

  test("documentation dependency and public site URL are pinned", () => {
    assert.equal(read(path.join(ROOT, "requirements-docs.txt")).trim(), "mkdocs-material==9.7.7");
    assert.match(read(CONFIG), /^site_url:\s+https:\/\/dimitroffvodka\.github\.io\/shadowdark-enhancer\/$/m);
  });
});
