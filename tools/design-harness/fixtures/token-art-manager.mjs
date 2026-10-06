// TokenArtManagerApp, real template. Audit fixture. state: busy
// Thumbnails are the module's own dragon icon (real ones are token art from installed packs).
const T = "modules/shadowdark-enhancer/icons/dragon-head.svg";
const names = ["Giant Spider", "Goblin", "Lamprey Queen of the Drowned Cathedral", "Bone Hound", "Gnoll Packleader", "Cave Troll", "Skeleton", "Wolf", "Dire Wolf", "Mummy Lord of the Burning Sands"];
const srcs = ["s1", "s2", "s3", "s4"];
const rows = Array.from({ length: 24 }, (_, i) => { const n = names[i % names.length] + (i >= 10 ? ` ${i}` : ""); const k = i % 5 === 4 ? 0 : (i % 4) + 1; return {
  id: "m" + i, name: n, imported: i % 6 === 5, multi: k > 1, hasOptions: k > 0, isOverride: i % 7 === 0, pick: i % 7 === 0 ? { thumb: T, label: "My folder", file: "x.webp" } : null,
  options: srcs.slice(0, k).map((s, j) => ({ source: s, label: "Source " + s, thumb: T, ring: j === 1, chosen: j === 0 })) }; });
const build = () => ({ context: {
  sources: srcs.map((id, i) => ({ id, label: ["Foundry Community Tokens", "Forgotten Adventures Pack", "Shadowdark Core", "My Own Art Folder"][i], count: 300 - i * 70, kind: i === 3 ? "folder" : "module", used: 120 - i * 30, isFirst: i === 0, isLast: i === 3 })), sourceCount: 4, sourcesOpen: true, blurbOpen: true,
  rows, folders: [{ label: "My Own Art Folder", path: "assets/tokens/monsters/custom-art-folder-with-a-long-path" }, { label: "Patreon pack", path: "modules/patreon-tokens/monsters" }], stats: {}, enabled: true, filter: "", conflictsOnly: false, total: 340, shown: 24 } });
export default { id: "sde-token-art-manager", title: "SDE.tokenArt.manager.title", icon: "fa-solid fa-images", classes: ["sde-ui", "sde-imp", "sde-token-art-manager"], width: 720, height: 760, template: "templates/token-art-manager.hbs", initial: "busy", build, resizable: true, actions: {} };
