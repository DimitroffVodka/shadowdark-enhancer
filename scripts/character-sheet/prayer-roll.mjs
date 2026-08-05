/**
 * Shadowdark Enhancer — Prayer Roll on Character Sheet
 *
 * Injects a clickable prayer icon next to the Deity heading on the
 * character sheet's Details tab. Clicking rolls the deity's prayer
 * generator table if it has been imported from the Western Reaches.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";

const PRAYER_ICON = `modules/${MODULE_ID}/icons/game-icons/prayer.svg`;

/**
 * Map a deity item name to its prayer table name.
 * Pattern: "{Deity Name} Prayers" (matching the MANIFEST entries).
 */
function prayerTableName(deityName) {
  if (!deityName) return null;
  const name = String(deityName).trim();
  // Special cases
  if (name === "The Lost") return "The Lost Prayers";
  return `${name} Prayers`;
}

/**
 * Find the prayer roll table for a deity, checking world tables first
 * then compendiums.
 */
function findPrayerTable(deityName) {
  const tableName = prayerTableName(deityName);
  if (!tableName) return null;

  // Check world tables
  const worldTable = game.tables.find(t => t.name === tableName);
  if (worldTable) return worldTable;

  // Check compendiums
  for (const pack of game.packs) {
    if (pack.documentName !== "RollTable") continue;
    const idx = pack.index.find(e => e.name === tableName);
    if (idx) return { pack, id: idx._id, name: tableName };
  }

  return null;
}

export function init() {
  Hooks.on("renderActorSheet", (_app, html, data) => {
    const actor = data.actor ?? data.document;
    if (!actor || actor.type !== "Player") return;

    const deityUuid = actor.system?.deity;
    if (!deityUuid) return;

    // Find the Deity header in the DOM
    const deitySections = html[0]?.querySelectorAll(".SD-box .header label")
      ?? html.querySelectorAll(".SD-box .header label");
    
    let deityHeader = null;
    for (const label of deitySections) {
      if (label.textContent?.toLowerCase().includes("deity")) {
        deityHeader = label.closest(".header");
        break;
      }
    }
    if (!deityHeader) return;

    // Don't inject twice
    if (deityHeader.querySelector(".sde-prayer-roll")) return;

    // Resolve deity name from UUID
    const deityName = (() => {
      try {
        const item = fromUuidSync(deityUuid);
        return item?.name ?? null;
      } catch { return null; }
    })();
    if (!deityName) return;

    // Find the prayer table
    const table = findPrayerTable(deityName);
    if (!table) return;

    // Build and inject the icon
    const icon = document.createElement("img");
    icon.className = "sde-prayer-roll";
    icon.src = PRAYER_ICON;
    icon.alt = "Pray";
    icon.title = game.i18n.format("SDE.prayerRoll.title", { deity: deityName });
    icon.style.cssText = "width:16px;height:16px;margin-left:6px;cursor:pointer;opacity:0.7;display:inline-block;vertical-align:middle;";
    icon.addEventListener("mouseenter", () => { icon.style.opacity = "1"; });
    icon.addEventListener("mouseleave", () => { icon.style.opacity = "0.7"; });
    icon.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      await rollPrayerTable(table, actor, deityName);
    });

    // Insert after the edit button (or at the end of the header span)
    const headerSpan = deityHeader.querySelector("span");
    if (headerSpan) {
      headerSpan.appendChild(icon);
    } else {
      deityHeader.appendChild(icon);
    }
  });
}

export async function rollPrayerTable(table, actor, deityName) {
  let rollTable;
  if (table.pack) {
    // Compendium table — import temporarily or draw from pack
    const doc = await table.pack.getDocument(table.id);
    if (!doc) return;
    rollTable = doc;
  } else {
    rollTable = table;
  }

  if (!rollTable) return;

  // Draw silently, then fold the flavor line and the drawn result into ONE
  // card — the old code posted two messages (the table's own card plus this
  // flavor line).
  const draw = await rollTable.draw({ displayChat: false });

  // A TableResult's display text lives on `name`/`description`. Never read
  // `.text` (or `._source.text`) here — the removed-in-v15 deprecation shim
  // fires on this Foundry version.
  const drawn = (draw.results ?? [])
    .map(r => r.name || r.description)
    .filter(Boolean);

  // Escape both sides: the flavor line interpolates actor/deity names into
  // the card's HTML, and the drawn text is table content. Note: esc() flattens
  // inline-roll syntax ([[/r 1d6]]) in result text — unreachable for the
  // imported prayer tables (plain names only), but user world tables could hit
  // it; deliberate tradeoff.
  const flavor = game.i18n.format("SDE.prayerRoll.rolled", {
    name: esc(actor.name),
    deity: esc(deityName),
  });
  const content = [flavor, ...drawn.map(text => esc(text))]
    .map(part => `<p>${part}</p>`).join("");

  const messageData = {
    content,
    speaker: ChatMessage.getSpeaker({ actor }),
  };
  // Attach the evaluated draw roll so Dice So Nice still animates it.
  if (draw.roll) messageData.rolls = [draw.roll];
  // v14 live-verified: the deprecated `core.rollMode` getter returns null (it
  // does not merely warn), so the effective mode is `core.messageMode` reached
  // through applyRollMode(null)'s fallback chain, not a value read here. Works
  // today; must migrate to messageMode/applyMode before v16 removes the shim.
  ChatMessage.applyRollMode(messageData, game.settings.get("core", "rollMode"));
  await ChatMessage.create(messageData);
}
