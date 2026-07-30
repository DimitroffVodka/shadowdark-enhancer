/**
 * Renown — the GM's award / dock dialog.
 *
 * Most of the book's renown triggers are judgement calls at the table (a public
 * honour, a humiliation, a faux pas), so the affordance is a dialog, not
 * automation. It doubles as the band display: the roster at the top shows every
 * PC's renown, the band it puts them in, what that band means, and the reaction
 * bonus it grants.
 *
 * A DialogV2 rather than an ApplicationV2 window on purpose — this is a
 * one-shot "who, how much, why", not a surface anyone keeps open.
 *
 * GM-only, like every other document-writing entry point in this module. All
 * writes go through `Renown.award`, so a change made here is logged exactly
 * like one made by downtime or a level-up.
 */

import { Renown } from "./renown.mjs";
import {
  RENOWN_HISTORY_CAP, RENOWN_TRIGGERS, historyRow, showsSourceTag, signedRenown, sourceLabel,
} from "./renown-core.mjs";

const { DialogV2 } = foundry.applications.api;

export const RenownAwardDialog = {

  /**
   * Open the dialog.
   * @param {object} [opts]
   * @param {string} [opts.actorId]  pre-select this PC
   * @param {number} [opts.delta]    pre-fill the change (default +1)
   * @param {string} [opts.reason]   pre-fill the reason
   * @returns {Promise<object|null>} the award result, or null if nothing applied
   */
  async open({ actorId = null, delta = 1, reason = "" } = {}) {
    if (!game.user?.isGM) {
      ui.notifications?.warn("Only a GM can change renown.");
      return null;
    }

    const party = Renown.party();
    if (!party.length) {
      ui.notifications?.warn("No player characters found. Renown is tracked on Player actors with a player owner.");
      return null;
    }

    // Read once, before the dialog opens — the ledger is static for the life of
    // one dialog, which is a single "who, how much, why".
    const history = Renown.historyByPlayer();

    // Default target: the selected token's PC if there is one, else whoever
    // the GM asked for, else the character with the most renown — the one the
    // table is most likely to be talking about.
    const controlled = canvas?.tokens?.controlled?.[0]?.actor ?? null;
    const preferred = actorId
      ?? (party.some((p) => p.actorId === controlled?.id) ? controlled.id : null)
      ?? party[0].actorId;

    const choice = await DialogV2.wait({
      window: { title: "Renown", icon: "fas fa-crown" },
      position: { width: 460 },
      content: _content({ party, preferred, delta, reason, history }),
      buttons: [
        { action: "apply", label: "Apply", icon: "fas fa-check", default: true, callback: _readForm },
        { action: "cha", label: "Start at CHA mod", icon: "fas fa-dice-d20", callback: _readForm },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
      rejectClose: false,
    }).catch(() => null);

    if (!choice || choice === "cancel" || !choice.actorId) return null;

    const actor = game.actors.get(choice.actorId);
    if (!actor) {
      ui.notifications?.warn("That character no longer exists.");
      return null;
    }

    // `force` — an explicit click overrides both the setting and the once-only
    // rule, and asks for the chat card the automatic seed suppresses.
    const result = choice.action === "cha"
      ? await Renown.maybeSeedFromCha(actor, { force: true, chat: true })
      : await Renown.award({ actor, delta: choice.delta, reason: choice.reason, source: "gm" });

    if (!result.ok) {
      ui.notifications?.error(result.error ?? "Renown could not be changed.");
      return null;
    }
    if (result.delta === 0) {
      ui.notifications?.info(`${actor.name}: renown unchanged.`);
      return result;
    }
    ui.notifications?.info(result.summary);
    return result;
  },
};

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Pull the form values off the dialog and hand the caller a plain object.
 *
 * The third callback argument has been both the DialogV2 instance and the
 * dialog element across Foundry versions, so the root is resolved defensively
 * — `dialog.element` when it is the application, the button's own form
 * otherwise. Both resolve to the same `<form>` DialogV2 wraps content in.
 */
function _readForm(_event, button, dialog) {
  const root = dialog?.element ?? button?.form ?? button?.closest("form") ?? null;
  const pick = (sel) => root?.querySelector(sel) ?? null;
  return {
    action: button.dataset.action ?? button.value ?? "apply",
    actorId: pick("[name='renownActor']")?.value ?? null,
    delta: Number(pick("[name='renownDelta']")?.value ?? 0) || 0,
    reason: String(pick("[name='renownReason']")?.value ?? "").trim(),
  };
}

/**
 * The per-player ledger, one collapsed `<details>` per player.
 *
 * Static HTML on purpose. DialogV2 wraps the content in a form and does not
 * re-render it, so a panel that had to follow the Character select would need
 * event wiring on a one-shot dialog; `<details>` is browser-native and needs
 * none. Newest change first inside each player, which is the order a GM asks in.
 *
 * @param {Array<{player:string, net:number, count:number, entries:Array<object>}>} history
 */
function _historySection(history) {
  const esc = foundry.utils.escapeHTML;

  if (!history.length) {
    return `
      <details class="sde-renown-history">
        <summary>Renown log</summary>
        <p class="sde-renown-history-empty">
          No renown changes recorded yet. Every change from here, from a level-up
          and from downtime is logged on the character from now on.
        </p>
      </details>`;
  }

  const players = history.map((group) => {
    const rows = [...group.entries].reverse().map((row) => {
      const when = Number(row.at) > 0 ? new Date(Number(row.at)).toLocaleString() : "";
      // The provenance tag — see `showsSourceTag`. It is what makes the cause
      // visible at all for a writer that supplies its own wording, which
      // shadowdark-extras' carousing always does.
      const tagged = showsSourceTag(row);
      const label = tagged ? sourceLabel(row.source) : "";
      return `
        <li class="sde-renown-history-row ${Number(row.delta) < 0 ? "sde-renown-down" : "sde-renown-up"}">
          <span class="sde-renown-history-who">${esc(String(row.actorName ?? "—"))}</span>
          <span class="sde-renown-history-what">${esc(historyRow(row))}</span>
          ${tagged ? `<span class="sde-renown-history-tag">${esc(label)}</span>` : ""}
          ${when ? `<span class="sde-renown-history-when" title="${esc(when)}">${esc(when.split(",")[0])}</span>` : ""}
        </li>`;
    }).join("");

    return `
      <details class="sde-renown-history-player">
        <summary>
          <span class="sde-renown-history-name">${esc(group.player)}</span>
          <span class="sde-renown-history-net">${signedRenown(group.net)} over ${group.count} change${group.count === 1 ? "" : "s"}</span>
        </summary>
        <ul class="sde-renown-history-list">${rows}</ul>
      </details>`;
  }).join("");

  const total = history.reduce((sum, g) => sum + g.count, 0);

  return `
    <details class="sde-renown-history">
      <summary>Renown log — ${total} change${total === 1 ? "" : "s"}</summary>
      <div class="sde-renown-history-body">${players}</div>
      <p class="sde-renown-history-foot">
        Grouped by the player who owned the character when the change was made.
        Each character keeps its last ${RENOWN_HISTORY_CAP} changes.
      </p>
    </details>`;
}

function _content({ party, preferred, delta, reason, history = [] }) {
  const esc = foundry.utils.escapeHTML;

  const rows = party.map((p) => `
    <tr class="${p.actorId === preferred ? "sde-renown-row-current" : ""}">
      <td class="sde-renown-cell-name">${esc(p.name)}</td>
      <td class="sde-renown-cell-value">${p.renown}</td>
      <td class="sde-renown-cell-band">
        <span class="sde-renown-band-label">${esc(p.band.label)}</span>
        <span class="sde-renown-band-note">${esc(p.band.note)}</span>
      </td>
      <td class="sde-renown-cell-bonus">${p.bonus ? signedRenown(p.bonus) : "—"}</td>
    </tr>`).join("");

  const options = party.map((p) =>
    `<option value="${esc(p.actorId)}"${p.actorId === preferred ? " selected" : ""}>${esc(p.name)} (${p.renown} · ${esc(p.band.label)})</option>`
  ).join("");

  const suggestions = [...RENOWN_TRIGGERS.gains, ...RENOWN_TRIGGERS.losses]
    .map((t) => `<option value="${esc(t)}"></option>`).join("");

  return `
    <div class="sde-renown-dialog">
      <table class="sde-renown-roster">
        <thead>
          <tr><th>Character</th><th>Renown</th><th>Band</th><th title="Bonus on reaction rolls, which the Encounter Roller applies, and on carousing rolls, which you apply yourself">Bonus</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="sde-renown-form">
        <label for="sde-renown-actor">Character</label>
        <select id="sde-renown-actor" name="renownActor">${options}</select>

        <label for="sde-renown-delta">Change</label>
        <input id="sde-renown-delta" type="number" name="renownDelta" step="1" value="${Number(delta) || 0}" />

        <label for="sde-renown-reason">Reason</label>
        <input id="sde-renown-reason" type="text" name="renownReason" list="sde-renown-triggers"
               placeholder="Why it changed" value="${esc(String(reason ?? ""))}" />
        <datalist id="sde-renown-triggers">${suggestions}</datalist>
      </div>

      ${_historySection(history)}

      <p class="sde-renown-hint">
        Renown may go negative. The Encounter Roller adds the bonus to a reaction
        roll when you mark the party as recognised — you decide that per roll.
        Carousing rolls are not automated, so add it by hand there.
        A new character is seeded from their CHA modifier automatically;
        <strong>Start at CHA mod</strong> does it again on demand, for a character
        made before this was on or one whose CHA has since changed. It ignores the
        Change field.
      </p>
    </div>`;
}
