/**
 * Shadowdark Enhancer — the GM's Reset fog window: whose map, which hexes, and whether first-entry tables roll again.
 * The count it shows comes from the same plan the write uses; the write itself is resetHexFog in hex-fog.mjs.
 */
import { L as t } from "../shared/i18n.mjs";
import { Party } from "../party/party.mjs";
import { fogCells, previewFogReset, resetHexFog, undoFogReset, fogUndoInfo } from "./hex-fog.mjs";
import { offsetKey } from "./hex-records.mjs";
import { hexNumberAt } from "./hex-number-api.mjs";
import { sceneZones, scanSceneFor } from "./hex-region.mjs";

const esc = (v) => foundry.utils.escapeHTML(String(v ?? ""));

/** Region name -> the "i_j" keys of this scene's hexes in it. Empty when the scene has no region scan to read. */
export async function regionKeys(scene) {
  const out = new Map(), scan = scanSceneFor(scene);
  if (!scan) return out;
  const { byNum } = await sceneZones(scan);
  if (!byNum.size) return out;
  for (const offset of fogCells(scene)) {
    const zone = byNum.get(hexNumberAt(offset, scene))?.zone;
    if (!zone) continue;
    if (!out.has(zone)) out.set(zone, []);
    out.get(zone).push(offsetKey(offset));
  }
  return out;
}

export async function openFogReset(scene = globalThis.canvas?.scene) {
  if (!game.user?.isGM || !scene) return null;
  const regions = await regionKeys(scene), names = [...regions.keys()].sort((a, b) => a.localeCompare(b));
  const parties = Party.list(), chosen = Party.selected()?.id, undo = fogUndoInfo(scene);
  const partyName = (id) => parties.find((a) => a.id === id)?.name ?? t("SDE.hexMap.fogReset.everyone");
  const content = `<div class="form-group"><label>${esc(t("SDE.hexMap.fogReset.whose"))}</label><div class="form-fields">
      <select name="party"><option value="">${esc(t("SDE.hexMap.fogReset.everyone"))}</option>
      ${parties.map((a) => `<option value="${esc(a.id)}"${a.id === chosen ? " selected" : ""}>${esc(a.name)}</option>`).join("")}</select></div>
      <p class="hint">${esc(t("SDE.hexMap.fogReset.everyoneHint"))}</p></div>
    <div class="form-group"><label>${esc(t("SDE.hexMap.fogReset.which"))}</label><div class="form-fields">
      <select name="area"><option value="">${esc(t("SDE.hexMap.fogReset.wholeMap"))}</option>
      ${names.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join("")}</select></div></div>
    <div class="form-group"><label class="checkbox"><input type="checkbox" name="rearm"> ${esc(t("SDE.hexMap.fogReset.rearm"))}</label>
      <p class="hint">${esc(t("SDE.hexMap.fogReset.rearmHint"))}</p></div>
    <p class="hint" data-count></p>`;
  const read = (root) => {
    const q = (n) => root.querySelector?.(`[name='${n}']`), area = q("area")?.value ?? "";
    return { partyId: q("party")?.value || null, keys: area === "" ? null : regions.get(names[Number(area)]) ?? [], rearm: !!q("rearm")?.checked };
  };
  const answer = await foundry.applications.api.DialogV2.wait({
    classes: ["sde-ui", "sde-dialog"],
    window: { title: t("SDE.hexMap.fogReset.title"), icon: "fa-solid fa-cloud" },
    content,
    render: (_event, dialog) => {
      const root = dialog.element ?? dialog, line = root.querySelector("[data-count]");
      const show = () => {
        const options = read(root), count = previewFogReset(options, scene);
        line.textContent = count ? t("SDE.hexMap.fogReset.count", { count, who: partyName(options.partyId) }) : t("SDE.hexMap.fogReset.nothing", { who: partyName(options.partyId) });
      };
      for (const name of ["party", "area", "rearm"]) root.querySelector(`[name='${name}']`)?.addEventListener("change", show);
      show();
    },
    buttons: [
      { action: "reset", label: t("SDE.hexMap.fogReset.confirm"), icon: "fa-solid fa-cloud", default: true, callback: (_event, _button, dialog) => ({ action: "reset", ...read(dialog.element ?? dialog) }) },
      ...(undo ? [{ action: "undo", label: t("SDE.hexMap.fogReset.undo", { count: undo.count, when: new Date(undo.at).toLocaleString() }), icon: "fa-solid fa-rotate-left" }] : []),
      { action: "cancel", label: t("SDE.hexMap.btn.cancel") },
    ],
    rejectClose: false,
  }).catch(() => null);
  if (answer === "undo") {
    const { count } = await undoFogReset(scene);
    ui.notifications?.info(t("SDE.hexMap.fogReset.undone", { count }));
  } else if (answer?.action === "reset") {
    const { count } = await resetHexFog(answer, scene);
    ui.notifications?.info(count ? t("SDE.hexMap.fogReset.done", { count, who: partyName(answer.partyId) }) : t("SDE.hexMap.fogReset.nothing", { who: partyName(answer.partyId) }));
  }
  return answer;
}
