/**
 * The party on the map wears a standard (a pennant on a pole, see emblemStandardSvg) instead of a stock
 * picture, and its portrait stays the emblem tile (emblemTokenSvg). Both are world files, one per distinct
 * emblem; Foundry's texture field takes no data URIs.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import {
  EMBLEM_FLAG, emblemOf, emblemIconPath, emblemStandardName, emblemStandardSvg, emblemTokenName, emblemTokenSvg,
} from "./party-emblem-core.mjs";

/** How each picture of an emblem is made: the actor's portrait tile, and the marker it stands on the map. */
const ART = {
  token: { name: emblemTokenName, svg: emblemTokenSvg },
  standard: { name: emblemStandardName, svg: emblemStandardSvg },
};

const uploaded = new Set();
let warned = false;

/**
 * Whether the world already serves this file. A GET of a data file needs no session, unlike the upload
 * route: a browser Foundry has logged out can still read what an earlier session (or the GM) put there.
 */
const served = async (path) => {
  try { return (await fetch(foundry.utils.getRoute(path), { method: "HEAD", cache: "no-store" })).ok; }
  catch (_err) { return false; }
};

/**
 * A refused upload answers the same empty result for a lost session and for any other server error
 * (a permission, a full disk), so the notice offers the reload without asserting which one it was.
 */
const warnRefused = () => {
  if (warned) return;
  warned = true;
  ui.notifications?.warn(game.i18n.localize("SDE.party.emblem.uploadRefused"));
};

/** The world path of one picture of the actor's emblem, uploading it once per session (GM). Null when it cannot be made. */
async function emblemArtPath(actor, kind) {
  try {
    const art = ART[kind];
    const emblem = emblemOf(actor?.flags?.[MODULE_ID]?.[EMBLEM_FLAG]);
    const dir = `worlds/${game.world.id}/party-tokens`, name = art.name(emblem), path = `${dir}/${name}`;
    if (uploaded.has(path)) return path;
    // The name is the emblem, so a file already there is this emblem's picture: no upload needed.
    if (await served(path)) { uploaded.add(path); return path; }
    const FP = foundry.applications.apps.FilePicker.implementation;
    const iconSvg = await (await fetch(foundry.utils.getRoute(emblemIconPath(emblem.icon)))).text();
    try { await FP.createDirectory("data", dir); } catch (_err) { /* exists */ }
    const res = await FP.upload("data", dir, new File([art.svg(emblem, iconSvg)], name, { type: "image/svg+xml" }), {}, { notify: false });
    if (!res?.path) { warnRefused(); return null; }
    uploaded.add(path);
    return res.path;
  } catch (error) { console.error(`${MODULE_ID} | party ${kind} picture`, error); return null; }
}

/** The world path of the actor's portrait tile. Null when it cannot be made. */
export const emblemTokenPath = (actor) => emblemArtPath(actor, "token");

/** The world path of the actor's standard, the picture its tokens wear on the map. Null when it cannot be made. */
export const emblemStandardPath = (actor) => emblemArtPath(actor, "standard");

/** Put the portrait on the actor, the standard on its prototype token and every scene token of it (GM). */
export async function syncPartyTokenArt(actor) {
  if (!game.user?.isGM || !actor) return;
  const [img, standard] = await Promise.all([emblemTokenPath(actor), emblemStandardPath(actor)]);
  if (!standard) return;
  const patch = {};
  if (img && actor.img !== img) patch.img = img;
  if (actor.prototypeToken?.texture?.src !== standard) patch["prototypeToken.texture.src"] = standard;
  if (Object.keys(patch).length) await actor.update(patch);
  for (const scene of game.scenes ?? []) {
    const ids = scene.tokens.filter((t) => t.actorId === actor.id && t.texture.src !== standard).map((t) => ({ _id: t.id, "texture.src": standard }));
    if (ids.length) await scene.updateEmbeddedDocuments("Token", ids);
  }
}

/** Any write of the emblem flag (the sheet, a macro, a flag edit) re-dresses the tokens; the writing GM's client does it once. */
export function registerPartyTokenArt() {
  Hooks.on("updateActor", (actor, changes, _options, userId) => {
    if (userId !== game.user?.id || !foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${EMBLEM_FLAG}`)) return;
    void syncPartyTokenArt(actor);
  });
  // A flag written while Foundry had the browser logged out leaves the actor and its tokens on the stock hex;
  // reconcile once the world is ready, when the picture can be read even without a session.
  Hooks.once("ready", () => {
    if (!game.user?.isGM) return;
    for (const actor of game.actors?.contents ?? []) if (actor.flags?.[MODULE_ID]?.[EMBLEM_FLAG] !== undefined) void syncPartyTokenArt(actor);
  });
}
