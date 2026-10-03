export default { previewHeight: 470,
  title: "SDE.hexMap.brush.title", icon: "fa-solid fa-paintbrush", classes: ["shadowdark", "sde-hex-brush"],
  width: 300, template: "templates/hex-brush.hbs",
  context: {
    terrainOptions: ["Forest", "Hills", "Mountains", "Plains", "Swamp", "Water"].map((l, i) => ({ value: l.toLowerCase(), label: l, selected: i === 0 })),
    features: [["river", "River"], ["path", "Path"], ["coast", "Coast"]].map(([value, label]) => ({ value, label, checked: false })),
    other: "__other__",
  },
};
