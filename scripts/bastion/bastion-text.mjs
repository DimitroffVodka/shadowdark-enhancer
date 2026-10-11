/**
 * Shadowdark Enhancer — Bastions: words shared by the sheet and the panel.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { BASTION_UPGRADES, effects, parseUpgradeLines } from "./bastion-core.mjs";

export const t = (key) => game.i18n.localize(key);
export const format = (key, data) => game.i18n.format(key, data);

/** Why a rules call said no, in words (written out in full: the i18n test scans for keys). */
export const WHY = {
  unknown: "SDE.bastion.why.unknown",
  full: "SDE.bastion.why.full",
  unstanding: "SDE.bastion.why.unstanding",
  broke: "SDE.bastion.why.broke",
  tooMany: "SDE.bastion.why.tooMany",
  nothing: "SDE.bastion.why.nothing",
  amount: "SDE.bastion.why.amount",
  built: "SDE.bastion.why.built",
  trophyRoom: "SDE.bastion.why.trophyRoom",
  aviary: "SDE.bastion.why.aviary",
  flown: "SDE.bastion.why.flown",
  name: "SDE.bastion.why.name",
};

/** The line a monthly disaster roll is posted with: `entry`'s text (the newest log line by default), and under a finished Infirmary a pestilence says the patients have ADV. */
export function monthLine(state, entry = state.log.at(-1)) {
  const note = entry.key === "SDE.bastion.log.pestilence" && effects(state).infirmary ? ` ${t("SDE.bastion.infirmary.pestilence")}` : "";
  return `${logText(entry)}${note}`;
}

/** A log line, with any i18n key in its data (an upgrade's name) turned into words. */
export const logText = (entry) => format(entry.key, Object.fromEntries(
  Object.entries(entry.data ?? {}).map(([k, v]) => [k, typeof v === "string" && v.startsWith("SDE.") ? t(v) : v])));

// ── What an upgrade does, in the book's words ─────────────────────────────────
// Read once from the GM's Player's Guide (p.247) into a world setting every client reads;
// the module ships none of it. Until it is read the sheet shows names and costs.

/** The world setting holding the read text: upgrade id → description. */
export const UPGRADE_TEXT_SETTING = "bastionUpgradeText";

/** The text read so far: id → description. */
export function upgradeText() {
  try {
    const v = game.settings.get(MODULE_ID, UPGRADE_TEXT_SETTING);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** One upgrade's printed description, or "" before it is read. */
export const effectOf = (id) => upgradeText()[id] ?? "";

/** Is any upgrade's text still to read? */
export const upgradeTextMissing = () => BASTION_UPGRADES.some((u) => !upgradeText()[u.id]);

/** Keep what a p.247 read found over what is kept; a short read says so. Returns how many are kept. */
export async function saveUpgradeText(text) {
  const found = parseUpgradeLines(text);
  if (!Object.keys(found).length) return 0;
  const merged = { ...upgradeText(), ...found };
  await game.settings.set(MODULE_ID, UPGRADE_TEXT_SETTING, merged);
  const n = Object.keys(merged).length;
  if (n < BASTION_UPGRADES.length) ui.notifications?.warn(format("SDE.bastion.notify.textPartial", { n, of: BASTION_UPGRADES.length }));
  else ui.notifications?.info(t("SDE.bastion.notify.textRead"));
  return n;
}

/** GM only: read the upgrade table from the linked Player's Guide PDF (p.247). */
export async function readUpgradeText() {
  if (!game.user.isGM) return 0;
  const { sourcePdfTarget } = await import("../importer/source-pdf-registry.mjs");
  const target = sourcePdfTarget("WR", "247");
  if (!target) {
    ui.notifications?.warn(t("SDE.bastion.notify.noPdf"));
    return 0;
  }
  const { extractPdfText, notifyGutterWarnings } = await import("../importer/pdf-text-extract.mjs");
  let result;
  try {
    result = await extractPdfText(target.file, { pages: [target.page], columns: "auto" });
  } catch (err) {
    console.error(`${MODULE_ID} | bastion upgrade text`, err);
    ui.notifications?.error(format("SDE.importer.pdf.readPageFailed", { error: err?.message || err }));
    return 0;
  }
  notifyGutterWarnings(result);
  const n = await saveUpgradeText(result.text);
  if (!n) ui.notifications?.warn(t("SDE.bastion.notify.textNotFound"));
  return n;
}
