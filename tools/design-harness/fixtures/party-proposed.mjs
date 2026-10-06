// Proposed Party sheet: the CURRENT sheet's layout (templates/party/party.hbs), in the kit's colours and fonts.
// Context is the current fixture's plus the fields the real JS would have to supply (see the report):
//   emblem.iconColor + emblemIconColors[], members[].luck / lightOn / spells[{name,img,lost}], leaderName (exists),
//   status[] with a Torches entry.
// State is  view.tab.mode.icon.color.iconColor  (the current fixture's, plus the icon colour as a sixth part).
import current from "./party.mjs";
import { proposed } from "./_proposed.mjs";
const p = proposed(current, { "templates/party/party.hbs": "tools/design-harness/proposed/templates/party.hbs" }, {
  extraCss: "tools/design-harness/proposed/css/party.css",
  strings: {   // new strings until they are in languages/en.json
    "SDE.party.status.torches": "Torches", "SDE.party.emblem.boxColor": "Box colour", "SDE.party.emblem.iconColor": "Icon colour", "SDE.party.emblem.done": "Done",
    "SDE.party.emblem.color.white": "White", "SDE.party.emblem.color.black": "Black",
    "SDE.party.roll.who": "Who", "SDE.party.roll.whoAll": "All PCs", "SDE.party.emblem.custom": "Custom colour", "SDE.party.downtime.open": "Open Downtime window", "SDE.party.downtime.none": "No downtime session is running.", "SDE.party.warbands": "Warbands", "SDE.party.warbands.empty": "No warbands are under a party member's command yet.", "SDE.party.warbands.paid": "Paid", "SDE.party.warbands.owes": "Owes {gp} gp", "SDE.party.warbands.upkeep": "{gp} gp a month", "SDE.party.warbands.payArrears": "Pay arrears", "SDE.party.warbands.returnToService": "Return to service", "SDE.party.warbands.runMonth": "Run month", "SDE.party.roll.stat": "Ability", "SDE.party.roll.dc": "DC", "SDE.party.roll.request": "Request roll",
    "SDE.party.award.xp": "XP", "SDE.party.award.gold": "Gold", "SDE.party.award.give": "Give", "SDE.party.award.loot": "Loot...",
    "SDE.party.items.add": "Add item", "SDE.party.items.name": "Item", "SDE.party.items.qty": "Qty", "SDE.party.items.giveTo": "Give to...", "SDE.party.coins.give": "Give coins", "SDE.party.coins.giveGo": "Give", "SDE.party.coins.giveTo": "Give to", "SDE.party.coins.allPcs": "All PCs", "SDE.party.coins.slotsTip": "Slots used by coins (1 slot per 100 gp)", "SDE.party.items.fromCompendium": "From compendium", "SDE.party.items.forge": "Forge a magic item", "SDE.party.coins.add": "Add coins", "SDE.party.coins.addGo": "Add", "SDE.proposed.party.divideTip": "Divide every coin type (GP, SP, CP) evenly among the PCs. Any remainder stays in the party.", "SDE.party.coins.divide": "Divide coins", "SDE.party.gm.title": "Request roll / Award", "SDE.party.spells.tierShort": "T{tier}",
  },
});
const icon = (p) => `/icons/magic/${p}.webp`;   // real Foundry core icons (Spell items use icons/magic/... paths, system config.mjs)
// [name, tier, icon, lost]: tier is system.tier on a Spell item, lost is system.lost
const spellsOf = {
  "Elbin Grizzlegut": [["Cure Wounds", 1, "life/cross-beam-green", 0], ["Protection from Evil", 1, "holy/barrier-shield-winged-blue", 0], ["Bless", 2, "holy/prayer-hands-glowing-yellow", 0], ["Smite", 2, "holy/angel-winged-humanoid-blue", 1]],
  "Martin Rast": [["Magic Missile", 1, "lightning/bolt-beam-strike-blue", 0], ["Light", 1, "light/light-lantern-lit-white", 0], ["Sleep", 1, "control/debuff-energy-hold-blue-yellow", 1], ["Mirror Image", 2, "defensive/barrier-shield-dome-blue-purple", 0], ["Burning Hands", 2, "fire/beam-jet-stream-embers", 0], ["Fireball", 3, "fire/explosion-fireball-large-orange", 1]],
};
const tiersOf = (list) => [...new Set(list.map((x) => x[1]))].sort().map((tier) => ({ tier, spells: list.filter((x) => x[1] === tier).map(([name, , p, lost]) => ({ name, img: icon(p), lost: !!lost })) }));
const luck = { "Creeg Greythorn": 1, "Elbin Grizzlegut": 0, "Iraga Draguul": 2, "Jorbin Ironhelm": 1, "Martin Rast": 0, "Bram": 0 };
const lit = { "Creeg Greythorn": true, "Jorbin Ironhelm": true };
const iconColors = ["ffffff", "000000", "c8892b", "b33a3a", "3f7a3f", "3a6ea5", "7a4fa5", "8b7d6b"];
const iconColorNames = { ffffff: "White", "000000": "Black", c8892b: "Amber", b33a3a: "Crimson", "3f7a3f": "Green", "3a6ea5": "Blue", "7a4fa5": "Violet", "8b7d6b": "Stone" };
const PCS = ["Creeg Greythorn", "Elbin Grizzlegut", "Iraga Draguul", "Jorbin Ironhelm", "Martin Rast"];
const LONG = ["Sir Bartholomew Wigglesworth-Thornbury of the Seventh Lantern", "Elbin Grizzlegut"];
const TAB_ORDER = ["members", "items", "travel", "quests", "downtime", "warbands", "bastion", "description"];
const NEW_TABS = { downtime: { label: "Downtime", icon: "fas fa-mug-hot" }, warbands: { label: "Warbands", icon: "fas fa-flag" } };
const token = "/systems/shadowdark/assets/tokens/cowled_token.webp";
const wb = (uuid, name, level, hp, max, upkeepGp, arrears, out) => ({ uuid, name, img: token, level, hp: { value: hp, max }, hpPercent: Math.round(hp / max * 100), upkeepGp, arrears, out });
const warbandGroups = (empty) => empty ? [] : [
  { commander: "Creeg Greythorn", rows: [wb("Actor.w1", "Hill Raiders", 2, 14, 20, 20, 0, false), wb("Actor.w2", "Hired Pikemen", 3, 9, 30, 30, 15, false)] },
  { commander: "Iraga Draguul", rows: [wb("Actor.w3", "The Salted Anchors", 2, 18, 18, 20, 0, false), wb("Actor.w4", "Deserters of the Ash Road", 1, 0, 12, 10, 0, true)] },
];
const downtime = (player) => ({ inSession: true, session: { sourceLabel: "Western Reaches", days: 7, locked: false, pickCount: 3, resultCount: 1 },
  rows: PCS.map((name, i) => ({ name, actorId: "a" + i, picked: i < 3, pickLabel: ["Serious option (Training)", "Cheap option (Crafting)", "Grand option (Skulduggery)"][i] ?? "", advantage: i === 1 ? "Advantage" : "Normal", rolled: i === 0, total: 17, dc: 13, success: true })).slice(0, player ? 1 : 5) });
const upgrade = (w, state) => {
  const c = w.context; if (!c) return w;
  const [view, tabKey = "members", mode = "-"] = state.split(".");
  const iconColor = (state.split(".")[5] || "ffffff").toLowerCase();
  const tabKeys = TAB_ORDER.filter((k) => k in NEW_TABS || c.tabs?.some((t) => t.key === k));
  const tabs = tabKeys.map((k) => { const old = c.tabs.find((t) => t.key === k); return { key: k, label: old?.label ?? NEW_TABS[k].label, icon: old?.icon ?? NEW_TABS[k].icon, active: k === tabKey }; });
  const dress = (m, i) => ({ ...m, name: mode === "longname" && LONG[i] ? LONG[i] : m.name, luck: m.isNPC ? undefined : (luck[m.name] ?? 0), lightOn: !!lit[m.name], spellTiers: tiersOf(spellsOf[m.name] ?? []), selected: mode !== "whosome" || i < 2 });
  const members = (c.members ?? []).map(dress);
  const byUuid = Object.fromEntries(members.map((m) => [m.uuid, m]));
  const status = c.status?.length ? [...c.status.slice(0, 2), { key: "torches", label: "Torches", icon: "fa-fire-flame-simple", value: "6" }, ...c.status.slice(2)] : c.status;
  const emblemIconColors = iconColors.map((color) => ({ color, label: iconColorNames[color], selected: color === iconColor }));
  const flags = Object.fromEntries(TAB_ORDER.map((k) => [k === "items" ? "itemsTab" : k + "Tab", k === tabKey]));
  return { ...w, context: { ...c, ...flags, tabs, downtime: downtime(view === "player"), warbandGroups: warbandGroups(mode === "empty" && tabKey === "warbands"),
    whoOpen: mode === "who" || mode === "whosome", whoAll: mode !== "whosome", whoLabel: mode === "whosome" ? "Creeg, Elbin" : "All PCs",
    addItemOpen: mode === "additem", addCoinsOpen: mode === "addcoins", giveCoinsOpen: mode === "givecoins", giveOpenId: mode === "giveitem" ? "i1" : "", coinSlots: 1,
    ...(mode === "over" ? { inventorySlots: { used: 22, max: 20 } } : {}), members, groups: (c.groups ?? []).map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, ...byUuid[r.uuid], canEdit: r.canEdit })) })), status,
    emblem: { ...c.emblem, iconColor }, emblemIconColors, emblemCustomBox: !c.emblemColors?.some((x) => x.selected), emblemCustomIcon: !emblemIconColors.some((x) => x.selected) } };
};
const build = p.build;
// harness-only: keep the custom colour input and its hex field in sync and show the colour at once (the real sheet does this in pickEmblem)
const sync = `<script>document.addEventListener("input",(e)=>{const t=e.target,w=t.closest&&t.closest(".pt-custom");if(!w)return;const hex=w.querySelector(".pt-hex"),col=w.querySelector("input[type=color]");if(t===col)hex.value=col.value;else if(/^#[0-9a-fA-F]{6}$/.test(t.value))col.value=t.value;else return;const box=col.dataset.colorInput==="box";const em=document.querySelector(".sdp-emblem");if(em)em.style.setProperty(box?"--c":"--ic",col.value);});</script>`;
const go = (label, st) => `<button data-action="go" data-state="${st}">${label}</button>`;
const extra = go("who open", "gm.members.who") + go("who: some", "gm.members.whosome") + go("downtime", "gm.downtime") + go("downtime (player)", "player.downtime") + go("warbands", "gm.warbands") + go("warbands empty", "gm.warbands.empty") + go("warbands (player)", "player.warbands") + go("long names", "gm.members.longname") + go("emblem custom", "gm.members.emblem.skull-crossed-bones.12a4b8.e0a040");
const itemStates = ["additem", "addcoins", "givecoins", "giveitem", "over"].map((m) => `<button data-action="itemsState" data-mode="${m}">items: ${m}</button>`).join("");
export default { ...p, initial: "gm.members",
  build: (s) => { const w = upgrade({ ...build(s), classes: p.classes, css: p.css, strings: p.strings }, s); return { ...w, toolbar: (w.toolbar ?? "") + extra + itemStates + sync }; },
  actions: { ...current.actions,
    go: { state: "{state}" },
    itemsState: { state: "gm.items.{mode}.{3}.{4}.{5}" },
    emblem: { state: "{0}.{1}.{mode|2}.{3}.{4}.{5}" },
    pickEmblem: { state: "{0}.{1}.emblem.{icon|3}.{color|4}.{iconColor|5}" },
    partyTab: { state: "{0}.{tab}.-.{3}.{4}.{5}" }, asView: { state: "{view}.{1}.{2}.{3}.{4}.{5}" }, setMode: { state: "{0}.{1}.{mode}.{3}.{4}.{5}" } } };
