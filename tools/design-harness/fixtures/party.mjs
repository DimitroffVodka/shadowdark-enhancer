import { party } from "./_party-data.mjs";
// Click the tabs. State names are tab names.
export default { previewHeight: 700, initial: "members", build: (tab) => party(tab), actions: { partyTab: { state: "{tab}" } } };
