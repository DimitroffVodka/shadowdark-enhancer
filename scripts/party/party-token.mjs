/**
 * The party's token wears its emblem (hex-shaped, see emblemTokenSvg) instead of a stock picture.
 * The picture is a world file, one per distinct emblem; Foundry's texture field takes no data URIs.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { EMBLEM_FLAG, emblemOf, emblemIconPath, emblemTokenSvg, emblemTokenName } from "./party-emblem-core.mjs";

const uploaded = new Set();

/** The world path of the actor's emblem token picture, uploading it once per session (GM). Null when it cannot be made. */
export async function emblemTokenPath(actor) {
  try {
    const emblem = emblemOf(actor?.flags?.[MODULE_ID]?.[EMBLEM_FLAG]);
    const dir = `worlds/${game.world.id}/party-tokens`, name = emblemTokenName(emblem), path = `${dir}/${name}`;
    if (uploaded.has(path)) return path;
    const FP = foundry.applications.apps.FilePicker.implementation;
    const iconSvg = await (await fetch(foundry.utils.getRoute(emblemIconPath(emblem.icon)))).text();
    try { await FP.createDirectory("data", dir); } catch (_err) { /* exists */ }
    const res = await FP.upload("data", dir, new File([emblemTokenSvg(emblem, iconSvg)], name, { type: "image/svg+xml" }), {}, { notify: false });
    if (!res?.path) return null;
    uploaded.add(path);
    return res.path;
  } catch (error) { console.error(`${MODULE_ID} | party token picture`, error); return null; }
}

/** Put the emblem on the actor's picture, its prototype token and every scene token of it (GM). */
export async function syncPartyTokenArt(actor) {
  if (!game.user?.isGM || !actor) return;
  const src = await emblemTokenPath(actor);
  if (!src) return;
  await actor.update({ img: src, "prototypeToken.texture.src": src });
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
}
