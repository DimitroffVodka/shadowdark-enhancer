// The landing page players see: the scene's own picture with this menu down the right. state = player | gm | empty |
// empty-gm | tavern-gm | tavern-player | tavern-player-night. Built with the window's own view functions. The real window has no frame; the harness draws one, so the
// fixture hides it. The painting is a SAMPLE drawn for the docs in the harness cache (never in the repo); the real one is the scene's own.
import { placeTiles, purseText } from "../../../scripts/town/town-view.mjs";
import { DEFAULT_PLACE_IDS } from "../../../scripts/town/town-core.mjs";
import { MERCHANTS, COINS, ACTOR, t } from "./_town.mjs";

const TAVERN = ["quests", "party", "carouse", "rumors"];
const css = `
html { background: #000 url(/cache/lp-sample-backdrop.jpg) 0 38% / cover no-repeat fixed !important; }
body { background: none !important; }
.sde-ui.sde-town.tm-root { position: fixed !important; inset: 0 0 0 auto !important; width: min(560px, 100vw) !important; height: 100vh !important; max-height: none !important; transform: none !important; }
.sde-ui.sde-town, .sde-ui.sde-town * { backdrop-filter: none !important; }
.sde-ui.sde-town .window-header { display: none; }
.sde-ui.sde-town .window-content { padding: 0; background: none; overflow: visible; }
`;
const toolbar = `<span>State:</span>${["player", "gm", "empty", "empty-gm", "tavern-gm", "tavern-player", "tavern-player-night"].map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`;
const build = (state) => {
  const tavern = state.startsWith("tavern"), night = state.endsWith("night");
  if (tavern) {
    return { toolbar, context: {
      townName: "The Gilded Flagon", tagline: "Warm hearth, cold ale", blurb: "", merchants: [],
      places: placeTiles(TAVERN, { isGM: state === "tavern-gm", hasParty: true, downtimeOpen: false, activeQuests: 1, nightOpen: night, gmOnline: true, rumorsHeard: night, t }),
      isGM: state === "tavern-gm", actorName: ACTOR, purse: purseText(COINS),
    } };
  }
  const empty = state.startsWith("empty"), isGM = state === "gm" || state === "empty-gm";
  return {
    toolbar,
    context: {
      townName: "Hollowmere", tagline: "A market town at the edge of the Western Reach",
      blurb: "", merchants: empty ? [] : MERCHANTS.slice(0, 3).concat({ ...MERCHANTS[3], open: false }),
      places: placeTiles([...DEFAULT_PLACE_IDS.slice(0, 3), "map", ...DEFAULT_PLACE_IDS.slice(3)], { isGM, hasParty: true, downtimeOpen: false, activeQuests: 3, t }),
      isGM, returnName: isGM ? "The Fallen Keep" : "", actorName: ACTOR, purse: purseText(COINS),
    },
  };
};
export default {
  previewHeight: 860, title: "Hollowmere", classes: ["shadowdark-enhancer", "sde-ui", "sde-town", "tm-root"], width: 560, height: 860, css,
  template: "templates/town/town-landing.hbs", initial: "player", toolbar, actions: { s: { state: "{state}" } }, build,
};
