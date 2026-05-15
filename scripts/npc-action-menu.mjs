/**
 * Shadowdark Enhancer — Action Menu
 *
 * Ported from vagabond-crawler/scripts/npc-action-menu.mjs.
 * The Vagabond UI shell is preserved verbatim (hover-tab strip + dropdown
 * panel anchored outside the card to escape overflow:hidden clipping). All
 * Vagabond-specific systems (mana/delivery dialog, alchemy craft, beast-form,
 * Step Up, Virtuoso, Summon, Gold Sink, Talent cast — and the whole
 * CrawlerSpellDialog ~500-line block) are dropped — Shadowdark has none of
 * those concepts.
 *
 * During combat, each combatant card shows a tab strip BELOW the card:
 *   NPCs:    [Actions] [Abilities]
 *   Players: [Weapons] [Spells]
 *
 * Hovering the card OR the strip reveals a dropdown panel listing the items
 * with damage labels inline (e.g. "Claws  2d6 piercing"). The panel is
 * appended to `#shadowdark-enhancer-strip` (NOT inside the card) so it is
 * never clipped by parent overflow rules.
 *
 * Click handlers route to Shadowdark's actor methods:
 *   - PC weapon → `actor.system.rollAttack(itemId)`
 *   - PC spell  → `actor.system.castSpell(itemId)`
 *   - NPC attack → `actor.rollAttack(itemId)` / fallback to sheet
 *   - NPC feature → open item sheet (passive description)
 */

import { MODULE_ID } from "./module-id.mjs";

// ─── Damage Label Helpers (Shadowdark adapters) ───────────────────────────────

function _npcAttackDmgLabel(item) {
  const dmg = item.system?.damage?.value ?? "";
  const special = item.system?.damage?.special ?? "";
  if (!dmg && !special) return "";
  const parts = [dmg, special].filter(Boolean).join(" ");
  return `<span class="sde-strip-menu-dmg">${parts}</span>`;
}

function _weaponDmgLabel(item) {
  const oneH = item.system?.damage?.oneHanded ?? "";
  const twoH = item.system?.damage?.twoHanded ?? "";
  const dmg = oneH || twoH;
  if (!dmg) return "";
  const range = item.system?.range ? ` ${item.system.range}` : "";
  return `<span class="sde-strip-menu-dmg">${dmg}${range}</span>`;
}

function _spellDmgLabel(item) {
  const tier = item.system?.tier ?? 0;
  const damageType = item.system?.damageType ?? "none";
  if (damageType === "none" || !damageType) {
    return `<span class="sde-strip-menu-dmg">T${tier}</span>`;
  }
  return `<span class="sde-strip-menu-dmg">T${tier} ${damageType}</span>`;
}

// ─── Item-List Builders (Shadowdark adapters) ─────────────────────────────────

function _buildNpcActions(actor) {
  return (actor.items?.contents ?? [])
    .filter(i => i.type === "NPC Attack" || i.type === "NPC Special Attack")
    .map(item => ({
      label: item.name || "Unnamed",
      dmg: _npcAttackDmgLabel(item),
      itemId: item.id,
      kind: "npc-attack",
    }));
}

function _buildNpcAbilities(actor) {
  return (actor.items?.contents ?? [])
    .filter(i => i.type === "NPC Feature")
    .map(item => ({
      label: item.name || "Unnamed",
      dmg: "",
      itemId: item.id,
      kind: "npc-feature",
    }));
}

// Build the PC weapons list mirroring the system's sheet structure:
//   - each equipped weapon contributes one attack entry for its native type
//     (melee or ranged)
//   - if a weapon is "thrown" AND native type is melee, ALSO add a ranged
//     entry so the player can throw it (matches the sheet's RANGED ATTACKS
//     section listing thrown weapons too).
function _buildPcWeapons(actor) {
  const weapons = (actor.items?.contents ?? []).filter(i => i.system?.isWeapon && i.system?.equipped);
  const entries = [];
  for (const w of weapons) {
    const nativeType = w.system?.type === "ranged" ? "ranged" : "melee";
    entries.push({
      label: w.name || "Unnamed",
      dmg: _weaponDmgLabel(w),
      itemUuid: w.uuid,
      itemId: w.id,
      attackType: nativeType,
      kind: "weapon",
    });
    // Thrown weapons that are natively melee also get a ranged entry.
    if (w.system?.isThrown && nativeType === "melee") {
      entries.push({
        label: `${w.name || "Unnamed"} (thrown)`,
        dmg: _weaponDmgLabel(w),
        itemUuid: w.uuid,
        itemId: w.id,
        attackType: "ranged",
        kind: "weapon",
      });
    }
  }
  return entries;
}

function _buildPcSpells(actor) {
  return (actor.items?.contents ?? [])
    .filter(i => i.type === "Spell" && !i.system?.lost)
    .map(item => ({
      label: item.name || "Unnamed",
      dmg: _spellDmgLabel(item),
      itemId: item.id,
      kind: "spell",
    }));
}

// PC Abilities tab — only `Class Ability` items (Special Abilities section on
// the character sheet, e.g. Avorn's Petrifying Gaze). Excludes Talents — those
// are passive bonuses (Stone Skin, Ambitious, etc.) that don't belong here.
function _buildPcAbilities(actor) {
  return (actor.items?.contents ?? [])
    .filter(i => i.type === "Class Ability")
    .map(item => ({
      label: item.name || "Unnamed",
      dmg: "",
      itemId: item.id,
      kind: "ability",
    }));
}

// ─── Menu Data ────────────────────────────────────────────────────────────────

function _buildMenuData(actor, isNPC) {
  if (isNPC) {
    return {
      tabA: "Actions",
      tabB: "Abilities",
      itemsA: _buildNpcActions(actor),
      itemsB: _buildNpcAbilities(actor),
    };
  }
  return {
    tabA: "Weapons",
    tabB: "Spells",
    tabC: "Abilities",
    itemsA: _buildPcWeapons(actor),
    itemsB: _buildPcSpells(actor),
    itemsC: _buildPcAbilities(actor),
  };
}

// ─── Tab Strip HTML (injected BELOW card, outside overflow:hidden) ────────────

/**
 * Returns HTML for the visible tab strip that sits below the card.
 * Rendered as a sibling to .sde-strip-member inside a .sde-strip-card-wrap div.
 */
export function buildTabStripHTML(actor, isNPC) {
  if (!actor) return "";
  const menu = _buildMenuData(actor, isNPC);
  const { tabA, tabB, tabC, itemsA, itemsB, itemsC } = menu;
  const hasA = itemsA && itemsA.length > 0;
  const hasB = itemsB && itemsB.length > 0;
  const hasC = itemsC && itemsC.length > 0;
  if (!hasA && !hasB && !hasC) return "";
  const firstShown = hasA ? "a" : hasB ? "b" : "c";
  return `
    <div class="sde-strip-action-tabs" data-actor-id="${actor.id}">
      ${hasA ? `<button class="sde-strip-atab ${firstShown === "a" ? "sde-strip-atab-active" : ""}" data-tab="a">${tabA}</button>` : ""}
      ${hasB ? `<button class="sde-strip-atab ${firstShown === "b" ? "sde-strip-atab-active" : ""}" data-tab="b">${tabB}</button>` : ""}
      ${hasC ? `<button class="sde-strip-atab ${firstShown === "c" ? "sde-strip-atab-active" : ""}" data-tab="c">${tabC}</button>` : ""}
    </div>`;
}

// ─── Floating Panel (appended to strip root, absolutely positioned) ───────────

let _activePanel = null;
let _hideTimer = null;

function _clearHideTimer() {
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
}

function _scheduleHide() {
  _clearHideTimer();
  _hideTimer = setTimeout(() => { _removePanel(); }, 200);
}

function _removePanel() {
  if (_activePanel) { _activePanel.remove(); _activePanel = null; }
}

function _showPanel(stripEl, cardWrap, actor, isNPC, activeTab) {
  _clearHideTimer();

  // Re-use existing panel for same actor
  if (_activePanel && _activePanel.dataset.actorId === actor.id) {
    if (activeTab) _switchTab(_activePanel, activeTab);
    return;
  }

  _removePanel();

  const menu = _buildMenuData(actor, isNPC);
  const { tabA, tabB, tabC, itemsA, itemsB, itemsC } = menu;
  const hasA = itemsA && itemsA.length > 0;
  const hasB = itemsB && itemsB.length > 0;
  const hasC = itemsC && itemsC.length > 0;
  const startTab = activeTab ?? (hasA ? "a" : hasB ? "b" : "c");

  const renderItems = (items) => items && items.length
    ? items.map(it => {
        const dataAttrs = [
          it.itemId       ? `data-item-id="${it.itemId}"`         : "",
          it.attackType   ? `data-attack-type="${it.attackType}"` : "",
        ].filter(Boolean).join(" ");
        // Weapon entries get a small left-side icon so melee vs ranged
        // is visible at a glance (especially helpful for thrown weapons
        // that appear in both variants).
        const typeIcon = it.kind === "weapon" && it.attackType
          ? (it.attackType === "ranged"
              ? `<i class="fas fa-crosshairs sde-strip-panel-type sde-strip-panel-type-ranged" title="Ranged"></i>`
              : `<i class="fas fa-swords sde-strip-panel-type sde-strip-panel-type-melee" title="Melee"></i>`)
          : "";
        return `<button type="button" class="sde-strip-panel-item" data-kind="${it.kind}" ${dataAttrs}>
          ${typeIcon}<span class="sde-strip-panel-name">${it.label}</span>${it.dmg}
        </button>`;
      }).join("")
    : `<div class="sde-strip-panel-empty">None</div>`;

  const panel = document.createElement("div");
  panel.className = "sde-strip-action-panel";
  panel.dataset.actorId = actor.id;
  panel.dataset.tokenId = cardWrap.querySelector(".sde-strip-member")?.dataset.tokenId ?? "";
  panel.innerHTML = `
    <div class="sde-strip-panel-tabs">
      ${hasA ? `<button class="sde-strip-ptab ${startTab === "a" ? "sde-strip-ptab-active" : ""}" data-tab="a">${tabA}</button>` : ""}
      ${hasB ? `<button class="sde-strip-ptab ${startTab === "b" ? "sde-strip-ptab-active" : ""}" data-tab="b">${tabB}</button>` : ""}
      ${hasC ? `<button class="sde-strip-ptab ${startTab === "c" ? "sde-strip-ptab-active" : ""}" data-tab="c">${tabC}</button>` : ""}
    </div>
    ${hasA ? `<div class="sde-strip-panel-body" data-panel="a" style="${startTab !== "a" ? "display:none" : ""}">${renderItems(itemsA)}</div>` : ""}
    ${hasB ? `<div class="sde-strip-panel-body" data-panel="b" style="${startTab !== "b" ? "display:none" : ""}">${renderItems(itemsB)}</div>` : ""}
    ${hasC ? `<div class="sde-strip-panel-body" data-panel="c" style="${startTab !== "c" ? "display:none" : ""}">${renderItems(itemsC)}</div>` : ""}`;

  stripEl.appendChild(panel);
  _activePanel = panel;

  _positionPanel(panel, cardWrap, stripEl);

  // Tab switching
  panel.querySelectorAll(".sde-strip-ptab").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); _switchTab(panel, btn.dataset.tab); });
  });

  // Item clicks
  panel.querySelectorAll(".sde-strip-panel-item").forEach(item => {
    item.addEventListener("click", async e => {
      e.stopPropagation();
      const tokenId = panel.dataset.tokenId;
      const token = tokenId ? canvas.tokens?.get(tokenId) : null;
      const resolvedActor = token?.actor ?? game.actors.get(actor.id);
      if (!resolvedActor?.isOwner) {
        ui.notifications.warn("You don't control this character.");
        return;
      }
      await _onItemClick(resolvedActor, item.dataset.kind, item.dataset.itemId, {
        attackType: item.dataset.attackType,
      });
      _removePanel();
    });
  });

  // Keep panel alive while hovering it
  panel.addEventListener("mouseenter", _clearHideTimer);
  panel.addEventListener("mouseleave", _scheduleHide);
}

function _switchTab(panel, tab) {
  panel.querySelectorAll(".sde-strip-ptab").forEach(b => b.classList.toggle("sde-strip-ptab-active", b.dataset.tab === tab));
  panel.querySelectorAll(".sde-strip-panel-body").forEach(b => b.style.display = b.dataset.panel === tab ? "block" : "none");
}

function _positionPanel(panel, cardWrap, stripEl) {
  const wrapRect = cardWrap.getBoundingClientRect();
  const stripRect = stripEl.getBoundingClientRect();
  // Position relative to strip (which is position:relative)
  const left = wrapRect.left - stripRect.left;
  const top = wrapRect.bottom - stripRect.top + 2;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

// ─── Item Click Dispatch ──────────────────────────────────────────────────────

async function _onItemClick(actor, kind, itemId, opts = {}) {
  if (!itemId) return;
  const item = actor.items.get(itemId);
  if (!item) return;
  try {
    switch (kind) {
      case "npc-attack":
        // Shadowdark NPC attacks: prefer actor.rollAttack, fall back to system.rollAttack, else open the item sheet
        if (typeof actor.rollAttack === "function") {
          return await actor.rollAttack(itemId);
        }
        if (typeof actor.system?.rollAttack === "function") {
          return await actor.system.rollAttack(itemId);
        }
        return item.sheet.render(true);

      case "weapon": {
        // PC rollAttack takes a UUID. For thrown weapons we may pass an
        // attack-variant override (melee vs ranged) so the system's roll
        // generator picks the right ability mod + range.
        if (typeof actor.system?.rollAttack === "function") {
          const config = {};
          if (opts?.attackType) config.attack = { type: opts.attackType };
          return await actor.system.rollAttack(item.uuid, config);
        }
        return item.sheet.render(true);
      }

      case "spell":
        // PC castSpell takes a UUID (uses fromUuid internally), not an ID.
        if (typeof actor.system?.castSpell === "function") {
          return await actor.system.castSpell(item.uuid);
        }
        return item.sheet.render(true);

      case "ability":
        // PC talents / class abilities — system.useAbility takes a UUID.
        // Passive talents (e.g. "Ambitious") fall through to item.displayCard;
        // active ones (e.g. Avorn's "Petrifying Gaze") trigger their roll/check.
        if (typeof actor.system?.useAbility === "function") {
          return await actor.system.useAbility(item.uuid);
        }
        if (typeof actor.useAbility === "function") {
          return await actor.useAbility(item.id);
        }
        return item.sheet.render(true);

      case "npc-feature":
      default:
        return item.sheet.render(true);
    }
  } catch (err) {
    console.error(`${MODULE_ID} | Action fire error (${kind}):`, err);
    ui.notifications.error("Action failed — check console.");
  }
}

// ─── Event Binding ────────────────────────────────────────────────────────────

/**
 * Call this after each strip render. Attaches hover listeners to
 * .sde-strip-card-wrap elements that have a tab strip.
 */
export function bindActionMenuEvents(stripEl) {
  if (!stripEl) return;

  stripEl.querySelectorAll(".sde-strip-card-wrap[data-has-menu]").forEach(wrap => {
    const actorId = wrap.dataset.actorId;
    const isNPC = wrap.dataset.isNpc === "1";
    const member = wrap.querySelector(".sde-strip-member");
    const actor = (() => {
      const tokenId = member?.dataset.tokenId;
      const token = tokenId ? canvas.tokens?.get(tokenId) : null;
      return token?.actor ?? game.actors.get(actorId);
    })();
    if (!actor) return;

    const showMenu = () => _showPanel(stripEl, wrap, actor, isNPC, null);

    wrap.addEventListener("mouseenter", showMenu);
    wrap.addEventListener("mouseleave", _scheduleHide);

    // Tab clicks inside the tab strip also trigger correct tab
    wrap.querySelectorAll(".sde-strip-atab").forEach(btn => {
      btn.addEventListener("mouseenter", () => _showPanel(stripEl, wrap, actor, isNPC, btn.dataset.tab));
    });
  });
}

/**
 * Close any open menu — called on combat turn change.
 */
export function closeActionMenu() {
  _clearHideTimer();
  _removePanel();
}
