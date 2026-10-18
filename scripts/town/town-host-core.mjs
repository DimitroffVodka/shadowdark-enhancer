/**
 * Shadowdark Enhancer — Town: which scene's page is up, with a Stage place able to host one. No Foundry globals.
 *
 * The decision reads the Stage VALUE only, never window state, so the order of the two `ready` handlers, a reload and
 * a late join all give the same answer.
 */

/**
 * `{ sceneId, hosted }` for the page that should be open, or null. The hosted scene wins (the Stage shows a place whose
 * scene still has a page); else the canvas scene's page when it is switched on; else none.
 */
export function pageHost(input) {
  const { stage, canvasSceneId, canvasShown, hasPage } = input ?? {};
  const has = typeof hasPage === "function" ? hasPage : () => false;
  const hostedId = stage?.shown === true && typeof stage.pageSceneId === "string" ? stage.pageSceneId : "";
  if (hostedId && has(hostedId)) return { sceneId: hostedId, hosted: true };
  if (canvasShown === true && canvasSceneId && has(canvasSceneId)) return { sceneId: canvasSceneId, hosted: false };
  return null;
}

/** Is the page for `sceneId` the one the Stage is hosting (its hide icon then drops the Stage)? */
export const isHostedPage = (stage, sceneId) => stage?.shown === true && !!sceneId && stage.pageSceneId === sceneId;
