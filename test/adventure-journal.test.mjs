/**
 * An adventure's overview laid out as the Lost Citadel quickstart lays it out (adventure-journal.mjs): the Overview page, the
 * page for the areas, tables where the PDF flattened them, bold run-in names, inline rolls and requests. Every string is invented.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { assembleOverview, tableize, boldLeadIns, listify } from "../scripts/importer/adventure/adventure-journal.mjs";

const part = (name, ...paras) => ({ key: name.toLowerCase().replace(/ /g, "-"), name, html: paras.map((p) => `<p>${p}</p>`).join("\n") });

test("tableize: a die header and its rows are a table with a header row; the caption is the section", () => {
  const html = tableize("<p>d6 Details</p>\n<p>1 A gust blows out the lamps</p>\n<p>2 2d4 gribbles argue</p>\n<p>3 Nothing</p>", "Random Encounters");
  assert.match(html, /^<table style="width:100%"><caption>Random Encounters<\/caption><tbody>/);
  assert.match(html, /<tr><td style="text-align:center"><p>d6<\/p><\/td><td><p>Details<\/p><\/td><\/tr>/, "the header row");
  assert.match(html, /<tr><td style="text-align:center"><p>2<\/p><\/td><td><p>2d4 gribbles argue<\/p><\/td><\/tr>/);
  assert.equal((html.match(/<tr>/g) ?? []).length, 4);
});

test("tableize: rumors numbered 1, 2, 3 are a table with no header row and bold numbers", () => {
  const html = tableize("<p>1 The well is cursed</p>\n<p>2 A knight sleeps below</p>\n<p>3 Gold, they say</p>", "Rumors");
  assert.equal((html.match(/<tr>/g) ?? []).length, 3, "no header row");
  assert.match(html, /<td style="font-weight:bold;text-align:center"><p><strong>1<\/strong><\/p><\/td><td><p>The well is cursed<\/p><\/td>/);
});

test("tableize: prose and two stray numbered lines stay paragraphs, and a d100 range is a row", () => {
  const prose = "<p>The hall is cold.</p>\n<p>1 One stray line</p>\n<p>2 And another</p>";
  assert.equal(tableize(prose, "Hall"), prose);
  const d100 = tableize("<p>d100 Details</p>\n<p>01 A coin</p>\n<p>02-03 Two coins</p>", "Treasure");
  assert.match(d100, /<p>02-03<\/p><\/td><td><p>Two coins<\/p>/);
});

test("boldLeadIns: a short run-in name is bold; a sentence with a comma or a long opening is not", () => {
  assert.equal(boldLeadIns("<p>Beastmen. These grey-furred beings hide.</p>"), "<p><strong>Beastmen.</strong> These grey-furred beings hide.</p>");
  assert.equal(boldLeadIns("<p>Entrances and Exits. The keep is a shell.</p>"), "<p><strong>Entrances and Exits.</strong> The keep is a shell.</p>");
  const prose = "<p>Long ago, a warrior lived here. It fell.</p>";
  assert.equal(boldLeadIns(prose), prose);
  assert.equal(boldLeadIns("<p>This opening sentence is far too long to be a name. Then more.</p>"), "<p>This opening sentence is far too long to be a name. Then more.</p>");
});

test("assembleOverview: one Overview page with an H2 a section, one page for what holds in every area", () => {
  const pages = assembleOverview([
    part("Room Key", "The keyworded descriptions are safe to share."),
    part("Background", "Long ago, a lord fell."),
    part("Factions", "Beastmen. Grey-furred and craven.", "Ettercaps. Greedy and leaderless."),
    { key: "rumors", name: "Rumors", html: "<p>1 One</p>\n<p>2 Two</p>\n<p>3 Three</p>" },
    part("Order of Battle", "Beastmen. Retreat to Area 14 and hide."),
    { key: "random-encounters", name: "Random Encounters", html: "<p>d4 Details</p>\n<p>1 DC 12 DEX or 1d4 damage</p>\n<p>2 A cave creeper</p>" },
  ], { range: [1, 27] });
  assert.deepEqual(pages.map((p) => [p.key, p.name]), [["overview", "Overview"], ["areas", "Areas 1-27"]]);
  const [overview, areas] = pages;
  assert.deepEqual([...overview.html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]), ["Room Key", "Background", "Factions", "Rumors", "Order of Battle"]);
  assert.match(overview.html, /<p><strong>Beastmen\.<\/strong> Grey-furred and craven\.<\/p>/);
  assert.doesNotMatch(overview.html, /<strong>Long ago/, "the background is prose");
  assert.match(overview.html, /<caption>Rumors<\/caption>/);
  assert.match(areas.html, /<caption>Random Encounters<\/caption>/);
  assert.match(areas.html, /\[\[request 12 dex\]\] or \[\[\/r 1d4\]\] damage/, "the encounter's check and dice are live");
  assert.doesNotMatch(overview.html + areas.html, /Overview<\/h2>/);
});

test("assembleOverview: a one-page adventure stays one Overview page, with its dice live; no area-wide text, no areas page", () => {
  const pages = assembleOverview([{ key: "overview", name: "Overview", html: "<p>A nest of gribbles.</p>\n<h3>Random Encounters</h3>\n<p>1 2d4 gribbles</p>" }], { range: [1, 9] });
  assert.deepEqual(pages.map((p) => p.key), ["overview"]);
  assert.match(pages[0].html, /\[\[\/r 2d4\]\] gribbles/);
  assert.deepEqual(assembleOverview([part("Background", "A lord fell.")], { range: [1, 5] }).map((p) => p.key), ["overview"]);
  assert.deepEqual(assembleOverview([], { range: [1, 5] }), []);
});

test("assembleOverview: the area-wide text the reader ran on from the section above goes to the areas page", () => {
  const pages = assembleOverview([
    part("Order of Battle", "Orcs. Retreat to the hall. Areas 1-33 Danger Level. Risky. Check every 2 rounds."),
    { key: "random-encounters", name: "Random Encounters", html: "<p>d4 Details</p>\n<p>1 A bat</p>\n<p>2 A rat</p>" },
  ], { range: [1, 33] });
  assert.match(pages[0].html, /Retreat to the hall\.<\/p>$/);
  assert.match(pages[1].html, /^<p><strong>Danger Level\.<\/strong> Risky\./);
  assert.doesNotMatch(pages[1].html, /<h2>/, "the page for the areas has no headings");
});

test("listify: bullets become nested lists, a broken line goes on from the one above, arrows inside a paragraph nest under it", () => {
  const html = listify("<p>• Light. Dim.</p>\n<p>• Walls. 30' high, smooth, and</p>\n<p>hard to climb. ▶ Ladders. Iron.</p>\n<p>• Doors. Stone.</p>");
  assert.equal(html, "<ul><li><p>Light. Dim.</p></li><li><p>Walls. 30' high, smooth, and hard to climb.</p><ul><li><p>Ladders. Iron.</p></li></ul></li><li><p>Doors. Stone.</p></li></ul>");
  const lone = "<p>• A single bullet.</p>";
  assert.equal(listify(lone), lone, "one bullet is not a list");
});

import { linkableItems, linkItems } from "../scripts/importer/adventure/adventure-journal.mjs";

test("linkableItems: magic items and treasure with a name a sentence can hold; not properties, not names with a comma", () => {
  const rows = [
    { name: "Scarab of Protection", uuid: "I.1", type: "Basic", system: { magicItem: true } },
    { name: "Rusty key", uuid: "I.2", type: "Basic", system: { treasure: true } },
    { name: "Rapier", uuid: "I.3", type: "Weapon", system: {} },
    { name: "Charge", uuid: "I.4", type: "Property", system: { magicItem: true } },
    { name: "Glow Paste, Jar", uuid: "I.5", type: "Basic", system: { treasure: true } },
    { name: "Orb", uuid: "I.6", type: "Basic", system: { magicItem: true } },
    { name: "rusty KEY", uuid: "I.7", type: "Basic", system: { magicItem: true } },
  ];
  assert.deepEqual(linkableItems(rows).map((i) => i.name), ["Scarab of Protection", "Rusty key"]);
});

test("linkItems: names in the text become links, in the text's own spelling; markup, links and rolls are left alone; a one-word name must match exactly", () => {
  const items = [{ name: "Scarab of Protection", uuid: "Item.A" }, { name: "Rusty key", uuid: "Item.B" }, { name: "Bloodlust", uuid: "Item.C" }, { name: "Rusty key to the vault", uuid: "Item.D" }];
  assert.equal(linkItems("<p>The wight wears a <em>scarab of protection</em>. A rusty key hangs here.</p>", items),
    "<p>The wight wears a <em>@UUID[Item.A]{scarab of protection}</em>. A @UUID[Item.B]{rusty key} hangs here.</p>");
  assert.equal(linkItems("<p>Bloodlust, the axe. His bloodlust grows.</p>", items), "<p>@UUID[Item.C]{Bloodlust}, the axe. His bloodlust grows.</p>");
  assert.equal(linkItems("<p>A Rusty key to the vault.</p>", items), "<p>A @UUID[Item.D]{Rusty key to the vault}.</p>", "the longer name wins");
  const marked = "<p>[[/r 1d4]] <strong>@UUID[Actor.X]{Scarab of Protection}</strong> <a href=\"rusty key\">x</a></p>";
  assert.equal(linkItems(marked, items), marked);
  assert.equal(linkItems("<p>Plain.</p>", []), "<p>Plain.</p>");
});

test("assembleOverview: the roll tables are linked just above the printed tables, and at the top of the areas page when none is printed", () => {
  const tables = { rumors: { uuid: "Compendium.w.RollTable.R", name: "Halls Rumors" }, encounters: { uuid: "Compendium.w.RollTable.E", name: "Halls Random Encounters" } };
  const [overview, areas] = assembleOverview([
    { key: "rumors", name: "Rumors", html: "<p>1 One</p>\n<p>2 Two</p>\n<p>3 Three</p>" },
    { key: "random-encounters", name: "Random Encounters", html: "<p>d4 Details</p>\n<p>1 A bat</p>\n<p>2 A rat</p>" },
  ], { range: [1, 9], tables });
  assert.match(overview.html, /^<h2>Rumors<\/h2>\n<p>@UUID\[Compendium\.w\.RollTable\.R\]\{Halls Rumors\}<\/p>\n<table/);
  assert.match(areas.html, /^<p>@UUID\[Compendium\.w\.RollTable\.E\]\{Halls Random Encounters\}<\/p>\n<table/);
  const noTable = assembleOverview([{ key: "features", name: "Features", html: "<p>• Light. Dim.</p>\n<p>• Walls. Stone.</p>" }], { range: [1, 9], tables });
  assert.match(noTable[0].html, /^<p>@UUID\[Compendium\.w\.RollTable\.E\]/);
  const onePage = assembleOverview([{ key: "overview", name: "Overview", html: "<p>A nest.</p>" }], { range: [1, 9], tables });
  assert.match(onePage[0].html, /<p>@UUID\[Compendium\.w\.RollTable\.E\]\{Halls Random Encounters\}<\/p>$/);
  assert.doesNotMatch(assembleOverview([{ key: "rumors", name: "Rumors", html: "<p>1 a b</p><p>2 c d</p><p>3 e f</p>" }], { range: [1, 9] })[0].html, /RollTable/, "no table in the world, no link");
});
