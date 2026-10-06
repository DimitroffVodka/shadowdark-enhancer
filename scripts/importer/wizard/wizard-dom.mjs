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
