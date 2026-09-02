import { MODULE_ID } from "../shared/module-id.mjs";
import { installHoverPeek } from "../shared/hover-peek.mjs";
import { MonsterTokenArt } from "./monster-token-art.mjs";
import { TokenArtCatalog } from "./token-art-catalog.mjs";
import { manualFolderPickPaths, normalizeTokenArtManagerState, tokenArtFolderSourceId } from "./token-art-manager-state.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Token Art Manager — one place to choose, per monster, which installed art
 * source skins the `shadowdark.monsters` compendium. A source-priority order
 * sets the default; per-monster clicks override it. "Apply" resolves the choice
 * into the enhancer's compendium-art overlay (every drag then uses the picks).
 */
export class TokenArtManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static _instance = null;

  static DEFAULT_OPTIONS = {
    id: "sde-token-art-manager",
    classes: ["sde-token-art-manager"],
    tag: "div",
    window: { title: "Token Art Manager", icon: "fa-solid fa-images", resizable: true },
    position: { width: 720, height: 760 },
    actions: {
      sourceUp: TokenArtManagerApp._onSourceMove,
      sourceDown: TokenArtManagerApp._onSourceMove,
      folderAdd: TokenArtManagerApp._onFolderAdd,
      folderEdit: TokenArtManagerApp._onFolderEdit,
      folderRemove: TokenArtManagerApp._onFolderRemove,
      choose: TokenArtManagerApp._onChoose,
      clearRow: TokenArtManagerApp._onClearRow,
      browse: TokenArtManagerApp._onBrowse,
      browserClose: TokenArtManagerApp._onBrowserClose,
      apply: TokenArtManagerApp._onApply,
      resetAll: TokenArtManagerApp._onResetAll,
      refresh: TokenArtManagerApp._onRefresh,
      reskinPlaced: TokenArtManagerApp._onReskinPlaced,
      turnOff: TokenArtManagerApp._onTurnOff,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/token-art-manager.hbs`, scrollable: [".sde-tam-list"] },
  };

  _catalog = null;
  _library = null;   // full cross-source token library for the image browser (lazy)
  _thumbPx = 56;     // image-browser thumbnail size (zoom slider)
  _collapsedSources = new Set();   // image-browser source groups collapsed by the user
  _collapsedPanels = new Set();    // `data-remember` keys of panels the user folded away
  _filter = "";
  _conflictsOnly = false;

  static open() {
    if (!game.user.isGM) return null;
    this._instance ??= new TokenArtManagerApp();
    this._instance.render(true);
    return this._instance;
  }

  async close(opts) { TokenArtManagerApp._instance = null; return super.close(opts); }

  _state() {
    return normalizeTokenArtManagerState(game.settings.get(MODULE_ID, "tokenArtManager"));
  }
  async _saveState(patch) {
    // Shallow top-level replace — every caller passes the complete `priority`
    // array or `overrides` object. A recursive mergeObject would *keep* keys
    // absent from the patch (performDeletions defaults to false), so clearing
    // an override or resetting all would silently no-op.
    const cur = this._state();
    const next = normalizeTokenArtManagerState({ ...cur, ...patch });
    await game.settings.set(MODULE_ID, "tokenArtManager", next);
    return next;
  }

  /** Remember exact files selected through a manual Browse folder. The list is
   * intentionally file-level, not another broad root prefix: a former folder
   * can be edited/removed without making arbitrary GM art replaceable. */
  static _rememberManagedPaths(state, paths = []) {
    const remembered = new Set(Array.isArray(state.managedPaths) ? state.managedPaths : []);
    for (const path of paths) {
      if (typeof path === "string" && path.trim()) remembered.add(path.trim());
    }
    return [...remembered];
  }

  async _prepareContext() {
    if (!this._catalog) this._catalog = await TokenArtCatalog.build();
    const cat = this._catalog;
    const state = this._state();
    const overrides = state.overrides ?? {};
    const picks = state.picks ?? {};
    const order = TokenArtCatalog.resolvePriority(cat.sources.map((s) => s.id));
    const sourceById = Object.fromEntries(cat.sources.map((s) => [s.id, s]));
    const folderById = Object.fromEntries(state.folders.map((folder) => [tokenArtFolderSourceId(folder), folder]));
    const orderedSources = order.map((id) => sourceById[id]).filter(Boolean);

    // resolved choice + per-source tally
    const res = TokenArtCatalog.resolve(cat);
    const enabled = game.settings.get(MODULE_ID, "tokenArtCompendium");

    // Render every monster row — including those with no name-match (imported
    // CS/WR monsters), which get only a "Browse…" affordance. The search box +
    // conflicts toggle filter the DOM client-side (no re-render) so typing never
    // loses focus.
    const srcLabel = (id) => sourceById[id]?.label ?? folderById[id]?.label ?? id;
    const rows = [];
    for (const m of cat.byMonster) {
      const chosen = res.chosen[m.id];
      const p = picks[m.id];
      const pick = p ? { thumb: p.token, label: p.source ? srcLabel(p.source) : "Custom", file: p.file ?? "" } : null;
      const isOverride = !!overrides[m.id] || !!pick;
      rows.push({
        id: m.id,
        name: m.name,
        imported: (m.pack ?? "shadowdark.monsters") !== "shadowdark.monsters",
        multi: m.options.length > 1,
        hasOptions: m.options.length > 0,
        isOverride,
        pick,
        options: m.options.map((o) => ({
          source: o.source,
          label: srcLabel(o.source),
          thumb: o.token,
          ring: !!o.tokenObj?.ring?.enabled,
          chosen: !pick && o.source === chosen,
        })),
      });
    }

    return {
      sources: orderedSources.map((s, i) => ({
        ...s,
        used: res.stats.perSource[s.id] ?? 0,
        isFirst: i === 0,
        isLast: i === orderedSources.length - 1,
      })),
      sourceCount: orderedSources.length,
      // Collapsed state is app state, not DOM state: the body re-renders on
      // every reorder, and a bare <details> would spring back open each time.
      // Optional chaining because the context builder is exercised against a
      // plain object in tests, where class field initialisers never ran. A
      // missing set means nothing was folded, which is the right default.
      sourcesOpen: !this._collapsedPanels?.has("sources"),
      blurbOpen: !this._collapsedPanels?.has("blurb"),
      rows,
      folders: state.folders,
      stats: res.stats,
      enabled,
      filter: this._filter,
      conflictsOnly: this._conflictsOnly,
      total: rows.length,
    };
  }

  /** Show/hide rows by the search text + conflicts toggle, purely in the DOM —
   *  no re-render, so the search box keeps focus/caret while typing. */
  _applyFilter() {
    const root = this.element;
    if (!root) return;
    const q = (this._filter ?? "").trim().toLowerCase();
    const rows = root.querySelectorAll(".sde-tam-row");
    let shown = 0;
    for (const r of rows) {
      const nameOk = !q || (r.dataset.name ?? "").toLowerCase().includes(q);
      const conflictOk = !this._conflictsOnly || r.dataset.multi === "1";
      const visible = nameOk && conflictOk;
      r.style.display = visible ? "" : "none";
      if (visible) shown++;
    }
    const count = root.querySelector(".sde-tam-count");
    if (count) count.textContent = `${shown} / ${rows.length}`;
  }

  _onRender(_ctx, _opts) {
    const root = this.element;
    const search = root.querySelector('input[name="filter"]');
    if (search && !search._sdeWired) {
      search._sdeWired = true;
      search.addEventListener("input", () => { this._filter = search.value ?? ""; this._applyFilter(); });
    }
    const conflicts = root.querySelector('input[name="conflicts"]');
    if (conflicts && !conflicts._sdeWired) {
      conflicts._sdeWired = true;
      conflicts.addEventListener("change", () => { this._conflictsOnly = conflicts.checked; this._applyFilter(); });
    }
    this._wireSourceDrag(root);

    // Remember which foldable panels are closed. `<details>` gives the
    // disclosure for free, but its open state dies with the markup and this
    // body re-renders on every reorder — so record it and let _prepareContext
    // put it back. No re-render on toggle: the browser has already done the
    // work. One loop rather than a block per panel, since the second one
    // arrived within the hour of the first.
    for (const panel of root.querySelectorAll("details[data-remember]")) {
      if (panel._sdeWired) continue;
      panel._sdeWired = true;
      const key = panel.dataset.remember;
      panel.addEventListener("toggle", () => {
        if (panel.open) this._collapsedPanels.delete(key);
        else this._collapsedPanels.add(key);
      });
    }

    // Hover-enlarge on the MAIN list too, not only inside Browse. The per-source
    // option thumbnails are where the actual comparison happens — you are
    // choosing between four candidates for one monster — and at that size they
    // are unreadable. Re-installed on every render because the list markup is
    // rebuilt; the teardown drops the previous listeners and element.
    this._listPeekOff?.();
    this._listPeekOff = installHoverPeek(root, {
      grid: ".sde-tam-list",
      item: ".sde-tam-opt",
      src: (tile) => tile.querySelector("img")?.getAttribute("src") ?? null,
      width: 340,
      anchor: root,
    });

    // Image browser overlay: search filter + click-to-pick (delegated). Wired
    // once; the overlay markup persists across body re-renders.
    const overlay = root.querySelector(".sde-tam-browser");
    if (overlay && !overlay._sdeWired) {
      overlay._sdeWired = true;
      const bsearch = overlay.querySelector(".sde-tam-browser-search");
      bsearch?.addEventListener("input", () => this._filterBrowser());
      // Clear-search (×) button.
      overlay.querySelector(".sde-tam-browser-clear")?.addEventListener("click", () => {
        if (!bsearch) return;
        bsearch.value = "";
        this._filterBrowser();
        bsearch.focus();
      });
      const zoom = overlay.querySelector(".sde-tam-browser-zoom");
      if (zoom) {
        zoom.value = this._thumbPx;
        zoom.addEventListener("input", () => this._setZoom(Number(zoom.value)));
      }
      const bgrid = overlay.querySelector(".sde-tam-browser-grid");
      // Ctrl + mouse wheel → zoom the thumbnails (suppress browser page-zoom).
      bgrid?.addEventListener("wheel", (ev) => {
        if (!ev.ctrlKey) return;
        ev.preventDefault();
        this._setZoom(this._thumbPx + (ev.deltaY < 0 ? 12 : -12));
      }, { passive: false });
      bgrid?.addEventListener("click", (ev) => {
        // Collapse/expand a source when its header is clicked.
        const head = ev.target.closest(".sde-tam-bgroup-head");
        if (head) { this._toggleGroup(head.closest(".sde-tam-bgroup")); return; }
        const btn = ev.target.closest(".sde-tam-browse-opt");
        if (!btn) return;
        const entry = this._library?.[Number(btn.dataset.idx)];
        const monster = overlay.dataset.monster;
        if (entry && monster) this._pickImage(monster, entry);
      });
      bgrid?.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        const head = ev.target.closest(".sde-tam-bgroup-head");
        if (head) { ev.preventDefault(); this._toggleGroup(head.closest(".sde-tam-bgroup")); }
      });
      // Live hover status — source + filename (native title is slow/hidden).
      const status = overlay.querySelector(".sde-tam-browser-status");
      const idle = `<span class="sde-tam-dim">Hover a token to see its source &amp; filename</span>`;
      bgrid?.addEventListener("mouseover", (ev) => {
        const btn = ev.target.closest(".sde-tam-browse-opt");
        const entry = btn && this._library?.[Number(btn.dataset.idx)];
        if (entry && status) {
          const nm = entry.file.replace(/\.(webp|png|jpg|jpeg)$/i, "");
          status.innerHTML = `<span class="sde-tam-status-src">${foundry.utils.escapeHTML(entry.label)}</span> · <span class="sde-tam-status-file">${foundry.utils.escapeHTML(nm)}</span>`;
        }
      });
      bgrid?.addEventListener("mouseleave", () => { if (status) status.innerHTML = idle; });
      // Hover-enlarge, the same component the character builder's gallery uses.
      // The status line names the art; this shows it. Thumbnails here go down to
      // 40px, so the case for it is stronger than in the gallery.
      //
      // Anchored to the WINDOW, not the hovered tile. Beside the tile the
      // preview chases the pointer across a six-column grid, which reads as
      // erratic and can land off screen when the window sits near a screen
      // edge; pinned to the window it appears in the same place every time.
      this._peekOff?.();
      this._peekOff = installHoverPeek(overlay, {
        grid: ".sde-tam-browser-grid",
        item: ".sde-tam-browse-opt",
        // The grid draws the same file at thumbnail size, so the preview is the
        // same path shown large — there is no separate full-size asset here.
        src: (tile) => tile.querySelector("img")?.getAttribute("src") ?? null,
        width: 340,
        anchor: root,
      });
      overlay.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") { overlay.hidden = true; return; }
        if (!ev.ctrlKey) return;
        // Ctrl +/− zoom; Ctrl 0 resets (suppress browser page-zoom).
        if (ev.key === "-" || ev.key === "_") { ev.preventDefault(); this._setZoom(this._thumbPx - 16); }
        else if (ev.key === "=" || ev.key === "+") { ev.preventDefault(); this._setZoom(this._thumbPx + 16); }
        else if (ev.key === "0") { ev.preventDefault(); this._setZoom(56); }
      });
    }
    // Re-apply the active filter after any re-render (priority/override/apply).
    this._applyFilter();
  }

  // ---- actions --------------------------------------------------------------
  /** Probe a user-entered data folder without letting FilePicker failures
   * escape into the manager or browser. An empty folder is readable and is
   * accepted; _browseTree will find images in any child directories later. */
  static async _probeFolder(path) {
    try {
      const result = await MonsterTokenArt.FilePickerCls.browse("data", path);
      return !!result && (Array.isArray(result.files) || Array.isArray(result.dirs));
    } catch (error) {
      console.debug(`${MODULE_ID} | token art: folder is not readable "${path}":`, error?.message ?? error);
      return false;
    }
  }

  /** Add or edit one named Browse folder. The dialog only writes after a
   * successful local FilePicker probe, so a typo cannot poison the setting. */
  static async _editFolder(index = null) {
    if (!game.user.isGM) return false;
    const state = this._state();
    const parsedIndex = Number.isInteger(index) ? index : Number.parseInt(index, 10);
    const editing = Number.isInteger(parsedIndex) && parsedIndex >= 0 ? state.folders[parsedIndex] : null;
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2?.prompt) {
      ui.notifications.error("Token Art Manager needs Foundry's dialog API to edit Browse folders.");
      return false;
    }
    const esc = foundry.utils.escapeHTML;
    const result = await DialogV2.prompt({
      window: { title: editing ? "Edit Token Art Browse Folder" : "Add Token Art Browse Folder" },
      content: `<div class="sde-tam-folder-form">
        <label>Label<input type="text" name="label" value="${esc(editing?.label ?? "")}" maxlength="120" autofocus></label>
        <label>Data folder path<input type="text" name="path" value="${esc(editing?.path ?? "")}" placeholder="modules/my-token-pack/tokens" spellcheck="false"></label>
        <p class="notes">Enter a folder under Foundry's Data directory. Images in child folders are included when you Browse.</p>
      </div>`,
      ok: {
        label: "Save",
        callback: (_event, button) => ({
          label: button.form.elements.label.value,
          path: button.form.elements.path.value,
        }),
      },
      rejectClose: false,
    }).catch(() => null);
    if (!result) return false;

    const label = String(result.label ?? "").trim();
    const path = String(result.path ?? "").trim();
    if (!label || !path) {
      ui.notifications.warn("A Browse folder needs both a label and a data folder path.");
      return false;
    }
    const folders = state.folders.map((folder) => ({ ...folder }));
    const duplicate = folders.findIndex((folder, i) => i !== parsedIndex && folder.path === path);
    if (duplicate >= 0) {
      ui.notifications.warn(`That data folder is already listed as “${folders[duplicate].label}”.`);
      return false;
    }
    if (!(await TokenArtManagerApp._probeFolder(path))) {
      ui.notifications.error(`Could not read the Browse folder “${path}”. Check the path and your file permissions.`);
      return false;
    }

    if (editing) folders[parsedIndex] = { ...editing, label, path };
    else folders.push({ label, path });
    const source = editing ? tokenArtFolderSourceId(editing) : null;
    const oldPickPaths = source
      ? Object.values(state.picks).flatMap((pick) => pick?.source === source ? manualFolderPickPaths(pick) : [])
      : [];
    await this._saveState({ folders, managedPaths: TokenArtManagerApp._rememberManagedPaths(state, oldPickPaths) });
    // Both catalogs are disk-backed and must not retain a removed/edited root.
    this._catalog = null;
    this._library = null;
    await this.render({ parts: ["body"] });
    ui.notifications.info(`${editing ? "Updated" : "Added"} Browse folder “${label}”.`);
    return true;
  }

  static async _onFolderAdd() { return TokenArtManagerApp._editFolder.call(this); }

  static async _onFolderEdit(_event, target) {
    return TokenArtManagerApp._editFolder.call(this, Number.parseInt(target.dataset.folder, 10));
  }

  static async _onFolderRemove(_event, target) {
    if (!game.user.isGM) return false;
    const index = Number.parseInt(target.dataset.folder, 10);
    const state = this._state();
    const folder = state.folders[index];
    if (!folder) return false;
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (!DialogV2?.confirm) return false;
    const confirmed = await DialogV2.confirm({
      window: { title: "Remove Token Art Browse Folder" },
      content: `<p>Remove the Browse folder <strong>${foundry.utils.escapeHTML(folder.label)}</strong>?</p>`,
      rejectClose: false,
    }).catch(() => false);
    if (!confirmed) return false;
    const folders = state.folders.filter((_entry, i) => i !== index);
    const oldSource = tokenArtFolderSourceId(folder);
    const oldPickPaths = Object.values(state.picks).flatMap((pick) => pick?.source === oldSource ? manualFolderPickPaths(pick) : []);
    await this._saveState({ folders, managedPaths: TokenArtManagerApp._rememberManagedPaths(state, oldPickPaths) });
    this._catalog = null;
    this._library = null;
    await this.render({ parts: ["body"] });
    ui.notifications.info(`Removed Browse folder “${folder.label}”.`);
    return true;
  }

  /**
   * Drag a source to reorder the priority list.
   *
   * Native HTML5 drag and drop, not a library and not Foundry's DragDrop: the
   * whole interaction is one list reordering itself, and `draggable` plus three
   * listeners covers it. The caret buttons stay — dragging is unavailable to
   * anyone working by keyboard, and they are the accessible path — but they are
   * no longer the ONLY way to move a row, which is what made an eight-source
   * list tedious.
   *
   * The new order is read from the DOM rather than recomputed, because the
   * rendered order IS the priority order; that keeps this independent of the
   * cached catalog and of how far the list has drifted from it.
   */
  _wireSourceDrag(root) {
    const list = root.querySelector("details.sde-tam-sources");
    if (!list || list._sdeDrag) return;
    list._sdeDrag = true;
    const rows = () => [...list.querySelectorAll(".sde-tam-source")];
    const clear = () => { for (const el of rows()) el.classList.remove("is-dragging", "drop-before", "drop-after"); };
    let dragId = null;

    list.addEventListener("dragstart", (event) => {
      const row = event.target.closest?.(".sde-tam-source");
      if (!row) return;
      dragId = row.dataset.source;
      row.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      // Firefox refuses to start a drag with no payload, whatever the payload is.
      event.dataTransfer.setData("text/plain", dragId);
    });

    list.addEventListener("dragover", (event) => {
      const row = event.target.closest?.(".sde-tam-source");
      if (!dragId || !row || row.dataset.source === dragId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const box = row.getBoundingClientRect();
      const after = event.clientY > box.top + box.height / 2;
      for (const el of rows()) el.classList.remove("drop-before", "drop-after");
      row.classList.add(after ? "drop-after" : "drop-before");
    });

    list.addEventListener("drop", async (event) => {
      const row = event.target.closest?.(".sde-tam-source");
      if (!dragId || !row || row.dataset.source === dragId) { clear(); dragId = null; return; }
      event.preventDefault();
      const box = row.getBoundingClientRect();
      const after = event.clientY > box.top + box.height / 2;
      const order = rows().map((el) => el.dataset.source).filter(Boolean);
      const from = order.indexOf(dragId);
      if (from < 0) { clear(); dragId = null; return; }
      order.splice(from, 1);
      const to = order.indexOf(row.dataset.source) + (after ? 1 : 0);
      order.splice(to, 0, dragId);
      clear();
      dragId = null;
      await this._applySourceOrder(order);
    });

    list.addEventListener("dragend", () => { clear(); dragId = null; });
  }

  /** Persist a source order and show it without waiting for a rebuild. */
  async _applySourceOrder(order) {
    await this._saveState({ priority: order });
    // Re-sort the cached catalog so resolve()/display reflect the new priority
    // immediately — otherwise the change only shows after a close/reopen.
    if (this._catalog) TokenArtCatalog.reorder(this._catalog, order);
    this.render({ parts: ["body"] });
  }

  static async _onSourceMove(event, target) {
    const id = target.dataset.source;
    const dir = target.dataset.action === "sourceUp" ? -1 : 1;
    const cat = this._catalog ?? (this._catalog = await TokenArtCatalog.build());
    const order = TokenArtCatalog.resolvePriority(cat.sources.map((s) => s.id));
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    await this._applySourceOrder(order);
  }

  static async _onChoose(event, target) {
    const { monster, source } = target.dataset;
    const state = this._state();
    const overrides = foundry.utils.deepClone(state.overrides ?? {});
    const picks = foundry.utils.deepClone(state.picks ?? {});
    // A source thumbnail clicked after F4 is a later GM decision. Remove only
    // the curated pick we seeded; legacy/browser picks remain authoritative and
    // continue to win through TokenArtCatalog.resolve().
    if (picks[monster]?.origin === "curated") delete picks[monster];
    overrides[monster] = source;
    await this._saveState({ overrides, picks });
    this.render({ parts: ["body"] });
  }

  static async _onClearRow(event, target) {
    const id = target.dataset.monster;
    const st = this._state();
    const overrides = foundry.utils.deepClone(st.overrides ?? {});
    const picks = foundry.utils.deepClone(st.picks ?? {});
    const clearedPickPaths = manualFolderPickPaths(picks[id]);
    delete overrides[id];   // clear both a source override and a hand-picked image
    delete picks[id];
    await this._saveState({ overrides, picks, managedPaths: TokenArtManagerApp._rememberManagedPaths(st, clearedPickPaths) });
    this.render({ parts: ["body"] });
  }

  /** Open the cross-source image browser for one monster (lazy-builds the
   *  library on first use), pre-filtered to the monster's name. */
  static async _onBrowse(event, target) {
    const { monster, name } = target.dataset;
    if (!this._library) {
      ui.notifications.info("Scanning token libraries…");
      this._library = await TokenArtCatalog.buildLibrary();
    }
    const root = this.element;
    const overlay = root.querySelector(".sde-tam-browser");
    if (!overlay) return;
    overlay.dataset.monster = monster;
    root.querySelector(".sde-tam-browser-title").textContent = `Choose art — ${name}`;
    const grid = overlay.querySelector(".sde-tam-browser-grid");
    grid.innerHTML = this._browserGridHTML();
    grid.style.setProperty("--tam-thumb", `${this._thumbPx}px`);
    const search = overlay.querySelector(".sde-tam-browser-search");
    // Pre-seed with the monster name so a matchable name jumps straight to its
    // art; but if the name matches nothing (novel imported names), clear it so
    // the browser opens on the full library instead of an empty grid.
    search.value = name ?? "";
    overlay.hidden = false;
    if (this._filterBrowser() === 0) { search.value = ""; this._filterBrowser(); }
    search.focus();
    search.select();
  }

  static async _onBrowserClose() {
    const overlay = this.element?.querySelector(".sde-tam-browser");
    if (overlay) overlay.hidden = true;
  }

  /** Build the browser grid HTML, grouped into a sticky-headed section per
   *  source (priority order). data-idx indexes back into this._library. */
  _browserGridHTML() {
    const esc = foundry.utils.escapeHTML;
    const groups = new Map();
    this._library.forEach((e, i) => {
      let g = groups.get(e.source);
      if (!g) { g = { source: e.source, label: e.label ?? e.source, items: [] }; groups.set(e.source, g); }
      g.items.push({ e, i });
    });
    return [...groups.values()].map((g) => {
      const collapsed = this._collapsedSources.has(g.source);
      return `<section class="sde-tam-bgroup${collapsed ? " is-collapsed" : ""}" data-source="${esc(g.source)}">` +
        `<div class="sde-tam-bgroup-head" role="button" tabindex="0" title="Click to collapse / expand">` +
          `<i class="fa-solid fa-caret-down sde-tam-bgroup-caret"></i> ${esc(g.label)} <span class="sde-tam-dim">${g.items.length}</span>` +
        `</div>` +
        `<div class="sde-tam-bgroup-items">` +
          g.items.map(({ e, i }) =>
            `<button type="button" class="sde-tam-browse-opt" data-idx="${i}" data-q="${esc(`${e.file} ${e.label}`).toLowerCase()}" title="${esc(e.label)} · ${esc(e.file)}">` +
              `<img src="/${e.token}" loading="lazy" alt="">` +
            `</button>`
          ).join("") +
        `</div>` +
      `</section>`;
    }).join("");
  }

  /** Set the image-browser thumbnail size (px), clamped, syncing the grid CSS
   *  var + the zoom slider. Shared by the slider, Ctrl+wheel and Ctrl+/− keys. */
  _setZoom(px) {
    this._thumbPx = Math.max(40, Math.min(320, Math.round(Number(px) || 56)));
    const overlay = this.element?.querySelector(".sde-tam-browser");
    overlay?.querySelector(".sde-tam-browser-grid")?.style.setProperty("--tam-thumb", `${this._thumbPx}px`);
    const zoom = overlay?.querySelector(".sde-tam-browser-zoom");
    if (zoom) zoom.value = this._thumbPx;
  }

  /** Collapse/expand one source group (in-DOM), remembering the state so it
   *  survives re-opening the browser for another monster. */
  _toggleGroup(section) {
    if (!section) return;
    const src = section.dataset.source;
    const collapsed = section.classList.toggle("is-collapsed");
    if (collapsed) this._collapsedSources.add(src);
    else this._collapsedSources.delete(src);
  }

  /** Filter the browser grid in-DOM by the search text (no re-render). Hides a
   *  source group when none of its tokens match. Returns the number of tokens
   *  shown, so callers can fall back when a seed matches 0. */
  _filterBrowser() {
    const overlay = this.element?.querySelector(".sde-tam-browser");
    if (!overlay) return 0;
    const raw = overlay.querySelector(".sde-tam-browser-search")?.value ?? "";
    const q = raw.trim().toLowerCase();
    const clearBtn = overlay.querySelector(".sde-tam-browser-clear");
    if (clearBtn) clearBtn.hidden = !raw;   // show the × only when there's a term
    let shown = 0;
    for (const g of overlay.querySelectorAll(".sde-tam-bgroup")) {
      let gShown = 0;
      for (const b of g.querySelectorAll(".sde-tam-browse-opt")) {
        const ok = !q || (b.dataset.q ?? "").includes(q);
        b.style.display = ok ? "" : "none";
        if (ok) { gShown++; shown++; }
      }
      g.style.display = gShown ? "" : "none";
    }
    const count = overlay.querySelector(".sde-tam-browser-count");
    if (count) count.textContent = `${shown} shown`;
    return shown;
  }

  /** Commit a hand-picked image (grid thumbnail click) as the monster's art. */
  async _pickImage(monsterId, entry) {
    const state = this._state();
    const picks = foundry.utils.deepClone(state.picks ?? {});
    const priorPickPaths = manualFolderPickPaths(picks[monsterId]);
    picks[monsterId] = {
      source: entry.source, file: entry.file,
      token: entry.token, portrait: entry.portrait, tokenObj: entry.tokenObj,
    };
    const selectedPaths = [entry.token, entry.portrait];
    await this._saveState({ picks, managedPaths: TokenArtManagerApp._rememberManagedPaths(state, [...priorPickPaths, ...selectedPaths]) });
    const overlay = this.element?.querySelector(".sde-tam-browser");
    if (overlay) overlay.hidden = true;
    this.render({ parts: ["body"] });
  }

  static async _onResetAll() {
    await this._saveState({ overrides: {}, picks: {}, managedPaths: [] });
    this.render({ parts: ["body"] });
  }

  static async _onRefresh() {
    this._catalog = null;
    this._library = null;
    ui.notifications.info("Rescanning art sources…");
    await this.render({ parts: ["body"] });
  }

  static async _onApply() {
    // Only claim success once the mapping is actually on disk — a failed write
    // leaves the compendium overlay pointing at nothing, and a green "applied"
    // toast over a red server error is how this went unnoticed on live servers.
    try {
      // Seed N6's reviewed imported rows through the same per-document pick
      // state used by Browse. This runs before resolve() so later GM picks and
      // explicit source overrides retain precedence, while zero-option rows
      // still remain visible with Browse.
      const curated = await TokenArtCatalog.applyCuratedImportedArt({ library: this._library ?? undefined });
      // The curation pass re-reads the managed pack (including Actors imported
      // after this window was opened). Rebuild the index-shaped catalog before
      // producing the per-pack overlay so a newly imported row cannot miss the
      // pick that was just prepared.
      if (curated?.status === "completed") this._catalog = null;
      const cat = this._catalog ?? (this._catalog = await TokenArtCatalog.build());
      const { tables, stats } = TokenArtCatalog.resolve(cat);
      await MonsterTokenArt.applyResolvedMapping(tables);
      const per = Object.entries(stats.perSource).map(([s, n]) => `${n} ${s.replace(/-tokens.*|-monster.*|dnd-/g, "").replace(/-/g, " ").trim()}`).join(", ");
      ui.notifications.info(`Applied token art to ${stats.mapped}/${stats.total} monsters (${per}). Every drag now uses your picks.`);
    } catch (e) {
      console.error(`${MODULE_ID} | applying token art failed:`, e);
      ui.notifications.error(`Could not apply token art: ${e.message}`);
      return;
    }
    this.render({ parts: ["body"] });
  }

  static async _onReskinPlaced() {
    // Honor the manager's multi-source/per-monster picks — resolve the catalog
    // to a name→art map instead of the legacy single-source matcher.
    const cat = this._catalog ?? (this._catalog = await TokenArtCatalog.build());
    const byName = TokenArtCatalog.resolveByName(cat);
    const r = await MonsterTokenArt.applyResolvedToPlaced(byName, {
      scene: true, actors: true, portraits: true,
      extraPrefixes: TokenArtCatalog.managedArtPrefixes(),
      extraPaths: TokenArtCatalog.managedArtPaths(),
    });
    if (r && !r.missing) {
      ui.notifications.info(`Re-skinned ${r.tokens} placed tokens, ${r.portraits} portraits (${r.kept} kept, ${r.skipped.length} unmatched).`);
    } else if (r && r.missing) {
      ui.notifications.warn("No token art resolved yet — pick sources or apply first.");
    }
  }

  static async _onTurnOff() {
    await MonsterTokenArt.disableCompendiumMapping();
    ui.notifications.info("Compendium art turned off — monsters show their default art again.");
    this.render({ parts: ["body"] });
  }
}
