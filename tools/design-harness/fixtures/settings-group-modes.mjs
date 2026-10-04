// SettingsGroupMenu for the "modesOfPlayMenu" group (scripts/shared/settings-group-menu.mjs), 720px wide as DEFAULT_OPTIONS says.
// Built by _settings-group.mjs from the real template, setting registrations and SETTING_GROUPS.
import { settingsGroupHtml, windowHtml } from "./_settings-group.mjs";
const faked = {   // another package's settings, which the harness cannot read (invented labels, real keys)
  "shadowdark.useMomentumMode": { name: "Momentum mode", hint: "Gain Momentum on a natural 20 and spend it for a reroll.", type: Boolean, default: false },
  "shadowdark.usePulpMode": { name: "Pulp mode", hint: "Heroes take bigger risks and recover faster.", type: Boolean, default: true },
  "shadowdark-extras.grinderMode": { name: "Grinder mode", hint: "Slow, deadly play with hit dice.", type: Boolean, default: true },
  "shadowdark-extras.grinderHitDice": { name: "Grinder hit dice", hint: "How many hit dice a character starts with.", type: Number, default: 2 },
};
const g = settingsGroupHtml("modesOfPlayMenu", { faked });
export default { previewHeight: 760, title: g.title, width: 720, html: windowHtml("sde-settings-modes", g) };
