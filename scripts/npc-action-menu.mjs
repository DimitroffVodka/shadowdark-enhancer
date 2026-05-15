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

function _buildPcWeapons(actor) {
  return (actor.items?.contents ?? [])
    .filter(i => i.type === "Weapon" && i.system?.equipped)
    .map(item => ({
      label: item.name || "Unnamed",
      dmg: _weaponDmgLabel(item),
      itemId: item.id,
      kind: "weapon",
    }));
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
    itemsA: _buildPcWeapons(actor),
    itemsB: _buildPcSpells(actor),
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
  const { tabA, tabB, itemsA, itemsB } = menu;
  const hasA = itemsA.length > 0;
  const hasB = itemsB.length > 0;
  if (!hasA && !hasB) return "";
  return `
    <div class="sde-strip-action-tabs" data-actor-id="${actor.id}">
      ${hasA ? `<button class="sde-strip-atab sde-strip-atab-active" data-tab="a">${tabA}</button>` : ""}
      ${hasB ? `<button class="sde-strip-atab ${!hasA ? "sde-strip-atab-active" : ""}" data-tab="b">${tabB}</button>` : ""}
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
  const { tabA, tabB, itemsA, itemsB } = menu;
  const startTab = activeTab ?? (itemsA.length ? "a" : "b");

  const renderItems = (items) => items.length
    ? items.map(it => {
        const dataAttrs = it.itemId ? `data-item-id="${it.itemId}"` : "";
        return `<button type="button" class="sde-strip-panel-item" data-kind="${it.kind}" ${dataAttrs}>
          <span class="sde-strip-panel-name">${it.label}</span>${it.dmg}
        </button>`;
      }).join("")
    : `<div class="sde-strip-panel-empty">None</div>`;

  const panel = document.createElement("div");
  panel.className = "sde-strip-action-panel";
  panel.dataset.actorId = actor.id;
  panel.dataset.tokenId = cardWrap.querySelector(".sde-strip-member")?.dataset.tokenId ?? "";
  panel.innerHTML = `
    <div class="sde-strip-panel-tabs">
      ${itemsA.length ? `<button class="sde-strip-ptab ${startTab === "a" ? "sde-strip-ptab-active" : ""}" data-tab="a">${tabA}</button>` : ""}
      ${itemsB.length ? `<button class="sde-strip-ptab ${startTab === "b" ? "sde-strip-ptab-active" : ""}" data-tab="b">${tabB}</button>` : ""}
    </div>
    ${itemsA.length ? `<div class="sde-strip-panel-body" data-panel="a" style="${startTab !== "a" ? "display:none" : ""}">${renderItems(itemsA)}</div>` : ""}
    ${itemsB.length ? `<div class="sde-strip-panel-body" data-panel="b" style="${startTab !== "b" ? "display:none" : ""}">${renderItems(itemsB)}</div>` : ""}`;

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
      await _onItemClick(resolvedActor, item.dataset.kind, item.dataset.itemId);
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

async function _onItemClick(actor, kind, itemId) {
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

      case "weapon":
        if (typeof actor.system?.rollAttack === "function") {
          return await actor.system.rollAttack(itemId);
        }
        return item.sheet.render(true);

      case "spell":
        if (typeof actor.system?.castSpell === "function") {
          return await actor.system.castSpell(itemId);
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
