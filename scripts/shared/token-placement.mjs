/**
 * Click-to-place token placement, over a queue of different creatures.
 *
 * The Encounter Roller places N of ONE monster; a pit fight draws a row that can
 * name two different creatures with their own counts ("2 hero | 2 lion"), so the
 * loop here walks a QUEUE and says which creature the next click drops. That is
 * the only behavioural difference, and it is why this is a queue module rather
 * than a call into the roller's own placer.
 *
 * WHY DOM EVENTS AND NOT PIXI. Foundry's PIXI v7+ federated-event API replaced
 * the old `event.data.getLocalPosition()`, and the replacement interacts poorly
 * with layered canvas children — TokenLayer can take the click first. A
 * capture-phase `pointerdown` on the document gets first refusal, and Foundry
 * already tracks world coordinates on `canvas.mousePosition`, so no coordinate
 * maths is needed. This mirrors the approach proven in the Encounter Roller.
 *
 * ART. Delegated wholesale to shared/art-utils.mjs. Some compendium NPCs carry
 * the default mystery-man on `prototypeToken.texture.src` while the real
 * illustration sits on `actor.img`, and community token modules supply art
 * through mappings that are applied at render time and are invisible to a plain
 * `actor.img` read — so the best texture has to be chosen explicitly.
 */

import {
  _bestArtForActor,
  _firstNonPlaceholder,
  _getCompendiumArtFor,
  _isPlaceholderArt,
} from "./art-utils.mjs";

/**
 * Get a world actor for a possibly-compendium one.
 *
 * Foundry does not track tokens against compendium actors — a token's `actorId`
 * has to name a world actor — so a compendium entry is imported once and reused
 * by name and type thereafter. Reuse is deliberate: placing the same monster
 * across three sessions should not leave three copies in the sidebar.
 *
 * A reused copy gets a one-shot art repair, because a world copy imported before
 * a community-tokens mapping finished loading was created holding placeholder
 * art. Only fields that are STILL placeholders are touched, so a GM who set
 * their own portrait keeps it.
 *
 * @param {Actor} actor  a world or compendium actor
 * @returns {Promise<Actor|null>} the world actor to hang tokens off
 */
export async function worldActorFor(actor) {
  if (!actor) return null;
  if (!actor.pack) return actor;

  const compendiumActor = actor;
  const compendiumArt = _getCompendiumArtFor(compendiumActor);

  const existing = game.actors.find(
    (a) => a.type === compendiumActor.type && a.name === compendiumActor.name,
  );
  if (!existing) {
    return Actor.implementation.create(compendiumActor.toObject());
  }

  const fromSource = await _bestArtForActor(existing);
  const bestImg = _firstNonPlaceholder([
    compendiumArt?.actor,
    compendiumActor.img,
    fromSource.img,
  ]);
  const bestTokenSrc = _firstNonPlaceholder([
    compendiumArt?.token?.texture?.src,
    compendiumActor.prototypeToken?.texture?.src,
    fromSource.tokenSrc,
  ]);

  const updates = {};
  if (bestImg && _isPlaceholderArt(existing.img)) updates.img = bestImg;
  if (bestTokenSrc && _isPlaceholderArt(existing.prototypeToken?.texture?.src)) {
    updates["prototypeToken.texture.src"] = bestTokenSrc;
  }
  if (Object.keys(updates).length) await existing.update(updates);

  return existing;
}

/**
 * Build the token source for an actor, with the best texture available.
 *
 * @param {Actor} worldActor  the world actor tokens will reference
 * @param {Actor} [origin]    the compendium actor it came from, if any
 * @returns {Promise<object>} a token source object ready to be positioned
 */
export async function tokenSourceFor(worldActor, origin = null) {
  const source = (await worldActor.getTokenDocument()).toObject();
  const compendiumArt = origin ? _getCompendiumArtFor(origin) : null;
  const worldBest = await _bestArtForActor(worldActor);

  const pick = _firstNonPlaceholder([
    compendiumArt?.token?.texture?.src,
    origin?.prototypeToken?.texture?.src,
    worldBest.tokenSrc,
    source.texture?.src,
    compendiumArt?.actor,
    origin?.img,
    worldBest.img,
    worldActor.img,
  ]);
  if (pick && pick !== source.texture?.src) {
    source.texture = { ...(source.texture ?? {}), src: pick };
  }
  return source;
}

/**
 * Drop a queue of tokens on the active scene, one per canvas click.
 *
 * Each entry is placed `count` times before the queue moves on, and the running
 * notification names the creature the NEXT click will drop — with two different
 * creatures in a pit fight, "place token 3 of 4" alone does not say what is
 * about to land. Escape cancels the remainder; whatever was already placed
 * stays, because a GM who has positioned two of four tokens has not asked to
 * undo them.
 *
 * @param {Array<{actor:Actor, count:number, origin?:Actor, label?:string}>} queue
 * @returns {Promise<{placed:number, cancelled:boolean}>}
 */
export async function placeTokensByClick(queue) {
  const entries = (queue ?? []).filter((e) => e?.actor && e.count > 0);
  if (!entries.length) return { placed: 0, cancelled: false };

  if (!canvas?.ready || !canvas.scene) {
    ui.notifications?.warn("No active scene to place tokens on.");
    return { placed: 0, cancelled: false };
  }

  // Resolve every actor and texture up front. Doing this inside the click
  // handler would put an await between the click and the placement, which is
  // long enough for a second click to arrive and drop two tokens on one spot.
  const plan = [];
  for (const entry of entries) {
    const worldActor = await worldActorFor(entry.actor);
    if (!worldActor) continue;
    plan.push({
      actor: worldActor,
      count: Math.max(0, Math.trunc(entry.count)),
      label: entry.label || worldActor.name,
      source: await tokenSourceFor(worldActor, entry.origin ?? null),
    });
  }
  if (!plan.length) return { placed: 0, cancelled: false };

  const total = plan.reduce((sum, p) => sum + p.count, 0);
  if (!total) return { placed: 0, cancelled: false };

  return new Promise((resolve) => {
    let index = 0;        // which plan entry
    let doneForEntry = 0; // how many of it are down
    let placed = 0;
    let active = true;
    let busy = false;       // a second click cannot race the scene write below

    const current = () => plan[index];

    const announce = () => {
      const c = current();
      if (!c) return;
      ui.notifications?.info(
        `Click the canvas to place ${c.label} (${placed + 1} of ${total}) — Esc to stop.`,
      );
    };

    const cleanup = (cancelled) => {
      if (!active) return;
      active = false;
      document.removeEventListener("pointerdown", onClick, true);
      document.removeEventListener("keydown", onKey);
      resolve({ placed, cancelled });
    };

    const onClick = async (event) => {
      if (!active || busy || event.button !== 0) return;

      // Ignore anything that is not the board — sidebar, chat, our own window.
      const insideCanvas =
        event.target?.closest?.("#board, #board-canvas, canvas, .scene") ||
        event.target?.tagName === "CANVAS";
      if (!insideCanvas) return;

      // Capture phase plus full propagation stop keeps Foundry's TokenLayer
      // from treating this as a drag-select or a deselect.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const pos = canvas.mousePosition;
      if (!pos) return;
      const snapped = canvas.grid.getSnappedPoint(
        { x: pos.x, y: pos.y },
        { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX },
      );

      const entry = current();
      if (!entry) return cleanup(false);

      const td = { ...entry.source, x: snapped.x, y: snapped.y, actorId: entry.actor.id };
      delete td._id; // Foundry assigns a fresh id per token
      busy = true;
      try {
        await canvas.scene.createEmbeddedDocuments("Token", [td]);
      } finally {
        busy = false;
      }

      placed++;
      doneForEntry++;
      if (doneForEntry >= entry.count) {
        index++;
        doneForEntry = 0;
      }

      if (placed >= total) {
        cleanup(false);
        ui.notifications?.info(`Placed all ${total} token${total === 1 ? "" : "s"}.`);
      } else {
        announce();
      }
    };

    const onKey = (event) => {
      if (event.key !== "Escape") return;
      cleanup(true);
      ui.notifications?.info(`Stopped after ${placed} of ${total}.`);
    };

    document.addEventListener("pointerdown", onClick, true);
    document.addEventListener("keydown", onKey);
    announce();
  });
}
