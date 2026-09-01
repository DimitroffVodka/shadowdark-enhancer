// C1 / #69 — Basic Gear description RECORD BOUNDARIES.
//
// One defect, nine reported symptoms: a description body ran to the next
// ANCHORED header instead of to the next RECORD START. Any real record start
// the anchor list did not cover therefore failed to end the record above it,
// and that record swallowed it:
//
//   • a row the importer deliberately refuses  — Coin / Gem are currency, so
//     they never become items and never become anchors (gear-currency-rows);
//   • a header whose book spelling differs from its table row — the row reads
//     "Oil, flask" while the description header reads "Oil flask.";
//   • a name two rows share — "Rope, 60'" and "Rope, morzo silk" both reduce
//     to the variant "Rope", which the builder drops as ambiguous;
//   • page furniture — a page-footer number between two records.
//
// The fix is one shared rule (record-boundary.mjs), not nine name-specific
// exceptions: a record ends at the next record START, whether or not anything
// claimed it. The controls below pin the two ways that rule can go wrong —
// cutting a body that should stay whole, and fusing records that should split.
//
// Fixtures are INVENTED prose on real gear names, per the no-book-content rule.
// They reproduce the grabbed SHAPE: column-ordered lines with no blank line
// between paragraphs, because pdf-text-extract's columnLines emits one line per
// visual line and turns a paragraph gap into an ordinary line break.
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitDescriptionsByNames } from "../scripts/importer/items/item-parser.mjs";
import { findRecordStarts, isRecordStartLine } from "../scripts/importer/items/record-boundary.mjs";
import { joinGear } from "../scripts/importer/items/gear-join.mjs";

/** The description text as the two-column grab hands it over: no blank lines. */
const grab = (...lines) => lines.join("\n");

const descOf = (entries, name) =>
  entries.find((e) => e.name.toLowerCase() === name.toLowerCase())?.description ?? null;

// ── The failure class ─────────────────────────────────────────────────────────

test("an unanchored record start ends the record above it (currency row)", () => {
  // "Coin" is refused by the importer, so it is never an anchor. Before the
  // fix, Charcoal's body ran straight through it.
  const text = grab(
    "Charcoal. One use. It leeches the",
    "poison from an edible item.",
    "Coin. One gold piece buys a night",
    "at a quiet inn.",
    "Crowbar. Grants an edge on prying.",
  );
  const entries = splitDescriptionsByNames(text, ["Charcoal", "Crowbar"]);
  const charcoal = descOf(entries, "Charcoal");
  assert.ok(charcoal, "Charcoal should still get its own description");
  assert.match(charcoal, /leeches the poison/);
  assert.doesNotMatch(charcoal, /gold piece/, "Coin's paragraph must not bleed into Charcoal");
  assert.doesNotMatch(charcoal, /Coin\./);
  // The record after the unanchored one is still whole.
  assert.match(descOf(entries, "Crowbar"), /edge on prying/);
});

test("a header whose spelling differs from its row still ends the record above", () => {
  // Row "Oil, flask" yields the anchors "Oil, Flask" and "Oil" — neither
  // matches the book header "Oil flask.", so Net used to swallow it.
  const text = grab(
    "Net. Close range, one target. A",
    "snared creature may cut free.",
    "Oil flask. One flask covers a close",
    "area and burns for four rounds.",
    "Pole. Wooden, ten feet long.",
  );
  const entries = splitDescriptionsByNames(text, ["Net", "Oil, Flask", "Oil", "Pole"]);
  const net = descOf(entries, "Net");
  assert.match(net, /snared creature may cut free/);
  assert.doesNotMatch(net, /burns for four rounds/, "Oil flask's paragraph must not bleed into Net");
  assert.match(descOf(entries, "Pole"), /Wooden, ten feet long/);
});

test("a name two rows share is ambiguous, but still ends the record above", () => {
  const text = grab(
    "Rations. One day of food and water",
    "for a single person.",
    "Rope. Braided hemp, sixty feet.",
    "Saddle. A rider gains an edge on",
    "checks to stay mounted.",
  );
  // "Rope" is dropped as ambiguous by the builder, so it is not an anchor.
  const entries = splitDescriptionsByNames(text, ["Rations", "Rope, Morzo Silk", "Saddle"]);
  const rations = descOf(entries, "Rations");
  assert.match(rations, /food and water/);
  assert.doesNotMatch(rations, /Braided hemp/, "Rope's paragraph must not bleed into Rations");
  assert.match(descOf(entries, "Saddle"), /stay mounted/);
});

// ── Control: partial / page boundary ──────────────────────────────────────────

test("page furniture between two records is a boundary, not description text", () => {
  const text = grab(
    "Holy water. The blessed contents of",
    "one flask sear an undead creature.",
    "108",
    "Iron spikes. Strong spikes bored for",
    "threading a rope.",
  );
  const entries = splitDescriptionsByNames(text, ["Holy Water", "Iron Spikes"]);
  const holy = descOf(entries, "Holy Water");
  assert.match(holy, /sear an undead creature/);
  assert.doesNotMatch(holy, /108/, "a page-footer number must not land in a description");
  const spikes = descOf(entries, "Iron Spikes");
  assert.match(spikes, /threading a rope/);
  assert.doesNotMatch(spikes, /108/);
});

test("a record whose text continues across a page break stays one record", () => {
  // The footer interrupts a body mid-sentence. It is dropped, and the record
  // is NOT split into two — nothing after the footer starts a new record.
  const text = grab(
    "Wagon. One per mount. It carries no",
    "rider and grants extra gear slots",
    "109",
    "while travelling overland.",
  );
  const entries = splitDescriptionsByNames(text, ["Wagon"]);
  assert.equal(entries.length, 1);
  const wagon = descOf(entries, "Wagon");
  assert.match(wagon, /grants extra gear slots/);
  assert.match(wagon, /while travelling overland/, "text after the footer belongs to the same record");
  assert.doesNotMatch(wagon, /109/);
});

// ── Control: adjacent record collision ────────────────────────────────────────

test("adjacent record starts split, even with no body between them", () => {
  const text = grab(
    "Mirror. A small, polished glass.",
    "Net. Close range, one target.",
    "Pole. Wooden, ten feet long.",
  );
  const entries = splitDescriptionsByNames(text, ["Mirror", "Net", "Pole"]);
  assert.equal(entries.length, 3);
  assert.match(descOf(entries, "Mirror"), /polished glass/);
  assert.doesNotMatch(descOf(entries, "Mirror"), /Close range/);
  assert.match(descOf(entries, "Net"), /Close range, one target/);
  assert.doesNotMatch(descOf(entries, "Net"), /Wooden/);
  assert.match(descOf(entries, "Pole"), /Wooden, ten feet long/);
});

test("two records sharing one line still split", () => {
  const text = "Pole. Wooden, ten feet long. Rations. One day of food for one person.";
  const entries = splitDescriptionsByNames(text, ["Pole", "Rations"]);
  assert.equal(entries.length, 2);
  assert.match(descOf(entries, "Pole"), /Wooden, ten feet long/);
  assert.doesNotMatch(descOf(entries, "Pole"), /day of food/);
  assert.match(descOf(entries, "Rations"), /day of food for one person/);
});

// ── Control: valid multiline descriptions must survive ────────────────────────

test("a line-initial trailing sentence stays with its record", () => {
  // "Has a shutter to hide the light." begins a line, is capitalised and ends
  // in an early period — the exact shape a naive boundary rule would cut on.
  // It is a sentence, not a name, so the record keeps it.
  const text = grab(
    "Lantern. Casts light to a double near",
    "distance. One flask of oil fuels it",
    "for an hour of real time.",
    "Has a shutter to hide the light.",
    "Lantern hook. Connects to a belt.",
  );
  const entries = splitDescriptionsByNames(text, ["Lantern", "Lantern Hook"]);
  const lantern = descOf(entries, "Lantern");
  assert.match(lantern, /fuels it for an hour/);
  assert.match(lantern, /Has a shutter to hide the light/, "a trailing sentence must not be dropped");
  assert.match(descOf(entries, "Lantern Hook"), /Connects to a belt/);
});

test("short mid-line sentences never start a record", () => {
  const text = grab(
    "Charcoal. One use. It leeches the",
    "poison from an edible item. Do not",
    "lose it. Keep it dry.",
    "Crowbar. Grants an edge on prying.",
  );
  const entries = splitDescriptionsByNames(text, ["Charcoal", "Crowbar"]);
  const charcoal = descOf(entries, "Charcoal");
  assert.match(charcoal, /One use/);
  assert.match(charcoal, /Keep it dry/, "the whole body must survive");
  assert.doesNotMatch(charcoal, /Grants an edge/);
});

test("a lowercase mention of another item's name never starts a record", () => {
  // "Caltrops. Tiny, triangle-shaped iron spikes. Living creatures…" wraps so
  // that a line BEGINS "iron spikes." — the name of a real item, in lowercase
  // prose. Matching is case-insensitive so the caller's spelling need not match
  // the book's, which used to let this cut Caltrops' body in two.
  const text = grab(
    "Caltrops. Tiny, triangle-shaped",
    "iron spikes. Living creatures who",
    "step on them move at half speed.",
    "Candle. Sheds light for a short while.",
  );
  const entries = splitDescriptionsByNames(text, ["Caltrops", "Iron Spikes", "Candle"]);
  const caltrops = descOf(entries, "Caltrops");
  assert.match(caltrops, /triangle-shaped iron spikes/);
  assert.match(caltrops, /move at half speed/, "the body must not be cut at a lowercase mention");
  assert.equal(descOf(entries, "Iron Spikes"), null, "no record starts at lowercase prose");
  assert.match(descOf(entries, "Candle"), /Sheds light/);
});

test("a multi-word item name longer than the shape cap still anchors when known", () => {
  const text = grab(
    "Traveler's folding camp lantern. It",
    "burns one flask of oil a day.",
    "Wagon. One per mount.",
  );
  const entries = splitDescriptionsByNames(text, ["Traveler's folding camp lantern", "Wagon"]);
  assert.match(descOf(entries, "Traveler's folding camp lantern"), /one flask of oil a day/);
  assert.doesNotMatch(descOf(entries, "Traveler's folding camp lantern"), /per mount/);
});

// ── The shared boundary owner ─────────────────────────────────────────────────

test("isRecordStartLine accepts name-shaped headers and refuses sentences", () => {
  assert.ok(isRecordStartLine("Coin. One gold piece buys a night."));
  assert.ok(isRecordStartLine("Oil flask. One flask covers a close area."));
  assert.ok(isRecordStartLine("Rope, morzo silk. A pencil-thin rope."));
  assert.equal(isRecordStartLine("Has a shutter to hide the light."), null);
  assert.equal(isRecordStartLine("One use. It leeches the poison out."), null);
  assert.equal(isRecordStartLine("It can free itself on its turn."), null);
  assert.equal(isRecordStartLine("and can only move at half speed"), null);
  // A known name overrides the shape cap.
  assert.ok(isRecordStartLine("Traveler's folding camp lantern. It burns oil.",
    { knownNames: ["Traveler's folding camp lantern"] }));
});

test("findRecordStarts reports known and unknown boundaries in reading order", () => {
  const text = grab(
    "Net. Close range, one target.",
    "Oil flask. One flask covers an area.",
    "42",
    "Pole. Wooden, ten feet long.",
  );
  const starts = findRecordStarts(text, { knownNames: ["Net", "Pole"] });
  // Page furniture is excised from bodies, not treated as a record start —
  // a footer must not split a record whose text continues past it.
  assert.deepEqual(starts.map((s) => s.kind), ["known", "unknown", "known"]);
  assert.deepEqual(starts.map((s) => s.name), ["Net", "Oil flask", "Pole"]);
  // Offsets are ascending, and each body starts after its header.
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i].start > starts[i - 1].start);
  for (const s of starts) assert.ok(s.bodyStart > s.start);
});

test("a known start is never also reported as an unknown one", () => {
  const starts = findRecordStarts("Net. Close range, one target.", { knownNames: ["Net"] });
  assert.equal(starts.length, 1);
  assert.equal(starts[0].kind, "known");
});

// ── The second consumer: the cost-table / description join ────────────────────

test("joinGear ends a body at an unmatched record start too", () => {
  // Same rule, the other consumer. "Coin" has no cost row (currency), so it
  // used to be swallowed by the row above it.
  const costText = [
    "Item Cost Quantity Per Gear Slot",
    "Charcoal, jar 1 gp 1",
    "Crowbar 5 sp 1",
  ].join("\n");
  const descText = grab(
    "Charcoal. One use. It leeches the",
    "poison from an edible item.",
    "Coin. One gold piece buys a night",
    "at a quiet inn.",
    "Crowbar. Grants an edge on prying.",
  );
  const { drafts, unclaimedDescriptions } = joinGear(costText, descText);
  const charcoal = drafts.find((d) => /charcoal/i.test(d.name));
  assert.match(charcoal.description, /leeches the poison/);
  assert.doesNotMatch(charcoal.description, /gold piece/, "Coin must not bleed into Charcoal, jar");
  const crowbar = drafts.find((d) => /crowbar/i.test(d.name));
  assert.match(crowbar.description, /edge on prying/);
  // The orphan is surfaced rather than silently absorbed.
  assert.ok(unclaimedDescriptions.some((u) => /coin/i.test(u.phrase)));
});

test("joinGear keeps a multiline body whole across a line-initial sentence", () => {
  const costText = ["Lantern 5 gp 1", "Lantern hook 5 sp 1"].join("\n");
  const descText = grab(
    "Lantern. Casts light to a double near",
    "distance. One flask of oil fuels it",
    "for an hour of real time.",
    "Has a shutter to hide the light.",
    "Lantern hook. Connects to a belt.",
  );
  const { drafts } = joinGear(costText, descText);
  const lantern = drafts.find((d) => d.name.toLowerCase() === "lantern");
  assert.match(lantern.description, /Has a shutter to hide the light/);
  assert.doesNotMatch(lantern.description, /Connects to a belt/);
});

test("joinGear ownership remains stable for Oil flask and both Rope headers", () => {
  const costText = [
    "Net 1 gp 1",
    "Oil, flask 1 gp 1",
    "Rope, 60' 1 gp 1",
    "Rope, morzo silk 2 gp 1",
  ].join("\n");
  const descText = grab(
    "Net. A snared creature may cut free.",
    "Oil flask. One flask covers a close area.",
    "Rope. Braided hemp, sixty feet long.",
    "Rope, morzo silk. A pencil-thin silk rope.",
  );
  const { drafts, unclaimedDescriptions } = joinGear(costText, descText);
  assert.equal(unclaimedDescriptions.length, 0);
  assert.match(drafts.find((draft) => draft.name === "Oil, Flask").description, /close area/);
  assert.match(drafts.find((draft) => draft.name === "Rope, 60'").description, /Braided hemp/);
  assert.match(drafts.find((draft) => draft.name === "Rope, Morzo Silk").description, /pencil-thin/);
});
