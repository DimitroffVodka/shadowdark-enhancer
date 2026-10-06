// Audit helper: render a module template to a string with the real Handlebars, and put it into the Party sheet
// the way PartyApp does (activityHTML / questHTML, with data-action rewritten).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import party from "./party.mjs";
const FOUNDRY = process.env.FOUNDRY_APP ?? path.join(os.homedir(), "FoundryV14", "app");
const Handlebars = createRequire(path.join(FOUNDRY, "x.js"))("handlebars");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const en = JSON.parse(fs.readFileSync(path.join(ROOT, "languages/en.json"), "utf8"));
const sys = JSON.parse(fs.readFileSync(path.join(FOUNDRY, "../Data/systems/shadowdark/i18n/en.json"), "utf8"));
const flat = (o, p = "", out = {}) => { for (const [k, v] of Object.entries(o)) (v && typeof v === "object") ? flat(v, `${p}${k}.`, out) : out[`${p}${k}`] = v; return out; };
const S = { ...flat(sys), ...en };
export const missing = new Set();
export function renderTemplate(file, ctx) {
  const hb = Handlebars.create();
  hb.registerHelper("localize", (key, o) => { const s = S[key]; if (s === undefined) { missing.add(key); return key; } return String(s).replace(/\{(\w+)\}/g, (m, k) => o?.hash?.[k] ?? m); });
  hb.registerHelper({ eq: (a, b) => a === b, not: (a) => !a, and: (...a) => a.slice(0, -1).every(Boolean), or: (...a) => a.slice(0, -1).some(Boolean) });
  return hb.compile(fs.readFileSync(path.join(ROOT, file), "utf8"))(ctx);
}
export const inParty = (state, patch) => {
  const w = party.build(state);
  Object.assign(w.context, patch);
  return { ...w, toolbar: "" };
};
export const asActivity = (html) => html.replace(/data-action="([^"]+)"/g, 'data-action="activityAction" data-activity-action="$1"');
export const asQuest = (html) => html.replace(/data-action="([^"]+)"/g, 'data-action="questAction" data-quest-action="$1"');
export { party };
