/**
 * Route a stored file path for fetching.
 *
 * `foundry.utils.getRoute()` joins whatever it is given onto "/" (plus the
 * ROUTE_PREFIX), so an absolute URL — what The Forge's asset library and S3
 * hand back from a FilePicker upload — comes out as
 * "/https://assets.forge-vtt.com/…", a path on the game server that holds
 * nothing. Foundry's own PDF page viewer copes because it uses the stored
 * `src` as-is; anything that routes a user-uploaded file must do the same.
 *
 * @param {string} path  a data-relative served path, or an absolute URL
 * @returns {string} the URL to fetch
 */
export function fileRoute(path) {
  return /^https?:\/\//i.test(path) ? path : foundry.utils.getRoute(path);
}
