// The browser side of the import wizard preview (see serve.mjs). Runs the module's real wizard code against
// Foundry's real pdf.js; only the server-side work (uploads, the final import) is simulated.
import { WizardController } from "../../scripts/importer/wizard/wizard-controller.mjs";
import { wireFiles, wireClicks } from "../../scripts/importer/wizard/wizard-dom.mjs";
import { bookRows, isHexMap } from "../../scripts/importer/wizard/wizard-core.mjs";
import { useSessionPdf, sessionPdfPath } from "../../scripts/importer/session-pdf.mjs";
import { extractPdfText, releaseLocalPdfs } from "../../scripts/importer/pdf-text-extract.mjs";

// pdf-text-extract asks Foundry where its bundled pdf.js lives; here the server serves it from the same route.
globalThis.foundry = { utils: { getRoute: (p) => `/${String(p).replace(/^\/+/, "")}` } };

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const S = await (await fetch("/strings.json")).json();
const t = (key, args) => (S[key] === undefined ? key : String(S[key]).replace(/\{(\w+)\}/g, (m, k) => args?.[k] ?? m));

const toast = (msg) => { const el = $("#toast"); el.textContent = msg; el.style.display = "block"; clearTimeout(toast.id); toast.id = setTimeout(() => { el.style.display = "none"; }, 3500); };
const sim = () => ({ forge: $("#sim-forge").checked, fail: $("#sim-fail").checked, big: $("#sim-big").checked, problem: $("#sim-problem").checked });

/** What Foundry would supply. Real: the PDF and image checks. Simulated: the two server jobs. */
const env = {
  t,
  get forge() { return sim().forge; },
  limitMB: 50,
  canUpload: true,
  useOnce: (src, file) => useSessionPdf(src, file),
  uploadBook: async (src, file) => { await sleep(350); if (sim().fail) throw new Error("the server refused the upload"); return `assets/${file.name}`; },
  probeBook: async (src) => (await extractPdfText(sessionPdfPath(src), { pages: [1] })).numPages,
  probeImage: async (file) => { const b = await createImageBitmap(file); return { w: b.width, h: b.height }; },
  uploadMap: async (file) => { await sleep(250); return sim().fail ? null : `worlds/preview/adventure-maps/${file.name}`; },

  async run(state, hooks) {
    const ready = new Set(state.check.ready);
    const books = bookRows(state).filter((b) => ready.has(`book:${b.id}`));
    const maps = Object.keys(state.maps).filter((id) => ready.has(`map:${id}`) && !isHexMap(id));
    const steps = [...books.map((b) => ({ phase: t("SDE.importer.wizard.preview.reading", { title: b.title }), book: b })), ...maps.map((id) => ({ phase: t("SDE.importer.wizard.preview.building", { title: id }) }))];
    let n = 0;
    for (const step of steps) {
      if (hooks.cancelled()) break;
      hooks.onProgress((n / steps.length) * 100, step.phase);
      // A book used once is really read here, which is what the real import does with it.
      if (step.book && state.books[step.book.id] && !state.uploaded[step.book.id]) await extractPdfText(sessionPdfPath(step.book.id), { pages: [1] });
      await sleep(450);
      n++;
    }
    hooks.onProgress(100, t("SDE.importer.wizard.preview.finishing"));
    await sleep(300);
    return {
      imported: books.length * 12 + maps.length, already: 0,
      needsYou: sim().problem ? [{ title: t("SDE.importer.wizard.preview.exampleTitle"), why: t("SDE.importer.wizard.preview.exampleWhy") }] : [],
    };
  },
  release: () => releaseLocalPdfs(),
  confirmCancel: async () => confirm("Leave the wizard? Nothing has been imported yet."),
  openAdvanced: () => toast("In Foundry, this opens the advanced importer."),
  openHex: () => toast("In Foundry, this opens the Hex map from image tool with your map."),
  close: () => { start(); toast("The window would close here. Starting over."); },
};

const content = $(".window-content");
let ctl, seq = 0;

async function render() {
  const mine = ++seq, vm = ctl.viewModel();
  const html = await (await fetch("/render", { method: "POST", body: JSON.stringify(vm) })).text();
  if (mine !== seq) return;   // a newer render is on its way
  const body = content.querySelector(".sde-wiz-body"), same = body?.closest("[data-page]")?.dataset.page === vm.page, top = same ? body.scrollTop : 0;
  content.innerHTML = html;
  const next = content.querySelector(".sde-wiz-body");
  if (next) next.scrollTop = top;
  wireFiles(content, ctl);
  window.__rendered = (window.__rendered ?? 0) + 1;
}

function start() { ctl = new WizardController(env, render); window.__wizard = ctl; return render(); }
wireClicks(content, { dispatch: (a, d) => ctl.dispatch(a, d) });

$("#win-close").addEventListener("click", () => ctl.dispatch("cancel"));
$("#restart").addEventListener("click", async () => { await releaseLocalPdfs(); start(); });
$("#load-samples").addEventListener("click", async () => {
  const list = await (await fetch("/sample-list.json")).json();
  const files = [];
  for (const s of list) {
    const q = s.mb && sim().big ? `?mb=${s.mb}` : "";
    const blob = await (await fetch(`/sample/${encodeURIComponent(s.name)}${q}`)).blob();
    files.push(new File([blob], s.name, { type: blob.type }));
  }
  await ctl.dispatch("pick", { files });
  toast(`Loaded ${files.length} invented sample files.`);
});

await start();
