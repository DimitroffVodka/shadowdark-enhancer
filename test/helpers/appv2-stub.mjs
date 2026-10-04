// Just enough of Foundry's ApplicationV2 for the actor sheet classes (npc-stat-sheet, mount-sheet, warband-sheet) to be
// imported and their methods called under node: the sheets read these two classes off `foundry.applications` at import.
// Call installAppV2Stub() before the dynamic import of a sheet module; it never replaces what a test already set.

/** What a sheet's DEFAULT_OPTIONS.actions come to once every class up the chain has merged its own, as ApplicationV2 merges them. */
export function mergedActions(SheetClass) {
  const chain = [];
  for (let cls = SheetClass; typeof cls === "function" && cls !== Function.prototype; cls = Object.getPrototypeOf(cls)) {
    if (Object.hasOwn(cls, "DEFAULT_OPTIONS")) chain.unshift(cls.DEFAULT_OPTIONS);
  }
  return Object.assign({}, ...chain.map((o) => o.actions ?? {}));
}

export function installAppV2Stub() {
  const g = globalThis;
  g.foundry ??= {};
  g.foundry.applications ??= {};
  g.foundry.applications.api ??= {};
  g.foundry.applications.sheets ??= {};
  g.foundry.applications.api.HandlebarsApplicationMixin ??= (Base) => class extends Base {};
  g.foundry.applications.sheets.ActorSheetV2 ??= class ActorSheetV2 {
    static DEFAULT_OPTIONS = {};
    /** What the core form handler would have done: submitted the form. */
    _onChangeForm() { return "submitted"; }
  };
}
