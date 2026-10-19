// The Arena fight picker (a DialogV2 body) with tinted stand-in thumbnails, rendered through the real template.
const art = (hue) => "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},38%,34%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},42%,16%)"/></linearGradient></defs><rect width="160" height="120" fill="url(#g)"/><circle cx="80" cy="60" r="34" fill="none" stroke="#ffb23f" stroke-width="3" opacity=".8"/></svg>`);
const LOOKS = [["pit", "Pit", 20], ["coliseum", "Coliseum", 50], ["ring", "Tournament ring", 100], ["tavern", "Tavern", 180], ["town", "Town square", 230], ["market", "Market", 300]];

const build = () => ({ strings: {}, parts: [
  { id: "body", template: "templates/stage/arena-picker.hbs", context: { looks: LOOKS.map(([id, label, hue], i) => ({ id: `arena-${id}`, label, thumb: art(hue), checked: i === 3 })) } },
] });

export default {
  title: "SDE.stage.arena.pickerTitle", icon: "fa-solid fa-circle-dot", classes: ["sde-ui", "sde-arena-picker"], width: 460,
  previewHeight: 520, build,
};
