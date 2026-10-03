const art = (f) => "/systems/shadowdark/assets/quickstart/pregens/" + f;
const svg = (c, t) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${c}"/><text x="48" y="60" font-size="40" text-anchor="middle" fill="#fff">${t}</text></svg>`);
const mod = (n) => (n >= 0 ? `+${n}` : String(n));
const member = (name, cls, hp, max, ac, lvl, group = "characters", effects = []) => ({
  uuid: "Actor." + name, memberKey: "Actor." + name, name, img: portraits[name] ?? "/systems/shadowdark/assets/tokens/cowled_token.webp", className: cls, group, canEdit: true, isNPC: group !== "characters",
  hp: { value: hp, max }, hpPercent: Math.round(hp / max * 100), hpWavesEnabled: true, hpWaveTranslate: Math.max(0, Math.round(hp / max * 100) - 15), hpWaveColor: "#dc2626", hpWaveClass: hp >= max ? "hp-full" : "",
  ac, level: lvl, xp: { current: lvl * 4, next: lvl * 10 }, slots: { used: 7, max: 10 },
  abilityLabels: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((k, i) => [k, mod(((i * 3 + lvl) % 7) - 2)])), effects,
});
const portraits = { "Creeg Greythorn": art("Creeg_Greythorn-portrait.webp"), "Elbin Grizzlegut": art("Elbin_Grizzlegut_portrait.webp"), "Iraga Draguul": art("Iraga_Draguul_portrait.webp"), "Jorbin Ironhelm": art("Jorbin_Ironhelm_portrait.webp"), "Martin Rast": art("Martin_Rast_portrait.webp") };
export const roster = [
  member("Creeg Greythorn", "Fighter", 14, 18, 15, 3), member("Elbin Grizzlegut", "Priest", 9, 12, 13, 3, "characters", [{ name: "Blessed", img: svg("#a80", "B") }]),
  member("Iraga Draguul", "Thief", 6, 8, 12, 2), member("Jorbin Ironhelm", "Fighter", 11, 11, 14, 2), member("Martin Rast", "Wizard", 4, 4, 10, 2), member("Bram", "Porter", 5, 5, 10, 1, "hirelings"), member("Dusty", "Mule", 11, 11, 9, 1, "mounts"),
];
const members = roster;
const slots = [];
for (let row = -1; row <= 1; row++) for (let col = -1; col <= 1; col++) { const m = members[(row + 1) * 3 + col + 1]; slots.push({ row, col, uuid: m?.uuid ?? "", name: m?.name, img: m?.img, leader: m?.name === "Creeg Greythorn", disabled: !m }); }
export const party = (tab) => ({
  title: "Party", icon: "fa-solid fa-users", classes: ["shadowdark", "sheet", "party", "sde-party"], resizable: true, width: 750, height: 650, template: "templates/party/party.hbs",
  context: {
    picker: false, isGM: true, hasParty: true, actor: { name: "The Lantern Guild", img: svg("#6a4a2a", "L") }, canEdit: true, memberCount: 7,
    partyStats: { totalHp: 60, maxHp: 69, avgAc: 12, avgLevel: 2 }, slots, hasLeader: true, leaderName: "Creeg Greythorn", followLeader: true, followStatus: "Marching", canResume: false, movementDisabled: false, movementReason: "",
    tabs: [["members", "Members", "fa-solid fa-users"], ["items", "Items", "fa-solid fa-box"], ["travel", "Travel", "fa-solid fa-route"], ["quests", "Quests", "fa-solid fa-scroll"], ["description", "Description", "fa-solid fa-book"]].map(([key, label, icon]) => ({ key, label, icon, active: key === tab })),
    membersTab: tab === "members", itemsTab: tab === "items", travelTab: tab === "travel", questsTab: tab === "quests", descriptionTab: tab === "description",
    members, groups: [["characters", "Characters"], ["hirelings", "Hirelings"], ["mounts", "Mounts"], ["missing", "Missing"]].map(([k, label]) => ({ label, rows: members.filter((m) => m.group === k) })),
    coins: { gp: 42, sp: 17, cp: 3 }, coinLabels: { gp: "SHADOWDARK.coins.gp", sp: "SHADOWDARK.coins.sp", cp: "SHADOWDARK.coins.cp" }, inventorySlots: { used: 14, max: 20 },
    items: ["Rope, 60'", "Torches (6)", "Rations (12)", "Crowbar", "Iron spikes", "Lantern"].map((name, i) => ({ id: "i" + i, name, img: svg("#555", name[0]), quantity: i + 1, slots: 1 })),
    description: "", descriptionHTML: "",
  },
});
