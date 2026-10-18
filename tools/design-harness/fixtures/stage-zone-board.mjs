// The zone fight board (a body-level layer, not a window): templates/stage/zone-board.hbs with the context
// scripts/stage/zone-board-core.mjs boardContext builds from plain stand-ins for a Combat, so the chips, the HP rule per viewer
// and the controls per viewer are the real code. The layer sits in a box the size of the viewport with mock stand-ins for the
// scene navigation (top), sidebar (right) and hotbar (bottom) that the board must stay clear of. Use --w=1200 --h=800 for 1280x800.
//
// State: gm | player | empty | long
//   gm      6 combatants over the three bands: a turn highlight, a defeated, a hidden foe, status icons, a damage popover open
//   player  a player's view: foe HP is a bar only, controls only on the player's own PC, the hidden foe is gone
//   empty   a fight with only the party
//   long    very long names, 12 combatants
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { boardContext } from "../../../scripts/stage/zone-board-core.mjs";

const en = JSON.parse(readFileSync(new URL("../../../languages/en.json", import.meta.url), "utf8"));
const Handlebars = createRequire(path.join(process.env.FOUNDRY_APP ?? path.join(os.homedir(), "FoundryV14", "app"), "x.js"))("handlebars");
const hb = Handlebars.create();
hb.registerHelper("localize", (key, o) => String(en[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => o?.hash?.[k] ?? m));
const template = hb.compile(fs.readFileSync(new URL("../../../templates/stage/zone-board.hbs", import.meta.url), "utf8"));

const M = "shadowdark-enhancer";
const art = (f) => "/systems/shadowdark/assets/quickstart/pregens/" + f;
const tok = "/systems/shadowdark/assets/tokens/cowled_token.webp";
const eff = (name, icon) => ({ name, img: `/icons/svg/${icon}.svg` });
const unit = (id, name, zone, hp, max, o = {}) => ({
  id, name, flags: { [M]: { zone } }, defeated: o.defeated ?? false, hidden: o.hidden ?? false, visible: true,
  actor: { id: "a" + id, name, img: o.img ?? tok, isOwner: !!o.own, flags: o.foe ? { [M]: { zoneClone: "f1" } } : {}, prototypeToken: { disposition: o.foe ? -1 : 1 },
    system: { attributes: { hp: { value: hp, max } } }, effects: o.fx ?? [] },
});
const PCS = [
  unit("p1", "Creeg Greythorn", "close", 12, 14, { img: art("Creeg_Greythorn-portrait.webp"), own: true }),
  unit("p2", "Elbin Grizzlegut", "near", 3, 11, { img: art("Elbin_Grizzlegut_portrait.webp"), fx: [eff("Poisoned", "poison"), eff("Blessed", "blind")] }),
];
const FOES = [
  unit("f1", "Goblin 1", "near", 2, 4, { foe: true }),
  unit("f2", "Goblin 2", "far", 4, 4, { foe: true, hidden: true }),
  unit("f3", "Ogre 1", "far", 0, 30, { foe: true, defeated: true }),
  unit("f4", "Wolf 1", "close", 5, 9, { foe: true, fx: [eff("Frightened", "terror")] }),
];

const set = (combatants, turnId, viewer) => {
  const visible = viewer === "gm" ? combatants : combatants.filter((c) => !c.hidden);
  return { combatants: visible, turns: visible, combatant: visible.find((c) => c.id === turnId) ?? null, flags: { [M]: { zoneFight: { id: "f1", clones: FOES.map((f) => f.actor.id) } } } };
};
const long = ["Brother Aldous Marchbanks-Thornwood the Younger", "Sir Reginald of the Seven Fallen Mountains Keep", "Elbin Grizzlegut", "Iraga Draguul", "The Unspeakably Enormous Cave Troll Chieftain Grukk"];
const many = Array.from({ length: 12 }, (_, i) => unit("m" + i, long[i % long.length] + (i > 4 ? ` ${i}` : ""), ["close", "near", "far"][i % 3], 1 + (i % 6), 8,
  { foe: i % 2 === 1, own: i === 0, fx: i % 4 === 0 ? [eff("Poisoned", "poison"), eff("Frightened", "terror"), eff("Blessed", "blind")] : [] }));

const STATES = {
  gm: { viewer: "gm", fight: set([...PCS, ...FOES], "p2", "gm"), open: "f1" },
  player: { viewer: "player", fight: set([...PCS, ...FOES], "f1", "player") },
  empty: { viewer: "gm", fight: set(PCS.map((c) => ({ ...c, flags: { [M]: { zone: "close" } } })), "p1", "gm") },
  long: { viewer: "gm", fight: set(many, "m3", "gm") },
};

function draw(s, backed) {
  const ctx = boardContext({ combat: s.fight, user: { isGM: s.viewer === "gm" }, stage: backed ? null : { shown: true, place: "camp", image: "x" } });
  let html = template(ctx);
  if (s.open) html = html.replace(new RegExp(`(data-combatant-id="${s.open}"[\\s\\S]*?<details class="zb-pop")`), "$1 open");
  const nav = "position:absolute;z-index:5;border:1px dashed #888;background:#3338;color:#ddd;font:11px sans-serif;display:grid;place-items:center";
  // The picture state: a landscape stand-in for the camp picture.
  const picture = backed ? "" : "background:linear-gradient(#27406b,#5e7a46 60%,#2d3b22)";
  return `<div style="position:relative;width:100%;height:calc(100vh - 32px);overflow:hidden;${picture}">
<div id="sde-zone-board" class="sde-ui${backed ? " zb-backed" : ""}" role="region" aria-label="${en["SDE.stage.zone.boardLabel"]}" style="position:absolute;inset:0">${html}</div>
<div style="${nav};left:30%;right:30%;top:8px;height:40px">scene navigation</div>
<style>@media (max-width:760px){.zbm-side{display:none!important}}</style>
<div class="zbm-side" style="${nav};right:0;top:0;bottom:0;width:300px">sidebar</div>
<div style="${nav};left:50%;transform:translateX(-50%);width:min(578px,92%);bottom:16px;height:60px">hotbar</div></div>`;
}

export default {
  title: "Zone fight board", width: 1200, id: "ui-zone-board",
  html: draw(STATES.gm, true),
  initial: "gm",
  build: (state) => ({ html: draw(STATES[String(state).split(".")[0]] ?? STATES.gm, !String(state).endsWith(".pic")) }),
  actions: {},
};
