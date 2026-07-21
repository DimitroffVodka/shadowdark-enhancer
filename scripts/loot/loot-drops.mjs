/**
 * Shadowdark Enhancer — Auto-drop loot on NPC defeat (G4).
 * On combat end, defeated NPCs roll their loot table (per-NPC flag or the
 * tier table for the NPC's level) at a drop chance, posting a hoard card.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { LootGenerator } from "./loot-generator.mjs";
import { LootDelivery } from "./loot-delivery.mjs";

export const LootDrops = {
  init() {
    Hooks.on("deleteCombat", (combat) => this._onCombatEnd(combat));
  },

  async _onCombatEnd(combat) {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, "lootDropEnabled")) return;

    const defeated = combat.combatants.filter(c => {
      const a = c.actor;
      if (!a || a.type !== "NPC") return false;
      return c.defeated || (a.system?.attributes?.hp?.value ?? a.system?.hp?.value ?? 1) <= 0;
    });

    for (const c of defeated) {
      const npc = c.actor;
      const level = Number(npc.system?.level?.value) || 0;
      const tableUuid = npc.getFlag(MODULE_ID, "lootTable") || LootGenerator.tableForLevel(level);
      if (!tableUuid) continue;
      const chance = npc.getFlag(MODULE_ID, "lootDropChance") ?? 50;
      if ((await new Roll("1d100").evaluate()).total > chance) continue;

      const batch = await LootGenerator.generate(level, { rolls: 1, tableUuid });
      if (batch.error) continue;
      batch.source = npc.name;
      await LootDelivery.postCard(batch);
    }
  },
};
