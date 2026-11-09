// Linking a book the importer has no recipe for ("Another book…") reads every page and shows what it found on the
// Preview tab through the paste box's own Auto parse. Nothing is created: that stays the Preview tab's button.
// The book text here is invented.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let ImporterHubApp, readWholeBook;
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
  ({ readWholeBook } = await import("../scripts/importer/importer-hub-maintenance.mjs"));
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
