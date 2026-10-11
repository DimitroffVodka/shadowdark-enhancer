/**
 * "What's new" — tell every user what an update changed, once.
 *
 * A module update used to be silent: the 3,000-line CHANGELOG.md ships in the
 * zip and sits on GitHub, and nobody opens it. On the first load after an
 * update this shows each user a short window built from that same file, so
 * there is no second place to write release notes.
 *
 * The record is the client setting `whatsNewSeen` (a version string), so it is kept per browser.
 * A user with no record, in a world the module has never run in, is a fresh
 * install: it is seeded silently, because "here is everything" is true and
 * useless on a first install.
 *
 * Reading the changelog:
 *   - `### Added` / `### Changed` / `### Fixed` sections are counted; the bold
 *     lead-in of each Added bullet is its headline.
 *   - A `### Highlights` section, when a release has one, replaces the Added
 *     headlines — for a release too big for the first dozen to mean anything.
 *   - `## [Unreleased]` is never shown.
 */
import { L as t } from "./i18n.mjs";
import { esc } from "./esc.mjs";
import { MODULE_ID } from "./module-id.mjs";

/** Client setting holding the last version this user was told about. Persisted — the key never changes. */
export const SEEN_SETTING = "whatsNewSeen";

/** How many addition headlines the window lists before "and N more". */
const SHOWN = 8;

const parts = (v) => String(v).split(".").map((n) => parseInt(n, 10) || 0);

/** -1, 0 or 1. Plain dotted numbers; a `-beta` suffix is ignored. */
export function compareVersions(a, b) {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The changelog split at its `## [x.y.z]` headings: [{ version, lines }]. */
export function releaseSections(text) {
  const out = [];
  let cur = null;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const h = /^## \[([^\]]+)\]/.exec(line);
    if (h) {
      cur = { version: h[1], lines: [] };
      out.push(cur);
    } else cur?.lines.push(line);
  }
  return out;
}

/** A bullet's headline: its bold lead-in, else its first sentence, cut to a line. */
export function headline(bullet) {
  const bold = /^\*\*(.+?)\*\*/.exec(bullet);
  const raw = bold ? bold[1] : bullet.split(/(?<=[.!?])\s/)[0];
  const clean = raw.replace(/[`*]/g, "").replace(/[.:\s]+$/, "").trim();
  return clean.length > 110 ? `${clean.slice(0, 107).trimEnd()}…` : clean;
}

/** Added headlines and Changed/Fixed counts of one section's lines. */
export function readNotes(lines) {
  const added = [];
  const highlights = [];
  let changed = 0;
  let fixed = 0;
  let kind = null;
  let bullet = null;
  const flush = () => {
    if (bullet === null) return;
    if (kind === "highlights") highlights.push(headline(bullet));
    else if (kind === "added") added.push(headline(bullet));
    else if (kind === "fixed") fixed++;
    else if (kind === "changed") changed++;
    bullet = null;
  };
  for (const line of lines) {
    const h = /^###\s+(.+?)\s*$/.exec(line);
    if (h) {
      flush();
      const name = h[1].toLowerCase();
      kind = name.startsWith("highlight") ? "highlights" : name.startsWith("add") ? "added" : name.startsWith("fix") ? "fixed" : "changed";
    } else if (/^- /.test(line)) {
      flush();
      bullet = line.slice(2).trim();
    } else if (bullet !== null && /^\s+\S/.test(line)) {
      bullet += ` ${line.trim()}`;   // a wrapped bullet continues on an indented line
    } else if (!line.trim() || /^#{1,4}\s/.test(line)) flush();
  }
  flush();
  return { added: highlights.length ? highlights : added, changed, fixed };
}

/**
 * What the releases after `from` up to and including `to` changed. A user with
 * no record (`from` null) is shown just `to`.
 */
export function notesBetween(text, from, to) {
  const wanted = releaseSections(text).filter(({ version }) =>
    version.toLowerCase() !== "unreleased" && compareVersions(version, to) <= 0
    && (from ? compareVersions(version, from) > 0 : compareVersions(version, to) === 0));
  const all = { added: [], changed: 0, fixed: 0 };
  for (const s of wanted) {
    const n = readNotes(s.lines);
    all.added.push(...n.added);
    all.changed += n.changed;
    all.fixed += n.fixed;
  }
  return all;
}

/** The window. Dismissing it is the same as "Got it": it is shown once. */
export async function showWhatsNew(version, notes) {
  const { added, changed, fixed } = notes;
  const url = globalThis.game?.modules?.get(MODULE_ID)?.url;
  const rest = [changed && t("SDE.whatsNew.changed", { n: changed }), fixed && t("SDE.whatsNew.fixed", { n: fixed })].filter(Boolean);
  const content = [
    added.length ? `<p>${t("SDE.whatsNew.intro", { version })}</p>` : "",
    added.length ? `<ul>${added.slice(0, SHOWN).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : "",
    added.length > SHOWN ? `<p>${t("SDE.whatsNew.more", { n: added.length - SHOWN })}</p>` : "",
    rest.length ? `<p>${t("SDE.whatsNew.also", { parts: rest.join(", ") })}</p>` : "",
    url ? `<p><a href="${esc(`${url}/releases/tag/v${version}`)}" target="_blank" rel="noopener">${t("SDE.whatsNew.full")}</a></p>` : "",
  ].join("");
  await foundry.applications.api.DialogV2.prompt({
    classes: ["sde-ui", "sde-dialog"],
    window: { title: t("SDE.whatsNew.title", { version }) },
    content,
    ok: { label: t("SDE.whatsNew.ok") },
    rejectClose: false,
  });
}

/** The shipped CHANGELOG.md. Throws when it cannot be read, so the caller does not stamp the version. */
async function loadChangelog() {
  const res = await fetch(foundry.utils.getRoute(`modules/${MODULE_ID}/CHANGELOG.md`));
  if (!res.ok) throw new Error(`CHANGELOG.md ${res.status}`);
  return res.text();
}

/**
 * Show this user what the update changed, if they have not seen it. At most
 * once per version: every other load is one comparison and a return.
 *
 * @param {object} deps
 * @param {string} deps.version        this module's version
 * @param {string} deps.seen           the user's last-seen version ("" when none)
 * @param {boolean} deps.history       the module has run in this world before (tells an update from a fresh install)
 * @param {(v:string)=>Promise} deps.write
 * @param {()=>Promise<string>} [deps.load]
 * @param {(v:string, n:object)=>Promise} [deps.show]
 * @returns {Promise<object|null>} the notes shown, or null when nothing was
 */
export async function checkWhatsNew({ version, seen, history, write, load = loadChangelog, show = showWhatsNew } = {}) {
  if (!version || seen === version) return null;
  if (!seen && !history) {
    await write(version);
    return null;
  }
  const notes = notesBetween(await load(), seen || null, version);
  await write(version);   // after the read: a changelog that would not load is retried next time
  if (!notes.added.length && !notes.changed && !notes.fixed) return null;
  await show(version, notes);
  return notes;
}
