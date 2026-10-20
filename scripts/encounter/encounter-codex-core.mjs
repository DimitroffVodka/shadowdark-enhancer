/**
 * Shadowdark Enhancer — the Encounters Met codex, the pure part.
 *
 * The party's own record of what it has met: one journal page a region, each
 * entry the day and hour, the place, and the creature (its art, how many, and
 * how it was behaving) or the row's own text for a find. encounter-codex.mjs
 * writes the entry and its page; this file only shapes a page's HTML, so the
 * same page can be rebuilt from its flag after any edit.
 */

import { esc } from "../shared/esc.mjs";

/**
 * One entry's identity, so a show and then a battle map of the same encounter
 * are one line: the draw's own id, or (for a draw from before ids) the hour and
 * what it was.
 * @param {object} entry
 * @returns {string}
 */
export function entryKey(entry) {
  if (entry?.id) return String(entry.id);
  const what = entry?.kind === "monster"
    ? `${entry.name ?? ""}/${entry.count ?? 1}`
    : String(entry?.text ?? entry?.heading ?? "").slice(0, 60);
  return `${Math.floor((Number(entry?.at) || 0) / 60)}|${entry?.kind ?? ""}|${what}`;
}

/** Newest first: the page reads as a log. */
export function newestFirst(entries) {
  return [...(entries ?? [])].sort((a, b) => (Number(b?.at) || 0) - (Number(a?.at) || 0));
}

/** One entry's HTML: the when, the where, and what was there. */
function entryHtml(e, fmt) {
  const head = `<h3>${esc(e.when ?? "")}${e.kind === "monster" && e.name ? ` — ${esc(fmt("SDE.codex.creature", { count: e.count ?? 1, name: e.name }))}` : ""}</h3>`;
  const where = e.where ? `<p class="sde-codex-where">${esc(e.where)}</p>` : "";
  if (e.kind === "monster") {
    const art = e.img ? `<img src="${esc(e.img)}" alt="" width="40" height="40">` : "";
    return `<section class="sde-codex-entry">${head}${where}<p class="sde-codex-what">${art}<strong>${esc(fmt("SDE.codex.creature", { count: e.count ?? 1, name: e.name ?? "" }))}</strong></p>${
      e.facets ? `<p class="sde-codex-facets">${esc(e.facets)}</p>` : ""}</section>`;
  }
  const label = e.heading || (e.poi ? fmt("SDE.codex.poi") : "");
  return `<section class="sde-codex-entry">${head}${where}<p class="sde-codex-what">${label ? `<strong>${esc(label)}</strong> ` : ""}${esc(e.text ?? "")}</p></section>`;
}

/**
 * A page's whole content, rebuilt from its entries.
 * @param {object[]} entries
 * @param {(key:string, data?:object)=>string} fmt
 * @returns {string}
 */
export function codexHtml(entries, fmt) {
  const rows = newestFirst(entries).map((e) => entryHtml(e, fmt)).join("");
  return `<section class="sde-codex"><p class="sde-codex-note">${esc(fmt("SDE.codex.generated"))}</p>${
    rows || `<p class="sde-codex-empty">${esc(fmt("SDE.codex.empty"))}</p>`}</section>`;
}
