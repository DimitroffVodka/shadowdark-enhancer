// The GM's landing page editor (a real template). state = filled | empty | long (add -full for the whole window). filled: one merchant of every kind
// (stocked, with no wares, restocking, NPC deleted); restock days and the haggle box vary. The Generate merchant row is under the merchants. long: very long names and text. empty: a new page, no NPC to add.
// Real window: 680 x 780, ApplicationV2 over the Scenes directory's right-click menu.
const portrait = (n) => `icons/environment/people/${n}.webp`;
const people = [
  { id: "m1", actorId: "a1", name: "Hargrave the Smith", img: portrait("infantry-armored"), role: "Weapons and tools", pitch: "Honest steel at fair prices, and no questions about the blood.", open: true, rev: 2, buyMultiplier: 110, sellRatio: 50, restockDays: 7, haggle: true, wares: 10 },
  { id: "m2", actorId: "a2", name: "Mother Quill", img: portrait("cleric-grey"), role: "Scribe and bookseller", pitch: "Scrolls, ink and secrets.", open: false, rev: 0, buyMultiplier: 100, sellRatio: 40, restockDays: 0, haggle: false, wares: 0, empty: true },
  { id: "m3", actorId: "a3", name: "The Gilded Flagon", img: portrait("commoner"), role: "Inn and provisions", pitch: "Ale, rations and rumours, in that order.", open: true, rev: 1, buyMultiplier: 100, sellRatio: 50, restockDays: 30, haggle: true, wares: 11, restocking: true },
  { id: "m4", actorId: "gone", name: "Unknown NPC", img: "icons/svg/mystery-man.svg", role: "", pitch: "", open: true, rev: 0, buyMultiplier: 100, sellRatio: 50, restockDays: 0, haggle: true, wares: 0, missing: true },
];
const page = { title: "Hollowmere", tagline: "A market town at the edge of the Western Reach", blurb: "The fair has drawn every trader from three valleys. The smithy rings from dawn, and the Flagon has never once closed its doors.", banner: "" };
const places = [["quests", "Quest Log"], ["journals", "Journals"], ["party", "Party"], ["downtime", "Downtime"]].map(([id, label], i) => ({ id, label, on: i !== 3 }));
const build = (state) => {
  const full = state.endsWith("-full"), s = state.replace("-full", "");
  const empty = s === "empty", long = s === "long";
  const merchants = empty ? [] : long
    ? [{ ...people[0], name: "Hargrave Wolfsbane-Ironhand, Master Smith of the Seven Spires and the Lantern Hold", role: "Weapons, tools, armour repairs and anything else that rings", pitch: "Honest steel at fair prices, and no questions about the blood on it, the hand that held it or the road it came by.", wares: 24 }]
    : people;
  return {
    ...(full ? { height: 1500 } : {}),
    context: {
      sceneName: long ? "The Free City of Hollowmere-upon-the-Lantern-Water and its Three Bridges" : "Hollowmere",
      page: empty ? { title: "Hollowmere", tagline: "", blurb: "", banner: "" } : { ...page, banner: long ? "worlds/campaign/assets/hollowmere-market-square-at-dusk-banner-final-v3.webp" : "" },
      places, merchants, openCount: merchants.filter((m) => m.open).length,
      kinds: [["general", "General store"], ["weaponsmith", "Weaponsmith"], ["armorer", "Armorer"], ["outfitter", "Outfitter"]].map(([id, label]) => ({ id, label })),
      sizes: [["village", "Village"], ["town", "Town"], ["city", "City"]].map(([id, label]) => ({ id, label, selected: id === "town" })),
      npcs: empty ? [] : [{ id: "n1", name: "Brannock the Barkeep" }, { id: "n2", name: "Ysolde Vane" }],
    },
  };
};
const toolbar = `<span>State:</span>${["filled", "filled-full", "long", "empty"].map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`;
export default {
  previewHeight: 780, title: "SDE.town.editor.title", icon: "fa-solid fa-landmark", classes: ["shadowdark-enhancer", "sde-ui", "sde-town-editor"], resizable: true, width: 680, height: 780,
  template: "templates/town/town-editor.hbs", initial: "filled", toolbar, actions: { s: { state: "{state}" } },
  build: (s) => ({ ...build(s), toolbar }),
};
