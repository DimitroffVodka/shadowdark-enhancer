/**
 * Where a stored teleport destination points. Foundry 14 keeps a teleportToken behavior's destinations in relative form
 * ("..<regionId>" on the same scene, "...<sceneId>.Region.<regionId>" on another), resolved against the behavior itself by
 * the rules of common/utils/helpers.mjs _resolveRelativeUuid; a world can also hold the absolute "Scene.<id>.Region.<id>".
 */

/**
 * Pure: the scene and region a destination names, or null when it names no scene's region.
 * @param {string} uuid  absolute or relative
 * @param {string[]} from  the behavior's own path: [sceneId, regionId, behaviorId]
 * @returns {{sceneId:string, regionId:string}|null}
 */
export function regionRef(uuid, [sceneId, regionId, behaviorId]) {
  let full = String(uuid ?? "");
  if (full.startsWith(".")) {
    const chain = [["Scene", sceneId], ["Region", regionId], ["RegionBehavior", behaviorId]];
    let k = 1;
    while (full[k] === ".") k++;
    const rel = chain.slice(0, chain.length - (k - 1));   // each dot after the first goes up one parent
    if (!rel.length) return null;
    const rest = full.slice(k), parts = rest ? rest.split(".") : [];
    const path = (docs) => docs.flat();
    if (!parts.length) full = path(rel).join(".");
    else if (parts.length % 2 === 0) full = [...path(rel), ...parts].join(".");   // an explicit type: a child of the relative document
    else full = [...path(rel.slice(0, -1)), rel.at(-1)[0], ...parts].join(".");    // a sibling of the relative document
  }
  const m = /^Scene\.([^.]+)\.Region\.([^.]+)$/.exec(full);
  return m ? { sceneId: m[1], regionId: m[2] } : null;
}
