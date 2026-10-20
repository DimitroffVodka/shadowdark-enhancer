// The real hex brush template with a busy Legend (ten terrains, two of them two words). The harness runs no module
// JS and has no map to crop, so every tile shows the icon fallback the window uses before the map has been read; the
// pictures themselves (crops of the map's own hexes) are drawn at runtime by sampler.mjs and never stored.
//   state: <terrain value> = that tile picked, "none" = nothing picked yet, "other" = Other... with a word typed.
const terrain = [   // value, label, overlay colour, icon (the same table the window reads: hex-picture.mjs, tag-overlay.mjs)
  ["forest", "forest", "#bad3af", "fa-tree"], ["grassland", "grassland", "#e4eebf", "fa-wheat-awn"], ["mountain", "mountain", "#c7b8ab", "fa-mountain"],
  ["swamp", "swamp", "#c3c8c8", "fa-frog"], ["desert", "desert", "#ffe8ba", "fa-sun"], ["jungle", "jungle", "#acd5c0", "fa-leaf"],
  ["lake", "lake", "#b4dce8", "fa-water"], ["ocean", "ocean", "#9ec5e0", "fa-water"],
  ["arctic_sea", "arctic sea", "#d9ebf9", "fa-snowflake"], ["salt_flat", "salt flat", "#f5ebd9", "fa-cube"],
];
const build = (state) => {
  const other = state === "other", picked = other ? "__other" : state;
  const tiles = [...terrain.map(([value, label, color, icon]) => ({ value, label, color, ink: "#1d1d1d", icon, img: "", selected: value === picked })),
    { value: "__other", label: "other…", color: "#6f6f6f", ink: "#fff", icon: "fa-pen", img: "", selected: other }];
  const stop = tiles.find((o) => o.selected) ?? tiles[0];
  for (const o of tiles) o.tab = o === stop ? 0 : -1;
  return {
    context: {
      tiles, otherSelected: other, otherWord: other ? "badlands" : "",
      current: tiles.find((o) => o.selected) ?? { label: "(none)", color: "#6f6f6f", ink: "#fff", icon: "fa-map", img: "" },
      features: [["river", "River", "fa-water"], ["path", "Path", "fa-road"], ["coast", "Coast", "fa-umbrella-beach"]].map(([value, label, icon]) => ({ value, label, icon, checked: value === "river" })),
    },
    toolbar: `<span>State:</span>${["forest", "arctic_sea", "other", "none"].map((s) => `<button data-action="pick" data-state="${s}">${s.replace("_", " ")}</button>`).join("")}`,
  };
};
export default {
  previewHeight: 560, title: "SDE.hexMap.brush.title", icon: "fa-solid fa-paintbrush", classes: ["shadowdark", "sde-hex-brush", "sde-ui"],
  width: 330, template: "templates/hex-brush.hbs", initial: "forest", build, actions: { pick: { state: "{state}" } },
};
