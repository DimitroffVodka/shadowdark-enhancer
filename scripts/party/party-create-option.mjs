/**
 * The Create Actor type list offers one Party. The Enhancer's own entry is added, and Extras' separate
 * "Party" entry (value `Party`) is dropped, including when Extras adds it after this runs. Extras on its
 * own is untouched: this only runs where the Enhancer is active.
 */
const EXTRAS_PARTY = 'option[value="Party"]';

export function offerParty(select, label, observe = (el, fn) => new MutationObserver(fn).observe(el, { childList: true })) {
  if (!select?.querySelector('option[value="NPC"]') || select.querySelector('option[value="sde-party"]')) return;
  const option = document.createElement("option");
  option.value = "sde-party"; option.textContent = label; select.append(option);
  const dropExtras = () => select.querySelector(EXTRAS_PARTY)?.remove();
  dropExtras();
  observe(select, dropExtras);
}
