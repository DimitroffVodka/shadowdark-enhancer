/**
 * Shadowdark Enhancer — Auto-drop loot on NPC defeat (G4).
 * On combat end, defeated NPCs roll their loot table (per-NPC flag or the
 * tier table for the NPC's level) at a drop chance, posting a hoard card.
 * Opt-in: off by default via the "Loot drops on combat end" setting. The
 * chance is a world setting; both chance and table can be overridden per
 * NPC from the Loot button in the NPC sheet header. "Loot drop mode" picks
 * between one roll per defeated NPC and one roll for the whole encounter.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { LootGenerator } from "./loot-generator.mjs";
import { LootDelivery } from "./loot-delivery.mjs";
import { esc } from "../shared/esc.mjs";

export const LootDrops = {
  init() {
    Hooks.on("deleteCombat", (combat) => this._onCombatEnd(combat));

    // Per-NPC drop config: a GM-only Loot button in the NPC sheet header,
    // shown only while the feature is enabled (no residue when it's off).
    Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
      const actor = sheet.actor;
      if (!game.user.isGM || actor?.type !== "NPC") return;
      if (!game.settings.get(MODULE_ID, "lootDropEnabled")) return;
      buttons.unshift({
        class: "sde-loot-drops-config",
        icon: "fas fa-coins",
        label: "Loot",
        onclick: () => this.openConfig(actor),
      });
    });
  },

  async _onCombatEnd(combat) {
    // Exactly one client may process the drop. deleteCombat fires on every
    // connected client, and `isGM` alone is true for assistant GMs too (e.g.
    // the always-on "Bridge" user), so each GM-level client used to roll and
    // post its own cards. Mirror the activeGM guard used by loot-delivery,
    // merchant-shop, and session-recap.
    if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
    if (!game.settings.get(MODULE_ID, "lootDropEnabled")) return;

    const defeated = combat.combatants.filter(c => {
      const a = c.actor;
      if (!a || a.type !== "NPC") return false;
      return c.defeated || (a.system?.attributes?.hp?.value ?? a.system?.hp?.value ?? 1) <= 0;
    });

    if (game.settings.get(MODULE_ID, "lootDropMode") === "encounter") {
      return this._dropForEncounter(defeated);
    }

    for (const c of defeated) {
      const npc = c.actor;
      const level = Number(npc.system?.level?.value) || 0;
      const tableUuid = npc.getFlag(MODULE_ID, "lootTable") || LootGenerator.tableForLevel(level);
      if (!tableUuid) continue;
      const chance = Number(
        npc.getFlag(MODULE_ID, "lootDropChance")
          ?? game.settings.get(MODULE_ID, "lootDropChance")
          ?? 50,
      );
      if ((await new Roll("1d100").evaluate()).total > chance) continue;

      const batch = await LootGenerator.generate(level, { rolls: 1, tableUuid });
      if (batch.error) continue;
      batch.source = npc.name;
      await LootDelivery.postCard(batch);
    }
  },

  /**
   * "Per encounter" mode: one chance roll and at most one card for the whole
   * combat. The highest-level defeated NPC is the representative — its
   * per-NPC table/chance overrides drive the drop (so a boss's custom table
   * wins), and loot is generated at its level. The card's source line lists
   * the defeated.
   */
  async _dropForEncounter(defeated) {
    if (!defeated.length) return;
    const rep = defeated.map(c => c.actor).reduce((a, b) =>
      (Number(b.system?.level?.value) || 0) > (Number(a.system?.level?.value) || 0) ? b : a);
    const level = Number(rep.system?.level?.value) || 0;
    const tableUuid = rep.getFlag(MODULE_ID, "lootTable") || LootGenerator.tableForLevel(level);
    if (!tableUuid) return;
    const chance = Number(
      rep.getFlag(MODULE_ID, "lootDropChance")
        ?? game.settings.get(MODULE_ID, "lootDropChance")
        ?? 50,
    );
    if ((await new Roll("1d100").evaluate()).total > chance) return;

    const batch = await LootGenerator.generate(level, { rolls: 1, tableUuid });
    if (batch.error) return;
    const names = defeated.map(c => c.actor.name);
    batch.source = names.length <= 3
      ? names.join(", ")
      : `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
    await LootDelivery.postCard(batch);
  },

  /**
   * GM dialog for one NPC's drop behaviour. Writes/clears the two actor
   * flags this feature reads: `lootTable` (a RollTable uuid; blank = the
   * treasure tier table for the NPC's level) and `lootDropChance` (0–100;
   * blank = the world setting).
   */
  async openConfig(actor) {
    if (!game.user.isGM || !actor) return;
    const { gatherLootTables } = await import("./loot-table-catalog.mjs");
    const tables = await gatherLootTables();

    const currentTable = actor.getFlag(MODULE_ID, "lootTable") ?? "";
    // A previously-flagged table that the picker no longer surfaces (deleted
    // or never a curated loot table) must still show as the selection.
    if (currentTable && !tables.some(t => t.uuid === currentTable)) {
      const doc = await fromUuid(currentTable).catch(() => null);
      tables.push({ uuid: currentTable, name: doc?.name ?? "(missing table)", group: "Other" });
    }

    const chanceFlag = actor.getFlag(MODULE_ID, "lootDropChance");
    const globalChance = Number(game.settings.get(MODULE_ID, "lootDropChance") ?? 50);
    const level = Number(actor.system?.level?.value) || 0;
    const tierUuid = LootGenerator.tableForLevel(level);
    const tierName = tierUuid ? (fromUuidSync(tierUuid)?.name ?? null) : null;
    const defaultLabel = tierName
      ? `Default — ${tierName} (tier table for level ${level})`
      : `Default — no tier table mapped for level ${level}`;

    const options = [
      `<option value="">${esc(defaultLabel)}</option>`,
      ...tables.map(t =>
        `<option value="${esc(t.uuid)}"${t.uuid === currentTable ? " selected" : ""}>${esc(t.name)} (${esc(t.group)})</option>`),
    ].join("");

    const content = `
      <div style="display:flex;flex-direction:column;gap:8px;padding:6px 2px;">
        <label>Loot table<br>
          <select name="table" style="width:100%;">${options}</select>
        </label>
        <label>Drop chance %<br>
          <input type="number" name="chance" min="0" max="100" step="1"
                 value="${Number.isFinite(Number(chanceFlag)) && chanceFlag !== undefined ? Number(chanceFlag) : ""}"
                 placeholder="World setting (${globalChance}%)" style="width:100%;">
        </label>
        <p class="notes" style="margin:0;">Rolled once per defeated NPC when combat ends. Blank fields use the world settings.</p>
      </div>`;

    // Same DialogV2.wait pattern as loot-delivery's recipient picker: the
    // "save" callback's return value becomes the resolved choice.
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: `Loot Drops — ${actor.name}` },
      content,
      buttons: [
        {
          action: "save", label: "Save", default: true,
          callback: (_e, _b, dlg) => ({
            table: dlg.element.querySelector('select[name="table"]').value,
            chance: dlg.element.querySelector('input[name="chance"]').value.trim(),
          }),
        },
        { action: "cancel", label: "Cancel" },
      ],
      rejectClose: false,
    }).catch(() => null);
    if (!choice || choice === "cancel") return;

    if (choice.table) await actor.setFlag(MODULE_ID, "lootTable", choice.table);
    else await actor.unsetFlag(MODULE_ID, "lootTable");

    const n = Number(choice.chance);
    if (choice.chance !== "" && Number.isFinite(n)) {
      await actor.setFlag(MODULE_ID, "lootDropChance", Math.max(0, Math.min(100, Math.round(n))));
    } else {
      await actor.unsetFlag(MODULE_ID, "lootDropChance");
    }
    ui.notifications.info(`Loot drops updated for ${actor.name}.`);
  },
};
