// PROPOSAL. The Party sheet with the dead space taken out:
//  - one 76px header: name and four numbers on the left, the 3x3 formation on the right, with the placing and the
//    follow settings behind two icon buttons (no "Marching formation" heading, no five lines of text);
//  - member cards in two columns, so six or seven members fit without scrolling;
//  - Items gains Gems; a Bastion tab so players can see theirs;
//  - a GM view and a Player view (the buttons above the window are the harness's, not part of the sheet).
// Click the tabs, the Marching order switch, the emblem, and View as. No "include mounts": marching order is a dungeon thing.
import { party } from "./_party-data.mjs";
import { roster } from "./_party-data.mjs";

const base = party("members").context;
const art = (f) => "/systems/shadowdark/assets/quickstart/pregens/" + f;
const walkers = roster.filter((m) => m.group !== "mounts");
const formation = Array.from({ length: 9 }, (_, i) => { const m = walkers[i]; return { row: Math.floor(i / 3) - 1, col: (i % 3) - 1, uuid: m?.uuid ?? "", name: m?.name, img: m?.img, leader: m?.name === "Creeg Greythorn", disabled: !m }; });
const abil = (m) => ["str", "dex", "con", "int", "wis", "cha"].map((k) => ({ k: k.toUpperCase(), v: m.abilityLabels[k] }));
const members = roster.map((m) => ({ ...m, abil: abil(m) }));
const gems = [["Jade", "#5fbf8f", 2, 50], ["Black opal", "#8a7fd0", 1, 100], ["Garnet", "#c24a5a", 3, 25], ["Citrine", "#e2b43c", 1, 10]].map(([name, color, quantity, value]) => ({ name, color, quantity, value }));
const bastion = { name: "The Lantern Hold", type: "Keep", art: "/modules/shadowdark-enhancer/assets/bastion/art/house.svg", ac: 14, hp: "32 / 40", slots: 9, treasury: 240, lastMonth: "+18 gp; the infirmary healed 2.",
  rooms: [["Barracks", "fa-shield-halved"], ["Blacksmith", "fa-hammer"], ["Infirmary", "fa-kit-medical"], ["Library", "fa-book"], ["Stable", "fa-horse"], ["Watchtower", "fa-binoculars"]].map(([name, icon]) => ({ name, icon })) };

const ICONS = ["lantern", "campfire", "torch", "castle", "crown", "crossed-swords", "wolf-head", "bear-head", "stag-head", "raven", "owl", "dragon-head", "skull-crossed-bones", "tower-flag", "shield-echoes", "anvil-impact", "mountain-cave", "tree-roots", "treasure-map", "rune-stone", "hooded-figure", "unicorn", "minotaur", "gem-pendant"];
const COLORS = ["c8892b", "b33a3a", "3f7a3f", "3a6ea5", "7a4fa5", "8b7d6b", "2f9ea0", "d9478a"];
const tabsFor = (view, tab, S) => [["members", "Members", "fa-solid fa-users"], ["items", "Items", "fa-solid fa-box"], ["travel", "Travel", "fa-solid fa-route"], ["quests", "Quests", "fa-solid fa-scroll"], ["bastion", "Bastion", "fa-solid fa-chess-rook"], ["description", "Description", "fa-solid fa-book"]]
  .filter(([k]) => view === "gm" || k !== "travel").map(([key, label, icon]) => ({ key, label, icon, active: key === tab, state: S({ tab: key, mode: "-" }) }));

const build = (state) => {
  const [view, tab, mode = "-", icon = "lantern", color = "c8892b"] = state.split("."), gm = view === "gm";
  const S = (o = {}) => [o.view ?? view, o.tab ?? tab, o.mode ?? "-", o.icon ?? icon, o.color ?? color].join(".");
  return {
    title: "The Lantern Guild", icon: "fa-solid fa-users", classes: ["shadowdark", "sde-party2"], resizable: true, width: 750, height: 650, template: "tools/design-harness/proposals/party.hbs",
    context: {
      ...base, view, tab, isGM: gm, canEdit: gm, paused: mode === "paused", off: mode === "off", followStatus: mode === "paused" ? "Paused: path blocked" : "Marching", emblemOpen: gm && mode === "emblem", tabs: tabsFor(view, tab, S),
      emblemState: S({ mode: mode === "emblem" ? "-" : "emblem" }), emblem: { icon, color },
      emblemIcons: ICONS.map((name) => ({ name, selected: name === icon, state: S({ mode: "emblem", icon: name }) })),
      emblemColors: COLORS.map((c) => ({ c, selected: c === color, state: S({ mode: "emblem", color: c }) })),
      today: [{ icon: "fa-person-walking", label: "Today", value: "Forest · Fair · 3 of 4 hexes" }, { icon: "fa-fire", label: "Light", value: "Torch, 38 min" }, { icon: "fa-drumstick-bite", label: "Rations", value: "12 days" }],
      membersTab: tab === "members", itemsTab: tab === "items", bastionTab: tab === "bastion", otherTab: !["members", "items", "bastion"].includes(tab),
      slots: formation.map((s) => ({ ...s, canEdit: gm })),
      groups: [["characters", "Characters"], ["hirelings", "Hirelings"], ["mounts", "Mounts"]].map(([k, label]) => ({ label, rows: members.filter((m) => m.group === k) })),
      coinList: [["gp", "Gold", 42], ["sp", "Silver", 17], ["cp", "Copper", 3]].map(([key, label, value]) => ({ key, label, value })),
      gems, gemTotal: gems.reduce((n, g) => n + g.value * g.quantity, 0), bastion,
    },
    toolbar: `<span>Marching order:</span><button data-action="asView" data-state="gm.members.-.${icon}.${color}">on</button><button data-action="asView" data-state="gm.members.paused.${icon}.${color}">paused</button><button data-action="asView" data-state="gm.members.off.${icon}.${color}">off</button><span style="margin-left:14px">View as</span><button data-action="asView" data-state="gm.members.-.${icon}.${color}">GM</button><button data-action="asView" data-state="player.members.-.${icon}.${color}">Player</button>`,
    strings: {
      "SDE.party.proposed.emblem": "Party emblem", "SDE.party.proposed.formation": "Marching order", "SDE.party.proposed.free": "Moving freely", "SDE.party.proposed.drag": "drag to arrange", "SDE.party.proposed.lead": "click to lead", "SDE.party.proposed.leads": "leads", "SDE.party.proposed.gems": "Gems", "SDE.party.proposed.rooms": "Rooms", "SDE.party.proposed.treasury": "Treasury", "SDE.party.proposed.lastMonth": "Last month",
      "SDE.party.proposed.manage": "Open bastion", "SDE.party.proposed.view": "View bastion", "SDE.party.proposed.unchanged": "Not redesigned yet: this tab is the same as today.",
    },
    css,
  };
};

// state is view.tab.mode.icon.color; mode is - | emblem | paused (shows Resume) | off (switch off, grid dimmed)
const css = `
.sde-party2 .window-content{padding:0;background:#0a0a0a}
.sde-p2{--card:#121212;--line:#2a2a2a;--muted:#8d8d8d;--gold:#e6c25a;display:flex;flex-direction:column;height:100%;min-height:0;color:#e6e6e6;position:relative}
.sde-p2-head{position:relative;display:flex;align-items:center;gap:14px;padding:8px 14px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#181818,#0d0d0d)}
.sde-p2-emblem{width:54px;height:54px;flex:none;padding:0;display:grid;place-items:center;border-radius:12px;border:1px solid #0008;background:radial-gradient(circle at 30% 25%,color-mix(in srgb,var(--c) 70%,#fff 30%),var(--c) 55%,color-mix(in srgb,var(--c) 70%,#000));box-shadow:inset 0 -4px 8px #0005,0 2px 6px #000a}
button.sde-p2-emblem{cursor:pointer}button.sde-p2-emblem:hover{box-shadow:inset 0 -4px 8px #0005,0 0 0 2px #e6c25a}
.sde-p2-emblem img{width:34px;height:34px;filter:drop-shadow(0 1px 2px #0008)}
.sde-p2 button{min-height:0}
.sde-p2-pop.sde-p2-emblems{left:14px;right:auto;width:300px}.sde-p2-emblems h4{margin:0;font:700 11px/1 Signika,sans-serif;letter-spacing:.7px;text-transform:uppercase;color:var(--muted)}
.sde-p2-emblems .icons{display:grid;grid-template-columns:repeat(6,1fr);gap:5px}
.sde-p2-emblems .icons button{height:38px;padding:0;border:1px solid #2f2f2f;border-radius:6px;background:#181818;cursor:pointer;display:grid;place-items:center}
.sde-p2-emblems .icons img{width:24px;height:24px;opacity:.85}.sde-p2-emblems .icons button:hover{border-color:#666}
.sde-p2-emblems .icons button.on{border-color:var(--gold);background:rgba(230,194,90,.14)}.sde-p2-emblems .icons button.on img{opacity:1}
.sde-p2-emblems .colors{display:flex;gap:7px}.sde-p2-emblems .colors button{flex:none;width:26px;height:26px;padding:0;border-radius:50%;border:2px solid transparent;background:var(--c);cursor:pointer;box-shadow:inset 0 -2px 4px #0005}
.sde-p2-emblems .colors button.on{border-color:#fff}
.sde-p2-id{flex:none}
.sde-p2-id h2{margin:0 0 5px;font:400 24px/1.05 "Old Newspaper Font",serif;border:0;color:#eee}
.sde-p2-stats{display:flex;gap:14px;font-size:13px;color:#ddd}
.sde-p2-stats i{margin-right:5px;color:var(--muted);font-size:12px}.sde-p2-stats small{color:var(--muted)}
.sde-p2-march{display:flex;align-items:center;gap:12px;margin-left:auto}
.sde-p2-ctl{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.sde-p2-sw{position:relative;display:flex;flex-direction:row;align-items:center;gap:8px;margin:0;width:auto;font-size:12px;color:#d6d6d6;cursor:pointer;white-space:nowrap;font-weight:400}
.sde-p2-sw input{position:absolute;opacity:0;pointer-events:none}
.sde-p2-sw .track{position:relative;width:28px;height:16px;flex:none;border-radius:8px;background:#2a2a2a;border:1px solid #444;transition:background .12s}
.sde-p2-sw .track::after{content:"";position:absolute;top:2px;left:2px;width:10px;height:10px;border-radius:50%;background:#9a9a9a;transition:left .12s,background .12s}
.sde-p2-sw input:checked + .track{background:#3b5f2e;border-color:#6fae52}
.sde-p2-sw input:checked + .track::after{left:14px;background:#fff}
.sde-p2-sw input:disabled + .track{opacity:.55}
.sde-p2-sw input:focus-visible + .track{outline:2px solid var(--gold)}
.sde-p2-status{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px;min-height:18px}
.sde-p2-status .off{display:none}
.sde-p2-status .dot{display:inline-block;width:7px;height:7px;margin-right:6px;border-radius:50%;background:#6fae52}
.sde-p2-status.warn .dot{background:#e0a030}.sde-p2-status.warn{color:#e0b060}
.sde-p2-mini{height:24px;padding:0 10px;font-size:11px;border:1px solid #6a5420;border-radius:4px;background:#2a2208;color:#f0cf7a;cursor:pointer;margin-left:4px}
.sde-p2-march:has(.sde-p2-sw:first-child input:not(:checked)) .sde-p2-status .on{display:none}
.sde-p2-march:has(.sde-p2-sw:first-child input:not(:checked)) .sde-p2-status .off{display:inline}
.sde-p2-march:has(.sde-p2-sw:first-child input:not(:checked)) .sde-p2-grid{opacity:.45}
.sde-p2-gridwrap{display:flex;flex-direction:column;align-items:center;gap:3px}
.sde-p2-drag{font-size:9px;line-height:1.25;text-align:center;letter-spacing:.3px;color:var(--muted);text-transform:uppercase;white-space:nowrap}
.sde-p2-pin{width:28px;height:28px;padding:0;border:1px solid #3a3a3a;border-radius:6px;background:#1a1a1a;color:#cfcfcf;cursor:pointer;display:grid;place-items:center}
.sde-p2-pin:hover{border-color:var(--gold);color:var(--gold)}
.sde-p2-bar{display:flex;gap:28px;padding:7px 16px;border-bottom:1px solid var(--line);background:#0c0c0c}
.sde-p2-bar>div{display:flex;align-items:baseline;gap:8px;min-width:0}
.sde-p2-bar .l{font:700 10px/1 Signika,sans-serif;letter-spacing:.7px;text-transform:uppercase;color:var(--muted)}.sde-p2-bar .l i{margin-right:5px;font-size:10px}
.sde-p2-bar .v{font-size:13px;color:#e6e6e6;white-space:nowrap}
.sde-p2-grid{display:grid;grid-template-columns:repeat(3,26px);gap:3px}
.sde-p2-slot{width:26px;height:26px;cursor:grab;padding:0;border:1px solid #444;border-radius:5px;background:#1c1c1c;overflow:hidden;cursor:pointer;position:relative}
.sde-p2-slot img{width:100%;height:100%;object-fit:cover;display:block}
.sde-p2-slot:disabled{cursor:default;opacity:1}
.sde-p2-slot.leader{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold)}
.sde-p2-pop{position:absolute;right:16px;top:100%;z-index:6;width:240px;margin-top:4px;padding:10px 12px;display:flex;flex-direction:column;gap:7px;background:#101010;border:1px solid #3a3a3a;border-radius:8px;box-shadow:0 8px 20px #000a;font-size:13px}
.sde-p2-pop p{margin:0}.sde-p2-pop p span{color:var(--muted);margin-right:4px}
.sde-p2-pop label{display:flex;flex-direction:row;align-items:center;justify-content:flex-start;gap:9px;margin:0;width:auto;text-align:left;font-weight:400;white-space:nowrap}
.sde-p2-pop input[type=checkbox]{margin:0;flex:none;width:16px;height:16px;display:inline-block}
.sde-p2-tabs{display:flex;gap:2px;padding:0 10px;border-bottom:1px solid var(--line);background:#0e0e0e}
.sde-p2-tabs a{display:flex;align-items:center;gap:7px;padding:9px 12px 8px;font:400 15px/1 "Old Newspaper Font",serif;letter-spacing:.4px;text-transform:uppercase;color:#9a9a9a;border-bottom:2px solid transparent;cursor:pointer}
.sde-p2-tabs a i{font-size:12px}.sde-p2-tabs a:hover{color:#ddd}.sde-p2-tabs a.active{color:#fff;border-bottom-color:var(--gold)}
.sde-p2-body{flex:1;min-height:0;overflow:auto;padding:12px 16px 16px}
.sde-p2-group{margin:14px 0 8px;font:700 11px/1 Signika,sans-serif;letter-spacing:.7px;text-transform:uppercase;color:var(--muted);border:0}
.sde-p2-group:first-child{margin-top:2px}
.sde-p2-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.sde-p2-card{display:flex;gap:10px;padding:9px;border:1px solid var(--line);border-radius:8px;background:var(--card)}
.sde-p2-face{width:62px;height:62px;border-radius:6px;object-fit:cover;object-position:top;flex:none;border:1px solid #333}
.sde-p2-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.sde-p2-line{display:flex;align-items:baseline;gap:7px;min-width:0}
.sde-p2-line strong{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sde-p2-line em{font-size:12px;color:var(--muted);white-space:nowrap}
.sde-p2-fx{width:16px;height:16px;margin-left:auto;border-radius:3px}
.sde-p2-hp{position:relative;height:16px;border-radius:4px;background:#1d1d1d;overflow:hidden}
.sde-p2-hpbar{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#9d2a3a,#d0405a)}
.sde-p2-hp span{position:relative;display:block;text-align:center;font-size:11px;font-weight:700;line-height:16px;text-shadow:0 1px 2px #000}
.sde-p2-chips{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12px;color:#e0e0e0}
.sde-p2-chips b{font-size:10px;letter-spacing:.5px;color:var(--muted);margin-right:3px}
.sde-p2-abil{display:flex;gap:9px;font-size:10px;color:var(--muted);letter-spacing:.3px}.sde-p2-abil b{color:#cfcfcf;font-size:11px}
.sde-p2-two{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:12px;align-items:start}
.sde-p2-col{display:flex;flex-direction:column;gap:12px}
.sde-p2-box{border:1px solid var(--line);border-radius:8px;background:var(--card);padding:10px 12px}
.sde-p2-boxhead{display:flex;align-items:baseline;gap:8px;margin:0 0 8px;padding:0;border:0;font:700 11px/1 Signika,sans-serif;letter-spacing:.7px;text-transform:uppercase;color:var(--muted)}
.sde-p2-boxhead small{margin-left:auto;font-weight:400;letter-spacing:.3px}.sde-p2-boxhead a{color:#cfcfcf;cursor:pointer}
.sde-p2-list{list-style:none;margin:0;padding:0}
.sde-p2-list li{display:flex;align-items:center;gap:9px;padding:6px 0;border-top:1px solid #1f1f1f;font-size:13px}
.sde-p2-list li:first-child{border-top:0}
.sde-p2-list img{width:22px;height:22px;border-radius:4px}
.sde-p2-list .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sde-p2-list .q{display:flex;align-items:center;gap:7px;min-width:64px;justify-content:center;color:#ddd}.sde-p2-list .q a{color:var(--muted);cursor:pointer;font-size:10px}
.sde-p2-list .s{width:34px;text-align:right;color:var(--muted);font-size:12px}
.sde-p2-gems .q{min-width:30px;color:var(--muted)}.sde-p2-gems .s{width:56px}
.sde-p2-coins{display:flex;flex-direction:column;gap:7px}
.sde-p2-coins label{display:flex;align-items:center;gap:9px}
.sde-p2-coins .coin{width:14px;height:14px;border-radius:50%;border:1px solid #0006}
.sde-p2-coins .gp{background:#e2b43c}.sde-p2-coins .sp{background:#b9bcc4}.sde-p2-coins .cp{background:#b8733f}
.sde-p2-coins input{flex:1;height:28px;text-align:right}.sde-p2-coins em{width:22px;color:var(--muted);font-size:12px;font-style:normal}
.sde-p2-bastion{display:flex;gap:16px;padding:14px}
.sde-p2-bastion .art{width:150px;height:150px;flex:none;object-fit:contain;border-radius:8px;background:#0c0c0c;border:1px solid #2a2a2a;padding:8px}
.sde-p2-bastion h3{margin:0;font:400 24px/1.1 "Old Newspaper Font",serif;border:0}
.sde-p2-bastion .sub{margin:2px 0 10px;color:var(--muted);font-size:13px}
.sde-p2-bastion .info{display:flex;flex-direction:column;gap:10px;min-width:0}
.sde-p2-rooms{display:flex;flex-wrap:wrap;gap:6px}
.sde-p2-rooms span{display:flex;align-items:center;gap:6px;padding:4px 9px;border:1px solid #2f2f2f;border-radius:6px;background:#181818;font-size:12px}
.sde-p2-rooms i{font-size:11px;color:var(--gold)}
.sde-p2-bastion .log{margin:0;font-size:13px;color:#cfcfcf}.sde-p2-bastion .log span{color:var(--muted);margin-right:5px}
.sde-p2-btn{align-self:flex-start;height:30px;padding:0 14px}
.sde-p2-note{margin:24px 0;text-align:center;color:var(--muted)}
`;

export default { previewHeight: 700, initial: "gm.members", build,
  actions: { partyTab: { state: "{state}" }, march: { state: "{state}" }, asView: { state: "{state}" }, pick: { state: "{state}" } } };
