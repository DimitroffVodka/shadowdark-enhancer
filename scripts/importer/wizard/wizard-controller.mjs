/**
 * Shadowdark Enhancer — the import wizard's controller.
 *
 * Everything the wizard does, with no window attached: it owns the state, answers a
 * click or a file drop with `dispatch`, and describes the current page as plain data
 * (`viewModel`) for the template. The Foundry window (wizard-app.mjs) and the browser
 * preview (tools/wizard-preview) both drive this one class, so what the preview shows is
 * what Foundry runs.
 *
 * Everything that touches Foundry, the server or the browser comes in as `env`, so the
 * preview can run the real flow with the Foundry parts simulated:
 *   t(key, args)            translate
 *   forge, limitMB, canUpload
 *   useOnce(src, file)      hand a book to the importer for this session (session-pdf.mjs)
 *   uploadBook(src, file)   upload and register a book; throws when the server refuses
 *   probeBook(src)          pages in the session book; throws when it is not a PDF
 *   probeImage(file)        {w, h}; throws when it is not an image
 *   uploadMap(file)         upload a map; null when refused
 *   run(state, hooks)       do the import: hooks.onProgress(pct, phase), hooks.cancelled()
 *   release()               let go of the books given from this computer
 *   confirmCancel()         ask whether to leave; resolves true to leave
 *   openAdvanced(), openHex(file), close()
 */
import {
  PAGES, HEX_MAPS, bookTitle, filesOfHex, isUsefulName, newState, addFiles, removeFile, bookRows, mapGroups, blocker, canBack, go,
} from "./wizard-core.mjs";
import { runCheck } from "./wizard-check.mjs";
import { expandPicked, materialize } from "./zip-reader.mjs";

const MB = 1048576;
const mbLabel = (mb) => (mb == null ? "" : mb < 0.1 ? `${Math.max(1, Math.round(mb * 1024))} KB` : mb >= 100 ? `${Math.round(mb)} MB` : `${Math.round(mb * 10) / 10} MB`);

/** Keys are written out in full (the i18n test finds them by scanning for them). */
const TITLES = {
  welcome: "SDE.importer.wizard.title.welcome", keep: "SDE.importer.wizard.title.keep", books: "SDE.importer.wizard.title.books",
  maps: "SDE.importer.wizard.title.maps", check: "SDE.importer.wizard.title.check", ready: "SDE.importer.wizard.title.ready",
  import: "SDE.importer.wizard.title.import", done: "SDE.importer.wizard.title.done",
};
const SUBTITLES = {
  welcome: "SDE.importer.wizard.sub.welcome", keep: "SDE.importer.wizard.sub.keep", books: "SDE.importer.wizard.sub.books",
  maps: "SDE.importer.wizard.sub.maps", check: "SDE.importer.wizard.sub.check", ready: "SDE.importer.wizard.sub.ready",
  import: "SDE.importer.wizard.sub.import", done: "SDE.importer.wizard.sub.done",
};

/** Names a click may carry in data-action; wizard-app.mjs maps each to dispatch(). */
export const ACTIONS = ["next", "back", "cancel", "choose", "remove", "setKeep", "setChoice", "toggleGroup", "fix", "openHex", "advanced"];

export class WizardController {
  /** @param {object} env  see the file header  @param {() => void} onChange  called after every change worth redrawing */
  constructor(env, onChange) {
    this.env = env;
    this.onChange = onChange ?? (() => {});
    this.state = newState();
    this.state.openGroups = new Set(["WR"]);
    this.notice = "";
    this.stopRequested = false;
  }

  t(key, args) { return this.env.t(key, args); }
  changed() { this.onChange(); }

  // ── Actions ────────────────────────────────────────────────────────────────────────────────

  /** One entry for every click and drop. `data` is the clicked element's dataset (or the picked files). */
  async dispatch(action, data = {}) {
    switch (action) {
      case "next": return this.next();
      case "back": return this.back();
      case "cancel": return this.cancel();
      case "pick": return this.pick(data.files ?? []);
      case "remove": removeFile(this.state, data.kind, data.id); this.notice = ""; return this.afterFilesChanged();
      case "setKeep": this.state.keep = data.value === "keep" ? "keep" : "once"; this.state.check = null; this.state.useOnce.clear(); return this.changed();
      case "setChoice": this.state.choice = data.value === "custom" ? "custom" : "everything"; return this.changed();
      case "toggleGroup": this.toggle(data.id); return this.changed();
      case "fix": return this.fix(data);
      case "openHex": return this.env.openHex?.(filesOfHex(this.state, data.id), data.id);
      case "advanced": return this.env.openAdvanced?.();
      default: return undefined;
    }
  }

  toggle(id) {
    const open = this.state.openGroups;
    if (!open.delete(id)) open.add(id);
  }

  async pick(files) {
    // A zip is opened and only the books and maps in it are taken; they are read (inflated) after the best copies are chosen.
    const { files: picked, zips } = await expandPicked([...files], isUsefulName);
    const r = addFiles(this.state, picked);
    const failed = [...await materialize(this.state.books), ...await materialize(this.state.maps)];
    const names = [...new Set([...r.books.map((id) => this.titleOfBook(id)), ...r.maps.map((id) => this.titleOfMap(id))])];
    const parts = [];
    if (names.length > 3) parts.push(this.t("SDE.importer.wizard.notice.addedMany", { books: new Set(r.books).size, maps: new Set(r.maps).size }));
    else if (names.length) parts.push(this.t("SDE.importer.wizard.notice.added", { list: names.join(", ") }));
    if (r.replaced.length) parts.push(this.t("SDE.importer.wizard.notice.replaced", { list: r.replaced.map((id) => this.titleOfBook(id) || this.titleOfMap(id)).join(", ") }));
    const nothing = zips.filter((z) => !z.used && !z.error).map((z) => z.name);
    if (nothing.length) parts.push(this.t("SDE.importer.wizard.notice.zipNothing", { list: nothing.join(", ") }));
    const broken = [...zips.filter((z) => z.error).map((z) => z.name), ...failed];
    if (broken.length) parts.push(this.t("SDE.importer.wizard.notice.zipBroken", { list: broken.join(", ") }));
    if (r.kept.length > 3) parts.push(this.t("SDE.importer.wizard.notice.keptMany", { n: r.kept.length }));
    else if (r.kept.length) parts.push(this.t("SDE.importer.wizard.notice.kept", { list: r.kept.join(", ") }));
    if (r.unknown.length) parts.push(this.t("SDE.importer.wizard.notice.unknown", { list: r.unknown.join(", ") }));
    this.notice = parts.join(" ");
    return this.afterFilesChanged();
  }

  titleOfBook(id) { return bookRows(this.state).find((b) => b.id === id)?.title ?? ""; }
  /** A map's name; a half of a split hex map ("hex-cs4:north") is named for the whole map. */
  titleOfMap(id) { return mapGroups(this.state).flatMap((g) => g.rows).find((r) => r.id === String(id).split(":")[0])?.title ?? ""; }

  /** A file added or removed while on the Check page means it must be checked again. */
  async afterFilesChanged() {
    this.changed();
    if (this.state.page === "check" && !this.state.check) await this.startCheck();
  }

  async next() {
    const s = this.state;
    if (s.page === "done") return this.finish();
    if (s.page === "ready" && s.choice === "custom") { await this.env.release?.(); return this.env.openAdvanced?.(); }
    const before = s.page;
    if (go(s, "next") === before) return this.changed();
    this.notice = "";
    this.changed();
    if (s.page === "check" && !s.check) await this.startCheck();
    else if (s.page === "import") await this.startImport();
  }

  back() {
    if (!canBack(this.state)) return;
    go(this.state, "back");
    this.notice = "";
    this.changed();
  }

  async cancel() {
    if (this.state.page === "import") { this.stopRequested = true; return this.changed(); }
    if (!(await this.env.confirmCancel?.())) return;
    await this.env.release?.();
    this.env.close?.();
  }

  async finish() {
    await this.env.release?.();
    this.env.close?.();
  }

  async fix({ fix, kind, target }) {
    if (fix === "useOnce") this.state.useOnce.add(target);
    else if (fix === "remove") removeFile(this.state, kind, target);
    this.state.check = null;
    this.changed();
    if (!Object.keys(this.state.books).length && !Object.keys(this.state.maps).length) { this.state.page = "books"; return this.changed(); }
    await this.startCheck();
  }

  async startCheck() {
    const s = this.state;
    s.check = { done: false, pct: 0, label: "", items: [], ready: [], problems: [] };
    this.changed();
    const result = await runCheck(s, {
      forge: !!this.env.forge, limitMB: this.env.limitMB ?? 50, canUpload: this.env.canUpload !== false,
      useOnce: (src, file) => this.env.useOnce(src, file),
      uploadBook: (src, file) => this.env.uploadBook(src, file),
      probeBook: (src) => this.env.probeBook(src),
      onError: (id, err) => console.warn("shadowdark-enhancer | wizard check failed for", id, err),
      probeImage: (file) => this.env.probeImage(file),
      uploadMap: (file) => this.env.uploadMap(file),
      onProgress: (pct, label) => { if (s.check && !s.check.done) { s.check.pct = pct; s.check.label = label; this.changed(); } },
    });
    s.check = result;
    this.changed();
  }

  async startImport() {
    const s = this.state;
    s.progress = { pct: 0, phase: this.t("SDE.importer.wizard.run.starting") };
    this.stopRequested = false;
    this.changed();
    try {
      s.result = await this.env.run(s, {
        onProgress: (pct, phase) => { s.progress = { pct: Math.max(0, Math.min(100, Math.round(pct))), phase }; this.changed(); },
        cancelled: () => this.stopRequested,
      });
    } catch (err) {
      console.error("shadowdark-enhancer | wizard import failed", err);
      s.result = { imported: 0, already: 0, needsYou: [{ title: this.t("SDE.importer.wizard.run.failedTitle"), why: String(err?.message ?? err) }] };
    }
    await this.env.release?.();
    s.page = "done";
    this.changed();
  }

  // ── What the template draws ────────────────────────────────────────────────────────────────

  viewModel() {
    const s = this.state, idx = PAGES.indexOf(s.page), t = (k, a) => this.t(k, a);
    const picked = Object.keys(s.books).length + Object.keys(s.maps).length;
    const vm = {
      page: s.page,
      title: t(s.update && s.page === "welcome" ? "SDE.importer.wizard.title.update" : TITLES[s.page]),
      subtitle: t(s.update && s.page === "welcome" ? "SDE.importer.wizard.sub.update" : SUBTITLES[s.page]),
      stepLabel: t("SDE.importer.wizard.stepOf", { n: idx + 1, total: PAGES.length }),
      dots: PAGES.map((_, i) => ({ current: i === idx, done: i < idx })),
      notice: this.notice,
      removeLabel: t("SDE.importer.wizard.remove"),
      extraLabel: t("SDE.importer.wizard.maps.extra"),
      [`is${s.page[0].toUpperCase()}${s.page.slice(1)}`]: true,
      picked,
    };
    if (s.update && s.page === "welcome") {
      vm.update = { lead: t(s.update.needed.length ? "SDE.importer.wizard.update.lead" : "SDE.importer.wizard.update.leadLinked", { n: s.update.n, books: s.update.books.map(bookTitle).join(", ") }) };
    }
    const size = (row) => mbLabel(row.bytes ? row.bytes / MB : row.expectedMB);   // what was picked, else what to expect

    if (s.page === "keep") {
      vm.keepOnce = s.keep === "once";
      const mb = Object.values(s.books).reduce((n, f) => n + f.size, 0) / MB;
      vm.keepHelp = mb > 0 ? t("SDE.importer.wizard.keep.keepHelpSized", { size: mbLabel(mb) }) : t("SDE.importer.wizard.keep.keepHelp");
      vm.forgeNote = this.env.forge ? t("SDE.importer.wizard.keep.forge", { limit: this.env.limitMB ?? 50 }) : "";
    }
    if (s.page === "books") {
      const rows = bookRows(s).map((r) => ({ ...r, size: size(r) }));
      vm.books = { rows, have: rows.filter((r) => r.added).length, total: rows.length };
    }
    if (s.page === "maps") {
      const groups = mapGroups(s).map((g) => ({
        ...g, open: s.openGroups.has(g.src),
        rows: g.rows.map((r) => ({ ...r, size: size(r) })),
      }));
      const all = groups.flatMap((g) => g.rows);
      vm.maps = { groups, have: all.filter((r) => r.added).length, total: all.length };
    }
    if (s.page === "check") vm.check = this.checkView();
    if (s.page === "ready") {
      const ok = new Set(s.check?.ready ?? []);
      const books = [...ok].filter((x) => x.startsWith("book:")).length;
      const maps = [...ok].filter((x) => x.startsWith("map:")).length;
      vm.everything = s.choice === "everything";
      vm.ready = {
        summary: t("SDE.importer.wizard.ready.summary", { books, maps }),
        hexNote: HEX_MAPS.some((h) => ok.has(`map:${h.id}`)),
      };
    }
    if (s.page === "import") vm.run = { pct: s.progress.pct, phase: s.progress.phase };
    if (s.page === "done") {
      const r = s.result ?? { imported: 0, already: 0, needsYou: [] };
      vm.done = {
        imported: r.imported, already: r.already, attention: r.needsYou.length, items: r.needsYou,
        skipped: r.skipped?.n ? t(r.skipped.books.length ? "SDE.importer.wizard.done.skippedBooks" : "SDE.importer.wizard.done.skipped", { n: r.skipped.n, books: r.skipped.books.join(", ") }) : "",
        hexMaps: HEX_MAPS.filter((h) => s.check?.ready.includes(`map:${h.id}`))
          .map((h) => ({ id: h.id, label: t("SDE.importer.wizard.done.hexButton", { title: h.title }) })),
      };
    }

    const why = blocker(s);
    vm.foot = {
      back: canBack(s) && idx > 0,
      next: s.page === "import" ? null
        : s.page === "done" ? { label: t("SDE.importer.wizard.finish") }
        : { label: s.page === "ready" ? t(s.choice === "custom" ? "SDE.importer.wizard.ready.openAdvanced" : "SDE.importer.wizard.ready.start") : t("SDE.importer.wizard.next"), disabled: !!why, reason: why ? t(why) : "" },
      cancel: s.page === "done" ? null : s.page === "import" ? t("SDE.importer.wizard.stop") : t("SDE.importer.wizard.cancel"),
    };
    return vm;
  }

  /** A problem's numbers and words for its sentence; the halves a split map is missing are named here, in the player's language. */
  problemArgs(p) {
    if (!p.args?.missing) return p.args;
    const HALF = { north: this.t("SDE.importer.wizard.part.north"), south: this.t("SDE.importer.wizard.part.south") };
    return { ...p.args, missing: p.args.missing.map((k) => HALF[k]).join(", ") };
  }

  /** The Check page: a bar while it runs, then how many are ready and a card per problem. */
  checkView() {
    const c = this.state.check;
    if (!c || !c.done) return { running: true, pct: c?.pct ?? 0, label: c?.label ?? "" };
    const FIX = { useOnce: this.t("SDE.importer.wizard.fix.useOnce"), remove: this.t("SDE.importer.wizard.fix.remove") };
    return {
      running: false,
      ready: c.ready.length,
      total: c.items.length,
      problems: c.problems.map((p) => ({
        id: p.id, kind: p.kind, title: p.title, why: this.t(p.reason, this.problemArgs(p)),
        fixes: (p.fixes ?? []).map((id) => ({ id, label: FIX[id] })),
      })),
      warnings: c.items.filter((x) => x.warn).map((x) => ({ title: x.title, why: this.t(x.warn, x.warnArgs) })),
    };
  }
}
