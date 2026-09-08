import { MODULE_ID } from "../shared/module-id.mjs";
import { LootGenerator } from "./loot-generator.mjs";
import { LootDrops } from "./loot-drops.mjs";
import { gatherLootTables } from "./loot-table-catalog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Monster Loot Overrides — every world NPC on one screen with its loot table
 * and drop chance, editable inline. The same two actor flags the per-sheet
 * Loot button edits (`lootTable`, `lootDropChance`); a change writes at once.
 * Opened from Configure Settings → Loot & XP, whether or not combat drops are
 * switched on, so a GM can set up a bestiary before enabling them.
 */
export class MonsterLootReviewApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sde-monster-loot-review",
    classes: ["sde-monster-loot"],
    window: { title: "SDE.settings.monsterLoot.title", icon: "fa-solid fa-coins", resizable: true },
    position: { width: 780, height: 640 },
    actions: { openSheet: MonsterLootReviewApp._onOpenSheet },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/monster-loot-review.hbs`, scrollable: [".sde-ml-list"] },
  };

  async _prepareContext() {
    const tables = await gatherLootTables();
    const known = new Set(tables.map((t) => t.uuid));
    const rows = game.actors
      .filter((a) => a.type === "NPC")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => {
        const level = Number(a.system?.level?.value) || 0;
        const table = a.getFlag(MODULE_ID, "lootTable") ?? "";
        const chance = a.getFlag(MODULE_ID, "lootDropChance");
        const tierUuid = LootGenerator.tableForLevel(level);
        const tierName = tierUuid ? fromUuidSync(tierUuid)?.name : null;
        return {
          id: a.id,
          name: a.name,
          nameKey: a.name.toLowerCase(),
          level,
          table,
          chance: chance ?? "",
          overridden: !!table || chance !== undefined,
          defaultLabel: tierName ? `Default — ${tierName}` : "Default — no tier table for this level",
          // A flagged table the picker no longer lists (deleted, or never a
          // curated loot table) still has to show as the selection.
          missingTable: table && !known.has(table) ? (fromUuidSync(table)?.name ?? "(missing table)") : null,
        };
      });
    return {
      rows,
      tables,
      worldChance: Number(game.settings.get(MODULE_ID, "lootDropChance") ?? 50),
      dropsOn: !!game.settings.get(MODULE_ID, "lootDropEnabled"),
      perEncounter: game.settings.get(MODULE_ID, "lootDropMode") === "encounter",
    };
  }

  _onRender() {
    const root = this.element;
    root.querySelector("[data-ml-filter]")?.addEventListener("input", (ev) => {
      const q = ev.target.value.trim().toLowerCase();
      for (const tr of root.querySelectorAll("tr[data-actor-id]")) tr.hidden = !!q && !tr.dataset.name.includes(q);
    });
    root.addEventListener("change", async (ev) => {
      const tr = ev.target.closest("tr[data-actor-id]");
      const actor = tr && game.actors.get(tr.dataset.actorId);
      if (!actor) return;
      await LootDrops.setOverrides(actor, {
        table: tr.querySelector('[name="table"]').value,
        chance: tr.querySelector('[name="chance"]').value,
      });
      tr.classList.toggle("overridden", !!tr.querySelector('[name="table"]').value || tr.querySelector('[name="chance"]').value.trim() !== "");
    });
  }

  static _onOpenSheet(_event, target) {
    game.actors.get(target.closest("tr[data-actor-id]")?.dataset.actorId)?.sheet?.render(true);
  }
}
