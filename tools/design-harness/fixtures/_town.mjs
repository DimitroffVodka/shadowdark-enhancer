// Shared sample data for the Town window and shopfront fixtures. Nothing here ships.
// `t` reads languages/en.json, and the fixtures build their context with the windows' own view functions, so what the
// harness draws is what the windows draw.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const EN = JSON.parse(fs.readFileSync(path.join(ROOT, "languages/en.json"), "utf8"));
export const t = (key, data) => String(EN[key] ?? `[${key}]`).replace(/\{(\w+)\}/g, (m, k) => data?.[k] ?? m);

export const art = (n) => `modules/shadowdark-enhancer/assets/bastion/art/${n}.svg`;
export const ico = (p) => `icons/${p}.webp`;

export const MERCHANTS = [
  { id: "m1", name: "Hargrave the Smith", role: "Weapons and tools", pitch: "Honest steel at fair prices, and no questions about the blood.", img: art("blacksmith"), wares: 10, open: true },
  { id: "m2", name: "Ysolde Vane", role: "Armorer", pitch: "Mail that has turned worse than you.", img: art("armorer"), wares: 9, open: true },
  { id: "m3", name: "The Gilded Flagon", role: "Inn and provisions", pitch: "Ale, rations and rumours, in that order.", img: art("tavern"), wares: 11, open: true },
  { id: "m4", name: "Mother Quill", role: "Scribe and bookseller", pitch: "Scrolls, ink and secrets. Back after the next session.", img: art("library"), wares: 7, open: false },
];

export const COINS = { gp: 134, sp: 12, cp: 5 };
export const ACTOR = "Creeg Greythorn";
