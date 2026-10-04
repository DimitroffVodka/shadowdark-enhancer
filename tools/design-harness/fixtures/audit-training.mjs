// Audit fixture: Regional Training, built with the real TRAINERS metadata.
import { TRAINERS } from "../../../scripts/training/training-core.mjs";
const t = TRAINERS.find((x) => x.key === "yodeling") ?? TRAINERS[0];
const regions = [...new Set(TRAINERS.map((x) => x.region))];
const build = (state) => ({ context: {
  tasks: [
    { text: "Climb the Singing Cliff at dawn and answer the echo of the three sisters without a single break in the note.", index: 0, quest: true, done: true },
    { text: "Win a yodel-off against the innkeeper of the Hanging Goat.", index: 1, quest: true, done: false },
    { text: "Carry a cheese wheel up the mountain while singing.", index: 2, canTake: state !== "player" },
    { text: "Teach the song to a stranger.", index: 3, canTake: state !== "player" },
  ],
  description: "Clementine lives in a hut above the snow line and teaches anyone who can hold a note across a ravine. She dislikes silence.",
  art: "/modules/shadowdark-enhancer/icons/game-icons/classes/pointy-hat.svg", journalUuid: "JournalEntry.x", canImport: state !== "player",
  canRoll: true, actors: [{ id: "a", name: "Creeg Greythorn", selected: true }, { id: "b", name: "Elbin Grizzlegut" }],
  groups: regions.map((region) => ({ region, trainers: TRAINERS.filter((x) => x.region === region).map((x) => ({ key: x.key, name: `${x.topic} - ${x.trainer}`, selected: x.key === t.key })) })),
  trainer: t, benefits: t.benefits.map((b, i) => ({ roll: b.roll, label: b.label, printed: i === 1 ? "" : b.label + " (as printed in the book, a longer sentence that wraps onto two lines)", todo: b.todo ?? "", mechanical: !!(b.actions || b.changes || b.choice), taken: i === 0 })),
  remaining: 3, spent: false, tableMissing: false, hasActor: true,
} });
export default { previewHeight: 760, title: "SDE.training.title", icon: "fa-solid fa-dumbbell", classes: ["shadowdark", "sde-training"], width: 520, resizable: true, template: "templates/training.hbs", initial: "gm", build, actions: {} };
