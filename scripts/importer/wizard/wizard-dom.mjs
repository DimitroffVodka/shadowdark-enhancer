/**
 * Shadowdark Enhancer — the wizard's browser wiring.
 *
 * What a plain template cannot do: open the file dialog, take dropped files, and pass an
 * element's data-* to the controller. Used by the Foundry window and by the browser preview,
 * so a click means the same in both. No Foundry globals.
 */

/** The data a click carries into WizardController.dispatch: the element's data-*, plus its value for a radio. */
export const actionData = (el) => ({ ...el.dataset, value: el.value });

/** Open the file dialog of the picker beside a "Choose files" button. Must run inside the click itself. */
export function openPicker(button) {
  button.closest("[data-dropzone]")?.querySelector("[data-picker]")?.click();
}

/**
 * Wire the file inputs and drop zones under `root`. Call after every render: the nodes are new.
 * @param {HTMLElement} root
 * @param {{dispatch:(action:string, data:object)=>any}} controller
 */
export function wireFiles(root, controller) {
  for (const input of root.querySelectorAll("input[data-picker]")) {
    input.addEventListener("change", () => {
      const files = [...input.files];
      input.value = "";   // so choosing the same file again still fires
      if (files.length) controller.dispatch("pick", { files });
    });
  }
  for (const zone of root.querySelectorAll("[data-dropzone]")) {
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("is-over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("is-over");
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) controller.dispatch("pick", { files });
    });
  }
}

/**
 * Wire the Terrain page's cards: a name chosen on a card or on one hex of an opened card goes to the controller as it is
 * given (a card is only redrawn when it opens up), and "other…" shows its text box. Call after every render.
 * @param {HTMLElement} root
 * @param {{dispatch:(action:string, data:object)=>any}} controller
 */
export function wireLegend(root, controller) {
  for (const sel of root.querySelectorAll("select[data-wiz-legend], select[data-wiz-pick]")) {
    const pick = sel.hasAttribute("data-wiz-pick");
    const box = root.querySelector(pick ? `input[data-wiz-pick-other][data-num="${sel.dataset.num}"]` : `input[data-wiz-legend-other][data-idx="${sel.dataset.idx}"]`);
    const send = () => controller.dispatch(pick ? "legendPick" : "legendAnswer", { idx: sel.dataset.idx, num: sel.dataset.num, value: sel.value, other: box?.value.trim() ?? "" });
    sel.addEventListener("change", () => {
      if (box) { box.hidden = sel.value !== "__other"; if (!box.hidden) box.focus(); }
      send();
    });
    box?.addEventListener("change", send);
  }
  // A hex picture is hard to judge alone (a coast depends on where it sits): a double click takes the map to it.
  for (const img of root.querySelectorAll("img[data-wiz-locate]")) img.addEventListener("dblclick", () => controller.legend?.locate(img.dataset.num));
}

/**
 * One listener for every [data-action] under `root` (the preview's; Foundry's window has its own action map).
 * "choose" opens the file dialog; the rest go to the controller.
 */
export function wireClicks(root, controller) {
  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || !root.contains(el) || el.disabled) return;
    const action = el.dataset.action;
    if (action === "choose") return openPicker(el);
    if (el.tagName === "A") e.preventDefault();
    controller.dispatch(action, actionData(el));
  });
}
