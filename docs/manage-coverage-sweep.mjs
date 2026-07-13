/**
 * Manage coverage sweep — reproducible extract→parse audit of every Manage-tree
 * entry that carries a page citation. Produces docs/pdf-import-sweep-<date>.json.
 *
 * WHY: the session review quotes "103/141 tables clean, 38 review". This probe is
 * the durable baseline behind that number — re-run it after any extractor/parser
 * change and diff the JSON to see exactly which entries improved or regressed.
 *
 * LIVES IN docs/ (not dev/probes/) deliberately: dev/ is local-only via
 * .git/info/exclude, and this probe must travel with the audit artifact it
 * produces. Foundry serves docs/, so it stays importable in a live world.
 *
 * HOW TO RUN (GM console, or the foundry-vtt MCP `evaluate` tool):
 *   const { runManageCoverageSweep } =
 *     await import("/modules/shadowdark-enhancer/docs/manage-coverage-sweep.mjs?t=" + Date.now());
 *   return runManageCoverageSweep({ save: true });
 * With { save: true } it serializes itself (JSON.stringify(payload, null, 1)) and
 * uploads to modules/shadowdark-enhancer/docs/pdf-import-sweep-<date>.json via
 * FilePicker.upload, overwriting any same-date artifact; `savedPath` echoes the
 * destination. Without it, save the returned object to that path manually.
 *
 * RETURNS { pass, meta, monsters, agg, records } (~60 KB). `pass` is the
 * id-uniqueness assertion: false iff meta.duplicateIds is non-empty. `records[]`:
 *   { id, name, type, src, pages, route, shape, status, formula, rows, warns[] }
 * id = `type::src::name::pages` — an audit diff key, since name+source alone is
 * not unique (WR Necromancer is both a Class and a SpellList record).
 * status ∈ clean | REVIEW | no-parse | partial | skip-no-page | no-pdf | *-error.
 *
 * METHOD: tables go through the REAL import path — _onCharSeedPaste (auto-extract)
 * + _onHubParse, which runs resolveShape({contentId,name,src})→parseByShape for
 * shaped tables and parseTables + _applyImportSeed otherwise. A shaped entry is
 * additionally checked for ACTUAL shape success: parseByShape is re-run and must
 * return the expected output class (compound→generator, lookup/section→table);
 * a shape that falls through to the generic parser is route
 * "table:shape-fallback-generic" AND status REVIEW even when warning-free.
 * Items/classes/ancestry use their own recognizers. A warning is "bad" (→ REVIEW)
 * if it matches /overlap|has no row|couldn't split|reach|missing|verif|rebuilt|prayer parse/i.
 * meta.method records this same description so a re-run + diff stays clean.
 */
export async function runManageCoverageSweep({ save = false } = {}) {
  const base = "modules/shadowdark-enhancer/scripts/encounter/";
  const { ImporterHubApp } = await import(foundry.utils.getRoute(base + "importer-hub-app.mjs"));
  const { buildManageTree } = await import(foundry.utils.getRoute(base + "manage-tree.mjs"));
  const { parseCharContent } = await import(foundry.utils.getRoute(base + "char-content-manifest.mjs"));
  const { parseClassSection } = await import(foundry.utils.getRoute(base + "class-parser.mjs"));
  const itemMod = await import(foundry.utils.getRoute(base + "item-parser.mjs"));
  const { resolveShape } = await import(foundry.utils.getRoute(base + "table-shapes.mjs"));
  const { parseByShape } = await import(foundry.utils.getRoute(base + "table-importer.mjs"));
  const reg = await import(foundry.utils.getRoute(base + "source-pdf-registry.mjs"));
  const mod = await import(foundry.utils.getRoute(base + "pdf-text-extract.mjs"));

  const meta = {
    date: new Date().toISOString().slice(0, 10),
    foundry: game.version,
    system: `${game.system.id} ${game.system.version}`,
    module: game.modules.get("shadowdark-enhancer")?.version ?? "?",
    method: "Real import path: _onCharSeedPaste (auto-extract) + _onHubParse (resolveShape{contentId,name,src}->parseByShape, else parseTables + _applyImportSeed) for Table entries; parseClassSection/parseCharContent/itemRecognizer for the rest. A shaped entry is checked for ACTUAL shape success (parseByShape returns the expected output class: compound->generator, lookup/section->table); a shape that falls through to the generic parser is route 'table:shape-fallback-generic' AND status REVIEW even if warning-free. Warnings classed 'bad' by /overlap|has no row|couldn't split|reach|missing|verif|rebuilt/i.",
    sources: (await reg.listSourcePdfs()).map((r) => `${r.src}:${r.origin}:${r.linked ? "linked" : "no"}`),
  };

  const tree = await buildManageTree();
  const entries = [];
  (function walk(nodes, path) {
    for (const n of nodes ?? []) {
      for (const e of n.entries ?? []) entries.push({ cat: path[0] || n.label, name: e.name, type: e.type, src: e.src, pages: e.pages || null, contentId: e.contentId || null });
      walk(n.children, [...path, n.label]);
    }
  })(tree, []);

  const monsterNode = tree.find((n) => (n.label || "").toLowerCase() === "monsters");
  const monsters = (monsterNode?.children || [])
    .filter((c) => (c.entries || []).length || c.have)
    .map((c) => ({ src: c.label, have: c.have ?? 0, missing: c.locked ?? 0, entries: (c.entries || []).length }));

  const app = ImporterHubApp.open();
  await new Promise((r) => setTimeout(r, 200));
  const itemRec = itemMod.itemRecognizer;
  const badRe = /overlap|has no row|couldn'?t split|reach|missing/i;
  const records = [];
  for (const e of entries) {
    const id = `${e.type || "?"}::${e.src || "?"}::${e.name}::${e.pages || "-"}`;
    if (!e.pages) { records.push({ id, name: e.name, type: e.type, src: e.src, pages: null, route: "no-page", status: "skip-no-page" }); continue; }
    const tgt = reg.sourcePdfTarget(e.src, e.pages);
    if (!tgt) { records.push({ id, name: e.name, type: e.type, src: e.src, pages: e.pages, route: "no-pdf", status: "no-pdf" }); continue; }
    let text; try { text = (await mod.extractPdfText(tgt.file, { pages: [tgt.page], columns: "auto" })).text; }
    catch { records.push({ id, name: e.name, type: e.type, src: e.src, pages: e.pages, status: "extract-error" }); continue; }

    const rec = { id, name: e.name, type: e.type, src: e.src, pages: e.pages };
    try {
      if (e.type === "Table") {
        const shape = resolveShape({ contentId: e.contentId, name: e.name, src: e.src });
        rec.shape = shape ? (shape.kind + (shape.split ? `/${shape.split}` : "")) : null;
        app._importTables = []; app._importGenerators = []; app._importSkipped = []; app._importText = ""; app._importSeed = null;
        await app._onCharSeedPaste({}, { dataset: { name: e.name, type: "Table", src: e.src, pages: e.pages, contentId: e.contentId || "" } });
        await new Promise((r) => setTimeout(r, 110));
        await app._onHubParse();
        await new Promise((r) => setTimeout(r, 80));
        const t = app._importTables[0], g = app._importGenerators[0];
        // Did the SHAPE actually parse, or did _onHubParse fall through to the
        // generic parser? Re-run parseByShape on the seeded text and require the
        // EXPECTED output class (compound->generator, lookup/section->table).
        let shapeOk = false;
        if (shape) {
          const bucket = parseByShape(app._importText, shape, { name: e.name });
          const gens = bucket?.generators?.length ?? 0, tabs = bucket?.tables?.length ?? 0;
          shapeOk = shape.kind === "compound" ? gens > 0 : tabs > 0;
        }
        rec.route = !shape ? (g ? "table:generator" : "table:generic")
          : shapeOk ? `table:shape(${rec.shape})` : `table:shape-fallback-generic(${rec.shape})`;
        // "verify/rebuilt" (generic fallback hedge) and "Prayer parse: N …
        // expected M" (a shaped generator that dropped an entry to cell-wrap)
        // are bad too — a shape that parsed but is short of its faces is REVIEW.
        const bad = (t?.warnings || g?.warnings || []).filter((w) => badRe.test(w) || /verif|rebuilt|prayer parse/i.test(w));
        rec.formula = t?.formula ?? null;
        rec.rows = t?.rows?.length ?? (g ? `gen:${g.compound?.columns?.length}col` : null);
        rec.warns = bad.slice(0, 4);
        rec.shapeOk = shape ? shapeOk : null;
        // A shaped entry that fell back to the generic parser is REVIEW even when
        // warning-free — its intended structure did not parse (Codex #3).
        rec.status = (t || g) ? ((bad.length || (shape && !shapeOk)) ? "REVIEW" : "clean") : "no-parse";
      } else if (["Basic", "Weapon", "Armor"].includes(e.type)) {
        const items = (itemRec?.claim && itemRec?.parse) ? itemRec.parse(itemRec.claim(text).claimed) : [];
        rec.route = "item:recognizer"; rec.status = items.length ? "clean" : "no-parse"; rec.rows = items.length;
      } else if (e.type === "Ancestry") {
        const r = parseCharContent(text, "ancestries"); rec.route = "charcontent:ancestry"; rec.status = r?.length ? "clean" : "no-parse"; rec.rows = r?.length;
      } else if (e.type === "Class") {
        const p = parseClassSection(text); rec.route = "class:parseClassSection";
        rec.status = (p?.talentTable && p?.features?.length) ? "clean" : (p?.features?.length ? "partial" : "no-parse");
        rec.detail = { talent: p?.talentTable?.rows?.length ?? 0, features: p?.features?.length ?? 0 };
      } else { rec.route = "skip:" + e.type; rec.status = "skip"; }
    } catch (err) { rec.status = "parse-error"; rec.err = String(err.message).slice(0, 80); }
    records.push(rec);
  }
  app.close();

  const idCounts = new Map();
  for (const r of records) idCounts.set(r.id, (idCounts.get(r.id) || 0) + 1);
  meta.duplicateIds = [...idCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k);

  const agg = {};
  for (const r of records) { const k = r.type || "?"; (agg[k] ??= {}); agg[k][r.status] = (agg[k][r.status] || 0) + 1; }
  const payload = { pass: meta.duplicateIds.length === 0, meta, monsters, agg, records };
  if (save) {
    const FP = foundry.applications?.apps?.FilePicker ?? FilePicker;
    const file = new File([JSON.stringify(payload, null, 1)], `pdf-import-sweep-${meta.date}.json`, { type: "application/json" });
    const up = await FP.upload("data", "modules/shadowdark-enhancer/docs", file, {}, { notify: false });
    payload.savedPath = up?.path ?? null;
  }
  return payload;
}
