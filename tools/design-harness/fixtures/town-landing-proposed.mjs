// Town landing page (proposal 2026-10-16): what players see on the town scene. state = player | gm | photo | empty.
// player: the busiest player view. gm: adds the GM's two icon buttons. photo: the GM chose a banner picture.
// empty: a town with no merchants yet. Add -full to any state for the whole window without scrolling. Real window: about 780 x 700, ApplicationV2 over the town scene.
import { proposed } from "./_proposed.mjs";
import { STRINGS, MERCHANTS, PURSE, ACTOR } from "./_town.mjs";

const places = [
  { id: "quests", icon: "fa-list-check", label: "Quest Log", sub: "What the party has taken on, and what it is owed.", tag: "3 active" },
  { id: "journals", icon: "fa-book-open", label: "Journals", sub: "Session recaps, handouts and your own notes.", tag: "New" },
  { id: "party", icon: "fa-people-group", label: "Party", sub: "Marching order, light and rations.", tag: "" },
  { id: "downtime", icon: "fa-hourglass-half", label: "Downtime", sub: "Train, carouse and recruit between adventures.", tag: "", disabled: true, hint: "Opens when the GM starts a downtime session." },
];
const toolbar = `<span>State:</span>${["player", "player-full", "gm", "photo", "empty", "empty-gm"].map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`;
const build = (state) => {
  const full = state.endsWith("-full"), s = state.replace("-full", "");
  const merchants = s.startsWith("empty") ? [] : MERCHANTS;
  return {
    toolbar, ...(full ? { height: 1180 } : {}),
    context: {
      townName: "Hollowmere", tagline: "A market town at the edge of the Western Reach",
      blurb: "The fair has drawn every trader from three valleys. The smithy rings from dawn, and the Flagon has never once closed its doors.",
      bannerImg: s === "photo" ? "modules/shadowdark-enhancer/assets/scenes/arena/greybanner-arena.webp" : "",
      stats: [{ label: "Heroes in town", value: "4" }, { label: "Quests", value: "3" }, { label: "Day", value: "Fair" }],
      merchants, openCount: merchants.filter((m) => m.open).length, places,
      isGM: s === "gm" || s === "empty-gm", actorName: ACTOR, purse: PURSE,
    },
  };
};
export default proposed({
  template: "tools/design-harness/proposed/templates/town-landing.hbs", title: "Hollowmere", icon: "fa-solid fa-landmark", resizable: true, width: 780, height: 720, previewHeight: 760,
  initial: "player", build, toolbar, actions: { s: { state: "{state}" } }, strings: STRINGS,
}, {}, { classes: ["sde-ui", "sde-town"], extraCss: "tools/design-harness/proposed/css/town.css" });
