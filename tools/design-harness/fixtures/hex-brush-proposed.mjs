// PROPOSAL. Terrain is a grid of tiles, each with an icon in the same colour the map overlay paints it
// (TERRAIN_COLORS in tag-overlay.mjs), so what you pick is what you will see. The window says what it does,
// controls are big enough to hit. Click the tiles.
import before from "./hex-brush.mjs";
const terrain = {   // key: [label, overlay colour, icon]
  forest: ["Forest", "#2f7d4f", "fa-tree"], grassland: ["Grassland", "#9ec46a", "fa-wheat-awn"], mountain: ["Mountain", "#8b7d6b", "fa-mountain"],
  swamp: ["Swamp", "#5b6b39", "fa-frog"], desert: ["Desert", "#e7cd84", "fa-sun"], lake: ["Lake", "#4aa3d9", "fa-water"],
};
export default {
  ...before, previewHeight: 470, title: "SDE.hexMap.brush.title", template: "tools/design-harness/proposals/hex-brush.hbs",
  strings: { "SDE.hexMap.brush.howTo": "Pick a terrain, then click or drag over hexes on the map to paint them." },
  context: {
    terrainOptions: Object.entries(terrain).map(([value, [label, color, icon]], i) => ({ value, label, color, icon, selected: i === 0 })),
    features: [["river", "River", "fa-water"], ["path", "Path", "fa-road"], ["coast", "Coast", "fa-umbrella-beach"]].map(([value, label, icon]) => ({ value, label, icon, checked: false })),
  },
  css: `
.sde-hxb2{display:flex;flex-direction:column;gap:14px;padding:12px 14px 14px}
.sde-hxb2-how{margin:0;color:#a8a8a8;font-size:13px;line-height:1.4}
.sde-hxb2 h4{margin:0 0 7px;font:700 11px/1 Signika,sans-serif;letter-spacing:.6px;text-transform:uppercase;color:#888}
.sde-hxb2 input{position:absolute;opacity:0;pointer-events:none}
.sde-hxb2-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.sde-hxb2-tile{position:relative;display:flex;flex-direction:column;align-items:center;gap:6px;padding:9px 4px 8px;border:1px solid #2e2e2e;border-radius:8px;background:#141414;cursor:pointer;transition:border-color .12s,background .12s}
.sde-hxb2-tile:hover{border-color:#5a5a5a;background:#1a1a1a}
.sde-hxb2-ico{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--c);box-shadow:inset 0 -3px 6px #0004,0 1px 3px #0008}
.sde-hxb2-ico i{font-size:16px;color:#fff;text-shadow:0 1px 2px #0009}
.sde-hxb2-lab{font-size:12px;color:#d6d6d6;line-height:1}
.sde-hxb2-tile:has(input:checked){border-color:#e6c25a;background:rgba(230,194,90,.12)}
.sde-hxb2-tile:has(input:checked) .sde-hxb2-lab{color:#f2d77a;font-weight:700}
.sde-hxb2-tile:has(input:checked)::after{content:"\\2713";position:absolute;top:4px;right:6px;font-size:11px;color:#e6c25a}
.sde-hxb2-tile:has(input:focus-visible),.sde-hxb2-feat:has(input:focus-visible){outline:2px solid #e6c25a}
.sde-hxb2-feats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.sde-hxb2-feat{position:relative;display:flex;align-items:center;justify-content:center;gap:6px;height:32px;border:1px solid #2e2e2e;border-radius:8px;background:#141414;color:#d6d6d6;font-size:12px;cursor:pointer}
.sde-hxb2-feat i{font-size:12px;color:#8fb4d9}
.sde-hxb2-feat:hover{border-color:#5a5a5a}
.sde-hxb2-feat:has(input:checked){border-color:#e6c25a;background:rgba(230,194,90,.12);color:#f2d77a}
.sde-hxb2-foot{display:flex;justify-content:flex-end;padding-top:12px;border-top:1px solid #262626}
.sde-hxb2-foot button{height:30px;padding:0 12px}
` };
