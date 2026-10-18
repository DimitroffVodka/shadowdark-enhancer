// The Stage Places window with invented places and tinted stand-in pictures, rendered through the real template.
// state = busy (24 places, a very long name, all four kinds, one shown, an upload running) | empty | shown (a few places, one on show)
const KINDS = ["town", "tavern", "camp", "custom"];
const label = (k) => `SDE.stage.places.kind${k[0].toUpperCase()}${k.slice(1)}`;

const art = (hue) => "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},38%,34%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},42%,16%)"/></linearGradient></defs><rect width="128" height="128" fill="url(#g)"/><circle cx="${40 + (hue % 60)}" cy="64" r="26" fill="hsl(${hue},32%,48%)" opacity=".75"/></svg>`);

const NAMES = ["Greybanner", "The Gilded Flagon", "Dunmere Market", "Old Mill", "Harbour at night", "River crossing", "Sablewood camp", "The Sunken Temple"];
const LONG = "The Ever-Smoking Tavern of the Three Drowned Bells and Other Names Nobody Would Pick, Out by the Salt Road";

const place = (i, shownIdx, name) => {
  const kind = KINDS[i % 4];
  return { id: `p${i}`, name: name ?? `${NAMES[i % NAMES.length]}${i >= NAMES.length ? ` ${i}` : ""}`, image: art((i * 37) % 360), shown: i === shownIdx, kinds: KINDS.map((value) => ({ value, label: label(value), selected: value === kind })) };
};

const build = (state) => {
  const places = state === "empty" ? [] : state === "shown" ? [place(0, 1), place(1, 1), place(2, 1)] : Array.from({ length: 24 }, (_, i) => place(i, 2, i === 1 ? LONG : undefined));
  const kinds = KINDS.map((value) => ({ value, label: label(value) }));
  return { strings: {}, parts: [
    { id: "add", template: "templates/stage/places-add.hbs", context: { kinds, busy: state === "busy" } },
    { id: "list", template: "templates/stage/places-list.hbs", context: { places } },
  ] };
};

export default {
  title: "SDE.stage.places.title", icon: "fa-solid fa-images", classes: ["sde-ui", "sde-stage-places"], resizable: true, width: 560,
  previewHeight: 900, initial: "busy", build,
  toolbar: ["busy", "empty", "shown"].map((s) => `<button data-action="t" data-state="${s}">${s}</button>`).join(""),
  actions: { t: { state: "{state}" } },
};
