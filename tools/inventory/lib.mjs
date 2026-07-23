/**
 * File-inventory generator — shared helpers.
 *
 * The §3.x `scripts/` tables in docs/FILE-INVENTORY.md carry a Lines column and
 * a per-file description. Line counts and the file set are DERIVED here (from
 * `git ls-files` + newline counts); only the descriptions, section titles and
 * curated ordering are hand-edited, in dev/inventory/data.json.
 *
 * Nothing here touches Foundry — it is pure filesystem + git, run under Node
 * via `npm run inventory`.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const INVENTORY_MD = path.join(ROOT, "docs", "FILE-INVENTORY.md");
export const DATA_JSON = path.join(ROOT, "tools", "inventory", "data.json");

/** Tracked files (optionally matching a git pathspec), repo-relative, posix. */
export function trackedFiles(pathspec) {
  const args = ["ls-files", ...(pathspec ? [pathspec] : [])];
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

/** `wc -l` semantics: number of newline bytes in the file. */
export function lineCount(relPath) {
  const buf = fs.readFileSync(path.join(ROOT, relPath));
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
  return n;
}

/** The .mjs files the §3 tables are responsible for. */
export function scriptFiles() {
  return trackedFiles("scripts/*").filter((f) => f.endsWith(".mjs"));
}

/**
 * Assign each file to the section whose `dir` is its longest path-prefix.
 * `scripts` (§3.1) is a prefix of everything, so it only ever catches the
 * root entry file; deeper section dirs win.
 */
export function assignSections(sections, files) {
  const byLongest = [...sections].sort((a, b) => b.dir.length - a.dir.length);
  const byId = new Map(sections.map((s) => [s.id, []]));
  const unassigned = [];
  for (const f of files) {
    const dir = path.posix.dirname(f);
    const sec = byLongest.find((s) => dir === s.dir || dir.startsWith(s.dir + "/"));
    if (sec) byId.get(sec.id).push(f);
    else unassigned.push(f);
  }
  return { byId, unassigned };
}

/** Description cells are single-line; escape the table delimiter. */
const escCell = (s) => String(s).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();

/**
 * Render the whole §3 block (heading + every subsection table) from config.
 * Returns { text, warnings } — warnings list new/removed/unassigned files so a
 * human notices drift even though the generator handles it gracefully.
 */
export function renderScripts(data) {
  const files = scriptFiles();
  const { byId, unassigned } = assignSections(data.sections, files);
  const warnings = [];
  if (unassigned.length) {
    warnings.push(`files under scripts/ with no section: ${unassigned.join(", ")}`);
  }

  const out = ["## 3. `scripts/` — module code (feature-folder layout)", ""];
  for (const sec of data.sections) {
    const present = byId.get(sec.id) ?? [];
    const presentSet = new Set(present);
    const configured = (data.order[sec.id] ?? []).filter((p) => presentSet.has(p));
    const configuredSet = new Set(configured);
    const added = present.filter((p) => !configuredSet.has(p)).sort();
    const removed = (data.order[sec.id] ?? []).filter((p) => !presentSet.has(p));
    if (added.length) warnings.push(`new in §${sec.id} (needs a description): ${added.join(", ")}`);
    if (removed.length) warnings.push(`gone from §${sec.id} (row dropped): ${removed.join(", ")}`);

    out.push(`### ${sec.id} ${sec.title}`, "");
    out.push("| File | Lines | Description |", "|---|---:|---|");
    for (const p of [...configured, ...added]) {
      const rel = path.posix.relative(sec.dir, p);
      const desc = data.descriptions[p] ?? "**TODO: describe**";
      out.push(`| \`${rel}\` | ${lineCount(p)} | ${escCell(desc)} |`);
    }
    out.push("");
    if (sec.note && sec.note.trim()) out.push(sec.note.trim(), "");
  }
  return { text: out.join("\n").trimEnd() + "\n", warnings };
}

/** Render the two derived lines of the header stat block. */
export function renderStats() {
  const all = trackedFiles();
  const loc = all
    .filter((f) => /^(scripts|templates|styles|test)\//.test(f))
    .reduce((n, f) => n + lineCount(f), 0);
  const rounded = (Math.round(loc / 100) * 100).toLocaleString("en-US");
  const mod = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8")).version;
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const ver =
    mod === pkg
      ? `\`v${mod}\` in both \`module.json\` and \`package.json\`.`
      : `⚠️ version mismatch: \`module.json\` v${mod}, \`package.json\` v${pkg}.`;
  return (
    `${all.length} tracked files · ~${rounded} lines of code/markup ` +
    `across scripts+templates+styles+test.\n${ver}`
  );
}

/** Replace the content between a marker pair, leaving everything else verbatim. */
export function splice(md, name, content) {
  const start = `<!-- inventory:${name}:start -->`;
  const end = `<!-- inventory:${name}:end -->`;
  const s = md.indexOf(start);
  const e = md.indexOf(end);
  if (s < 0 || e < 0) throw new Error(`FILE-INVENTORY.md is missing the ${name} markers`);
  return md.slice(0, s + start.length) + "\n" + content.trimEnd() + "\n" + md.slice(e);
}

/** Produce the full FILE-INVENTORY.md from the current doc + config + git. */
export function render(data, currentMd) {
  const scripts = renderScripts(data);
  let md = currentMd;
  md = splice(md, "stats", renderStats());
  md = splice(md, "scripts", scripts.text);
  return { md, warnings: scripts.warnings };
}

export function loadData() {
  return JSON.parse(fs.readFileSync(DATA_JSON, "utf8"));
}
