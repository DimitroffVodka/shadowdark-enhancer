/**
 * Shadowdark Enhancer — the stairs, ladders, shafts and trapdoors that join one part of an adventure's maps to another.
 *
 * A link is a pair of Regions with Foundry's Teleport Token behavior, one at each end, each sending a token to the other
 * (the mover is asked first). The two ends may be on two maps (a stair down to the next level): the end on a map is made
 * when that map's scene is built, and the pair is wired as soon as both ends exist, so whichever scene is built second
 * completes it. Positions only, as fractions of each map (REVIEWED_LINKS in adventure-reviewed.mjs).
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { regionShapes } from "./adventure-traps.mjs";
import { REVIEWED_LINKS } from "./adventure-reviewed.mjs";

/** Region flag: { site, link, end } of the link end a Region is. */
export const LINK_FLAG = "adventureLink";
/** The colour of a link's Regions: blue, apart from the traps' red. */
export const LINK_COLOR = "#2e86c1";
const TELEPORT = "teleportToken";

/**
 * Pure: is a Region (its link flag and name) this end of this link? A Region the GM made by hand during the review carries
 * the link's name but not which end it is, so it is known by its own name.
 * @param {{link?:string, end?:string}|undefined} flag
 * @param {string} name  the Region's name
 * @param {{name:string, a:{name:string}, b:{name:string}}} link
 * @param {"a"|"b"} end
 */
export const isLinkEnd = (flag, name, link, end) => flag?.link === link.name && (flag.end ? flag.end === end : name === link[end].name);

/** Pure: the links with an end on a site: the ones a build of that site makes an end of, or completes. */
export const linksOf = (links, siteId) => (links ?? []).filter((l) => l.a.site === siteId || l.b.site === siteId);

/**
 * Pure: the link ends to make on a site's scene: every end on that site the scene does not have yet, unwired (the pair is
 * wired once both ends exist, by placeSiteLinks).
 * @param {{links:Array<{name:string, a:object, b:object}>, siteId:string, rect:{x:number,y:number,width:number,height:number}, regions?:Array<{name:string, flag?:object}>}} args
 *   regions: the scene's Regions, each with its link flag
 * @returns {Array<{link:object, end:"a"|"b", data:object}>} data: the Region creation data
 */
export function planLinkEnds({ links, siteId, rect, regions = [] }) {
  const out = [];
  for (const link of links ?? []) {
    for (const end of ["a", "b"]) {
      const e = link[end];
      if (e.site !== siteId || regions.some((r) => isLinkEnd(r.flag, r.name, link, end))) continue;
      out.push({
        link, end,
        data: {
          name: e.name, color: LINK_COLOR, shapes: regionShapes(e, rect),
          behaviors: [{ type: TELEPORT, name: link.name, system: { destinations: [], choice: true } }],
          flags: { [MODULE_ID]: { [LINK_FLAG]: { site: e.site, link: link.name, end } } },
        },
      });
    }
  }
  return out;
}

/**
 * Build a site's link ends on its scene and wire every pair whose two ends now exist, on this scene or the other map's.
 * Run again, it adds only a missing end, and it only fills a teleport that has no destination yet: an end the GM moved,
 * renamed or re-aimed stays as it is, and nothing is ever deleted.
 * @param {Scene} scene
 * @param {{id:string}} site
 * @param {{x:number,y:number,width:number,height:number}} rect  the scene's image area
 * @returns {Promise<{placed:number, wired:number}>}
 */
export async function placeSiteLinks(scene, site, rect) {
  const links = linksOf(REVIEWED_LINKS, site.id);
  if (!links.length) return { placed: 0, wired: 0 };
  const { findSiteScene } = await import("./adventure-scene.mjs");
  const regionsOf = (s) => s.regions.map((r) => ({ name: r.name, flag: r.getFlag(MODULE_ID, LINK_FLAG), doc: r }));
  const plan = planLinkEnds({ links, siteId: site.id, rect, regions: regionsOf(scene) });
  const made = plan.length ? await scene.createEmbeddedDocuments("Region", plan.map((p) => p.data)) : [];
  const endDoc = (link, end) => {
    const on = link[end].site === site.id ? scene : findSiteScene(link[end].site);
    return on ? regionsOf(on).find((r) => isLinkEnd(r.flag, r.name, link, end))?.doc ?? null : null;
  };
  let wired = 0;
  for (const link of links) {
    const a = endDoc(link, "a"), b = endDoc(link, "b");
    if (!a || !b) continue;
    for (const [from, to] of [[a, b], [b, a]]) {
      const teleport = from.behaviors.find((x) => x.type === TELEPORT);
      if (!teleport || [...(teleport.system.destinations ?? [])].length) continue;
      await teleport.update({ "system.destinations": [to.uuid] });
      wired++;
    }
  }
  return { placed: made.length, wired };
}
