/**
 * Markup for the module's chat cards, on the UI kit (styles/sde-ui.css) plus the card-scale parts (`cc-*`) in
 * styles/shadowdark-enhancer.css. Pure string builders: callers localize first and pass plain text; a field named
 * `html` is markup the caller already escaped (a localized line carrying <strong> or a link). The card's data and
 * handler hooks (`sde-dt-open-btn`, `sde-warband-note`, the rules notice's button) stay on the same elements.
 */

import { esc } from "./esc.mjs";

const head = (icon, title, aside = "") =>
  `<header class="cc-head"><i class="fa-solid fa-${icon}"></i><h4 class="cc-title">${esc(title)}</h4>${aside}</header>`;
const card = (inner, cls = "") => `<div class="sde-ui ui-cc${cls ? ` ${cls}` : ""}">${inner}</div>`;
const body = (inner) => `<div class="cc-body">${inner}</div>`;

/** Initiative order: `rows` is [{ name, total, formula }]. */
export function chaosCard({ title, rows }) {
  const list = rows.map((r, i) => `<li class="cc-li"><span class="cc-rank">${i + 1}</span><span class="cc-who">${esc(r.name)}</span>`
    + `<span class="cc-fine">${esc(r.formula)}</span><span class="cc-num">${esc(r.total)}</span></li>`).join("");
  return card(`${head("shuffle", title)}<ol class="cc-list">${list}</ol>`);
}

/** Session luck: `rows` is [{ name, total }]. */
export function pulpCard({ title, rows }) {
  const list = rows.map((r) => `<li class="cc-li"><span class="cc-who">${esc(r.name)}</span><span class="cc-num">${esc(r.total)}</span></li>`).join("");
  return card(`${head("clover", title)}<ul class="cc-list">${list}</ul>`);
}

/** Rumors heard: `rumors` is a list of strings. */
export function rumorsCard({ title, rumors }) {
  const list = rumors.map((r) => `<li class="cc-li quote">${esc(r)}</li>`).join("");
  return card(`${head("ear-listen", title)}<ul class="cc-list">${list}</ul>`);
}

/** A settlement-trouble whisper; `html` is the escaped line (it carries links and bold). */
export function troubleCard({ title, html }) {
  return card(`${head("triangle-exclamation", title)}${body(`<p class="cc-text">${html}</p>`)}`, "warn");
}

/** The missing-rules notice: one line and the button the module wires (the card's only `button`). */
export function rulesNoticeCard({ text, button }) {
  return card(body(`<p class="cc-text">${esc(text)}</p><div><button type="button" class="ui-btn"><i class="fa-solid fa-scroll"></i>${esc(button)}</button></div>`), "warn sde-rules-notice");
}

/** A weather roll: `text` is the effect, `fine` the until and dice line. */
export function weatherCard({ icon = "cloud-sun", title, text, fine }) {
  return card(`${head(icon, title)}${body(`<p class="cc-text">${esc(text)}</p><p class="cc-fine">${esc(fine)}</p>`)}`, "sde-weather-card");
}

/** The downtime announcement. The button keeps `sde-dt-open-btn`, which the session wires. */
export function downtimeAnnounceCard({ title, announce, book, days, open, foot }) {
  return card(`${head("mug-hot", title)}${body(`<p class="cc-text">${esc(announce)}</p>`
    + `<p class="ui-inline"><span class="ui-chip gold"><i class="fa-solid fa-book"></i>${esc(book)}</span>`
    + `<span class="ui-chip"><i class="fa-solid fa-hourglass-half"></i>${esc(days)}</span></p>`
    + `<div><button type="button" class="ui-btn primary sde-dt-open-btn"><i class="fa-solid fa-mug-hot"></i>${esc(open)}</button></div>`)}`
    + `<footer class="cc-foot"><span class="cc-fine">${esc(foot)}</span></footer>`);
}

/** A purchase; `html` is the escaped bought line. */
export function purchaseCard({ title, buyer, img, name, html }) {
  return card(`${head("store", title, `<span class="ui-chip">${esc(buyer)}</span>`)}${body(`<div class="cc-thing"><img src="${esc(img)}" alt="">`
    + `<span class="cc-name">${esc(name)}<small>${html}</small></span></div>`)}`);
}

/** One compact line: a picture (or an icon), the text and an optional second line. `html` is escaped markup. */
export function compactCard({ img, icon, tone = "", html, aux = "", big = "" }) {
  const lead = big !== "" ? `<span class="cc-big">${esc(big)}</span>`
    : img ? `<img src="${esc(img)}" alt="">` : `<i class="fa-solid fa-${icon}"></i>`;
  return card(`${lead}<span class="cc-main"><span class="cc-text">${html}</span>${aux ? `<span class="cc-aux">${esc(aux)}</span>` : ""}</span>`,
    `compact${tone ? ` ${tone}` : ""}`);
}

/** The area note a warband's attack card carries. The `sde-warband-note` hook marks it as already added. */
export function warbandNote({ text }) {
  return card(body(`<p class="cc-note info sde-warband-note"><i class="fa-solid fa-people-group"></i>${esc(text)}</p>`));
}

/** The pit fight twist reveal; `sub` is the optional 1d4 line. */
export function pitTwistCard({ title, text, sub = "" }) {
  return card(`${head("bolt", title)}${body(`<p class="cc-text">${esc(text)}</p>${sub ? `<p class="cc-fine">${esc(sub)}</p>` : ""}`)}`);
}
