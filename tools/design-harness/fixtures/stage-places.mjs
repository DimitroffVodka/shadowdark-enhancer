// The Stage Places window with invented places and tinted stand-in pictures, rendered through the real template.
// The ready places come first, as in the real window; the list below is the GM's own.
// state = busy (24 places, a very long name, all four kinds, one shown, an upload running) | empty | shown (a few places, one on show)
const KINDS = ["town", "tavern", "camp", "custom"];
const label = (k) => `SDE.stage.places.kind${k[0].toUpperCase()}${k.slice(1)}`;

const art = (hue) => "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},38%,34%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},42%,16%)"/></linearGradient></defs><rect width="128" height="128" fill="url(#g)"/><circle cx="${40 + (hue % 60)}" cy="64" r="26" fill="hsl(${hue},32%,48%)" opacity=".75"/></svg>`);

const NAMES = ["Greybanner", "The Gilded Flagon", "Dunmere Market", "Old Mill", "Harbour at night", "River crossing", "Sablewood camp", "The Sunken Temple"];
const LONG = "The Ever-Smoking Tavern of the Three Drowned Bells and Other Names Nobody Would Pick, Out by the Salt Road";

const SCENES = [{ id: "s1", name: "Greybanner (town page)" }, { id: "s2", name: "The Gilded Flagon" }];
const place = (i, shownIdx, name) => {
  const kind = KINDS[i % 4];
  const pageId = i === 2 || i === 4 ? "gone" : i === 0 ? "s1" : null; // busy: a row with a page, a row whose page is missing
  return { id: `p${i}`, pageSceneId: pageId, pageNone: !pageId, pageMissing: pageId === "gone", pageScenes: SCENES.map((s) => ({ ...s, selected: s.id === pageId })), name: name ?? `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` ${i}` : ""}`, image: art((i * 37) % 360), shown: i === shownIdx, kinds: KINDS.map((value) => ({ value, label: label(value), selected: value === kind })) };
};

const READY = [["SDE.stage.ready.tavern", 20], ["SDE.stage.ready.town", 140], ["SDE.stage.ready.market", 260]];
const ready = (shownIdx) => READY.map(([nameKey, hue], i) => ({ id: `ready-${i}`, nameKey, image: art(hue), shown: i === shownIdx }));

const build = (state) => {
  const places = state === "empty" ? [] : state === "shown" ? [place(0, 1), place(1, 1), place(2, 1)] : Array.from({ length: 24 }, (_, i) => place(i, 2, i === 1 ? LONG : undefined));
  const kinds = KINDS.map((value) => ({ value, label: label(value) }));
  return { strings: {}, parts: [
    { id: "ready", template: "templates/stage/places-ready.hbs", context: { ready: ready(state === "shown" ? 0 : -1) } },
    { id: "add", template: "templates/stage/places-add.hbs", context: { kinds, pageScenes: SCENES, busy: state === "busy" } },
    { id: "list", template: "templates/stage/places-list.hbs", context: { places } },
  ] };
};

export default {
  title: "SDE.stage.places.title", icon: "fa-solid fa-images", classes: ["sde-ui", "sde-stage-places"], resizable: true, width: 560,
  previewHeight: 900, initial: "busy", build,
  toolbar: ["busy", "empty", "shown"].map((s) => `<button data-action="t" data-state="${s}">${s}</button>`).join(""),
  actions: { t: { state: "{state}" } },
};
