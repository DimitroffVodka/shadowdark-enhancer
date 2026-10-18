/**
 * The party's token wears its emblem (hex-shaped, see emblemTokenSvg) instead of a stock picture.
 * The picture is a world file, one per distinct emblem; Foundry's texture field takes no data URIs.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { EMBLEM_FLAG, emblemOf, emblemIconPath, emblemTokenSvg, emblemTokenName } from "./party-emblem-core.mjs";

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

/** The upload route refuses an anonymous request with "User [] does not have permission to upload files."; say what fixes it. */
const warnRefused = () => {
  if (warned) return;
  warned = true;
  ui.notifications?.warn(game.i18n.localize("SDE.party.emblem.uploadRefused"));
};

/** The world path of the actor's emblem token picture, uploading it once per session (GM). Null when it cannot be made. */
export async function emblemTokenPath(actor) {
  try {
    const emblem = emblemOf(actor?.flags?.[MODULE_ID]?.[EMBLEM_FLAG]);
    const dir = `worlds/${game.world.id}/party-tokens`, name = emblemTokenName(emblem), path = `${dir}/${name}`;
    if (uploaded.has(path)) return path;
    // The name is the emblem, so a file already there is this emblem's picture: no upload needed.
    if (await served(path)) { uploaded.add(path); return path; }
    const FP = foundry.applications.apps.FilePicker.implementation;
    const iconSvg = await (await fetch(foundry.utils.getRoute(emblemIconPath(emblem.icon)))).text();
    try { await FP.createDirectory("data", dir); } catch (_err) { /* exists */ }
    const res = await FP.upload("data", dir, new File([emblemTokenSvg(emblem, iconSvg)], name, { type: "image/svg+xml" }), {}, { notify: false });
    if (!res?.path) { warnRefused(); return null; }
    uploaded.add(path);
    return res.path;
  } catch (error) { console.error(`${MODULE_ID} | party token picture`, error); return null; }
}

/** Put the emblem on the actor's picture, its prototype token and every scene token of it (GM). */
export async function syncPartyTokenArt(actor) {
  if (!game.user?.isGM || !actor) return;
  const src = await emblemTokenPath(actor);
  if (!src) return;
  if (actor.img !== src || actor.prototypeToken?.texture?.src !== src) await actor.update({ img: src, "prototypeToken.texture.src": src });
  for (const scene of game.scenes ?? []) {
    const ids = scene.tokens.filter((t) => t.actorId === actor.id && t.texture.src !== src).map((t) => ({ _id: t.id, "texture.src": src }));
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
