// Proposed Warband sheet as a standalone ApplicationV2 sheet (Mount-style: kit header band, three tabs, the system's NPC
// stat block, a Warband tab). Not a drop-in for the V1 sheet: it assumes a V2 class supplying `tab`, `moves`, `alignments`,
// `castingAbilities`, `enrichedNotes` and Mount-shaped `spells`/`effects` (see the report). Context otherwise = current fixture.
import fs from "node:fs";
import current from "./warband-npc.mjs";
import { proposed } from "./_proposed.mjs";
const common = fs.readFileSync(new URL("../proposed/css/sheet-family.css", import.meta.url), "utf8");
const TABS = ["abilities", "warband", "spells", "description", "effects"];
const opt = (list, cur) => list.map(([value, label]) => ({ value, label, selected: value === cur }));
const extra = {
  moves: opt([["near", "Near"], ["doubleNear", "Double near"], ["far", "Far"]], "near"), alignments: opt([["lawful", "Lawful"], ["neutral", "Neutral"], ["chaotic", "Chaotic"]], "lawful"),
  castingAbilities: opt([["wis", "Wisdom"], ["int", "Intelligence"]], "wis"), enrichedNotes: "<p>Raised in the Ashdown valley.</p>",
  spells: [{ id: "sp1", uuid: "Item.sp1", name: "Hold Person", img: "/icons/svg/heal.svg", lost: false, dc: 12, focus: false, duration: "Focus", range: "Near", description: "<p>One creature in range is paralyzed while you focus.</p>" }],
  effects: [{ label: "Effects", items: [{ id: "e1", uuid: "Item.e1", name: "Lantern light", img: "/icons/svg/light.svg", unlimited: false }] }, { label: "Conditions", items: [] }],
  activeEffects: [{ uuid: "AE.1", name: "Haste", img: "/icons/svg/wing.svg", source: "The Ashdown Spears", duration: "3 rounds", unlimited: false, disabled: false }, { uuid: "AE.2", name: "Blessing of the road", img: "/icons/svg/sun.svg", source: "Brenna", duration: "", unlimited: true, disabled: false }],
};
const cur = { ...current, cssProposed: common, build: (s) => { const { template, css, ...rest } = current.build(s); const tab = TABS.includes(s) ? s : "warband";
  return { ...rest, context: { ...rest.context, ...extra, tab: Object.fromEntries(TABS.map((t) => [t, t === tab])) } }; },
  strings: { "SDE.ui.mountMore": "More", "SDE.ui.spellsEmpty": "No spells yet. Use the plus to add one.", "SDE.ui.effectsEmpty": "No active effects. Use the plus to add one." } };
const out = proposed(cur, { [current.template]: "tools/design-harness/proposed/templates/warband-npc.hbs" }, { width: 640, strings: cur.strings });
export default { ...out, compareState: "warband" };
