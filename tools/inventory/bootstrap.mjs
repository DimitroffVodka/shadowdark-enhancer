#!/usr/bin/env node
/**
 * ONE-TIME migration: seed dev/inventory/data.json from the descriptions
 * already written into docs/FILE-INVENTORY.md, then rewrite the doc with the
 * generator's marker regions in place. After this runs, `npm run inventory`
 * owns the derived parts and data.json owns the prose.
 *
 * Kept in-tree for reproducibility; not part of the normal workflow.
 */

import fs from "node:fs";
import path from "node:path";
import { INVENTORY_MD, DATA_JSON, scriptFiles, assignSections, render } from "./lib.mjs";

const md = fs.readFileSync(INVENTORY_MD, "utf8");
const lines = md.split("\n");

const findLine = (re) => lines.findIndex((l) => re.test(l));
const statsStart = findLine(/tracked files/);
const verLine = findLine(/^`v[\d.]+` in both|version mismatch/);
const sec3 = findLine(/^## 3\.\s/);
const sec4 = findLine(/^## 4\.\s/);
if ([statsStart, verLine, sec3, sec4].some((i) => i < 0)) {
  throw new Error("could not locate the stats / §3 / §4 boundaries");
}
// Keep any `---` separator that sits just above `## 4.` in the trailing prose.
let tailStart = sec4;
let j = sec4 - 1;
while (j > sec3 && lines[j].trim() === "") j--;
if (lines[j].trim() === "---") tailStart = j;

// --- parse the §3 subsections ------------------------------------------------
const parseRow = (l) => {
  const c = l.split("|");
  return {
    cell: c[1].trim().replace(/`/g, ""),
    desc: c.slice(3, c.length - 1).join("|").trim().replace(/\\\|/g, "|"),
  };
};

const block = lines.slice(sec3, tailStart);
const heads = [];
block.forEach((l, i) => {
  if (/^### 3\.\d+\s/.test(l)) heads.push(i);
});

const parsed = [];
for (let k = 0; k < heads.length; k++) {
  const sub = block.slice(heads[k], k + 1 < heads.length ? heads[k + 1] : block.length);
  const id = sub[0].match(/^### (3\.\d+)/)[1];
  const title = sub[0].replace(/^### 3\.\d+\s+/, "").trim();
  const dirMatch = title.match(/`(scripts\/[^`]*)`/);
  const dir = dirMatch ? dirMatch[1].replace(/\/$/, "") : null;
  if (!dir) throw new Error(`§${id} title has no scripts/ path: ${title}`);

  const rows = [];
  let lastRow = -1;
  for (let i = 1; i < sub.length; i++) {
    const l = sub[i];
    if (!l.startsWith("|")) continue;
    if (/\|\s*File\s*\|/i.test(l) || /^\|[\s|:-]*\|$/.test(l)) continue;
    rows.push(parseRow(l));
    lastRow = i;
  }
  const note = (lastRow >= 0 ? sub.slice(lastRow + 1) : []).join("\n").trim();
  parsed.push({ id, dir, title, note, rows });
}

// --- resolve each File cell to a real tracked path ---------------------------
const files = scriptFiles();
const { byId, unassigned } = assignSections(parsed, files);
const descriptions = {};
const order = {};
const unresolved = [];
for (const sec of parsed) {
  order[sec.id] = [];
  const present = byId.get(sec.id) ?? [];
  const presentSet = new Set(present);
  const byBase = new Map();
  for (const p of present) {
    const b = path.posix.basename(p);
    byBase.set(b, [...(byBase.get(b) ?? []), p]);
  }
  for (const { cell, desc } of sec.rows) {
    const full = `${sec.dir}/${cell}`;
    let resolved = null;
    if (presentSet.has(full)) resolved = full;
    else {
      const cands = byBase.get(path.posix.basename(cell)) ?? [];
      if (cands.length === 1) resolved = cands[0];
    }
    if (!resolved) {
      unresolved.push(`§${sec.id}: "${cell}"`);
      continue;
    }
    descriptions[resolved] = desc;
    order[sec.id].push(resolved);
  }
}

const data = {
  _note:
    "Source of truth for docs/FILE-INVENTORY.md §3 descriptions. Line counts " +
    "and the file list are DERIVED by `npm run inventory` — edit only titles, " +
    "notes, ordering and descriptions here.",
  sections: parsed.map((s) => ({ id: s.id, dir: s.dir, title: s.title, note: s.note })),
  order,
  descriptions,
};

// --- rebuild the doc with marker regions, then fill them ---------------------
const marked = [
  ...lines.slice(0, statsStart),
  "<!-- inventory:stats:start -->",
  "<!-- inventory:stats:end -->",
  ...lines.slice(verLine + 1, sec3),
  "<!-- inventory:scripts:start -->",
  "<!-- inventory:scripts:end -->",
  ...lines.slice(tailStart),
].join("\n");

const { md: finalMd, warnings } = render(data, marked);

fs.writeFileSync(DATA_JSON, JSON.stringify(data, null, 2) + "\n");
fs.writeFileSync(INVENTORY_MD, finalMd.endsWith("\n") ? finalMd : finalMd + "\n");

console.log(`sections: ${parsed.length}`);
console.log(`descriptions seeded: ${Object.keys(descriptions).length}`);
console.log(`tracked scripts/*.mjs: ${files.length}`);
if (unassigned.length) console.log(`UNASSIGNED files: ${unassigned.join(", ")}`);
if (unresolved.length) console.log(`UNRESOLVED rows (dropped): ${unresolved.join(" | ")}`);
for (const w of warnings) console.log(`warn: ${w}`);
