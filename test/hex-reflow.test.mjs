import test from "node:test";
import assert from "node:assert/strict";
import { reflowBodyLines, buildHexPageHtml, reflowLegacyHexHtml } from "../scripts/importer/tables/hex-parser.mjs";

// Invented fixtures (D1): prose written here, wrapped the way a column wraps it.

test("a column's wrapped lines come back as one paragraph", () => {
  assert.deepEqual(reflowBodyLines([
    "A sea-worn statue of an angelic",
    "woman stands on a sandbar",
    "that connects three islands.",
  ]), ["A sea-worn statue of an angelic woman stands on a sandbar that connects three islands."]);
});

test("a full stop mid-paragraph is not a paragraph break", () => {
  // The line that ends a sentence is usually still mid-paragraph in a column.
  const out = reflowBodyLines(["one, two, and three.", "Four is tolerated if they do", "their business elsewhere."]);
  assert.equal(out.length, 1);
});

test("a blank line is a paragraph break", () => {
  assert.deepEqual(reflowBodyLines(["first para", "still first", "", "second para"]),
    ["first para still first", "second para"]);
});

test("a word the column broke in half is put back together", () => {
  assert.deepEqual(reflowBodyLines(["a magi-", "cal bowl"]), ["a magical bowl"]);
  // a dash that is not hyphenation stays put
  assert.deepEqual(reflowBodyLines(["a bowl -", "truly"]), ["a bowl - truly"]);
});

test("a heading and a bullet keep their own line", () => {
  assert.deepEqual(reflowBodyLines(["THE VAULT", "gold sits here", "", "- one", "- two"]),
    ["THE VAULT", "gold sits here", "- one", "- two"]);
});

test("the printed page number at the foot is dropped", () => {
  assert.deepEqual(reflowBodyLines(["prose here.", "164"]), ["prose here."]);
  assert.deepEqual(reflowBodyLines(["prose here.", "pg. 167)"]), ["prose here."]);
  assert.deepEqual(reflowBodyLines(["prose here.", "(p. 12"]), ["prose here."]);
});

test("a bare number INSIDE the body is kept: it is probably a hex reference", () => {
  const out = reflowBodyLines(["see also", "1334", "for the harbor."]);
  assert.equal(out.length, 1);
  assert.match(out[0], /1334/);
});

test("nothing to reflow is not an error", () => {
  assert.deepEqual(reflowBodyLines([]), []);
  assert.deepEqual(reflowBodyLines(undefined), []);
  assert.equal(buildHexPageHtml({ bodyLines: ["164"] }, new Set()), "<p></p>");
});

test("the page HTML is one paragraph per paragraph, not per line", () => {
  const html = buildHexPageHtml({ bodyLines: ["one", "two", "", "three"] }, new Set());
  assert.equal(html, "<p>one two</p>\n<p>three</p>");
});

test("a page filed one paragraph per printed line is reflowed in place", () => {
  const old = [
    "<p>A salt &amp; pepper tower leans</p>",
    "<p>over the harbor (@UUID[Compendium.world.x.JournalEntry.a.JournalEntryPage.b]{1204}), and its</p>",
    "<p>keeper is a gnome who sells magi-</p>",
    "<p>cal maps.</p>",
    "<p>pg. 12)</p>",
  ].join("\n");
  const next = reflowLegacyHexHtml(old);
  assert.equal(next, "<p>A salt &amp; pepper tower leans over the harbor "
    + "(@UUID[Compendium.world.x.JournalEntry.a.JournalEntryPage.b]{1204}), and its keeper is a gnome who sells magical maps.</p>");
  assert.equal(reflowLegacyHexHtml(next), null, "a second pass changes nothing");
});

test("a page the GM formatted, or one already a paragraph, is left alone", () => {
  assert.equal(reflowLegacyHexHtml("<p>one line</p>\n<p><strong>two</strong></p>"), null);
  assert.equal(reflowLegacyHexHtml("<p>Already one paragraph.</p>"), null);
  assert.equal(reflowLegacyHexHtml("<h2>HEAD</h2><p>a</p><p>b</p>"), null);
  assert.equal(reflowLegacyHexHtml(""), null);
});

test("real paragraphs are not a legacy page: a fresh import's, or the GM's own", () => {
  const fresh = buildHexPageHtml({ bodyLines: ["The tower leans.", "", "Its keeper sells maps."] }, new Set());
  assert.equal(fresh, "<p>The tower leans.</p>\n<p>Its keeper sells maps.</p>");
  assert.equal(reflowLegacyHexHtml(fresh), null);
  assert.equal(reflowLegacyHexHtml("<p>First.</p><p>Second.</p>"), null);
  assert.equal(reflowLegacyHexHtml("<p>TREASURE</p><p>A gold ring.</p>"), null, "a heading line is not a cut line");
});

test("the ready-time rewrite runs once per world, and waits for a locked pack", async () => {
  const { reflowLegacyHexPages } = await import("../scripts/importer/hex/hex-commit.mjs");
  const legacy = "<p>A tower leans</p>\n<p>over the harbor.</p>";
  const makePage = () => ({ id: "p1", text: { content: legacy }, getFlag: () => ({ num: "1204" }) });
  const makeEntry = (page, writes) => ({
    pages: [page],
    getFlag: () => ({ crawl: "WR" }),
    updateEmbeddedDocuments: async (_type, updates) => {
      writes.push(...updates);
      page.text.content = updates[0]["text.content"];
    },
  });
  const run = async ({ locked = false, done = false } = {}) => {
    const writes = [];
    const settings = new Map([["shadowdark-enhancer.hexReflowDone", done]]);
    const packEntry = makeEntry(makePage(), writes);
    const pack = {
      locked, collection: "world.sde-journal", metadata: { packageType: "world" },
      getDocuments: async () => [packEntry],
    };
    globalThis.ui = {};
    globalThis.game = {
      packs: [pack],
      journal: [makeEntry(makePage(), writes)],
      settings: { get: (m, k) => settings.get(`${m}.${k}`), set: async (m, k, v) => settings.set(`${m}.${k}`, v) },
      i18n: { format: (k) => k },
    };
    const n = await reflowLegacyHexPages();
    delete globalThis.game; delete globalThis.ui;
    return { n, writes, stamped: settings.get("shadowdark-enhancer.hexReflowDone") };
  };
  const first = await run();
  assert.equal(first.writes[0]["text.content"], "<p>A tower leans over the harbor.</p>");
  assert.equal(first.stamped, true);
  assert.deepEqual(await run({ done: true }), { n: 0, writes: [], stamped: true }, "a stamped world is never read");
  const locked = await run({ locked: true });
  assert.equal(locked.n, 1, "the world copy is still repaired");
  assert.equal(locked.stamped, false, "the locked pack keeps the job open");
});
