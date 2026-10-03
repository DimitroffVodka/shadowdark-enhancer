// PROPOSAL. Hex mode in one row: Continue is the one primary (it becomes Start day when no day is pending),
// Make camp stays; Start day / Forage / Weather / Start a crawl lead the Tools panel under "This travel day".
// Click Tools. Next Round and Combat are gone: they were disabled in travel mode anyway.
import { css, hex } from "./_bar-proposed.mjs";
export default { previewHeight: 450, compareState: "tools", title: "Crawl bar (hex mode, proposed)", width: 1009, css, initial: "closed", build: (s) => ({ html: hex(s) }),
  actions: { tools: { toggle: ["tools", "closed"] } } };
