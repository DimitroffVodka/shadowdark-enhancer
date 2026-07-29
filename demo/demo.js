/*
 * Behaviour for the demo page.
 *
 * Everything here fakes an interaction the module performs for real. Where the
 * module reads a document, rolls dice or writes a setting, this file swaps in a
 * canned value. Nothing persists and nothing is simulated.
 *
 * Each panel's setup is guarded on its own root element, so panels can be
 * added or removed from index.html without touching this file's entry point.
 */

"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ══ Theme toggle ═══════════════════════════════════════════════════════════
 * The module ships 77 `body.theme-light` rules, so Foundry's own theme class
 * is all that is needed -- the palette swap is the module's, not the demo's.
 */

function setupTheme() {
  const btn = $('[data-demo="theme"]');
  if (!btn) return;
  const label = $('[data-demo="theme-label"]', btn);
  btn.addEventListener("click", () => {
    const light = document.body.classList.toggle("theme-light");
    document.body.classList.toggle("theme-dark", !light);
    label.textContent = light ? "Dark theme" : "Light theme";
  });
}

/* ══ Crawl strip ════════════════════════════════════════════════════════════ */

/**
 * Canned action lists, keyed by the card's data-actor-id then by tab.
 * Shapes match what npc-action-menu.mjs builds from real items:
 * weapons carry an attack type, spells a tier, abilities neither.
 */
const STRIP_ACTIONS = {
  eliara: {
    a: [
      { type: "melee", name: "Staff", dmg: "(Close) +1 1d4" },
      { type: "ranged", name: "Dagger (thrown)", dmg: "(Near) +4 1d4" },
      { type: "melee", name: "Dagger", dmg: "(Close) +1 1d4" },
    ],
    b: [
      { name: "Magic Missile", dmg: "T1 force" },
      { name: "Burning Hands", dmg: "T1 fire" },
      { name: "Detect Magic", dmg: "T1" },
      { name: "Mirror Image", dmg: "T2" },
    ],
    c: [{ name: "Learning Spells", dmg: "" }],
  },
  bazogo: {
    a: [
      { type: "melee", name: "Bastard sword", dmg: "(Close) +5 1d10" },
      { type: "ranged", name: "Javelin", dmg: "(Far) +3 1d6" },
    ],
    c: [
      { name: "Weapon Mastery", dmg: "" },
      { name: "Grit", dmg: "" },
      { name: "Hauler", dmg: "" },
    ],
  },
  willow: {
    a: [
      { type: "melee", name: "Shortsword", dmg: "(Close) +4 1d6" },
      { type: "ranged", name: "Shortbow", dmg: "(Far) +5 1d4" },
    ],
    c: [
      { name: "Backstab", dmg: "" },
      { name: "Thievery", dmg: "" },
      { name: "Stealthy", dmg: "" },
    ],
  },
  troana: {
    a: [{ type: "melee", name: "Mace", dmg: "(Close) +2 1d6" }],
    b: [
      { name: "Cure Wounds", dmg: "T1" },
      { name: "Turn Undead", dmg: "T1" },
      { name: "Hold Person", dmg: "T2" },
    ],
    c: [{ name: "Farsight", dmg: "" }],
  },
  goblin: {
    // NPC attacks carry a ×N prefix for multiattacks, the way the module
    // renders them from a statblock.
    a: [
      { type: "melee", name: "×2 Shortsword", dmg: "(Close) +1 1d6" },
      { type: "ranged", name: "Sling", dmg: "(Near) +2 1d4" },
    ],
    c: [{ name: "Keen Senses", dmg: "" }],
  },
};

/**
 * One row of the dropdown.
 *
 * The melee glyph is fa-khanda, not the module's fa-swords: that one is Font
 * Awesome *Pro*, which Foundry bundles but the free kit does not have, so it
 * would render as a blank box here. Keeping it an <i> rather than swapping in
 * an SVG matters -- .sde-strip-panel-type-melee colours it via `color`, which
 * an <img> would ignore. tools/demo/check-glyphs.mjs guards this.
 */
function actionRow(item) {
  let icon = "";
  if (item.type === "ranged") {
    icon = '<i class="fas fa-crosshairs sde-strip-panel-type sde-strip-panel-type-ranged" title="Ranged"></i>';
  } else if (item.type === "melee") {
    icon = '<i class="fas fa-khanda sde-strip-panel-type sde-strip-panel-type-melee" title="Melee"></i>';
  }
  const dmg = item.dmg ? `<span class="sde-strip-menu-dmg">${item.dmg}</span>` : "";
  return `<button type="button" class="sde-strip-panel-item" data-kind="${item.type ? "weapon" : "other"}">${icon}<span class="sde-strip-panel-name">${item.name}</span>${dmg}</button>`;
}

function setupCrawlStrip() {
  const strip = $("#shadowdark-enhancer-strip");
  if (!strip) return;

  let panel = null;
  let hideTimer = null;

  const clearHide = () => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  };

  const removePanel = () => {
    clearHide();
    if (panel) { panel.remove(); panel = null; }
  };

  /** Mirror npc-action-menu.mjs: append to the strip root, offset from the card. */
  function showPanel(wrap, startTab) {
    removePanel();
    const actorId = wrap.dataset.actorId;
    const actions = STRIP_ACTIONS[actorId];
    if (!actions) return;

    // Tab labels come from the card's own tab strip, so the two never diverge.
    const tabs = $$(".sde-strip-atab", wrap).map((b) => ({ key: b.dataset.tab, label: b.textContent.trim() }));
    if (!tabs.length) return;
    const active = tabs.some((t) => t.key === startTab) ? startTab : tabs[0].key;

    const tabHtml = tabs
      .map((t) => `<button class="sde-strip-ptab ${t.key === active ? "sde-strip-ptab-active" : ""}" data-tab="${t.key}">${t.label}</button>`)
      .join("");

    const bodyHtml = tabs
      .map((t) => {
        const items = actions[t.key] ?? [];
        const rows = items.length
          ? items.map(actionRow).join("")
          : '<div class="sde-strip-panel-empty">None</div>';
        return `<div class="sde-strip-panel-body" data-panel="${t.key}" style="${t.key !== active ? "display:none" : ""}">${rows}</div>`;
      })
      .join("");

    panel = document.createElement("div");
    panel.className = "sde-strip-action-panel";
    panel.dataset.actorId = actorId;
    panel.innerHTML = `<div class="sde-strip-panel-tabs">${tabHtml}</div>${bodyHtml}`;

    const stripRect = strip.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    panel.style.left = `${wrapRect.left - stripRect.left}px`;
    panel.style.top = `${wrapRect.bottom - stripRect.top + 2}px`;
    strip.appendChild(panel);

    // Moving the pointer off the card and onto the panel must not close it.
    panel.addEventListener("mouseenter", clearHide);
    panel.addEventListener("mouseleave", scheduleHide);

    $$(".sde-strip-ptab", panel).forEach((btn) => {
      const swap = () => {
        $$(".sde-strip-ptab", panel).forEach((b) => b.classList.toggle("sde-strip-ptab-active", b === btn));
        $$(".sde-strip-panel-body", panel).forEach((b) => {
          b.style.display = b.dataset.panel === btn.dataset.tab ? "" : "none";
        });
      };
      btn.addEventListener("mouseenter", swap);
      btn.addEventListener("click", swap);
    });
  }

  /** The module waits 200ms before tearing the panel down; so does this. */
  function scheduleHide() {
    clearHide();
    hideTimer = setTimeout(removePanel, 200);
  }

  $$(".sde-strip-card-wrap[data-has-menu]").forEach((wrap) => {
    wrap.addEventListener("mouseenter", () => showPanel(wrap, "a"));
    wrap.addEventListener("mouseleave", scheduleHide);

    // Hovering a specific tab opens the panel on that tab.
    $$(".sde-strip-atab", wrap).forEach((tab) => {
      tab.addEventListener("mouseenter", () => {
        $$(".sde-strip-atab", wrap).forEach((t) => t.classList.toggle("sde-strip-atab-active", t === tab));
        showPanel(wrap, tab.dataset.tab);
      });
    });
  });

  // Next Turn, from either the strip's chevron or the bar button.
  const turnEls = $$('[data-demo="crawl-turn"], [data-demo="bar-turn"]');
  $$('[data-action="nextCrawlTurn"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = Number(turnEls[0].textContent) + 1;
      turnEls.forEach((el) => { el.textContent = String(next); });
    });
  });

  // Luck pills tick down, because a pill that never responds reads as broken.
  $$('.sde-strip-pill[data-action="spendLuck"]').forEach((pill) => {
    pill.addEventListener("click", () => {
      const node = [...pill.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      if (!node) return;
      const left = Number(node.textContent.trim());
      if (left <= 0) return;
      node.textContent = String(left - 1);
      if (left - 1 === 0) {
        pill.classList.add("sde-strip-pill-empty");
        pill.title = "No Luck Tokens";
      }
    });
  });

  // Torches go out and relight.
  $$('.sde-strip-light-badge[data-action="toggleLight"]').forEach((badge) => {
    badge.addEventListener("click", () => {
      const lit = badge.classList.toggle("sde-strip-light-lit");
      badge.classList.toggle("sde-strip-light-off", !lit);
      badge.title = lit ? "Torch is lit — 60 min left · click to put out" : "No light source lit · click to light a torch";
    });
  });
}

/* ══ Encounter roller ═══════════════════════════════════════════════════════
 * Pressing Roll cycles canned results rather than drawing from a table. The
 * facet values are real lookups though -- DISTANCE, ACTIVITY and reactionBand
 * in scripts/encounter/encounter-result.mjs -- so nothing here contradicts
 * what the module would actually produce for the same dice.
 */

const DISTANCE = { 1: "Close", 2: "Near", 3: "Near", 4: "Near", 5: "Far", 6: "Far" };
const ACTIVITY = {
  2: "Hunting", 3: "Hunting", 4: "Hunting",
  5: "Eating", 6: "Eating",
  7: "Building/nesting", 8: "Building/nesting",
  9: "Socializing/playing", 10: "Socializing/playing",
  11: "Guarding", 12: "Sleeping",
};

/** encounter-result.mjs:26 — kept identical so rerolls stay self-consistent. */
function reactionBand(total) {
  if (total <= 6) return "Hostile";
  if (total <= 8) return "Suspicious";
  if (total === 9) return "Neutral";
  if (total <= 11) return "Curious";
  return "Friendly";
}

const ENCOUNTERS = [
  { kind: "monster", name: "Goblin Scouts", count: 3, img: "goblin.webp", distance: 2, activity: 4, reaction: 5 },
  { kind: "monster", name: "Kobold Trappers", count: 5, img: "kobold.webp", distance: 5, activity: 9, reaction: 9 },
  { kind: "flavor", text: "A cold wind carries woodsmoke from somewhere ahead." },
  { kind: "monster", name: "Half-Orc Marauders", count: 2, img: "half-orc.webp", distance: 1, activity: 12, reaction: 11 },
  { kind: "monster", name: "Elf Wayfarers", count: 2, img: "elf.webp", distance: 4, activity: 7, reaction: 12 },
];

function setupEncounter() {
  const panel = $('[data-demo="encounter-result"]');
  if (!panel) return;

  let index = 0;
  let chaMod = 1;
  let current = { ...ENCOUNTERS[0] };

  const facet = (icon, label, roll, text, key, bandClass = "") => `
    <div class="sde-facet-row">
      <span class="sde-facet-label"><i class="fas ${icon}"></i> ${label}</span>
      <span class="sde-facet-roll">${roll}</span>
      <span class="sde-facet-arrow">→</span>
      <span class="sde-facet-result ${bandClass}">${text}</span>
      <button type="button" class="sde-reroll-btn" data-action="reroll" data-facet="${key}" title="Reroll ${label.toLowerCase()}" aria-label="Reroll ${label.toLowerCase()}"><i class="fas fa-sync"></i></button>
    </div>`;

  function render() {
    if (current.kind === "flavor") {
      panel.innerHTML = `
        <div class="sde-result-card sde-result-flavor">
          <header class="sde-card-header">
            <h3>Environmental Result</h3>
            <div class="sde-header-actions">
              <button type="button" data-action="postToChat" title="Post to Chat"><i class="fas fa-clipboard-list"></i> Post</button>
            </div>
          </header>
          <div class="sde-flavor-text">${current.text}</div>
        </div>`;
      return;
    }

    const band = reactionBand(current.reaction + chaMod);
    panel.innerHTML = `
      <div class="sde-result-card">
        <header class="sde-card-header">
          <h3>Encounter Result</h3>
          <div class="sde-header-actions">
            <button type="button" data-action="postToChat" title="Post to Chat"><i class="fas fa-clipboard-list"></i> Post</button>
            <button type="button" data-action="placeTokens" title="Place Tokens"><i class="fas fa-bullseye"></i> Place</button>
          </div>
        </header>
        <div class="sde-monster-row">
          <img src="modules/shadowdark-enhancer/assets/ancestries/${current.img}" width="48" height="48" alt="${current.name}" loading="lazy" decoding="async" />
          <div class="sde-monster-info">
            <span class="sde-monster-count">${current.count} ×</span>
            <span class="sde-monster-name">${current.name}</span>
          </div>
        </div>
        <div class="sde-facets">
          ${facet("fa-ruler-horizontal", "Distance", `1d6 = ${current.distance}`, DISTANCE[current.distance], "distance")}
          ${facet("fa-masks-theater", "Activity", `2d6 = ${current.activity}`, ACTIVITY[current.activity], "activity")}
          ${facet("fa-comment", "Reaction", `2d6+CHA = ${current.reaction} + (${chaMod})`, band, "reaction", band)}
        </div>
        <div class="sde-stepper-row">
          <label for="sde-cha-mod">Apply CHA mod:</label>
          <div class="sde-stepper">
            <button type="button" data-action="chaDec" aria-label="Decrease CHA mod"><i class="fas fa-caret-down"></i></button>
            <input id="sde-cha-mod" type="number" name="chaMod" value="${chaMod}" readonly aria-label="CHA modifier" />
            <button type="button" data-action="chaInc" aria-label="Increase CHA mod"><i class="fas fa-caret-up"></i></button>
          </div>
        </div>
      </div>`;
  }

  // Canned "dice": step each facet through its own range so a reroll always
  // visibly moves, instead of occasionally landing on the same face.
  const bump = (v, min, max) => (v >= max ? min : v + 1);

  panel.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-action]");
    if (!btn) return;
    const act = btn.dataset.action;
    if (act === "reroll") {
      const f = btn.dataset.facet;
      if (f === "distance") current.distance = bump(current.distance, 1, 6);
      if (f === "activity") current.activity = bump(current.activity, 2, 12);
      if (f === "reaction") current.reaction = bump(current.reaction, 2, 12);
      render();
    } else if (act === "chaInc" || act === "chaDec") {
      chaMod = Math.max(-4, Math.min(4, chaMod + (act === "chaInc" ? 1 : -1)));
      render();
    }
  });

  const roll = $('[data-action="rollTable"]');
  if (roll) {
    roll.addEventListener("click", () => {
      index = (index + 1) % ENCOUNTERS.length;
      current = { ...ENCOUNTERS[index] };
      render();
    });
  }

  render();
}

/* ══ Merchant shop ══════════════════════════════════════════════════════════
 * Search, category collapse and the wallet are all real client-side work --
 * only the inventory and the purse are invented. Coin is tracked in copper so
 * mixed denominations come out exact, which is how the module handles it.
 */

const CP_PER_SP = 10;
const CP_PER_GP = 100;

function formatPurse(cp) {
  const gp = Math.floor(cp / CP_PER_GP);
  const sp = Math.floor((cp % CP_PER_GP) / CP_PER_SP);
  return `${gp} gp ${sp} sp ${cp % CP_PER_SP} cp`;
}

function setupMerchant() {
  const shop = $(".sdems-container");
  if (!shop) return;

  const walletEl = $('[data-demo="wallet"]', shop);
  let purse = 42 * CP_PER_GP + 5 * CP_PER_SP;

  /** Grey out anything the purse can no longer cover, the way the module does. */
  function reprice() {
    walletEl.textContent = formatPurse(purse);
    $$(".sdems-item-row", shop).forEach((row) => {
      if (row.classList.contains("sdems-out-of-stock")) return;
      const cost = Math.round(Number(row.dataset.price) * CP_PER_GP);
      const qty = Number($(".sdems-qty-input", row).value) || 1;
      const afford = cost * qty <= purse;
      row.classList.toggle("sdems-cant-afford", !afford);
      $(".sdems-buy-btn", row).disabled = !afford;
    });
  }

  shop.addEventListener("click", (ev) => {
    const header = ev.target.closest(".sdems-section-header");
    if (header) {
      const section = header.closest(".sdems-shop-section");
      const collapsed = section.classList.toggle("sdems-section-collapsed");
      header.setAttribute("aria-expanded", String(!collapsed));
      return;
    }

    const buy = ev.target.closest(".sdems-buy-btn");
    if (buy && !buy.disabled) {
      const row = buy.closest(".sdems-item-row");
      const qty = Number($(".sdems-qty-input", row).value) || 1;
      purse -= Math.round(Number(row.dataset.price) * CP_PER_GP) * qty;

      // Finite stock counts down and sells out; ∞ stays as it is.
      const stock = $(".sdems-item-stock", row);
      if (stock.textContent.trim() !== "∞") {
        const left = Math.max(0, Number(stock.textContent.trim()) - qty);
        stock.textContent = String(left);
        if (left === 0) {
          row.classList.add("sdems-out-of-stock");
          stock.title = "Out of stock";
          $(".sdems-buy-btn", row).disabled = true;
        }
      }
      reprice();
    }
  });

  shop.addEventListener("input", (ev) => {
    if (ev.target.matches(".sdems-qty-input")) reprice();

    if (ev.target.matches(".sdems-search-input")) {
      const q = ev.target.value.trim().toLowerCase();
      $$(".sdems-item-row", shop).forEach((row) => {
        const name = $(".sdems-item-name", row).textContent.toLowerCase();
        row.style.display = !q || name.includes(q) ? "" : "none";
      });
      // A section whose every row is filtered out should disappear too.
      $$(".sdems-shop-section", shop).forEach((sec) => {
        const any = $$(".sdems-item-row", sec).some((r) => r.style.display !== "none");
        sec.style.display = any ? "" : "none";
      });
    }
  });

  shop.addEventListener("change", (ev) => {
    if (!ev.target.matches(".sdems-category-select")) return;
    const cat = ev.target.value;
    $$(".sdems-shop-section", shop).forEach((sec) => {
      const secCat = $(".sdems-item-cat", sec)?.textContent.trim();
      sec.style.display = cat === "all" || secCat === cat ? "" : "none";
    });
  });

  reprice();
}

/* ══ Session recap ══════════════════════════════════════════════════════════
 * Pure presentation, so the only behaviour is switching tabs and expanding an
 * encounter. The real window re-renders per tab; showing and hiding sections
 * looks identical and keeps the canned content in the markup where it is
 * easier to read.
 */

function setupRecap() {
  const recap = $(".sde-session-recap");
  if (!recap) return;

  recap.addEventListener("click", (ev) => {
    const tab = ev.target.closest('.sr-tab[data-tab]');
    if (tab) {
      $$(".sr-tab", recap).forEach((t) => t.classList.toggle("active", t === tab));
      $$(".sr-section[data-panel]", recap).forEach((s) => {
        s.hidden = s.dataset.panel !== tab.dataset.tab;
      });
      return;
    }

    const head = ev.target.closest('[data-action="toggleEncounter"]');
    if (head) {
      const body = head.nextElementSibling;
      body.hidden = !body.hidden;
      const caret = $("i", head);
      caret.classList.toggle("fa-chevron-down", !body.hidden);
      caret.classList.toggle("fa-chevron-right", body.hidden);
    }
  });
}

/* ══ Character builder ══════════════════════════════════════════════════════
 * Only step 1 is live. "Roll Abilities" fills the six tiles with a fixed
 * array rather than rolling, so the demo reads the same for everyone; the
 * modifiers are computed with Shadowdark's own floor((score - 10) / 2).
 */

const CB_ROLLS = { str: 13, dex: 16, con: 12, int: 9, wis: 14, cha: 11 };

const abilityMod = (score) => Math.floor((score - 10) / 2);
const signed = (n) => (n >= 0 ? `+${n}` : String(n));

function setupCharBuilder() {
  const cb = $(".sde-cb");
  if (!cb) return;

  const rollBtn = $('[data-action="cb-roll-stats"]', cb);
  const resetBtn = $('[data-action="cb-reset-stats"]', cb);
  const rollLabel = $('[data-demo="cb-roll-label"]', cb);
  const foot = $('[data-demo="cb-foot"]', cb);
  let rolled = false;

  function paint() {
    let total = 0;
    $$('[data-demo="tile"]', cb).forEach((tile) => {
      const val = $(".tile-val", tile);
      const mod = $(".tile-mod", tile);
      if (!rolled) {
        val.innerHTML = '<span class="ph">–</span>';
        mod.textContent = "";
        tile.classList.add("empty");
        tile.classList.remove("filled");
        return;
      }
      const score = CB_ROLLS[tile.dataset.abil];
      total += score;
      val.textContent = String(score);
      mod.textContent = signed(abilityMod(score));
      tile.classList.remove("empty");
      tile.classList.add("filled");
    });

    rollLabel.textContent = rolled ? "Roll Again" : "Roll Abilities";
    resetBtn.hidden = !rolled;
    foot.innerHTML = rolled
      ? `<p class="sde-cb-stats-total">Total: <b>${total}</b></p>
         <p class="sde-cb-hint ok"><i class="fa-solid fa-check"></i> All six abilities set.</p>`
      : "";
  }

  rollBtn.addEventListener("click", () => { rolled = true; paint(); });
  resetBtn.addEventListener("click", () => { rolled = false; paint(); });

  // The step rail is inert -- only Abilities exists here -- but a tab that
  // does not even highlight reads as broken, so let it take the active mark.
  $$(".sde-cb-tab", cb).forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".sde-cb-tab", cb).forEach((t) => t.classList.toggle("active", t === tab));
    });
  });

  paint();
}

/* ══ Boot ═══════════════════════════════════════════════════════════════════ */

function init() {
  setupTheme();
  setupCrawlStrip();
  setupEncounter();
  setupMerchant();
  setupRecap();
  setupCharBuilder();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
