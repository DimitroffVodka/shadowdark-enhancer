// PROPOSAL. Crawl mode: 4 buttons and a Tools menu, down from 8 buttons. Click Tools.
import { css, crawl } from "./_bar-proposed.mjs";
export default { previewHeight: 450, compareState: "tools", title: "Crawl bar (crawl mode, proposed)", width: 1009, css, initial: "closed", build: (s) => ({ html: crawl(s) }),
  actions: { tools: { toggle: ["tools", "closed"] } } };
