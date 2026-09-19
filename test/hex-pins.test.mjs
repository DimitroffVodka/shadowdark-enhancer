import test from "node:test";
import assert from "node:assert/strict";
import { planPins, rewriteCrawlLinksForWorld, PIN_ICONS } from "../scripts/hex-map/hex-pins.mjs";

const numbered = new Map([[1403, { x: 100.4, y: 200.6 }], [505, { x: 50, y: 60 }], [6373, { x: 900, y: 1000 }]]);

test("planPins: one note per keyed page at its hex centre, icon by feature, missing hexes reported", () => {
  const pages = [
    { id: "p1", num: "1403", name: "1403 Thornmere", feature: "town" },
    { id: "p2", num: "0505", name: "0505 Old tower" },
    { id: "p3", num: "9999", name: "9999 Off the map", feature: "village" },
    { id: "p4", num: "", name: "Preface" },
  ];
  const { create, update, missing } = planPins(pages, numbered, [], { entryId: "J1" });
  assert.equal(update.length, 0);
  assert.deepEqual(missing, [9999]);
  assert.equal(create.length, 2);
  const [a, b] = create;
  assert.deepEqual([a.entryId, a.pageId, a.x, a.y, a.text], ["J1", "p1", 100, 201, "1403 Thornmere"]);
  assert.equal(a.texture.src, PIN_ICONS.town);
  assert.equal(b.texture.src, PIN_ICONS.keyed_location, "no feature → keyed location icon");
  assert.deepEqual(a.flags["shadowdark-enhancer"].hexPin, { num: 1403 });
});

test("planPins: existing pins are moved, not duplicated", () => {
  const pages = [{ id: "p1", num: 1403, name: "1403 Thornmere" }, { id: "p5", num: 6373, name: "6373 Cliff" }];
  const { create, update } = planPins(pages, numbered, [{ id: "n1", num: 1403 }], { entryId: "J1", iconSize: 52 });
  assert.equal(update.length, 1);
  assert.deepEqual([update[0]._id, update[0].pageId, update[0].iconSize], ["n1", "p1", 52]);
  assert.equal(create.length, 1);
  assert.equal(create[0].pageId, "p5");
});

test("rewriteCrawlLinksForWorld points same-crawl page links at the world copy and leaves others", () => {
  const html = '<p>See @UUID[Compendium.world.sde-journal.JournalEntry.abc.JournalEntryPage.p2]{Old tower} and @UUID[Actor.xyz]{Someone}</p>';
  const out = rewriteCrawlLinksForWorld(html, "Compendium.world.sde-journal.JournalEntry.abc", "abc");
  assert.equal(out, '<p>See @UUID[JournalEntry.abc.JournalEntryPage.p2]{Old tower} and @UUID[Actor.xyz]{Someone}</p>');
});
