/**
 * Shadowdark Enhancer — Bastions: words shared by the sheet and the panel.
 */

import { effects } from "./bastion-core.mjs";

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
