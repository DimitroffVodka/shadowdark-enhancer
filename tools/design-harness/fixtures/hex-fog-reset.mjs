// The Reset fog window (scripts/hex-map/hex-fog-reset-dialog.mjs), a DialogV2 built in JS, so this mirrors the
// markup it emits: a party picked, a region list, the box ticked, the live count, and the undo button present.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const S = JSON.parse(fs.readFileSync(path.join(ROOT, "languages/en.json"), "utf8"));
const L = (k, d) => String(S[k] ?? `[${k}]`).replace(/\{(\w+)\}/g, (m, key) => d?.[key] ?? m);
const parties = ["The Red Company", "Hollow Lantern"], regions = ["The Marrowfen", "Ashgate Downs", "Saltmarch"];
const content = `<div class="form-group"><label>${L("SDE.hexMap.fogReset.whose")}</label><div class="form-fields">
    <select name="party"><option value="">${L("SDE.hexMap.fogReset.everyone")}</option>${parties.map((n, i) => `<option value="p${i}"${i === 0 ? " selected" : ""}>${n}</option>`).join("")}</select></div>
    <p class="hint">${L("SDE.hexMap.fogReset.everyoneHint")}</p></div>
  <div class="form-group"><label>${L("SDE.hexMap.fogReset.which")}</label><div class="form-fields">
    <select name="area"><option value="">${L("SDE.hexMap.fogReset.wholeMap")}</option>${regions.map((n, i) => `<option value="${i}">${n}</option>`).join("")}</select></div></div>
  <div class="form-group"><label class="checkbox"><input type="checkbox" name="rearm"> ${L("SDE.hexMap.fogReset.rearm")}</label>
    <p class="hint">${L("SDE.hexMap.fogReset.rearmHint")}</p></div>
  <p class="hint" data-count>${L("SDE.hexMap.fogReset.count", { count: 412, who: parties[0] })}</p>`;
const footer = `<button type="button" class="default" data-action="reset"><i class="fa-solid fa-cloud" inert></i>${L("SDE.hexMap.fogReset.confirm")}</button>
  <button type="button" data-action="undo"><i class="fa-solid fa-rotate-left" inert></i>${L("SDE.hexMap.fogReset.undo", { count: 37, when: "10/11/2026, 9:14:02 PM" })}</button>
  <button type="button" data-action="cancel">${L("SDE.hexMap.btn.cancel")}</button>`;
export default {
  title: "Reset the fog", width: 440,
  html: `<div class="application dialog window-app themed sde-ui sde-dialog" role="dialog">
  <header class="window-header"><h1 class="window-title">${L("SDE.hexMap.fogReset.title")}</h1></header>
  <section class="window-content"><div class="dialog-content standard-form">${content}</div><footer class="form-footer">${footer}</footer></section>
</div>`,
};
