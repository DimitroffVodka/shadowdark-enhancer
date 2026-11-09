// Linking a book the importer has no recipe for ("Another book…") reads every page and shows what it found on the
// Preview tab through the paste box's own Auto parse. Nothing is created: that stays the Preview tab's button.
// The book text here is invented.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist";
import { writePdf } from "./pdf-synth/pdf-writer.mjs";

let ImporterHubApp, readWholeBook, bookNameFromFile, pickThirdPartyBook;
const toasts = [];
before(async () => {
  globalThis.foundry = {
    applications: {
      api: { ApplicationV2: class { async close() { } }, HandlebarsApplicationMixin: (B) => class extends B { } },
      handlebars: { renderTemplate() { }, loadTemplates() { }, getTemplate() { } },
      ux: {}, apps: {}, sheets: {},
    },
    utils: {},
  };
  globalThis.Hooks = { on() { }, off() { }, once() { } };
  globalThis.game = { i18n: { localize: (k) => k, format: (k) => k }, settings: { get() { }, register() { } } };
  const say = (level) => (message, opts) => {
    const note = { level, message, opts, updates: [], removed: false, update(u) { this.updates.push(u); }, remove() { this.removed = true; } };
    toasts.push(note);
    return note;
  };
  globalThis.ui = { notifications: { info: say("info"), warn: say("warn"), error: say("error") } };
  globalThis.CONFIG = {};
  ({ ImporterHubApp } = await import("../scripts/importer/importer-hub-app.mjs"));
  ({ readWholeBook, bookNameFromFile, pickThirdPartyBook } = await import("../scripts/importer/importer-hub-maintenance.mjs"));
});

const PAGES = 23;
const MONSTER_PAGE = 12;
const TABLE_PAGE = 17;
const DOWNTIME_PAGE = 20;
const STATBLOCK = [
  "MIRE GRUB",
  "A pale grub the size of a hound, slick with bog water.",
  "AC 12, HP 9, ATK 1 bite +2 (1d6), MV near (burrow), S +1, D +0, C +2, I -3, W +0, Ch -3, AL N, LV 2",
  "Slick. DC 12 DEX or fall when grappling it.",
].join("\n");
// A d100 table printed two entries to a line: the fold that reads it treats ALL the text it is given as this table.
const TWO_COLUMN = ["Marsh Finds", "d100 Details",
  // The third row is misprinted 3-6 (for 5-6), which the fold repairs and notes.
  ...["1-2", "3-4", "3-6", "7-8", "9-10"].map((range, i) => `${range} Reed charm ${i}   ${i * 2 + 51}-${i * 2 + 52} Bog iron ${i}`)].join("\n");
const DOWNTIME = ["SKULDUGGERY", "DC 9: A dull week.", "DC 12: A purse goes missing.", "DC 15: A rival is named."].join("\n");
const pageText = (n) => ({ [MONSTER_PAGE]: STATBLOCK, [TABLE_PAGE]: TWO_COLUMN, [DOWNTIME_PAGE]: DOWNTIME, 3: "" })[n]
  ?? `The marsh road runs on past marker ${n}.`;

/** A stand-in for pdf-text-extract.mjs over an invented 23-page book. */
const fakePdf = ({ blank = false, fail = false } = {}) => {
  const calls = [];
  const shown = [];
  return {
    calls, shown,
    async extractPdfText(file, { pages, columns }) {
      if (fail) throw new Error("no such file");
      calls.push({ file, pages, columns });
      const wanted = pages.filter((n) => n >= 1 && n <= PAGES);
      const out = wanted.map((n) => ({ page: n, lines: blank || !pageText(n) ? [] : pageText(n).split("\n") }));
      return { text: "", numPages: PAGES, warnings: wanted.includes(MONSTER_PAGE) ? [`p${MONSTER_PAGE}: gutter`] : [], pages: out };
    },
    notifyGutterWarnings: (result) => shown.push(...result.warnings),
  };
};

const hub = () => {
  const app = new ImporterHubApp();
  app.rendered = 0;
  app.render = () => { app.rendered++; };
  app.element = { querySelector: () => null, querySelectorAll: () => [] };
  return app;
};

test("a linked book is read page by page, parsed as Auto and shown on Preview under its own name", async () => {
  toasts.length = 0;
  const app = hub();
  app._importSeed = { name: "left over from a Manage row" };
  app._importType = "tables";
  const pdf = fakePdf();

  assert.equal(await readWholeBook(app, "assets/marsh.pdf", "The Marsh Road", pdf), true);

  assert.deepEqual(pdf.calls.flatMap((c) => c.pages).filter((n) => n <= PAGES), Array.from({ length: PAGES }, (_, i) => i + 1),
    "every page is asked for once, in order");
  assert.ok(pdf.calls.every((c) => c.file === "assets/marsh.pdf" && c.columns === "auto"));
  assert.ok(pdf.calls.length > 1, "in several calls, so the progress bar moves");

  assert.equal(app._importSource, "The Marsh Road");
  assert.equal(app._importType, "auto");
  assert.equal(app._importSeed, null, "an old unlock seed would rename what the book holds");
  assert.equal(app._tab, "preview");
  assert.deepEqual(app._importMonsters.map((m) => m.draft?.name ?? m.name), ["Mire Grub"]);
  assert.match(app._importText, /marker 23\./, "the whole text is left in the paste box for a second try");

  assert.deepEqual(pdf.shown, [`p${MONSTER_PAGE}: gutter`], "column warnings from every chunk reach the GM");
  const bar = toasts.find((n) => n.opts?.progress);
  assert.ok(bar?.removed, "the progress bar is taken down");
  assert.equal(bar.updates.at(-1).pct, 1);
});

test("each page is folded on its own, so one two-column table or downtime page does not cost the rest of the book", async () => {
  const app = hub();
  await readWholeBook(app, "assets/marsh.pdf", "The Marsh Road", fakePdf());

  assert.deepEqual(app._importMonsters.map((m) => m.draft?.name ?? m.name), ["Mire Grub"], "the statblock five pages before the table survives");
  const finds = app._importTables.find((tbl) => /Marsh Finds/.test(tbl.name));
  assert.equal(finds?.rows.length, 10, "the two-column table is still folded into one column");
  assert.ok(app._importTables[0].warnings.some((w) => w.startsWith(`p${TABLE_PAGE}: Auto-fixed`)), "a fold note names its page");
  const aside = app._importSkipped.filter((s) => s.name.startsWith(`p${DOWNTIME_PAGE}: `));
  assert.equal(aside.length, 1, "the downtime page is set aside with its page number");
  assert.ok(!app._importItems.some((i) => /dull week|purse|rival/.test(JSON.stringify(i))), "and mints no items");
  assert.equal(app._importText.split("\f").length, PAGES, "one form feed between pages, empty pages kept, so an index is a page number");
});

/** A stand-in book whose pages are these texts. */
const bookOf = (pageTexts) => {
  const pdf = fakePdf();
  pdf.extractPdfText = async (file, { pages }) => ({
    text: "", numPages: pageTexts.length, warnings: [],
    pages: pages.filter((n) => n <= pageTexts.length).map((n) => ({ page: n, lines: pageTexts[n - 1].split("\n") })),
  });
  return pdf;
};

test("a statblock a book reprints word for word comes through once; a copy that differs in anything stays", async () => {
  const venom = `${STATBLOCK}\nVenom. DC 12 CON or sleep.`;   // one trait more
  const sting = STATBLOCK.replace("1 bite +2 (1d6)", "1 sting +5 (1d8)");   // same LV, AC and HP, another attack
  const tougher = STATBLOCK.replace("HP 9", "HP 14");
  const app = hub();
  await readWholeBook(app, "assets/marsh.pdf", "The Marsh Road", bookOf(["The marsh road runs on.", STATBLOCK, STATBLOCK, venom, sting, tougher, STATBLOCK]));
  const grubs = app._importMonsters.map((m) => `${m.draft.hp.max} ${m.draft.actions[0].name} ${m.draft.features.map((f) => f.name).join("+")}`);
  assert.deepEqual(grubs, ["9 bite Slick", "9 bite Slick+Venom", "9 sting Slick", "14 bite Slick"],
    "three identical printings are one draft; the trait, the attack and the HP variants are each kept for the GM");

  const paste = hub();
  paste._importText = `${STATBLOCK}\n\n${STATBLOCK}`;
  await paste._onHubParse();
  assert.equal(paste._importMonsters.length, 2, "a paste is left as the GM pasted it");
});

// A d100 printed two entries to a line: faces `from`..`to`, the left column the lower half.
const twoColumns = (from, to) => Array.from({ length: (to - from + 1) / 4 }, (_, k) => {
  const a = from + k * 2, b = a + (to - from + 1) / 2;
  return `${a}-${a + 1} Reed charm ${a}   ${b}-${b + 1} Bog iron ${b}`;
});

test("a two-column table that runs on over the page is one table, with the die it was printed with", async () => {
  const { computeBlockers } = await import("../scripts/importer/tables/table-importer.mjs");
  const first = ["Marsh Finds", "d100 Details", ...twoColumns(1, 52)].join("\n");
  const app = hub();
  await readWholeBook(app, "assets/marsh.pdf", "The Marsh Road", bookOf(["The marsh road runs on.", first, twoColumns(53, 100).join("\n"), STATBLOCK]));
  assert.deepEqual(app._importTables.map((tbl) => [tbl.name, tbl.formula, tbl.rows.length, computeBlockers(tbl).length]), [["Marsh Finds", "1d100", 50, 0]]);
  assert.equal(app._importMonsters.length, 1, "the page after the table is still read on its own");

  // The second half is missing (or another table follows): the first half must not pass as a whole, smaller table.
  const other = ["Bog Sounds", "d8 Details", "1-2 Drip   5-6 Croak", "3-4 Splash   7-8 Silence"].join("\n");
  const cut = hub();
  await readWholeBook(cut, "assets/marsh.pdf", "The Marsh Road", bookOf([first, other]));
  const [finds, sounds] = cut._importTables;
  assert.deepEqual([finds.name, finds.formula, finds.rows.length], ["Marsh Finds", "1d100", 26]);
  assert.ok(computeBlockers(finds).length > 0, "half a d100 is a d100 with a gap, which the commit gate stops");
  assert.deepEqual([sounds.name, sounds.formula, sounds.rows.length, computeBlockers(sounds).length], ["Bog Sounds", "1d8", 4, 0], "a table that starts over at 1 is its own table");
});

test("a paste with no form feed is one page, as it always was: a downtime page still stops the parse", async () => {
  const app = hub();
  app._importText = `${DOWNTIME}\n\n${STATBLOCK}`;
  await app._onHubParse();
  assert.equal(app._importMonsters.length, 0);
  assert.equal(app._importSkipped.length, 1);
  assert.equal(app._importSkipped[0].name, "SDE.importer.skipReason.downtimePage");
});

test("an open paste box is given the book, because Parse reads the box back", async () => {
  const app = hub();
  const box = { value: "old paste" };
  app.element = { querySelector: (sel) => (sel === "textarea[data-import-text]" ? box : null), querySelectorAll: () => [] };
  await readWholeBook(app, "assets/marsh.pdf", "The Marsh Road", fakePdf());
  assert.match(box.value, /MIRE GRUB/);
  assert.equal(app._importMonsters.length, 1);
});

test("a book with no text, or one that cannot be read, says so and leaves the hub alone", async () => {
  for (const [pdf, level] of [[fakePdf({ blank: true }), "warn"], [fakePdf({ fail: true }), "error"]]) {
    toasts.length = 0;
    const app = hub();
    app._importText = "what the GM had pasted";
    assert.equal(await readWholeBook(app, "assets/scan.pdf", "Scanned Book", pdf), false);
    assert.equal(app._importText, "what the GM had pasted");
    assert.equal(app._tab, "paste");
    assert.equal(toasts.at(-1).level, level);
    assert.ok(toasts.find((n) => n.opts?.progress).removed);
  }
});

test("only a book without a recipe is read on link; a known book reopens the library", () => {
  const src = readFileSync(new URL("../scripts/importer/importer-hub-maintenance.mjs", import.meta.url), "utf8");
  assert.match(src, /isCustomSource\(src\) \? readWholeBook\(app, path, label \|\| sourceLabel\(src\)\) : manageSourcePdfs\(app\)/);
  assert.equal(src.match(/return afterLink\(path\)/g)?.length, 2, "both Upload and keep and Link a file on the server");
});

// ── The one-step entry: "Import a third-party book" ─────────────────────────────

test("a book is named after its file: no extension, version, download id or underscores", () => {
  for (const [file, name] of [
    ["The Marsh Road_1.2.pdf", "The Marsh Road"],
    ["assets/The%20Marsh%20Road_1.2.pdf", "The Marsh Road"],
    ["Keep of the Reed King V1-2.pdf", "Keep of the Reed King"],
    ["Reed King v4-3.PDF", "Reed King"],
    ["The Great Eel Hunt v1.1b.pdf", "The Great Eel Hunt"],
    ["123456789-Crypts-of-the-Fen-V3.pdf", "Crypts of the Fen"],
    ["123456789-Against-the-Reed-Cult-1-1.pdf", "Against the Reed Cult"],
    ["Marsh Timer Issue 2.pdf", "Marsh Timer Issue 2"],
    ["Fen-Born Heroes.pdf", "Fen-Born Heroes"],
    ["TheLastReed_1.3.pdf", "TheLastReed"],
  ]) assert.equal(bookNameFromFile(file), name, file);
});

/** Foundry as the dialog and the upload see it: `answer` is what the GM did in the window; `upload` what the server says. */
const withFoundry = async (answer, upload, run) => {
  const saved = { game: globalThis.game, foundry: globalThis.foundry, FilePicker: globalThis.FilePicker };
  const pages = [];
  const uploads = [];
  const journal = { pages, getFlag: (_m, k) => k === "sourcePdfLibrary", createEmbeddedDocuments: async (_t, data) => { pages.push(...data); return data; } };
  globalThis.game = { ...saved.game, user: { isGM: true }, journal: { find: (fn) => (fn(journal) ? journal : null), getName: () => null } };
  globalThis.foundry = { ...saved.foundry, applications: { ...saved.foundry.applications, api: { ...saved.foundry.applications.api, DialogV2: { wait: async () => answer } } } };
  globalThis.FilePicker = { createDirectory: async () => {}, upload: async (_s, dir, file) => { uploads.push(file.name); return upload(dir, file); } };
  try { return await run({ pages, uploads }); } finally { Object.assign(globalThis, saved); }
};
const pdfFile = (name) => new File(["x"], name, { type: "application/pdf" });

test("choosing a PDF links it under the file's name, or the name the GM typed, with nothing else to fill in", async () => {
  await withFoundry({ file: pdfFile("The Marsh Road_1.2.pdf"), label: "" }, (dir, file) => ({ path: `${dir}/${file.name}` }), async ({ pages, uploads }) => {
    const book = await pickThirdPartyBook();
    assert.deepEqual(book, { path: "assets/The Marsh Road_1.2.pdf", label: "The Marsh Road" });
    assert.deepEqual(uploads, ["The Marsh Road_1.2.pdf"]);
    assert.equal(pages[0].name, "The Marsh Road");
    assert.equal(pages[0].flags["shadowdark-enhancer"].sourceKey, "custom:the-marsh-road");
  });
  await withFoundry({ file: pdfFile("scan0042.pdf"), label: "Fen Notes" }, (dir, file) => ({ path: `${dir}/${file.name}` }), async () => {
    assert.equal((await pickThirdPartyBook()).label, "Fen Notes");
  });
  await withFoundry("cancel", () => null, async ({ uploads }) => {
    assert.equal(await pickThirdPartyBook(), null);
    assert.deepEqual(uploads, []);
  });
});

test("a server that refuses the upload does not stop the import: the book is read from this computer", async () => {
  toasts.length = 0;
  await withFoundry({ file: pdfFile("The Marsh Road_1.2.pdf"), label: "" }, () => undefined, async ({ pages }) => {
    const warn = console.warn; console.warn = () => {};
    const book = await pickThirdPartyBook().finally(() => { console.warn = warn; });
    assert.deepEqual(book, { path: "session-pdf:custom:the-marsh-road", label: "The Marsh Road" });
    assert.equal(pages.length, 0, "no link to a file that was never stored");
    assert.equal(toasts.at(-1).message, "SDE.importer.thirdParty.notKept");
  });
});

test("the entry is on the guide's first page and on the hub's Paste tab, one button each", async () => {
  const { WizardController, ACTIONS } = await import("../scripts/importer/wizard/wizard-controller.mjs");
  const opened = [];
  const ctl = new WizardController({ t: (k) => k, openThirdParty: () => opened.push("book") }, () => {});
  assert.ok(ACTIONS.includes("thirdParty"));
  await ctl.dispatch("thirdParty");
  ctl.state.page = "books";
  await ctl.dispatch("thirdParty");
  assert.deepEqual(opened, ["book"], "only from the first page, where its button is");

  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  assert.equal(read("../templates/importer-wizard.hbs").match(/data-action="thirdParty"/g)?.length, 1);
  assert.equal(read("../templates/importer-hub.hbs").match(/data-action="hubThirdPartyBook"/g)?.length, 1);
  assert.equal(typeof ImporterHubApp.DEFAULT_OPTIONS.actions.hubThirdPartyBook, "function");
  assert.equal(typeof ImporterHubApp.prototype._onThirdPartyBook, "function");
  assert.match(read("../scripts/importer/importer-hub-maintenance.mjs"), /return readWholeBook\(app, book\.path, book\.label\);/);
});

test("from the guide, a book the server refused is still there to read after the guide closes", async () => {
  const { ImportWizardApp } = await import("../scripts/importer/wizard/wizard-app.mjs");
  const { _internals, releaseLocalPdfs } = await import("../scripts/importer/pdf-text-extract.mjs");
  const { hasSessionPdf } = await import("../scripts/importer/session-pdf.mjs");
  _internals._useLib({ getDocument: (params) => pdfjs.getDocument({ ...params, verbosity: 0 }) });
  const file = new File([writePdf([{ runs: STATBLOCK.split("\n").map((text, i) => ({ x: 40, y: 700 - i * 14, text, size: 9 })) }])],
    "The Marsh Road_1.2.pdf", { type: "application/pdf" });
  await withFoundry({ file, label: "" }, () => undefined, async () => {
    globalThis.foundry.applications.api.DialogV2.confirm = async () => true;
    globalThis.foundry.utils = { getRoute: (p) => `/${p}` };
    Object.assign(globalThis.game, { scenes: { viewed: null, get: () => null }, user: { isGM: true, can: () => true } });
    const theHub = Object.assign(hub(), { rendered: true, bringToFront() { }, render: async () => { } });
    ImporterHubApp._instance = theHub;
    const guide = new ImportWizardApp({});
    guide.render = () => { };
    const warn = console.warn; console.warn = () => { };
    try {
      await guide._env().openThirdParty();
      assert.equal(guide._keepBooks, true, "the guide hands its books on, as it does for the advanced importer");
      assert.equal(hasSessionPdf("custom:the-marsh-road"), true);
      assert.deepEqual(theHub._importMonsters.map((m) => m.draft.name), ["Mire Grub"], "read from this computer, after the guide is gone");
      assert.equal(theHub._importSource, "The Marsh Road");
      assert.equal(theHub._tab, "preview");
    } finally {
      console.warn = warn;
      ImporterHubApp._instance = null;
      await releaseLocalPdfs();
    }
  });
});
