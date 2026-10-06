// The Bastion panel (ApplicationV2 window listing every bastion the user can see), as the GM sees it: four bastions,
// one breached, one still being raised. Cards come from the real bastionCard() with fake actors.
//   state: gm | player | empty
import { readFileSync } from "node:fs";
const en = JSON.parse(readFileSync(new URL("../../../languages/en.json", import.meta.url), "utf8"));
const fill = (s, d = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => d[k] ?? m);
globalThis.game = { i18n: { localize: (k) => en[k] ?? k, format: (k, d) => fill(en[k] ?? k, d) } };
const core = await import("../../../scripts/bastion/bastion-core.mjs");
const { bastionCard } = await import("../../../scripts/bastion/bastion-panel-core.mjs");
const { t, format } = await import("../../../scripts/bastion/bastion-text.mjs");
const sprites = readFileSync(new URL("../../../assets/bastion/sprites.svg", import.meta.url), "utf8");

const mk = (name, type, o) => ({ id: name, name, img: `/modules/shadowdark-enhancer/assets/bastion/art/${type}.svg`, system: { ...core.newBastion(type), ...o } });
const up = (id, weeksLeft = 0, slot = 0) => ({ id, slot, weeksLeft });
const actors = [
  mk("Ashdown Keep", "keep", { weeksLeft: 0, week: 14, hp: { value: 82 }, treasury: 240, upgrades: ["barracks", "blacksmith", "library", "stable", "trophy-room", "vault", "aviary", "armorer"].map((id, i) => up(id, 0, i)).concat([up("wizard-tower", 2, 8)]) }),
  mk("The Lantern Hold Beyond the Mistwood Gate", "castle", { weeksLeft: 0, week: 40, hp: { value: 0 }, treasury: 12500, upgrades: ["granary", "infirmary", "moat", "tavern"].map((id, i) => up(id, 0, i)) }),
  mk("Greywater Outpost", "outpost", { weeksLeft: 1, week: 0, hp: { value: 50 }, treasury: 0, upgrades: [] }),
  mk("Mossy Cottage", "house", { weeksLeft: 0, week: 3, hp: { value: 40 }, treasury: 9, upgrades: [up("granary")] }),
];
const build = (state) => {
  const [mode = "gm"] = (state ?? "gm").split("."), gm = mode !== "player", empty = mode === "empty";
  return { context: { gm, cards: empty ? [] : actors.map((a) => bastionCard(a, { t, format })), empty: t("SDE.bastion.panel.empty") }, toolbar: `<span>State:</span>${["gm", "player", "empty"].map((x) => `<button data-action="setMode" data-mode="${x}">${x}</button>`).join("")}${sprites}` };
};
export default {
  previewHeight: 640, title: "SDE.bastion.panel.title", icon: "fa-solid fa-chess-rook", classes: ["shadowdark-enhancer", "sde-ui", "sde-parchment", "sde-bastion-panel"],
  width: 680, height: 560, resizable: true, template: "templates/bastion-panel.hbs", initial: "gm", build, actions: { setMode: { state: "{mode}" } },
};
