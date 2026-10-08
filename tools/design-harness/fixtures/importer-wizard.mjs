// The import wizard, real template, real controller: every page is the view model WizardController.viewModel() gives for
// that state, so what is drawn is what the window draws.
//   state: welcome | update | keep | books-empty | books | maps | check-running | check | ready | import | done
import { readFileSync } from "node:fs";
import { WizardController } from "../../../scripts/importer/wizard/wizard-controller.mjs";
import { addFiles, startUpdate, HEX_MAPS } from "../../../scripts/importer/wizard/wizard-core.mjs";

const S = JSON.parse(readFileSync(new URL("../../../languages/en.json", import.meta.url), "utf8"));
const t = (key, args) => String(S[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => args?.[k] ?? m);
const MB = 1048576;
const file = (name, mb) => ({ name, size: Math.round(mb * MB) });

const BOOKS = [
  ["Shadowdark_RPG_-_V4-9-2.pdf", 102.7], ["Player_s_Guide_to_the_Western_Reaches.pdf", 145.2],
  ["Game Master's Guide to the Western Reaches.pdf", 96.9], ["Cursed Scroll 1 - Diablerie V4-3.pdf", 16.3],
  ["Cursed Scroll 2 - Red Sands.pdf", 22.5], ["Cursed Scroll 3 - Midnight Sun.pdf", 20.2],
  ["Cursed Scroll 4 - River of Night.pdf", 32.4], ["Cursed Scroll 5 - Dwellers in the Deep V1-3.pdf", 24.1],
  ["Cursed Scroll 6 - City of Masks.pdf", 23.9],
];
const MAPS = [
  ["Western Reaches GM Map A0.jpg", 21.2], ["Ruins of Bittermold Keep (68 wide x 44 high).png", 2.7],
  ["The Iron Fortress (45 wide x 35 high).png", 2.4], ["Sea Caves and Tombs (68 wide x 44 high).png", 2.9],
];

/** A controller on a state; `fill` picks files, `at` the page, `check` the check's outcome. */
function make({ page, books = 0, maps = 0, check, update, keep = "once", forge = true, notice = "", progress, result, open, terrain, art }) {
  const c = new WizardController({ t, forge, limitMB: 50, canUpload: true }, () => {});
  const s = c.state;
  s.keep = keep;
  addFiles(s, [...BOOKS.slice(0, books), ...MAPS.slice(0, maps)].map(([n, mb]) => file(n, mb)));
  if (update) startUpdate(s, update.info, update.have);
  s.page = page;
  if (open) s.openGroups = new Set(open);
  if (check) s.check = check(s);
  if (progress) s.progress = progress;
  if (result) s.result = result;
  if (art) s.art = art;
  c.notice = notice;
  if (terrain) {
    s.result ??= { imported: 0, already: 0, needsYou: [], hex: [] };
    s.terrain = { queue: [{ id: "hex-cs1", title: "The Gloaming hex map", sceneId: "g" }, { id: "hex-cs2", title: "The Djurum hex map", sceneId: "d" }], i: 0, stage: terrain.stage, error: terrain.error ?? "", named: [] };
    c.legend = { cards: () => CARDS };
  }
  return c.viewModel();
}

const readyIds = (s, skip = []) => [...Object.keys(s.books).map((id) => `book:${id}`), ...Object.keys(s.maps).map((id) => `map:${id}`)].filter((id) => !skip.includes(id));
const items = (s) => [...Object.keys(s.books).map((id) => ({ id, kind: "book", title: id })), ...Object.keys(s.maps).map((id) => ({ id, kind: "map", title: id }))];

/** Invented hex pictures (a hexagon and a few strokes) for the Terrain page: the real ones are crops of the GM's own map. */
const pic = (seed) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 72 72"><rect width="72" height="72" fill="#f4f0e6"/><polygon points="62,36 49,58 23,58 10,36 23,14 49,14" fill="#fff" stroke="#222" stroke-width="2"/>${[0, 1, 2, 3, 4].map((i) => `<path d="M${22 + ((seed * 7 + i * 11) % 28)} ${48 - ((seed * 5 + i * 9) % 22)} l4 -12 l4 12 z" fill="none" stroke="#222" stroke-width="1.6"/>`).join("")}</svg>`)}`;
const TERRAINS = ["arctic", "desert", "forest", "grassland", "hills", "jungle", "mountains", "swamp", "village", "keyed_location"];
const opts = (selected = "") => [...TERRAINS.map((v) => ({ value: v, label: v.replace(/_/g, " "), selected: v === selected })), { value: "__other", label: "other…", selected: false }];
const card = (idx, size, selected = "") => ({ idx, size, thumbs: [1, 2, 3, 4].map((k) => ({ src: pic(idx * 10 + k), num: idx * 100 + k, label: String(idx * 100 + k).padStart(4, "0") })), terrainOptions: [...opts(selected), { value: "__split", label: "these are not all the same", selected: false }], terrainOther: "", split: null, expand: false, picks: [] });
const opened = { idx: 3, size: 38, expand: true, thumbs: [], terrainOptions: [], picks: [1, 2, 3, 4].map((k) => ({ num: 300 + k, label: String(300 + k).padStart(4, "0"), thumb: pic(30 + k), terrainOptions: opts(k === 1 ? "hills" : ""), other: "" })) };
const CARDS = [card(0, 61, "forest"), card(1, 48, "forest"), card(2, 40), opened, card(4, 22, "mountains"), card(5, 9)];

const STATES = {
  welcome: () => make({ page: "welcome" }),
  update: () => make({ page: "welcome", update: { info: { n: 14, books: ["CS6", "WR"] }, have: () => false } }),
  keep: () => make({ page: "keep", books: 9, maps: 3 }),
  "books-empty": () => make({ page: "books" }),
  books: () => make({ page: "books", books: 7, maps: 2, notice: "Added 7 books and 2 maps. Left out 1 second copy of something already added; the other copy suits Foundry better." }),
  maps: () => make({ page: "maps", books: 9, maps: 4, open: ["WR", "CS1"] }),
  "check-running": () => make({ page: "check", books: 9, maps: 4, check: () => ({ done: false, pct: 42, label: "Reading Cursed Scroll 4: River of Night", items: [], ready: [], problems: [] }) }),
  check: () => make({
    page: "check", books: 9, maps: 4,
    check: (s) => ({
      done: true, ready: readyIds(s, ["book:WR", "book:CS3"]), items: [
        ...items(s), { id: "CS5", kind: "book", title: "Cursed Scroll 5: Dwellers in the Deep", warn: "SDE.importer.wizard.warn.olderCs5", warnArgs: { have: "V1", current: "V1-3" } }],
      problems: [
        { id: "WR", kind: "book", title: "Player's Guide to the Western Reaches", reason: "SDE.importer.wizard.problem.tooBig", args: { size: 145, limit: 50 }, fixes: ["useOnce", "remove"] },
        { id: "CS3", kind: "book", title: "Cursed Scroll 3: Midnight Sun", reason: "SDE.importer.wizard.problem.notPdf", fixes: ["remove"] },
      ],
    }),
  }),
  ready: () => make({ page: "ready", books: 9, maps: 4, check: (s) => ({ done: true, ready: readyIds(s).concat(["map:hex-wr"]), items: items(s), problems: [] }) }),
  import: () => make({ page: "import", books: 9, maps: 4, progress: { pct: 62, phase: "Filing the adventure The Hideous Halls of Mugdulblub" } }),
  "terrain-reading": () => make({ page: "terrain", terrain: { stage: "reading" } }),
  terrain: () => make({ page: "terrain", terrain: { stage: "cards" } }),
  "terrain-failed": () => make({ page: "terrain", terrain: { stage: "failed", error: "The map could not be read." } }),
  done: () => make({
    art: { sources: ["Monster Manual", "Shadowdark Community Tokens", "Pathfinder: Monster Core"], stage: "offer", line: "" },
    page: "done", books: 9, maps: 4, check: (s) => ({ done: true, ready: readyIds(s).concat([`map:${HEX_MAPS[0].id}`]), items: items(s), problems: [] }),
    result: { imported: 412, already: 38, skipped: { n: 257, books: ["Player's Guide to the Western Reaches", "Cursed Scroll 6: City of Masks"] }, needsYou: [
      { title: "Fallen Keep of the Emerald Knight", why: "The scene is built. The module does not know where this map's locations sit yet, so you place them by clicking: Importer, Tools, Adventure map." },
      { title: "Goblin", why: "This could not be imported. The advanced importer can show why." },
    ], hex: [
      { id: "hex-wr", title: "Western Reaches hex map (A0)", status: "ready", legend: true, look: false, sceneId: "a0", pinned: 270 },
      { id: "hex-cs1", title: "The Gloaming hex map", status: "ready", legend: true, look: false, optional: true, sceneId: "g", pinned: 31 },
      { id: "hex-cs3", title: "The Isles of Andrik hex map", status: "already", legend: false, look: false, sceneId: "i", pinned: 12 },
      { id: "hex-cs2", title: "The Djurum hex map", status: "needsLook", legend: false, look: true },
      { id: "hex-cs4", title: "The Black River hex map (Jungle)", status: "failed", legend: false, look: true, pinned: 0 },
      { id: "hex-cs5", title: "Morzomotha hex map", status: "already", legend: false, look: false, named: true, sceneId: "m", pinned: 23 },
    ] },
  }),
};

const build = (state) => ({
  toolbar: `<span>State:</span>${Object.keys(STATES).map((s) => `<button data-action="pick" data-state="${s}">${s}</button>`).join("")}`,
  context: (STATES[state] ?? STATES.welcome)(),
});

export default {
  id: "sde-import-wizard", title: "SDE.importer.wizard.windowTitle", icon: "fa-solid fa-file-import", classes: ["sde-ui", "sde-import-wizard"],
  width: 640, height: 700, template: "templates/importer-wizard.hbs", initial: "books", build, resizable: true,
  actions: { pick: { state: "{state}" } },
};
