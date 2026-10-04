// The GM's Extra Gear editor (ApplicationV2 form): every Item compendium folder, default stock locked, a few grants ticked.
const mk = (uuid, name, type, isDefault, checked) => ({ uuid, name, type, img: "/icons/svg/item-bag.svg", isDefault, checked: isDefault || checked });
const folders = [
  ["Shadowdark Gear", ["Backpack", "Caltrops", "Crowbar", "Flask of oil", "Flint and steel", "Grappling hook", "Iron spikes", "Lantern", "Rope, 60'", "Torch"].map((n, i) => mk("a" + i, n, "Basic", true, false))],
  ["Shadowdark Magic Items", ["Potion of Healing", "Scroll of Fireball", "Wand of Magic Missile", "Ring of Protection with an unreasonably long enchanted name to test the cut-off"].map((n, i) => mk("m" + i, n, i === 1 ? "Scroll" : i === 0 ? "Potion" : "Wand", false, i < 2))],
  ["World Items", ["Dwarven Pickaxe", "Moonblade"].map((n, i) => mk("w" + i, n, "Weapon", false, false))],
  ["Western Reaches Gear", ["Climbing kit", "Fishing net", "Sled", "Snowshoes", "Tent, two-person"].map((n, i) => mk("r" + i, n, "Basic", false, false))],
].map(([label, items], i) => ({ id: "f" + i, label, count: items.length, items, hasChecked: i === 1 }));
export default {
  previewHeight: 760, title: "SDE.charBuilder.extraGear.title", icon: "fa-solid fa-toolbox", classes: ["shadowdark", "sde-extra-gear-editor"],
  width: 560, height: 720, resizable: true, template: "templates/char-builder/gear-editor.hbs",
  context: { sources: folders.map((f) => ({ id: f.id, label: f.label, count: f.count })), count: 12, hasGroups: true, folders },
};
