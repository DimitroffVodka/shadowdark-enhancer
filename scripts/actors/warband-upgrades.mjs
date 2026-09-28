/**
 * Shadowdark Enhancer — what a warband's upgrades do (#201, PGWR p.250).
 *
 * Armor Upgrade, Tough, Training and Weapons Upgrade change numbers on the
 * sheet. Each is written into the stored field it changes, in the same update
 * that ticks the box, and taken off by the same amount when it's unticked.
 * Not an Active Effect: an NPC's attack reads only its item's own fields, and
 * the NPC sheet drops an edit to a field an effect overrides. The attacks it
 * raised are marked (`warbandUpgrade` flag), so unticking lowers only those.
 *
 * Every upgrade's book text is read once from the GM's PDF into a world
 * setting, which every client reads for the sheet's hovers.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { UPGRADES, upgradeActorChanges, upgradeAttackChanges, parseUpgradeLines } from "./warband-core.mjs";

export const UPGRADE_TEXT_SETTING = "warbandUpgradeText";
const ATTACK_FLAG = "warbandUpgrade";
const ATTACK_TYPES = new Set(["NPC Attack", "NPC Special Attack"]);

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** The book text for each upgrade the GM has read in: key → text. */
export function upgradeText() {
  try { return game.settings.get(MODULE_ID, UPGRADE_TEXT_SETTING) ?? {}; } catch { return {}; }
}

/** Save what a p.250 read found; a short read keeps what it found and says so. Returns the count. */
export async function saveUpgradeText(text) {
  const found = parseUpgradeLines(text);
  const n = Object.keys(found).length;
  if (!n) return 0;
  await game.settings.set(MODULE_ID, UPGRADE_TEXT_SETTING, found);
  if (n < UPGRADES.length) ui.notifications?.warn(t("SDE.warband.notify.textPartial", { n, of: UPGRADES.length }));
  else ui.notifications?.info(t("SDE.warband.notify.textRead"));
  return n;
}

/** Read the upgrades' text from the Player's Guide p.250 (GM). */
export async function readUpgradeText() {
  if (!game.user.isGM) return 0;
  const { sourcePdfTarget } = await import("../importer/source-pdf-registry.mjs");
  const target = sourcePdfTarget("WR", "250");
  if (!target) {
    ui.notifications?.warn(t("SDE.warband.notify.noPdf"));
    return 0;
  }
  const { extractPdfText, notifyGutterWarnings } = await import("../importer/pdf-text-extract.mjs");
  const result = await extractPdfText(target.file, { pages: [target.page], columns: "topband" });
  notifyGutterWarnings(result);
  const n = await saveUpgradeText(result.text);
  if (!n) ui.notifications?.warn(t("SDE.warband.notify.textNotFound"));
  return n;
}

/**
 * The upgrade's numbers onto (`on`) or off the warband: the actor's own fields
 * in `extra`, for the caller to write with the flag in one update, then its
 * attacks. Reads stored values, so no effect's change is written in.
 * @returns {{extra: object, attacks: () => Promise<void>}}
 */
export function upgradeWrites(actor, key, on) {
  const a = actor._source.system.attributes;
  const extra = upgradeActorChanges(key, on, { ac: Number(a.ac?.value) || 0, hpMax: Number(a.hp?.max) || 0, hpValue: Number(a.hp?.value) || 0 });
  const attacks = async () => {
    const updates = [];
    for (const item of actor.items) {
      if (!ATTACK_TYPES.has(item.type)) continue;
      const marked = !!item.getFlag(MODULE_ID, ATTACK_FLAG)?.[key];
      if (marked === on) continue;
      const src = item._source.system;
      const changes = upgradeAttackChanges(key, on, { attackBonus: src.bonuses?.attackBonus, damage: src.damage?.value });
      if (changes === null) return;
      updates.push({ _id: item.id, ...changes, [`flags.${MODULE_ID}.${ATTACK_FLAG}.${key}`]: on });
    }
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  };
  return { extra, attacks };
}

/** The setting. Must run in `init`. */
export function registerWarbandUpgrades() {
  game.settings.register(MODULE_ID, UPGRADE_TEXT_SETTING, { scope: "world", config: false, type: Object, default: {} });
}
