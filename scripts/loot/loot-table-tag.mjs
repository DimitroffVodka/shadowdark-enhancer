/**
 * Shadowdark Enhancer — Loot-table tagging.
 * Adds a RollTable sidebar context-menu toggle ("Mark / Unmark as Loot
 * Table") so the Loot Generator picker can show only loot tables. A table
 * counts as loot if it carries `flags.shadowdark-enhancer.isLootTable` OR was
 * filed as "loot" by the Roll Table Importer (`tableType:"loot"`).
 */
import { MODULE_ID } from "../shared/module-id.mjs";

const FLAG = "isLootTable";

/** Resolve the RollTable for a context-menu target (HTMLElement or jQuery). */
function _tableFor(li) {
  const el = li instanceof HTMLElement ? li : li?.[0];
  const id = el?.dataset?.entryId;
  return id ? game.tables.get(id) : null;
}

function _isMarked(table) {
  return table?.getFlag?.(MODULE_ID, FLAG) === true;
}

/** Re-render the Loot Generator window if it's open (no hard import cycle). */
function _refreshGenerator() {
  try { foundry.applications.instances?.get?.("sde-loot-generator")?.render?.(); } catch (e) { /* not open */ }
}

export const LootTableTag = {
  FLAG,

  /** True if a table should appear in the Loot Generator picker. */
  isLootTable(table) {
    return table?.getFlag?.(MODULE_ID, FLAG) === true
      || table?.getFlag?.(MODULE_ID, "tableType") === "loot";
  },

  /** Register the RollTable directory context-menu entries. Call at init. */
  init() {
    Hooks.on("getRollTableContextOptions", (...args) => {
      const entries = args.find(a => Array.isArray(a));
      if (!entries) return;

      // visible/condition are evaluated per-open against the target row.
      const showWhen = marked => li => {
        if (!game.user.isGM) return false;
        const t = _tableFor(li);
        return !!t && _isMarked(t) === marked;
      };

      entries.push(
        {
          label: "Mark as Loot Table",
          icon: '<i class="fa-solid fa-coins"></i>',
          visible: showWhen(false),
          condition: showWhen(false),
          onClick: async (event, li) => {
            const t = _tableFor(li ?? event);
            if (!t) return;
            await t.setFlag(MODULE_ID, FLAG, true);
            ui.notifications.info(`"${t.name}" marked as a loot table.`);
            _refreshGenerator();
          },
        },
        {
          label: "Unmark as Loot Table",
          icon: '<i class="fa-solid fa-coins"></i>',
          visible: showWhen(true),
          condition: showWhen(true),
          onClick: async (event, li) => {
            const t = _tableFor(li ?? event);
            if (!t) return;
            await t.unsetFlag(MODULE_ID, FLAG);
            ui.notifications.info(`"${t.name}" unmarked as a loot table.`);
            _refreshGenerator();
          },
        },
      );
    });
  },
};
