import { MODULE_ID } from "../shared/module-id.mjs";
import { esc } from "../shared/esc.mjs";
import { Party } from "../party/party.mjs";
import { configureMovement, marchGrid } from "../party/party-movement.mjs";
import { moveToSlot } from "../party/party-movement-core.mjs";

const t = (key, data = {}) => game.i18n.format(key, data);

/** The march switch for the strip's PARTY plate: on gold while the party marches, outlined while on but nobody is out yet. */
export function marchButtonHTML(party, { active }) {
  const on = !!Party.data(party).followLeader;
  const tip = t(on ? (active ? "SDE.crawlStrip.marchOn" : "SDE.crawlStrip.marchWaiting") : "SDE.crawlStrip.marchOff");
  return `<button class="sde-strip-march-btn ${on ? "on" : ""} ${active ? "active" : ""}" data-action="toggleMarch" data-party-id="${esc(party.id)}" aria-pressed="${on}" title="${esc(tip)}" aria-label="${esc(tip)}"><i class="fas fa-people-arrows"></i></button>`;
}

/** The 3x3 marching order as it stands, the top row the front. Anyone who may manage the party can drag and click it. */
export function marchGridHTML(party, { canEdit }) {
  const cells = marchGrid(party).map(c => {
    const tip = c.name ? t(c.leader ? "SDE.crawlStrip.marchCellLeader" : "SDE.crawlStrip.marchCell", { name: c.name }) : t("SDE.party.movement.emptySlot");
    const live = canEdit && !!c.name;
    // A button for the keyboard too, as the sheet's own grid and the strip's cards are; an empty or read-only cell is inert.
    return `<div class="sde-strip-march-cell${c.leader ? " leader" : ""}${c.name ? "" : " empty"}" role="button" tabindex="${live ? 0 : -1}" aria-label="${esc(tip)}"${live ? ` draggable="true"` : ` aria-disabled="true"`} data-march-slot data-row="${c.row}" data-col="${c.col}" data-uuid="${esc(c.uuid ?? "")}" title="${esc(tip)}">${c.img ? `<img src="${esc(c.img)}" alt="${esc(c.name)}">` : ""}</div>`;
  }).join("");
  return `<div class="sde-strip-march" data-march-grid data-party-id="${esc(party.id)}" title="${esc(t("SDE.crawlStrip.marchGridTip"))}">${cells}</div>`;
}

/** Wire the switch and the grid inside `root`. The party's own hook re-draws the strip after each write. */
export function bindMarchControls(root) {
  const change = async (write) => {
    try { await write(); } catch (error) {
      console.error(`${MODULE_ID} | Marching order`, error);
      ui.notifications?.warn(game.i18n.localize(error.message?.startsWith("SDE.") ? error.message : "SDE.party.unknownRoster"));
    }
  };
  const button = root.querySelector('[data-action="toggleMarch"]');
  button?.addEventListener("click", event => {
    event.stopPropagation();
    const party = Party.get(button.dataset.partyId);
    if (party && Party.canManage(party)) void change(() => configureMovement(party, { followLeader: !Party.data(party).followLeader }));
  });
  for (const cell of root.querySelectorAll("[data-march-slot]")) {
    const party = () => Party.get(cell.closest("[data-march-grid]")?.dataset.partyId);
    const manage = () => { const p = party(); return p && Party.canManage(p) ? p : null; };
    const lead = () => { const p = manage(); if (p && cell.dataset.uuid) void change(() => configureMovement(p, { leaderUuid: cell.dataset.uuid })); };
    cell.addEventListener("click", lead);
    cell.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); lead(); } });
    cell.addEventListener("dragstart", event => { if (!manage() || !cell.dataset.uuid) return event.preventDefault(); event.dataTransfer.setData("text/plain", cell.dataset.uuid); });
    cell.addEventListener("dragover", event => { if (manage()) event.preventDefault(); });
    cell.addEventListener("drop", event => {
      event.preventDefault();
      const p = manage();
      if (!p) return;
      const slots = moveToSlot(Party.data(p), Party.rows(p), event.dataTransfer.getData("text/plain"), Number(cell.dataset.row), Number(cell.dataset.col));
      if (slots) void change(() => configureMovement(p, { formation: { slots } }));
    });
  }
}
