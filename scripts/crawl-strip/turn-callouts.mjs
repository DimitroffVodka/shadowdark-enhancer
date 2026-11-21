/**
 * Combat turn callouts: pan to the turn that starts, tell a player their
 * character is up next, and mark the next token on the map with UP NEXT.
 *
 * Ideas from Roll Call's turn reminders (github.com/Sayshal/roll-call, MIT).
 * "Next" follows the strip's own skip rule (nextLiveTurn), so a dead monster
 * whose turn is about to be skipped is never announced.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { combatantEntry, isTurnless } from "./turn-skip-core.mjs";
import { nextLiveTurn } from "./strip-layout-core.mjs";

const setting = (key) => game.settings.get(MODULE_ID, key);

/** The SDE kit's colours and title face for this theme, read off a hidden `sde-ui` element (the canvas can't use CSS tokens). */
function kitStyle() {
  const probe = document.body.appendChild(document.createElement("div"));
  probe.className = "sde-ui";
  probe.hidden = true;
  const css = getComputedStyle(probe);
  const color = (name, fallback) => new PIXI.Color(css.getPropertyValue(name).trim() || fallback).toNumber();
  const style = {
    page: color("--ui-page", "#000"), frame: color("--ui-frame", "#c9c9c9"),
    text: color("--ui-text", "#fff"), gold: color("--ui-gold", "#c9aa58"),
    // A custom property comes back unresolved, so a var() fallback inside it is swapped for plain serif.
    title: (css.getPropertyValue("--ui-title").trim() || '"JSL Blackletter", serif').replace(/var\([^)]*\)\)?/g, "serif"),
  };
  probe.remove();
  return style;
}

/** The combatant who acts after the current one, or null. */
export function nextCombatant(combat) {
  if (!combat?.started) return null;
  const turns = combat.turns ?? [];
  const index = nextLiveTurn(turns.map(combatantEntry), combat.turn);
  return index == null ? null : turns[index];
}

/**
 * A combatant this user may know about: the GM knows them all, a player none
 * that is hidden, by its combatant flag or its token's (the strip and the
 * splash use the same two; hidden-sync copies one to the other a moment later).
 */
export const knownTo = (user, combatant) => !!combatant
  && (user?.isGM === true || (!combatant.hidden && !combatant.token?.hidden));
const known = (combatant) => knownTo(game.user, combatant);

/** "My" turn: a player's own character, or for the GM any combatant no player owns. */
const isMine = (combatant) => (game.user.isGM ? !combatant.hasPlayerOwner : combatant.isOwner);

let marker = null;
let lastAlert = null;

function clearMarker() {
  if (marker && !marker.destroyed) marker.destroy({ children: true });
  marker = null;
}

/** Hang the UP NEXT tag and arc on the next combatant's token; a child of the token, so it hides with it. */
function drawMarker() {
  if (!canvas.ready) return;
  const combat = game.combat;
  const next = setting("combatUpNext") ? nextCombatant(combat) : null;
  const token = known(next) && next !== combat?.combatant ? next.token?.object : null;
  if (!token) return clearMarker();
  if (marker && !marker.destroyed && marker.parent === token) return;
  clearMarker();
  marker = new PIXI.Container();
  marker.eventMode = "none";

  // The kit's look: a black plate with a silver frame and a white blackletter title; gold only on the arc, the selection.
  const kit = kitStyle();
  const radius = token.externalRadius * 1.08;
  const arc = marker.addChild(new PIXI.Graphics());
  arc.lineStyle({ width: Math.max(2, radius * 0.05), color: kit.gold, alpha: 1, cap: PIXI.LINE_CAP.ROUND });
  arc.arc(0, 0, radius, Math.PI * 0.2, Math.PI * 0.8);
  arc.position.set(token.w / 2, token.h / 2);

  const { PreciseText } = foundry.canvas.containers;
  const text = new PreciseText(game.i18n.localize("SDE.combat.upNext"),
    PreciseText.getTextStyle({ fontFamily: kit.title, fontSize: 20, fill: kit.text, strokeThickness: 0, dropShadow: false }));
  text.anchor.set(0.5, 1);
  text.y = -3;
  const width = text.width + 18;
  const height = text.height + 6;
  const plate = new PIXI.Graphics().lineStyle(1, kit.frame, 1).beginFill(kit.page, 1)
    .drawRoundedRect(-width / 2, -height, width, height, 2).endFill();
  const tag = marker.addChild(new PIXI.Container());
  tag.addChild(plate, text);
  tag.position.set(token.w / 2, 0);
  tag.scale.set((canvas.dimensions.uiScale ?? 1) * Math.max(1, token.document.width));

  token.addChild(marker);
}

/** A banner that slides in at the top of the screen and removes itself when its animation ends. */
export function showBanner(title, subtitle, img, waited = 0) {
  // The first turn's banner would land on the combat splash: wait for it to close (it lasts about 7 s).
  if (document.querySelector(".sde-vs") && waited < 10000) {
    setTimeout(() => showBanner(title, subtitle, img, waited + 250), 250);
    return;
  }
  document.querySelector(".sde-callout-banner")?.remove();
  const el = document.createElement("div");
  el.className = "sde-ui sde-callout-banner";
  el.setAttribute("role", "status");
  el.innerHTML = `${img ? `<img src="${esc(img)}" alt="">` : ""}
    <div><div class="sde-callout-title">${esc(title)}</div>${subtitle ? `<div class="sde-callout-sub">${esc(subtitle)}</div>` : ""}</div>`;
  el.addEventListener("click", () => el.remove());
  el.addEventListener("animationend", () => el.remove(), { once: true });
  document.body.append(el);
}

function onTurnChange(combat) {
  if (!combat?.started || combat !== game.combat) return;
  const current = combat.combatant;
  // A turn the strip skips (a dead monster) is about to be advanced past: say nothing for it.
  if (!current || isTurnless(combatantEntry(current))) return;

  const pan = setting("crawlStripPanToTurn");
  const token = current.token?.object;
  if (token && known(current) && (pan === "all" || (pan === "mine" && isMine(current)))) {
    canvas.animatePan({ x: token.center.x, y: token.center.y });
  }

  if (game.user.isGM || !setting("combatUpNext")) return;
  const next = nextCombatant(combat);
  if (!next?.isOwner || next === current) return;
  const key = `${combat.id}:${combat.round}:${combat.turn}:${next.id}`;
  if (key === lastAlert) return;
  lastAlert = key;
  const subtitle = known(current)
    ? game.i18n.format("SDE.combat.upNextFor", { name: next.name, current: current.name })
    : next.name;
  // After this hook pass, so a combat splash opened by the same turn change is already up to wait for.
  queueMicrotask(() => showBanner(game.i18n.localize("SDE.combat.upNext"), subtitle, next.img));
}

export function registerTurnCallouts() {
  Hooks.on("combatTurnChange", onTurnChange);
  const redraw = foundry.utils.debounce(drawMarker, 50);
  for (const hook of ["canvasReady", "updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant", "updateActor"]) {
    Hooks.on(hook, redraw);
  }
  Hooks.on("refreshToken", (token, flags) => {
    if (flags.refreshSize && marker?.parent === token) { clearMarker(); redraw(); }
  });
}
