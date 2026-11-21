/**
 * The combat splash: when a combat starts, both sides line up in turn order on
 * every screen for a few seconds, the same monster counted once with ×N.
 * Each client draws its own from what its user may see, so a player's splash
 * leaves out the hidden combatants their strip leaves out.
 *
 * Idea from Roll Call's VS screen (github.com/Sayshal/roll-call, MIT).
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { combatantEntry, isHiddenFromStrip } from "./turn-skip-core.mjs";
import { vsGroupKey, vsTiles } from "./strip-layout-core.mjs";
import { stripLayout } from "./crawl-strip.mjs";

const SHOW_MS = 6500;
const LEAVE_MS = 300;

/** The splash's tiles for this user: what the strip would show them. */
function tilesFor(combat) {
  const { art } = stripLayout();
  const entries = (combat.turns ?? [])
    .filter((c) => c.actor && !isHiddenFromStrip(combatantEntry(c)))
    .filter((c) => game.user.isGM || !(c.hidden || c.token?.hidden))
    .map((c) => {
      const isPlayer = c.actor.type === "Player";
      const disposition = c.token?.disposition;
      return {
        name: c.token?.name ?? c.name,
        img: (art === "portrait" ? c.actor.img : c.img) || c.img || c.actor.img,
        initiative: c.initiative,
        ally: isPlayer || disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY,
        groupKey: vsGroupKey({ isPlayer, actorId: c.actorId, disposition, initiative: c.initiative }),
      };
    });
  return vsTiles(entries);
}

const tileHTML = (t, i) => `
  <div class="sde-vs-tile" style="--sde-vs-i:${i}">
    <img src="${esc(t.img)}" alt="">
    <span class="sde-vs-name">${esc(t.name)}${t.count > 1 ? ` <span class="sde-vs-count">×${t.count}</span>` : ""}</span>
    ${t.initiative != null ? `<span class="sde-vs-init">${esc(t.initiative)}</span>` : ""}
  </div>`;

function show(combat) {
  const { allies, enemies } = tilesFor(combat);
  if (!allies.length || !enemies.length) return;
  document.querySelector(".sde-vs")?.remove();
  const el = document.createElement("div");
  el.className = "sde-ui sde-vs";
  el.innerHTML = `
    <div class="sde-vs-side sde-vs-allies">${allies.map(tileHTML).join("")}</div>
    <div class="sde-vs-mark">${esc(game.i18n.localize("SDE.combat.vsMark"))}</div>
    <div class="sde-vs-side sde-vs-enemies">${enemies.map(tileHTML).join("")}</div>`;
  let timer = null;
  const leave = () => {
    clearTimeout(timer);
    el.classList.add("sde-vs-leaving");
    setTimeout(() => el.remove(), LEAVE_MS);
  };
  el.addEventListener("click", leave);
  document.body.append(el);
  timer = setTimeout(leave, SHOW_MS);
}

export function registerVsScreen() {
  // Round 0 to round 1 is the moment a combat begins, on every client.
  Hooks.on("combatTurnChange", (combat, prior, current) => {
    if (prior?.round !== 0 || current?.round !== 1) return;
    if (combat !== game.combat || !game.settings.get(MODULE_ID, "combatVsScreen")) return;
    show(combat);
  });
}
