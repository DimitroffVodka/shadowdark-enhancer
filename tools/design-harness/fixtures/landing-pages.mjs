// The GM's Landing pages window (a real template): Make a landing page, the world's pages, and the Western Reaches
// settlements. state = full (three pages, the player map as a picture, eight settlements) | empty (a new world: no
// pages, no hex import, only the three shipped pictures). Real window: 560 x 760, from the toolbar's Landing page button.
import { t } from "./_town.mjs";

const PLACES = "modules/shadowdark-enhancer/assets/scenes/places";
const pic = (id, label, selected = false) => ({ id, label, thumb: `${PLACES}/thumbs/${id}.webp`, selected });
const games = ["coin", "duel", "wheel", "cards", "bluff", "brag", "death", "roulette", "blackjack", "liars"].map((id) => ({ id, label: t(`SDE.town.games.${id}.name`) }));
const sizes = [["village", "Village"], ["town", "Town"], ["city", "City"], ["city_state", "City-State"]].map(([id, label]) => ({ id, label, selected: id === "town" }));
const build = (state) => {
  const full = state === "full";
  return {
    context: {
      defaultName: "Market", sizes, games,
      pictures: full ? [{ id: "playerMap", label: "Player's Map", thumb: `${PLACES}/thumbs/market.webp`, selected: true }, pic("town", "Town"), pic("market", "Market"), pic("tavern", "Tavern")] : [pic("town", "Town", true), pic("market", "Market"), pic("tavern", "Tavern")],
      pages: full ? [
        { sceneId: "s1", name: "Bone Choir", sizeLabel: "City", here: false, shown: true },
        { sceneId: "s2", name: "Hollowmere Market and the Three Bridges of the Lantern Water", sizeLabel: "Town", here: true, shown: true },
        { sceneId: "s3", name: "The Gilded Flagon", sizeLabel: "", here: false, shown: false },
      ] : [],
      places: full ? [
        ["Alkesh", "City-State", "s9"], ["Bone Choir", "City", "s1"], ["Stonehall", "City", null], ["Low Ford", "Town", null],
        ["Ash Hollow", "Town", null], ["Briarwick", "Village", null], ["Dunmere", "Village", null], ["Saltmarsh Crossing", "Village", null],
      ].map(([name, sizeLabel, sceneId], i) => ({ num: 100 + i, name, sizeLabel, sceneId })) : [],
    },
  };
};
const toolbar = `<span>State:</span>${["full", "empty"].map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`;
export default {
  previewHeight: 760, title: "SDE.town.make.title", icon: "fa-solid fa-landmark", classes: ["shadowdark-enhancer", "sde-ui", "sde-landing-pages"], resizable: true, width: 560, height: 760,
  template: "templates/town/landing-pages.hbs", initial: "full", toolbar, actions: { s: { state: "{state}" } },
  build: (s) => ({ ...build(s), toolbar }),
};
