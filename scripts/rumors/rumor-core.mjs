/**
 * Shadowdark Enhancer — the rumor generator's rules (pure, Foundry-free, #190).
 *
 * Which table each rumor comes from, which rows are still there to give, the
 * plain text a trouble becomes as a rumor, and the Rumors Heard ledger's page
 * body and public shape. Everything reads the GM's imported tables; no book
 * content ships.
 */

/** The GM Guide's general rumor table. */
export const GENERAL_TABLE = "Rumors in the Reaches";

/** A table's name without the "<book> - " prefix some imports carry. */
export const unprefixed = (name) => String(name ?? "").trim().replace(/^.*?\s-\s/, "");

/**
 * The region a regional rumor table is for: "Sablewood Rumors" → "Sablewood",
 * "Western Reaches GM Guide - The Last Sea Rumors" → "The Last Sea". Null for
 * the general table and any other name.
 */
export function rumorTableRegion(name) {
  const n = unprefixed(name);
  if (n.toLowerCase() === GENERAL_TABLE.toLowerCase()) return null;
  // "The Lost Citadel: Rumors" is a site's table, not a region's.
  const m = n.match(/^([^:]+?)\s+Rumors$/i);
  return m ? m[1].trim() : null;
}

/** True for the general table or a regional one. */
export const isRumorTable = (name) => unprefixed(name).toLowerCase() === GENERAL_TABLE.toLowerCase() || !!rumorTableRegion(name);

/**
 * Where each of `count` table rumors comes from: the region's table and the
 * general one in turn, the region's first. When one runs out (or there is
 * none), the rest come from the other; when both have, the list is shorter.
 * @param {number} count
 * @param {{regional:number, general:number}} left  rows still there to give
 * @returns {Array<"regional"|"general">}
 */
export function planDraws(count, { regional = 0, general = 0 } = {}) {
  const out = [];
  const left = { regional, general };
  let next = "regional";
  while (out.length < count && (left.regional > 0 || left.general > 0)) {
    const from = left[next] > 0 ? next : (next === "regional" ? "general" : "regional");
    out.push(from);
    left[from]--;
    next = from === "regional" ? "general" : "regional";
  }
  return out;
}

/**
 * `n` rows picked from those still there to give, each weighted by how many
 * faces of the die land on it, without repeats: what drawing without
 * replacement does, done without core's reroll loop. `rng` returns [0, 1).
 * @param {Array<{id:string, range:[number, number]}>} rows  the rows still there to give
 * @returns {Array<object>} the rows picked, in draw order
 */
export function pickRows(rows, n, rng = Math.random) {
  const pool = [...rows];
  const out = [];
  const width = (r) => Math.max(1, (Number(r.range?.[1]) || 0) - (Number(r.range?.[0]) || 0) + 1);
  while (out.length < n && pool.length) {
    let roll = rng() * pool.reduce((s, r) => s + width(r), 0);
    const i = pool.findIndex((r) => (roll -= width(r)) < 0);
    out.push(pool.splice(i < 0 ? pool.length - 1 : i, 1)[0]);
  }
  return out;
}

/**
 * The rows of a table still there to give: not drawn, and not a row a re-import
 * recreated. A re-import makes every row new (a new id, never drawn); a rumor
 * already given from the same range of the same table, whose row id is gone,
 * still counts as given.
 * @param {Array<{id:string, range:[number,number], drawn:boolean}>} results
 * @param {Array<{resultId:string, range:[number,number]}>} given  ledger rumors from this table
 * @returns {{available:object[], stale:object[]}} `stale`: undrawn rows to mark drawn
 */
export function rowsLeft(results, given = []) {
  const ids = new Set(results.map((r) => r.id));
  const key = (range) => `${range?.[0]}-${range?.[1]}`;
  const lost = new Set(given.filter((g) => g.resultId && !ids.has(g.resultId) && g.range).map((g) => key(g.range)));
  const available = [], stale = [];
  for (const r of results) {
    if (r.drawn) continue;
    (lost.has(key(r.range)) ? stale : available).push(r);
  }
  return { available, stale };
}

/**
 * The rows of `table` a draw landed on, once each. `draw` gives one roll;
 * `drawMany` gives a pool of them, one per result. With no roll, the drawn
 * results that are the table's own.
 * @param {{getResultsForRoll:(total:number)=>object[]}} table
 * @param {{roll?:object, results?:object[]}} out  what draw or drawMany returned
 * @returns {object[]}
 */
export function drawnRows(table, out) {
  const rolls = out?.roll?.terms?.[0]?.rolls ?? (out?.roll ? [out.roll] : []);
  const rows = rolls.length
    ? rolls.flatMap((r) => table.getResultsForRoll(r.total))
    : (out?.results ?? []).filter((r) => r.parent === table);
  return [...new Map(rows.map((r) => [r.id, r])).values()];
}

/** Link markup in a row, "@UUID[…]{Label}" or "@Compendium[…]{Label}", as its label. */
export const plainRow = (text) => String(text ?? "")
  .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")
  .replace(/<[^>]*>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

/**
 * A trouble the party hasn't heard of, as a rumor: plain text, no links (the
 * trouble's page is the GM's, and Shadowdark Extras shows the text escaped).
 * @param {{settlement:{name:string}, region:string, type:string, detail?:string, stage:string, symptoms:object}} tr
 * @param {(key:string, data?:object) => string} fmt  en.json
 */
export function troubleRumorText(tr, fmt) {
  const what = tr.detail ? fmt("SDE.troubles.typeDetail", { type: tr.type, detail: tr.detail }) : tr.type;
  return fmt("SDE.rumors.troubleText", {
    settlement: tr.settlement?.name ?? "", region: tr.region ?? "", what, symptoms: tr.symptoms?.[tr.stage] ?? "",
  });
}

/** What `rumors.heard()` returns for one rumor. */
export const heardView = (r) => ({
  text: r.text,
  region: r.region ?? null,
  heardAt: { world: Number.isFinite(r.worldTime) ? r.worldTime : null, real: r.real },
  heardBy: [...(r.heardBy ?? [])],
});

/**
 * Every rumor on the ledger's pages, newest first, optionally one region's:
 * the pages' `rumorPage` flags, as rumors.heard() reads them.
 * @param {Array<{region:string|null, rumors:object[]}>} pages
 * @param {{region?:string|null, sameRegion?:(a:string, b:string) => boolean}} [opts]
 */
export function heardList(pages, { region, sameRegion = (a, b) => a === b } = {}) {
  const all = (pages ?? []).flatMap((p) => (Array.isArray(p?.rumors) ? p.rumors : []))
    .filter((r) => r && r.text);
  const wanted = region === undefined ? all : all.filter((r) => (region === null ? !r.region : r.region && sameRegion(r.region, region)));
  return wanted.sort((a, b) => (b.real ?? 0) - (a.real ?? 0)).map(heardView);
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * A ledger page's text, newest first, written from its flag every time: the
 * flag is the record rumors.heard() and the party sheet read. The GM sees one
 * line saying so, in a secret block players don't get.
 * @param {object[]} rumors
 * @param {(key:string, data?:object) => string} fmt  en.json
 * @param {(ms:number) => string} realDate  the real date, as the GM's client shows it
 * @param {(names:string[]) => string} listNames  "Aria and Bram", in Foundry's language
 */
export function ledgerHtml(rumors, fmt, realDate, listNames) {
  const rows = [...rumors].sort((a, b) => (b.real ?? 0) - (a.real ?? 0)).map((r) => {
    const when = r.gameTime ? fmt("SDE.rumors.ledger.when", { game: r.gameTime, real: realDate(r.real) }) : realDate(r.real);
    const meta = r.heardBy?.length
      ? fmt("SDE.rumors.ledger.meta", { when, names: listNames(r.heardBy) })
      : when;
    return `<li data-sde-rumor="${esc(r.id)}"><p>${esc(r.text)}</p><p class="sde-rumor-meta">${esc(meta)}</p></li>`;
  }).join("");
  return `<section class="secret"><p>${esc(fmt("SDE.rumors.ledger.generated"))}</p></section><ul class="sde-rumor-list">${rows}</ul>`;
}

/** A quest's name from a rumor: its first words, at most `max` characters. */
export function questName(text, fmt, max = 60) {
  const s = String(text ?? "").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const start = cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2)).replace(/[\s,.;:]+$/, "");
  return fmt("SDE.rumors.questName", { start });
}
