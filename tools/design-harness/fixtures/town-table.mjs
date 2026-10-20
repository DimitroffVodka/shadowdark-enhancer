// The landing page: the table you sit at (a real template, built with the window's own table functions). state = gm |
// player | hover (the chest lit). The real window has no frame and fills the screen; the harness draws one, so the
// fixture hides it and sets the picture's scale (the window measures it at run time).
import { TABLE, homography, propSrc, seatsFor, tableProps, tomePages, dialAngle } from "../../../scripts/town/landing-table-core.mjs";
import { placeTiles, purseText } from "../../../scripts/town/town-view.mjs";
import { COINS, ACTOR, t } from "./_town.mjs";

const L = TABLE.layout;
const css = `
.sde-ui.sde-town.lt-root { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; max-height: none !important; transform: none !important; --lt-k: .5; }
.sde-ui.sde-town .window-header { display: none; }
.sde-ui.sde-town .lt-stage { position: fixed !important; inset: 0 !important; }
.sde-ui.sde-town .window-content { position: static !important; padding: 0; background: none; overflow: visible; }
`;
const quests = [
  { name: "The Drowned Bell", status: "active", objectives: [{ text: "Find the bell-ringer", done: true }, { text: "Dive the old chapel", done: false }] },
  { name: "Rats in the Cellar", status: "active", objectives: [{ text: "Clear the cellar", done: false }] },
];
const members = [["Denin", 1, "Kyzian Archer", "7 / 7"], ["Malchor", 2, "Wizard", "5 / 9"], ["Romas", 1, "Fighter", "11 / 11"], ["Ysolde", 3, "Thief", "8 / 12"]];
const toolbar = `<span>State:</span>${["gm", "player", "hover"].map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`;
const build = (state) => {
  const isGM = state !== "player";
  const page = { places: ["quests", "journals", "party", "map", "downtime", "carouse"], games: { on: true } };
  const tiles = placeTiles([...page.places, "games"], { isGM, hasParty: true, downtimeOpen: false, activeQuests: 2, t });
  const labels = Object.fromEntries(tiles.map((p) => [p.id, { name: p.label, sub: p.tag || p.sub, disabled: p.disabled, hint: p.hint }]));
  labels.market = { name: t("SDE.town.table.market"), sub: "Outfitter, The Table" };
  const [left, right] = tomePages(quests, 5);
  const props = tableProps(page, { hasMerchant: true, labels }).map((p) => ({ ...p, hot: state === "hover" && p.id === "market" }));
  return {
    toolbar,
    context: {
      isGM, townName: "The Table", table: TABLE,
      sizes: [["village", "Village"], ["town", "Town"], ["city", "City"], ["city_state", "City-State"]].map(([id, label]) => ({ id, label, selected: id === "town" })),
      returnName: isGM ? "Western Reaches hex map (A0)" : "", actorName: ACTOR, purse: purseText(COINS),
      props, chestOpen: { ...L.marketOpen, src: propSrc("market-open") },
      coin: { text: "113 gp", x: L.chestFront[0], y: L.chestFront[1] },
      tome: [
        { lines: left, transform: homography(300, 410, L.tomeLeft), box: [300, 410] },
        { lines: right, transform: homography(300, 410, L.tomeRight), box: [300, 410], flip: true },
      ],
      title: { text: "Session 14: Ash Above the Styx", transform: homography(700, 150, L.title), box: [700, 150] },
      dial: { angle: dialAngle(20.5), transform: homography(400, 400, L.dial), box: [400, 400], ticks: Array.from({ length: 24 }, (_, i) => ({ deg: i * 15, len: i % 6 ? 20 : 30 })) },
      seats: seatsFor(members.length).map((at, i) => ({ ...at, id: `a${i}`, name: members[i][0], img: "icons/svg/mystery-man.svg", mine: i === 0, level: members[i][1], cls: members[i][2], hp: members[i][3], purse: purseText(COINS) })),
      party: { x: (L.seats[0][0] + L.seats[3][0]) / 2, y: L.seats[0][1] + 92 },
    },
  };
};
export default {
  previewHeight: 760, title: "The Table", classes: ["shadowdark-enhancer", "sde-ui", "sde-town", "lt-root"], width: 1366, height: 768, css,
  template: "templates/town/town-table.hbs", initial: "gm", toolbar, actions: { s: { state: "{state}" } }, build,
};
