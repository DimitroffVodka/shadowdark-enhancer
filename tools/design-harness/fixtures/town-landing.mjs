// The Town window players see on a landing scene. state = player | gm | photo | empty | empty-gm (add -full for the whole
// window without scrolling). Built with the window's own view functions. Real window: 780 x 760, ApplicationV2.
import { placeTiles, purseText, townStats } from "../../../scripts/town/town-view.mjs";
import { PLACE_IDS } from "../../../scripts/town/town-core.mjs";
import { MERCHANTS, COINS, ACTOR, t } from "./_town.mjs";

const toolbar = `<span>State:</span>${["player", "player-full", "gm", "photo", "empty", "empty-gm"].map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`;
const build = (state) => {
  const full = state.endsWith("-full"), s = state.replace("-full", "");
  const merchants = s.startsWith("empty") ? [] : MERCHANTS;
  const open = merchants.filter((m) => m.open).length, isGM = s === "gm" || s === "empty-gm";
  return {
    toolbar, ...(full ? { height: 1180 } : {}),
    context: {
      townName: "Hollowmere", tagline: "A market town at the edge of the Western Reach",
      blurb: "The fair has drawn every trader from three valleys. The smithy rings from dawn, and the Flagon has never once closed its doors.",
      bannerImg: s === "photo" ? "modules/shadowdark-enhancer/assets/scenes/arena/greybanner-arena.webp" : "",
      stats: townStats({ open, total: merchants.length, activeQuests: 3, t }), merchants, openCount: open,
      places: placeTiles(PLACE_IDS, { isGM, hasParty: true, downtimeOpen: false, activeQuests: 3, t }),
      isGM, actorName: ACTOR, purse: purseText(COINS),
    },
  };
};
export default {
  previewHeight: 760, title: "Hollowmere", icon: "fa-solid fa-landmark", classes: ["shadowdark-enhancer", "sde-ui", "sde-town"], resizable: true, width: 780, height: 760,
  template: "templates/town/town-landing.hbs", initial: "player", toolbar, actions: { s: { state: "{state}" } }, build,
};
