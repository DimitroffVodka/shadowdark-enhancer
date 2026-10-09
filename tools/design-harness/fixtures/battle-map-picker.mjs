// The battle map picker, built by the picker's own model (battle-map-picker-core.mjs) from an invented library, so the context
// is the one the window gets. The busiest state is `forest`: a GM, a pinned map, one switched off, camp art on, night on.
// state = forest | default | random | night | scene | alloff | none | player
import { readFileSync } from "node:fs";
import { pickerModel, terrainWords } from "../../../scripts/encounter/battle-maps/battle-map-picker-core.mjs";

const en = JSON.parse(readFileSync(new URL("../../../languages/en.json", import.meta.url), "utf8"));

/** A picture to stand in for a map's art: a tinted tile, so a card's layout shows without the shipped images. */
const art = (hue) => "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},38%,34%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},42%,16%)"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><circle cx="${90 + (hue % 220)}" cy="150" r="46" fill="hsl(${hue},32%,48%)" opacity=".75"/></svg>`);

const library = [
  ["forest-woods", ["forest"], 120, "Forest Floor, Forest Treetop"], ["forest-road", ["forest", "path"], 100, "Tiling Grass, Forest Floor"],
  ["forest-glade", ["forest"], 140, "Forest Floor"], ["forest-thicket", ["forest", "jungle"], 150, "Forest Treetop"],
  ["grass-open", ["grassland"], 80, "Tiling Grass"], ["grass-hills", ["grassland", "mountain"], 90, "Tiling Grass, Mountain Assets"],
  ["jungle-dense", ["jungle"], 160, "Forest Floor"], ["swamp-bog", ["swamp"], 70, "River and Water Assets"], ["swamp-mire", ["swamp"], 60, "River and Water Assets"],
  ["river-rowboat", ["river"], 200, "Endless River, Rowboat"], ["lake-calm", ["lake"], 210, "River and Water Assets, Rowboat"], ["ocean-open-sea", ["ocean"], 220, "Ocean Water Textures, Galleon"],
  ["arctic-sea-ice-floes", ["arctic_sea"], 190, "Ocean Water Textures, Viking Longship"], ["desert-dunes", ["desert"], 40, "Desert Map Assets"],
  ["salt-flat", ["salt_flat"], 30, "Desert Map Assets"], ["canyon-run", ["canyon"], 20, "Canyon Pack"], ["mountain-pass", ["mountain"], 260, "Mountain Pack"],
  ["coast-cliffs", ["coast"], 180, "Coastal Cliffs"], ["volcano-rim", ["volcano"], 10, "Volcano Pack"], ["lava-field", ["lava"], 0, "Volcano Pack"], ["deep-tunnels", ["deep_tunnels"], 280, "Dungeon Tunnels"],
].map(([id, terrains, hue, credit]) => ({
  id, labelKey: `fx.map.${id}`, terrains, variant: "day", image: art(hue), sources: credit.split(", ").map((name) => ({ name, url: "https://example.test" })),
}));
const CAMP_HUES = { "forest-woods": 125, "grass-open": 85, "forest-road": 105 };
const campOf = (m) => (CAMP_HUES[m.id] ? { ...m, id: `${m.id}-camp`, variant: "camp", variantOf: m.id, image: art(CAMP_HUES[m.id] + 150) } : null);

// The library's map labels live in the library's own strings; the fixture makes some up.
const strings = Object.fromEntries(library.map((m) => [m.labelKey, terrainWords(m.id.replace(/-/g, "_"))]));
const scenes = [
  "The Hideous Halls of Mugdulblub, third level, east wing, with the collapsed bridge and the flooded crypt below", "Black Mine", "The Keep, level 2", "The Keep, level 10",
  "Western Reaches GM Map A0", "Tavern cellar", "Greybanner arena", "Ruined watchtower", "Sablewood crossroads", "The Sunken Temple", "Goblin warren", "Harbour at night", "Old mill", "Bandit camp",
].map((name, i) => ({ id: `s${i}`, name, thumb: i % 3 === 0 ? null : art(i * 25) }));

const build = (state) => {
  const terrain = state === "none" ? "volcano" : "forest";
  const here = state === "none" ? [] : library.filter((m) => m.terrains.includes(terrain));
  // Saved choices: nothing (the first map is the default), random (no pin), every map off, or a pin with one map off.
  const prefs = state === "default" ? {}
    : state === "random" ? { forest: { pinned: null, disabled: ["forest-glade"] } }
      : state === "alloff" ? { forest: { pinned: null, disabled: here.map((m) => m.id) } }
        : { forest: { pinned: "forest-woods", disabled: ["forest-glade"] } };
  const model = pickerModel({
    terrain, maps: here, otherMaps: library.filter((m) => !here.includes(m)), prefs, scenes: state === "none" ? [] : scenes,
    terrainFilter: state === "forest" ? "grassland" : null, query: "", night: state === "night" || state === "forest",
    camping: state !== "alloff" && state !== "none", selected: state === "scene" ? { sceneId: "s1" } : state === "night" ? { mapId: "grass-open" } : null,
    canEdit: state !== "player", campOf,
  });
  return {
    strings,
    context: { ...model, partId: "sde-battle-map-picker-body", terrainName: model.terrainLabelKey ? en[model.terrainLabelKey] : model.terrainText },
  };
};

export default {
  title: "SDE.encounterMaps.picker.title", icon: "fa-solid fa-map", classes: ["sde-ui", "sde-battle-map-picker"], resizable: true, width: 780,
  template: "templates/encounter-maps/picker.hbs", previewHeight: 900, initial: "forest", build,
  toolbar: ["forest", "default", "random", "night", "scene", "alloff", "none", "player"].map((s) => `<button data-action="t" data-state="${s}">${s}</button>`).join(""),
  actions: { t: { state: "{state}" } },
};
