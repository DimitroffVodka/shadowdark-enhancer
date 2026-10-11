// The Temp HP row under the system's HP box on a Player sheet (scripts/character-sheet/temp-hp-field.mjs).
// The HP box is the system's templates/actors/player/abilities/hp.hbs, rendered; the row is what the module appends.
// It is injected by JS, so this is a still of the markup, not its logic; the look is the module's own stylesheet.
const box = (temp, disabled = "") => `<div class="SD-box" style="width: 220px">
  <div class="header"><label>HP</label><span><a class="item-selector fas fa-pen-to-square edit-button" data-action="toggle-edit-hp"></a></span></div>
  <div class="content larger">
    <div class="value-grid"><input type="number" name="system.attributes.hp.value" value="3" placeholder="0"><div>/</div><div>3</div></div>
    <label class="sde-temp-hp"><span>Temp HP</span><input type="number" min="0" step="1" value="${temp}" ${disabled}></label>
  </div>
</div>`;
export default {
  previewHeight: 200, title: "Temp HP field", width: 820,
  html: `<div class="shadowdark sheet actor player" style="display:flex;gap:24px;padding:16px">${box(2)}${box(0)}${box(2, "disabled")}</div>`,
};
