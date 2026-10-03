// PROPOSAL: the same captured strip, CSS only.
//  - Waiting cards stay readable (full-contrast text on a dark scrim) but sit back: card at ~80%, portrait dimmed.
//  - Whose turn it is: a gold ring and the name in gold. Nothing moves or grows.
//  - Names may use two lines instead of "Animated Arm..."; initiative sits on a dark chip.
import base from "./crawl-strip.mjs";
export default { ...base, previewHeight: 250, title: "Crawl strip (proposed)", css: `
.sde-strip-member.sde-strip-dim{opacity:.8}
.sde-strip-member.sde-strip-dim > :not(.sde-strip-light-lit){opacity:1;filter:none}
.sde-strip-member.sde-strip-dim .sde-strip-portrait{filter:saturate(.5) brightness(.6)}
.sde-strip-member.sde-strip-is-turn{border-color:#e6c25a!important;box-shadow:0 0 0 1px #e6c25a,0 0 10px rgba(230,194,90,.4)!important}
#shadowdark-enhancer-strip .sde-strip-member.sde-strip-is-turn .sde-strip-name{color:#f2d77a!important}
.sde-strip-name{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.1;font-size:12px;padding:3px 4px 1px}
.sde-strip-ac-line{margin-top:2px}
#shadowdark-enhancer-strip .sde-strip-init-badge{top:50%;bottom:auto;right:auto;left:3px;transform:translateY(-50%);background:rgba(0,0,0,.7)!important;border-radius:10px;min-width:20px;height:20px}
.sde-strip-hp-label,.sde-strip-pill{text-shadow:0 1px 2px #000,0 0 3px #000}
.sde-strip-bottom{background:linear-gradient(to top,rgba(0,0,0,.85),transparent)}
` };
