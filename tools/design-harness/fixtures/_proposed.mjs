// Helper for "<name>-proposed" fixtures: reuse the current fixture's context and states, swap in proposed templates
// and the shared UI kit (tools/design-harness/proposed/sde-ui.css). Nothing here ships; it only feeds the harness.
//   export default proposed(current, { "templates/x.hbs": "tools/design-harness/proposed/templates/x.hbs" }, { classes?, width?, title?, extraCss? })
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const UI_CSS = () => fs.readFileSync(path.join(ROOT, "tools/design-harness/proposed/sde-ui.css"), "utf8");


// Foundry draws data-tooltip itself; the design harness does not. This shows it on hover so a proposal's tooltips can be judged.
// It lives in the harness toolbar (server-rendered, so the script runs), never in the kit, so it cannot double up in Foundry.
const TOOLTIP_SHIM = `<script>(()=>{if(window.__tt)return;window.__tt=1;const t=document.createElement("div");t.style.cssText="position:fixed;z-index:99999;max-width:260px;padding:4px 8px;font:12px/1.3 sans-serif;color:#fff;background:#000e;border:1px solid #888;border-radius:3px;pointer-events:none;display:none";document.body.appendChild(t);document.addEventListener("mouseover",e=>{const n=e.target.closest&&e.target.closest("[data-tooltip]");if(!n){t.style.display="none";return}t.textContent=n.dataset.tooltip;t.style.display="block";const r=n.getBoundingClientRect();t.style.left=Math.max(4,Math.min(innerWidth-t.offsetWidth-4,r.left))+"px";t.style.top=Math.max(4,r.top-t.offsetHeight-6)+"px"})})()</script>`;
const withShim = (w) => ({ ...w, toolbar: (w.toolbar ?? "") + TOOLTIP_SHIM });

export function proposed(current, map = {}, opts = {}) {
  const swap = (w) => {
    const t = (x) => map[x] ?? x;
    const out = { ...w };
    if (w.template) out.template = t(w.template);
    if (w.parts) out.parts = w.parts.map((p) => ({ ...p, template: t(p.template) }));
    return out;
  };
  const extra = opts.extraCss ? fs.readFileSync(path.join(ROOT, opts.extraCss), "utf8") : "";
  const base = { ...swap(current), classes: opts.classes ?? ["sde-ui"], css: UI_CSS() + "\n" + extra + "\n" + (current.cssProposed ?? ""), ...(opts.width ? { width: opts.width } : {}), ...(opts.title ? { title: opts.title } : {}), ...(opts.strings ? { strings: { ...current.strings, ...opts.strings } } : {}) };
  if (current.build) base.build = (s) => withShim(swap({ ...current.build(s) }));
  return withShim(base);
}
