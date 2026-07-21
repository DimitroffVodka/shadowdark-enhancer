import { MODULE_ID } from "./module-id.mjs";

/**
 * Resilience guard for the system's "Searching Distant Lands…" loading spinner.
 *
 * The Shadowdark system opens a `LoadingSD` dialog at the TOP of
 * `ItemSheetSD.getData()` (on a sheet's first render) and only closes it on the
 * SUCCESS path — and even then the close is not awaited:
 *
 *     loadingDialog = new LoadingSD().render(true);
 *     const context = await super.getData(options);   // any throw here …
 *     … more awaits (getSources, class/spell selector configs) …
 *     if (loadingDialog) loadingDialog.close({force: true});   // … skips this
 *
 * So a single transient throw in getData orphans the spinner until the user
 * refreshes. Worse, the throw is usually in the SHARED compendium-scan path
 * (`CompendiumsSD._documents`), so every subsequent Item-sheet open re-throws
 * the same way and stacks another stuck spinner — which is why one failure
 * "breaks viewing anything in the compendium" until a reload. Observed live
 * right after importing a class into the world compendium suite.
 *
 * Two hazards have to be handled together:
 *
 *   1. LEAK — getData never closes the spinner when it throws. Fixed by wrapping
 *      getData so the spinner is dismissed on the failure path (and logging the
 *      real error so the underlying transient can still be root-caused).
 *
 *   2. HANG — `LoadingSD.close()` itself loops `while (!this.rendered)` with no
 *      bound. If the dialog is torn down mid-render (rendered never flips true)
 *      that loop, and anything awaiting it, spins forever. A naive "just call
 *      close() in a finally" fix would inherit this hang. Fixed by bounding the
 *      wait so close() can never spin indefinitely. Confirmed live: an unbounded
 *      close() awaited on a mid-render dialog hung a 40s bridge call.
 *
 * Both patches are idempotent monkeypatches on the system prototypes, matching
 * this module's existing `installCompoundRollTable()` pattern (compound-table.mjs).
 * They are defensive only — they change nothing on the normal success path.
 */
export function installLoadingDialogGuard() {
  const LoadingSD = globalThis.shadowdark?.apps?.LoadingSD;
  const ItemSheetSD = globalThis.shadowdark?.sheets?.ItemSheetSD;
  if (!LoadingSD || !ItemSheetSD) {
    console.warn(`${MODULE_ID} | loading-dialog guard: system LoadingSD/ItemSheetSD not found — skipping`);
    return false;
  }

  // ── Patch 1: bound LoadingSD.close() so it can never spin forever. ──
  const lproto = LoadingSD.prototype;
  if (!lproto._sdeCloseGuarded) {
    const appClose = foundry.appv1.api.Application.prototype.close;
    lproto.close = async function (options = {}) {
      // Original waits for `rendered` so Foundry removes the window cleanly;
      // keep that, but give up after a bound instead of looping indefinitely.
      const DEADLINE_MS = 2000;
      let waited = 0;
      while (!this.rendered && waited < DEADLINE_MS) {
        await new Promise((r) => setTimeout(r, 50));
        waited += 50;
      }
      return appClose.call(this, options);
    };
    lproto._sdeCloseGuarded = true;
  }

  // ── Patch 2: never leave the spinner open when getData fails. ──
  const sproto = ItemSheetSD.prototype;
  if (!sproto._sdeLoadingGuarded) {
    const origGetData = sproto.getData;
    sproto.getData = async function (options) {
      try {
        return await origGetData.call(this, options);
      } catch (err) {
        // Log the REAL failure (item type + name) so the underlying transient
        // can be diagnosed, then dismiss any orphaned spinner so the sheet list
        // stays usable and a retry works instead of a permanent lockout.
        console.error(
          `${MODULE_ID} | ItemSheet getData failed for ${this?.item?.type} "${this?.item?.name}" ` +
          `— dismissing the loading dialog so the compendium stays usable`,
          err
        );
        dismissLoadingDialogs();
        throw err;
      }
    };
    sproto._sdeLoadingGuarded = true;
  }

  return true;
}

/**
 * Close every open `LoadingSD` spinner. Uses the (now bounded) close() so the
 * window is torn down cleanly and can't hang the caller. Fire-and-forget: the
 * caller rethrows immediately so the render fails fast and a retry succeeds.
 *
 * close() is async (and bounded), so both a synchronous throw AND a rejected
 * close() promise are swallowed here — a failed dismissal must never surface as
 * an unhandled promise rejection (it would spam the console during the very
 * failure this guard is recovering from). Returns the count of spinners it
 * attempted to close, for observability/tests.
 */
export function dismissLoadingDialogs() {
  let closed = 0;
  for (const app of Object.values(ui.windows ?? {})) {
    if (app?.constructor?.name === "LoadingSD") {
      closed++;
      try { Promise.resolve(app.close({ force: true })).catch(() => { /* already closing / torn down */ }); }
      catch (_) { /* synchronous close throw — ignore */ }
    }
  }
  return closed;
}
