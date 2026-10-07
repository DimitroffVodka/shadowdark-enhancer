/**
 * Shadowdark Enhancer — an adventure's overview in the layout of the Lost Citadel quickstart (Foundry-free).
 *
 * The quickstart's journal has an Overview page (Room Key, Background, Factions, Rumors, Environs & Entrances, Order of
 * Battle, one H2 each), an "Areas 1-27" page for what holds in every area (danger level, light, doors, the random
 * encounters), then one page per area. The books' own overview pages come out of the PDF as sections at the book's
 * ALL-CAPS headings (chapter-journal buildChapterPages); this puts those sections on the two pages, turns the numbered
 * rows the PDF flattened into tables again (the rumors without a header row, the d-tables with one), makes the run-in
 * names ("Beastmen. These grey-furred…") bold, and writes the dice and DC checks as inline rolls and requests.
 *
 * Ships no book text; the tests invent theirs.
 */

import { enrichContextualText } from "../../shared/contextual-enricher.mjs";

/** The sections that hold for every area, whatever the book calls them. Everything else is the Overview. */
const AREA_WIDE_RE = /^(?:random-)?encounters?$|^features$|^danger|^light$|^doors$|^wandering|slaves$|npcs?$/;

/** The area-wide sections that are the page's own body, with no heading of their own. */
const UNTITLED_AREA_RE = /^(?:random-)?encounters?$|^features$|^danger/;

/** Sections whose paragraphs are prose, never run-in lists: their first words are not a name. */
const PROSE_RE = /^(?:background|room-key|lead|overview)$/;

const textOf = (html) => String(html).replace(/<[^>]+>/g, "");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Pure: which of a world's items are worth a link in an adventure's text: the magic items and the treasure (the Lost Citadel
 * links its pearls and statuettes, not its rope and daggers), by names a sentence can hold.
 * @param {Array<{name:string, uuid:string, type?:string, system?:{magicItem?:boolean, treasure?:boolean}}>} rows  index rows with those fields
 * @returns {Array<{name:string, uuid:string}>}
 */
export function linkableItems(rows) {
  const seen = new Set();
  return (rows ?? []).filter((r) => r?.name && r.uuid && r.type !== "Property" && (r.system?.magicItem === true || r.system?.treasure === true)
    && !/[,()]/.test(r.name) && r.name.length >= 5 && !seen.has(r.name.toLowerCase()) && seen.add(r.name.toLowerCase())).map((r) => ({ name: r.name, uuid: r.uuid }));
}

/**
 * The item names in a page's text as links: "Scarab of Protection" → @UUID[Item…]{Scarab of Protection}. Only text is read, never
 * markup, an existing link or an inline roll; a name of one word has to be written exactly as the item is (a capital
 * letter), so "bloodlust" in a sentence is not the item, and a longer name wins over a shorter one inside it.
 * @param {string} html
 * @param {Array<{name:string, uuid:string}>} items  linkableItems
 * @returns {string}
 */
export function linkItems(html, items) {
  const list = [...(items ?? [])].sort((a, b) => b.name.length - a.name.length);
  if (!list.length || !html) return html;
  const byLower = new Map(list.map((i) => [i.name.toLowerCase(), i]));
  const re = new RegExp(`(?<![\\w@])(?:${list.map((i) => escapeRe(i.name)).join("|")})(?![\\w])`, "gi");
  return String(html).split(/(<[^>]+>|@UUID\[[^\]]*\]\{[^}]*\}|\[\[[^\]]*\]\]|@@LOC\[[^\]]*\]\{[^}]*\}@@)/).map((seg, i) => (i % 2 ? seg : seg.replace(re, (m) => {
    const item = byLower.get(m.toLowerCase());
    if (!item || (!/\s/.test(item.name) && m !== item.name)) return m;
    return `@UUID[${item.uuid}]{${m}}`;
  }))).join("");
}

/**
 * The creatures an adventure names, in the text where the book printed them plain: "Howlers" in a sentence is a link to the
 * Howler, once a page (the first mention), unless that page already links it. Text only, never markup, an existing link or an
 * inline roll.
 * @param {string} html
 * @param {Array<{form:string, uuid:string}>} vocabulary  creatureVocabulary
 * @returns {string}
 */
export function linkCreatures(html, vocabulary) {
  const list = vocabulary ?? [];
  if (!list.length || !html) return html;
  const byForm = new Map(list.map((v) => [v.form, v.uuid]));
  const re = new RegExp(`(?<![\\w@'’-])(?:${list.map((v) => escapeRe(v.form)).join("|")})(?![\\w-])`, "gi");
  const done = new Set(list.map((v) => v.uuid).filter((u) => String(html).includes(`@UUID[${u}]`)));
  // "Sir Reginald Bittermold" is a person with a family's name, not a Bittermold: a capitalised word in front of the name, in the
  // middle of a sentence, makes it a surname.
  const surname = (before) => {
    const w = /([A-Z][\p{L}'’-]*)\s+$/u.exec(before);
    return !!w && before.slice(0, w.index).trim() !== "" && !/[.!?:"“”]\s*$/.test(before.slice(0, w.index));
  };
  return String(html).split(/(<[^>]+>|@UUID\[[^\]]*\]\{[^}]*\}|\[\[[^\]]*\]\]|@@LOC\[[^\]]*\]\{[^}]*\}@@)/).map((seg, i) => (i % 2 ? seg : seg.replace(re, (m, offset) => {
    const uuid = byForm.get(m.toLowerCase().replace(/\s+/g, " "));
    if (!uuid || done.has(uuid) || surname(seg.slice(0, offset))) return m;
    done.add(uuid);
    return `@UUID[${uuid}]{${m}}`;
  }))).join("");
}

/** One row of a table, cells as paragraphs the way the editor writes them; the first cell is the die or number, centred. */
const tr = (cells, { boldFirst = false } = {}) => `<tr>${cells.map((c, i) => (i === 0
  ? `<td style="${boldFirst ? "font-weight:bold;" : ""}text-align:center"><p>${boldFirst ? `<strong>${c}</strong>` : c}</p></td>`
  : `<td><p>${c}</p></td>`)).join("")}</tr>`;
const tableHtml = (caption, rows) => `<table style="width:100%"><caption>${esc(caption)}</caption><tbody>${rows.join("")}</tbody></table>`;

/** A die header such as "d8 Details" or "d10 Names Appearances Behaviors": the die, then the columns' names. */
const DIE_HEAD_RE = /^(d\d+)((?:\s+[A-Z][A-Za-z]*(?: \d)?)+)?$/;

/**
 * Paragraph rows → tables. A "d8 Details" paragraph and the rows after it (each starts with its number or range) become a table
 * with a header row; a run of three or more paragraphs numbered 1, 2, 3… with no die header (the rumors) becomes a table
 * with none. A row whose text the extractor ran on past its own line stays one row.
 * @param {string} html  paragraphs and h3s
 * @param {string} caption  the table's caption: the section it came from
 * @returns {string}
 */
export function tableize(html, caption) {
  const parts = String(html ?? "").match(/<p>[\s\S]*?<\/p>|<h3>[\s\S]*?<\/h3>/g) ?? [];
  // The text of a paragraph, tags off; and its inner HTML (already escaped by the chapter reader), which is what a cell keeps.
  const inner = (p) => (p.startsWith("<p>") ? p.slice(3, -4) : "");
  const plainOf = (p) => textOf(inner(p)).trim();
  const out = [];
  for (let i = 0; i < parts.length;) {
    const p = parts[i], plain = plainOf(p);
    const head = DIE_HEAD_RE.exec(plain);
    if (head) {
      const rows = [];
      let j = i + 1;
      while (j < parts.length && /^\d+(?:[-–]\d+)?\s+\S/.test(plainOf(parts[j]))) {
        const m = /^(\d+(?:[-–]\d+)?)\s+([\s\S]*)$/.exec(inner(parts[j]).trim());
        rows.push(tr([m[1], m[2]]));
        j++;
      }
      if (rows.length >= 2) {
        const names = (head[2] ?? "").trim().split(/\s+/).filter(Boolean);
        out.push(tableHtml(caption, [tr([head[1], names.length ? names.join(" ") : "Details"]), ...rows]));
        i = j;
        continue;
      }
    }
    // The rumors: rows numbered 1, 2, 3 with nothing above them.
    let n = 0, j = i;
    while (j < parts.length && new RegExp(`^${n + 1}\\s+\\S`).test(plainOf(parts[j]))) { n++; j++; }
    if (n >= 3) {
      out.push(tableHtml(caption, parts.slice(i, j).map((q, k) => tr([String(k + 1), inner(q).trim().replace(/^\d+\s+/, "")], { boldFirst: true }))));
      i = j;
      continue;
    }
    out.push(p);
    i++;
  }
  return out.join("\n");
}

/**
 * Bullets the reader left as paragraphs ("• Light. Magma fills…", "▶ Guard Change. Every two hours…") → nested lists, as the
 * room pages have. A paragraph that opens in lower case goes on from the one above it (the column cut the sentence), and an
 * arrow inside a paragraph starts an item under it. A run of fewer than two bullets stays as the book's paragraph.
 */
export function listify(html) {
  const parts = String(html ?? "").match(/<p>[\s\S]*?<\/p>|<h[23]>[\s\S]*?<\/h[23]>|<table[\s\S]*?<\/table>/g) ?? [];
  const LEVEL = { "•": 1, "▶": 2, "►": 2, "▷": 3 };
  const out = [];
  let items = [];
  const flush = () => {
    if (items.length < 2) out.push(...items.map((it) => `<p>${it.glyph} ${it.text}</p>`));
    else {
      const root = { children: [] }, stack = [{ level: 0, node: root }];
      for (const it of items) {
        while (stack.length > 1 && stack.at(-1).level >= it.level) stack.pop();
        const node = { text: it.text, children: [] };
        stack.at(-1).node.children.push(node);
        stack.push({ level: stack.at(-1).level + 1, node });
      }
      const render = (nodes) => `<ul>${nodes.map((n) => `<li><p>${n.text}</p>${n.children.length ? render(n.children) : ""}</li>`).join("")}</ul>`;
      out.push(render(root.children));
    }
    items = [];
  };
  for (const p of parts) {
    if (!p.startsWith("<p>")) { flush(); out.push(p); continue; }
    const inner = p.slice(3, -4).trim();
    const pieces = inner.split(/\s+(?=[▶►▷]\s)/);
    if (/^[•▶►▷]\s/.test(inner)) {
      for (const piece of pieces) { const m = /^([•▶►▷])\s+([\s\S]*)$/.exec(piece); if (m) items.push({ glyph: m[1], level: LEVEL[m[1]], text: m[2] }); }
    } else if (items.length && /^[a-z(]/.test(inner)) {
      items.at(-1).text += ` ${pieces[0]}`;
      for (const piece of pieces.slice(1)) { const m = /^([▶►▷])\s+([\s\S]*)$/.exec(piece); if (m) items.push({ glyph: m[1], level: LEVEL[m[1]], text: m[2] }); }
    }
    else { flush(); out.push(p); }
  }
  flush();
  return out.join("\n");
}

/**
 * The book's run-in names, bold: a paragraph that opens with a short name and a full stop ("Beastmen. These grey-furred…",
 * "Entrances and Exits. The keep…"). The PDF's bold is gone by this point, so the shape stands in for it: up to five words,
 * no comma, then a capital.
 */
export function boldLeadIns(html) {
  return String(html ?? "").replace(/<p>([A-Z][A-Za-z'’&-]*(?: (?:[A-Za-z'’&-]+)){0,4})\.\s+(?=[A-Z0-9"“(])/g, (m, lead) => `<p><strong>${lead}.</strong> `);
}

const sectionBody = (s) => {
  const key = s.key ?? "";
  const body = listify(tableize(s.html, s.name));
  return PROSE_RE.test(key) ? body : boldLeadIns(body);
};

/**
 * The overview pages of an adventure laid out as the quickstart does.
 * @param {Array<{key:string, name:string, html:string}>} parts  chapter-journal buildChapterPages pages (or the one page of
 *   a one-page adventure, whose Random Encounters heading splits the two)
 * @param {{range?:number[], tables?:{rumors?:{uuid:string,name:string}, encounters?:{uuid:string,name:string}}, items?:Array<{name:string,uuid:string}>}} [opts]
 *   tables: the world's roll tables for this adventure; each is linked just above the printed table it is (as the Lost Citadel
 *   does), or at the top of the areas page when the book prints none. items: linkableItems. creatures: creatureVocabulary, linked
 *   on the areas page (the encounters name them; the overview does not link them, as the quickstart's)
 * @returns {Array<{key:"overview"|"areas", name:string, html:string}>}  the Overview, then the page for the areas when the book has area-wide text
 */
export function assembleOverview(parts, { range, tables = {}, items, creatures } = {}) {
  // A one-page adventure's page is jumbled map labels and a flattened table: it stays the one Overview page the reader made of it.
  const finish = (html) => linkItems(enrichContextualText(html, { context: "journal" }), items);
  const linkLine = (t) => `<p>@UUID[${t.uuid}]{${esc(t.name)}}</p>`;
  if (parts?.length === 1 && parts[0].key === "overview") {
    const tail = tables.encounters ? `\n${linkLine(tables.encounters)}` : "";
    return [{ key: "overview", name: "Overview", html: finish(parts[0].html + tail) }];
  }
  const overview = [], areas = [];
  const sections = [];
  for (const p of parts ?? []) {
    // The page for the areas has a title-case heading ("Areas 1-33") the reader cannot tell from prose, so its Danger Level,
    // Light and the rest come out as the tail of the section above it; they are cut off there.
    const cut = /\s*Areas \d+(?:-\d+)? (?=Danger Level\.)/.exec(p.html);
    if (cut) {
      sections.push({ ...p, html: `${p.html.slice(0, cut.index)}</p>` });
      sections.push({ key: "danger-level", name: "Areas", html: `<p>${p.html.slice(cut.index + cut[0].length)}` });
      continue;
    }
    // A one-page adventure keeps its encounters under a heading of its own inside its single page.
    const at = p.html.indexOf("<h3>Random Encounters</h3>");
    if (p.key === "overview" && at >= 0) {
      sections.push({ ...p, html: p.html.slice(0, at) });
      sections.push({ key: "random-encounters", name: "Random Encounters", html: p.html.slice(at + "<h3>Random Encounters</h3>".length) });
    } else sections.push(p);
  }
  for (const s of sections) {
    const body = sectionBody(s);
    if (!body.trim()) continue;
    // The quickstart's page for the areas has no headings: its rules are bold run-in lines and its tables carry their own captions.
    if (AREA_WIDE_RE.test(s.key)) areas.push(UNTITLED_AREA_RE.test(s.key) ? body : `<h2>${esc(s.name)}</h2>\n${body}`);
    else overview.push(s.key === "overview" || s.key === "lead" ? body : `<h2>${esc(s.name)}</h2>\n${body}`);
  }
  // The roll tables the importer made for this adventure are linked just above the printed table they are.
  const above = (html, caption, table) => {
    if (!table) return { html, done: false };
    const mark = `<table style="width:100%"><caption>${caption}</caption>`;
    return html.includes(mark) ? { html: html.replace(mark, `${linkLine(table)}\n${mark}`), done: true } : { html, done: false };
  };
  let overviewHtml = overview.join("\n"), areasHtml = areas.join("\n");
  overviewHtml = above(overviewHtml, "Rumors", tables.rumors).html;
  const enc = above(areasHtml, "Random Encounters", tables.encounters);
  areasHtml = enc.done || !tables.encounters || !areas.length ? enc.html : `${linkLine(tables.encounters)}\n${areasHtml}`;
  const out = [];
  if (overview.length) out.push({ key: "overview", name: "Overview", html: finish(overviewHtml) });
  if (areas.length) out.push({ key: "areas", name: range ? `Areas ${range[0]}-${range[1]}` : "Areas", html: finish(linkCreatures(areasHtml, creatures)) });
  return out;
}
