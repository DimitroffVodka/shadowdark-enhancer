// Maps for this world, real template, rows from the window's own model (world-maps-core.mjs) over an invented world.
//   state: busy (Western Reaches loaded and its View shown, a map at work, every state on screen) | fresh | noupload
import { readFileSync } from "node:fs";
import { mapList, mapsView } from "../../../scripts/importer/world-maps-core.mjs";
import { allSites } from "../../../scripts/importer/adventure/adventure-manifest.mjs";

const S = JSON.parse(readFileSync(new URL("../../../languages/en.json", import.meta.url), "utf8"));
const t = (key, args) => String(S[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => args?.[k] ?? m);
const sites = allSites();

const STATES = {
  busy: () => {
    const filed = new Set(sites.filter((s) => s.src !== "CS6").map((s) => s.id));
    const inWorld = new Set(["hex-wr", sites[0].id]);
    const packed = new Set(["hex-cs1", "hex-cs2", "hex-cs5", ...sites.slice(1, 6).map((s) => s.id)]);
    const lines = {
      "hex-wr": { text: "", sceneId: "a0" },
      "hex-cs4": { text: t("SDE.importer.maps.line.bothHalves"), sceneId: null },
      "hex-cs3": { text: t("SDE.importer.maps.line.noKeys", { book: "Cursed Scroll 3: Midnight Sun" }), sceneId: "i" },
    };
    inWorld.add("hex-cs3");
    return { groups: mapsView(mapList({ inWorld, packed, filed }), { busy: sites[2].id, lines, canUpload: true, t }), canUpload: true };
  },
  fresh: () => ({ groups: mapsView(mapList({ inWorld: new Set(), packed: new Set(), filed: new Set() }), { busy: null, lines: {}, canUpload: true, t }), canUpload: true }),
  noupload: () => ({ groups: mapsView(mapList({ inWorld: new Set(["hex-wr"]), packed: new Set(["hex-cs1"]), filed: new Set(sites.map((s) => s.id)) }), { busy: null, lines: {}, canUpload: false, t }), canUpload: false }),
};

const build = (state) => ({
  toolbar: `<span>State:</span>${Object.keys(STATES).map((s) => `<button data-action="pick" data-state="${s}">${s}</button>`).join("")}`,
  context: (STATES[state] ?? STATES.busy)(),
});

export default {
  id: "sde-world-maps", title: "SDE.importer.maps.windowTitle", icon: "fa-solid fa-map", classes: ["sde-ui", "sde-world-maps"],
  width: 560, height: 640, template: "templates/importer-world-maps.hbs", initial: "busy", build, resizable: true,
  actions: { pick: { state: "{state}" } },
};
