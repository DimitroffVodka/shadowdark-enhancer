// CrawlTrackerTab (scripts/crawl-strip/crawl-tracker.mjs): the Crawl Order sidebar tab as a popout window, three parts
// (header, tracker, footer) like its PARTS. The real tab sits in the sidebar rail with no window frame; the frame here is
// the popout one. Context is hand-built to the shape _prepareContext produces; trackerFooter is the real helper.
//   state: order  (GM, order rolled, Creeg holds the turn, one member still unrolled)   norolled  (GM, nothing rolled)
//          player (a player looking at someone else's turn)
import { trackerFooter } from "../../../scripts/crawl-strip/crawl-tracker-core.mjs";
const art = (f) => "/systems/shadowdark/assets/quickstart/pregens/" + f;
const people = [["Creeg Greythorn", "Creeg_Greythorn-portrait.webp", 18], ["Elbin Grizzlegut", "Elbin_Grizzlegut_portrait.webp", 15], ["Iraga Draguul", "Iraga_Draguul_portrait.webp", 12], ["Jorbin Ironhelm", "Jorbin_Ironhelm_portrait.webp", 9], ["Martin Rast", "Martin_Rast_portrait.webp", null], ["Bram the Porter of the Seventh Lantern Company", null, 4]];
const build = (state) => {
  const gm = state !== "player", rolled = state !== "norolled";
  const rows = people.map(([name, f, init], i) => ({ actorId: "a" + i, name, img: f ? art(f) : "/systems/shadowdark/assets/tokens/cowled_token.webp",
    css: rolled && i === 0 ? "active" : "", hasInitiative: rolled && init !== null, initiative: rolled ? init : null, canRoll: gm && !(rolled && init !== null), canPan: !gm }));
  return { parts: [
    { id: "header", template: "templates/crawl-tracker-header.hbs", context: { title: rolled ? "Crawl round 3" : "Crawl not started", controls: { rollAll: gm && !rolled, reset: gm && rolled } } },
    { id: "tracker", template: "templates/crawl-tracker-list.hbs", context: { rows, isGM: gm, initiativeIcon: { icon: "/icons/svg/d20-grey.svg", hover: "/icons/svg/d20-highlight.svg" } } },
    { id: "footer", template: "templates/crawl-tracker-footer.hbs", context: { footer: trackerFooter({ isGM: gm, orderActive: rolled, ownsHolder: state === "player", round: 3 }) } },
  ] };
};
export default {
  previewHeight: 560, title: "SDE.crawlStrip.tracker.title", icon: "fa-solid fa-person-hiking", classes: ["combat-sidebar", "sde-tracker-tab", "sidebar-popout", "active"],
  width: 300, height: 520, id: "sde-crawl-tracker", initial: "order", build,
  toolbar: `<span>State:</span>${["order", "norolled", "player"].map((s) => `<button data-action="s" data-state="${s}">${s}</button>`).join("")}`, actions: { s: { state: "{state}" } },
};
