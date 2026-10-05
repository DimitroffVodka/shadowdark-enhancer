// The real hex brush template with a busy Legend (ten terrains, two of them two words). The harness runs no module
// JS and has no map to crop, so every tile shows the icon fallback the window uses before the map has been read; the
// pictures themselves (crops of the map's own hexes) are drawn at runtime by sampler.mjs and never stored.
//   state: <terrain value> = that tile picked, "none" = nothing picked yet, "other" = Other... with a word typed.
const terrain = [   // value, label, overlay colour, icon (the same table the window reads: hex-picture.mjs, tag-overlay.mjs)
  ["forest", "forest", "#2f7d4f", "fa-tree"], ["grassland", "grassland", "#9ec46a", "fa-wheat-awn"], ["mountain", "mountain", "#8b7d6b", "fa-mountain"],
  ["swamp", "swamp", "#5b6b39", "fa-frog"], ["desert", "desert", "#e7cd84", "fa-sun"], ["jungle", "jungle", "#186b3a", "fa-leaf"],
  ["lake", "lake", "#4aa3d9", "fa-water"], ["ocean", "ocean", "#1f5f9e", "fa-water"],
  ["arctic_sea", "arctic sea", "#8fd4e8", "fa-snowflake"], ["salt_flat", "salt flat", "#d2c9a0", "fa-cube"],
];
const build = (state) => {
  const other = state === "other", picked = other ? "__other" : state;
  const tiles = [...terrain.map(([value, label, color, icon]) => ({ value, label, color, icon, img: "", selected: value === picked })),
    { value: "__other", label: "other…", color: "#6f6f6f", icon: "fa-pen", img: "", selected: other }];
  const stop = tiles.find((o) => o.selected) ?? tiles[0];
  for (const o of tiles) o.tab = o === stop ? 0 : -1;
  return {
    context: {
      tiles, otherSelected: other, otherWord: other ? "badlands" : "",
      current: tiles.find((o) => o.selected) ?? { label: "(none)", color: "#6f6f6f", icon: "fa-map", img: "" },
      features: [["river", "River", "fa-water"], ["path", "Path", "fa-road"], ["coast", "Coast", "fa-umbrella-beach"]].map(([value, label, icon]) => ({ value, label, icon, checked: value === "river" })),
    },
    toolbar: `<span>State:</span>${["forest", "arctic_sea", "other", "none"].map((s) => `<button data-action="pick" data-state="${s}">${s.replace("_", " ")}</button>`).join("")}`,
  };
};
export default {
  previewHeight: 560, title: "SDE.hexMap.brush.title", icon: "fa-solid fa-paintbrush", classes: ["shadowdark", "sde-hex-brush", "sde-ui"],
  width: 330, template: "templates/hex-brush.hbs", initial: "forest", build, actions: { pick: { state: "{state}" } },
};
