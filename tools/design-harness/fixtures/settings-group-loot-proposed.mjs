// Proposed kit version of the "lootXpMenu" settings group; see settings-group-loot.mjs for the current one.
import { proposedGroupFixture } from "./_settings-group.mjs";
const faked = {   // another package's settings (invented labels, real keys), as in the current fixture
  "shadowdark.useMomentumMode": { name: "Momentum mode", hint: "Gain Momentum on a natural 20 and spend it for a reroll.", type: Boolean, default: false },
  "shadowdark.usePulpMode": { name: "Pulp mode", hint: "Heroes take bigger risks and recover faster.", type: Boolean, default: true },
  "shadowdark-extras.grinderMode": { name: "Grinder mode", hint: "Slow, deadly play with hit dice.", type: Boolean, default: true },
  "shadowdark-extras.grinderHitDice": { name: "Grinder hit dice", hint: "How many hit dice a character starts with.", type: Number, default: 2 },
};
export default proposedGroupFixture("lootXpMenu", faked);
