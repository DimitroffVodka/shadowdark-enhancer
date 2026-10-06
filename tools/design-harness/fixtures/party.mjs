// The Party sheet: templates/party/party.hbs with a context built the way PartyApp._prepareContext builds it,
// through the same pure helpers (scripts/party/party-sheet-core.mjs, party-emblem-core.mjs). The people, items,
// bastion and numbers are invented; everything the sheet decides is the real code.
//
// State is  view.tab.mode.icon.color  (every part optional after view and tab):
//   view  gm | player          who is looking (the buttons above the window are the harness's, not the sheet's)
//   tab   members | items | travel | quests | bastion | description
//   mode  -        marching, the party token placed and following
//   notoken -       the scene has no party token: the warning strip under the header
//         paused   following stopped on a blocked path (a GM gets Resume)
//         off      Marching order switched off
//         emblem   the GM's emblem picker open
//         empty    a party with no members
//         quiet    no status bar and no bastion (a world with no travel, light or bastion)
//   icon, color    the emblem (a game-icons name and six hex digits)
import { readFileSync } from "node:fs";
import { partyTabs, tabRow, resolveTab, sheetView, marchState, marchText, gemSummary, statusBar } from "../../../scripts/party/party-sheet-core.mjs";
import { DEFAULT_EMBLEM, emblemOf, emblemIconPath, emblemChoices } from "../../../scripts/party/party-emblem-core.mjs";

const en = JSON.parse(readFileSync(new URL("../../../languages/en.json", import.meta.url), "utf8"));
const say = (key) => en[key] ?? key;
const sayWith = (key, data) => say(key).replace(/\{(\w+)\}/g, (m, k) => data[k] ?? m);
const words = { say, sayWith };

const art = (f) => "/systems/shadowdark/assets/quickstart/pregens/" + f;
const svg = (c, t) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${c}"/><text x="48" y="60" font-size="40" text-anchor="middle" fill="#fff">${t}</text></svg>`);
const mod = (n) => (n >= 0 ? `+${n}` : String(n));
const portraits = { "Creeg Greythorn": art("Creeg_Greythorn-portrait.webp"), "Elbin Grizzlegut": art("Elbin_Grizzlegut_portrait.webp"), "Iraga Draguul": art("Iraga_Draguul_portrait.webp"), "Jorbin Ironhelm": art("Jorbin_Ironhelm_portrait.webp"), "Martin Rast": art("Martin_Rast_portrait.webp") };
const member = (name, className, hp, max, ac, level, group = "characters", effects = []) => ({
  uuid: "Actor." + name, memberKey: "Actor." + name, name, img: portraits[name] ?? "/systems/shadowdark/assets/tokens/cowled_token.webp", className, group, canEdit: true, missing: false,
  isNPC: group !== "characters", showAbilities: group !== "mounts", hp: { value: hp, max }, hpPercent: Math.round(hp / max * 100), ac, level,
  xp: { current: level * 4, next: level * 10 }, slots: { used: 7, max: 10 }, effects,
  abilityLabels: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((k, i) => [k, mod(((i * 3 + level) % 7) - 2)])),
});
const roster = [
  member("Creeg Greythorn", "Fighter", 14, 18, 15, 3), member("Elbin Grizzlegut", "Priest", 9, 12, 13, 3),
  member("Iraga Draguul", "Thief", 6, 8, 12, 2), member("Jorbin Ironhelm", "Fighter", 11, 11, 14, 2), member("Martin Rast", "Wizard", 4, 4, 10, 2),
  member("Bram", "Porter", 5, 5, 10, 1, "hirelings"), member("Dusty", "Mule", 11, 11, 9, 1, "mounts"),
];

const gemItems = [["Jade", 2, { gp: 50 }], ["Black opal", 1, { gp: 100 }], ["Garnet", 3, { gp: 25 }], ["Citrine", 1, { sp: 100 }]]
  .map(([name, quantity, cost], i) => ({ id: "g" + i, name, type: "Gem", img: svg("#3a7", name[0]), system: { quantity, cost } }));
const bastion = {
  name: "The Lantern Hold", type: "Keep", img: "/modules/shadowdark-enhancer/assets/bastion/art/keep.svg", ac: 18, hp: 82, maxHp: 100, breached: false, used: 6, slots: 10, treasury: 240, standing: true, building: "",
  rooms: [["Barracks", "fa-bed"], ["Blacksmith", "fa-hammer"], ["Infirmary", "fa-kit-medical"], ["Library", "fa-book"], ["Stable", "fa-horse"], ["Wizard tower", "fa-hat-wizard", true]].map(([name, icon, building]) => ({ name, icon, building: !!building, tip: building ? "Weeks left: 2" : "" })),
  lastMonth: "A quiet month (d6: 4).",
};

const build = (state) => {
  const [view = "gm", requested = "members", mode = "-", icon, color] = state.split(".");
  const isGM = view === "gm", empty = mode === "empty", quiet = mode === "quiet";
  const v = sheetView({ isGM, canEdit: isGM });
  const keys = partyTabs({ hasBastion: !quiet }), tab = resolveTab(requested, keys);
  const members = empty ? [] : roster, walkers = members.filter((m) => m.group !== "mounts");
  const characters = members.filter((m) => m.group === "characters");
  const emblem = emblemOf({ icon: icon ?? DEFAULT_EMBLEM.icon, color: color ?? DEFAULT_EMBLEM.color });
  const picker = emblemChoices(emblem, say);
  const follow = mode !== "off";
  const march = marchText(marchState({ follow, hasToken: mode !== "notoken", deployed: true, reason: mode === "paused" ? "blocked" : "", pausedMember: "Actor.Iraga Draguul", manager: v.canEdit, hasLeader: !empty }),
    { leaderName: "Creeg Greythorn", pausedName: "Iraga Draguul", missing: say("SDE.party.missing") }, words);
  const gems = gemSummary(gemItems);
  const slots = Array.from({ length: 9 }, (_, i) => { const m = walkers[i]; return { row: Math.floor(i / 3) - 1, col: (i % 3) - 1, uuid: m?.uuid ?? "", name: m?.name, img: m?.img, leader: m?.name === "Creeg Greythorn", disabled: !v.canEdit || !m }; });
  const status = quiet ? [] : statusBar({ travel: { terrain: "forest", weather: "Fair", hexesLeft: 3, budget: 4 }, light: { name: "Torch", mins: 38 }, rations: 12 }, words);
  return {
    title: "The Lantern Guild", icon: "fa-solid fa-users", classes: ["shadowdark", "sheet", "party", "sde-party", "sde-ui"], resizable: true, width: 750, height: 650, template: "templates/party/party.hbs",
    toolbar: `<span>Marching order:</span><button data-action="setMode" data-mode="-">on</button><button data-action="setMode" data-mode="paused">paused</button><button data-action="setMode" data-mode="off">off</button><span style="margin-left:14px">Party:</span><button data-action="setMode" data-mode="empty">no members</button><button data-action="setMode" data-mode="quiet">no bastion or status</button><span style="margin-left:14px">View as</span><button data-action="asView" data-view="gm">GM</button><button data-action="asView" data-view="player">Player</button>`,
    context: {
      picker: false, hasParty: true, isGM, canEdit: v.canEdit, actor: { name: "The Lantern Guild" }, memberCount: members.length,
      partyStats: { totalHp: members.reduce((n, m) => n + m.hp.value, 0), maxHp: members.reduce((n, m) => n + m.hp.max, 0), avgAc: members.length ? Math.round(members.reduce((n, m) => n + m.ac, 0) / members.length) : 0, avgLevel: characters.length ? Math.round(characters.reduce((n, m) => n + m.level, 0) / characters.length) : 0 },
      emblem: { ...emblem, path: "/" + emblemIconPath(emblem.icon), maskUrl: "/" + emblemIconPath(emblem.icon) }, emblemEdit: v.emblemEdit, emblemOpen: v.emblemEdit && mode === "emblem",
      emblemIcons: picker.icons.map((i) => ({ ...i, path: "/" + i.path })), emblemColors: picker.colors,
      slots, followLeader: follow, march: { ...march, warn: march.mode === "notice" }, hasLeader: !empty, leaderName: "Creeg Greythorn", canResume: !!march.canResume, movementDisabled: !v.canEdit, movementReason: say("SDE.party.movement.importExport"),
      status, tabs: tabRow(keys, tab, say),
      membersTab: tab === "members", itemsTab: tab === "items", travelTab: tab === "travel", questsTab: tab === "quests", bastionTab: tab === "bastion", descriptionTab: tab === "description",
      members, groups: [["characters", "Characters"], ["hirelings", "Hirelings"], ["mounts", "Mounts"], ["missing", "Missing member"]].map(([k, label]) => ({ label, rows: members.filter((m) => m.group === k).map((m) => ({ ...m, canEdit: v.canEdit })) })),
      coinList: [["gp", 42], ["sp", 17], ["cp", 3]].map(([key, value]) => ({ key, labelKey: "SHADOWDARK.coins." + key, value })), inventorySlots: { used: 14, max: 20 },
      items: ["Rope, 60'", "Torches (6)", "Rations (12)", "Crowbar", "Iron spikes", "Lantern"].map((name, i) => ({ id: "i" + i, name, img: svg("#555", name[0]), quantity: i + 1, slots: 1 })),
      gems: gems.rows, gemTotal: gems.total, bastion: quiet ? null : bastion,
      activityHTML: "", questHTML: "", description: "", descriptionHTML: "",
    },
  };
};

export default { previewHeight: 700, initial: "gm.members", build,
  actions: {
    partyTab: { state: "{0}.{tab}.-.{3}.{4}" }, asView: { state: "{view}.{1}.{2}.{3}.{4}" }, setMode: { state: "{0}.{1}.{mode}.{3}.{4}" },
    emblem: { state: "{0}.{1}.emblem.{3}.{4}" }, pickEmblem: { state: "{0}.{1}.emblem.{icon|3}.{color|4}" },
  } };
