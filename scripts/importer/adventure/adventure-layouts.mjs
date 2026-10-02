/**
 * Shadowdark Enhancer — where each adventure's room numbers sit on its map.
 *
 * Positions only: for a site, "pin 23 is this far across and this far down the
 * map", as fractions of the whole map picture (0 to 1), so the same layout fits
 * the GM's copy of that map at any resolution. No book text and no art ship, and
 * the module cannot place a pin on a map it has no layout for: that is still the
 * GM's one-click-per-room job (adventure-placer.mjs).
 *
 * `aspect` is the map's width over its height when the layout was captured. A
 * scene whose image differs from it by more than map-labels.mjs ASPECT_TOLERANCE
 * is not the same map, so nothing is placed from the layout.
 *
 * To add a site: place its pins by clicking, press "Copy layout" in the placer,
 * and paste the result into ADVENTURE_LAYOUTS below (CONTRIBUTING.md). The four
 * sites the book prints its numbers as text for were captured from the book's own
 * key map (map-labels.mjs) the same way.
 */

/** Positions are kept to four decimals: a tenth of a square on a 68-square map. */
const PLACES = 4;

export const ADVENTURE_LAYOUTS = {
  "cs1-mugdulblub": {
    aspect: 1.5521,
    pins: {
      1: [0.8546, 0.1518], 2: [0.7925, 0.2446], 3: [0.7802, 0.08], 4: [0.6269, 0.0553],
      5: [0.7058, 0.2932], 6: [0.7124, 0.2008], 7: [0.6554, 0.436], 8: [0.5568, 0.3381],
      9: [0.5239, 0.2405], 10: [0.4349, 0.1794], 11: [0.4378, 0.3252], 12: [0.3455, 0.3795],
      13: [0.2985, 0.2145], 14: [0.1828, 0.277], 15: [0.2214, 0.0797], 16: [0.0698, 0.1763],
      17: [0.0631, 0.3825], 18: [0.2289, 0.3884], 19: [0.0531, 0.501], 20: [0.0787, 0.6999],
      21: [0.1431, 0.5632], 22: [0.155, 0.7287], 23: [0.321, 0.8216], 24: [0.4345, 0.6312],
      25: [0.2759, 0.636], 26: [0.4836, 0.8102], 27: [0.6481, 0.8307], 28: [0.8091, 0.8783],
      29: [0.9311, 0.8451], 30: [0.7112, 0.5757], 31: [0.9407, 0.742], 32: [0.9337, 0.519],
      33: [0.8217, 0.4007],
    },
  },
  "cs3-sea-wolf": {
    aspect: 1.5674,
    pins: {
      1: [0.1408, 0.7986], 2: [0.2742, 0.9039], 3: [0.4158, 0.8824], 4: [0.536, 0.631],
      5: [0.6948, 0.6365], 6: [0.6396, 0.9081], 7: [0.863, 0.8554], 8: [0.9522, 0.8152],
      9: [0.9517, 0.5451], 10: [0.8706, 0.4661], 11: [0.9349, 0.349], 12: [0.9125, 0.2486],
      13: [0.8471, 0.126], 14: [0.9187, 0.0963], 15: [0.6687, 0.1378], 16: [0.46, 0.2306],
      17: [0.6379, 0.3138], 18: [0.3503, 0.0904], 19: [0.3267, 0.3435], 20: [0.3416, 0.4495],
      21: [0.2963, 0.7418], 22: [0.2532, 0.5487], 23: [0.0734, 0.5797], 24: [0.1188, 0.5091],
      25: [0.142, 0.3971], 26: [0.0802, 0.3041], 27: [0.0527, 0.1902], 28: [0.1746, 0.1392],
      29: [0.1027, 0.0687],
    },
  },
  "cs5-leng-1": {
    aspect: 1.5754,
    pins: {
      1: [0.1977, 0.2653], 2: [0.1801, 0.4998], 3: [0.0891, 0.4304], 4: [0.0782, 0.1452],
      5: [0.3032, 0.1675], 6: [0.4095, 0.2895], 7: [0.5903, 0.2137], 8: [0.442, 0.4309],
      9: [0.7629, 0.0929], 10: [0.895, 0.2625], 11: [0.9255, 0.3534], 12: [0.955, 0.0972],
      13: [0.7146, 0.4283], 14: [0.8806, 0.4964], 15: [0.8982, 0.8139], 16: [0.7726, 0.8128],
      17: [0.5925, 0.9039], 18: [0.5772, 0.7842], 19: [0.6235, 0.6906], 20: [0.5052, 0.6227],
      21: [0.3602, 0.7305], 22: [0.3778, 0.5693], 23: [0.2875, 0.5935], 24: [0.3026, 0.8128],
      25: [0.2103, 0.6177], 26: [0.1801, 0.7886], 27: [0.0606, 0.7644], 28: [0.1071, 0.5935],
    },
  },
  "cs5-leng-2": {
    aspect: 1.5754,
    pins: {
      29: [0.1567, 0.4206], 30: [0.2914, 0.4262], 31: [0.3647, 0.524], 32: [0.2462, 0.5482],
      33: [0.3153, 0.5917], 34: [0.3611, 0.5917], 35: [0.423, 0.5724], 36: [0.4802, 0.5951],
      37: [0.5466, 0.5482], 38: [0.53, 0.7122], 39: [0.5907, 0.5309], 40: [0.6051, 0.6119],
      41: [0.6802, 0.524], 42: [0.423, 0.7331], 43: [0.3331, 0.7331], 44: [0.2424, 0.7546],
      45: [0.1536, 0.6678], 46: [0.0872, 0.543], 47: [0.1128, 0.7862], 48: [0.17, 0.8775],
      49: [0.3344, 0.8818], 50: [0.7258, 0.8045], 51: [0.9022, 0.4038], 52: [0.9189, 0.3101],
      53: [0.8617, 0.1449], 54: [0.6978, 0.1701], 55: [0.5652, 0.08], 56: [0.623, 0.3343],
      57: [0.4694, 0.1943], 58: [0.3638, 0.1453], 59: [0.2911, 0.1453], 60: [0.2312, 0.2185],
      61: [0.2066, 0.3231], 62: [0.3342, 0.311], 63: [0.1852, 0.08], 64: [0.0789, 0.2184],
    },
  },
};

/** Whether this site's pins can be placed without the GM clicking each one. */
export const hasKnownPositions = (site) => !!(site?.mapPages || ADVENTURE_LAYOUTS[site?.id]);

/** The saved layout for a site, or null. */
export const layoutFor = (siteId) => ADVENTURE_LAYOUTS[siteId] ?? null;

/**
 * A layout as the placement planner takes it.
 * @param {{pins:Record<string,[number,number]>}} layout
 * @returns {Map<number,{x:number,y:number}>}
 */
export function layoutPoints(layout) {
  return new Map(Object.entries(layout?.pins ?? {}).map(([num, [x, y]]) => [Number(num), { x, y }]));
}

const round = (n) => Number(n.toFixed(PLACES));

/**
 * Pure: a scene's pins as a layout.
 * @param {Array<{num:number, x:number, y:number}>} pins  Note positions in scene pixels
 * @param {{x:number, y:number, width:number, height:number}} rect  the scene's image area
 * @returns {{aspect:number, pins:Record<string,[number,number]>}}
 */
export function layoutFromPins(pins, rect) {
  const out = {};
  for (const p of [...pins].sort((a, b) => a.num - b.num)) {
    out[p.num] = [round((p.x - rect.x) / rect.width), round((p.y - rect.y) / rect.height)];
  }
  return { aspect: round(rect.width / rect.height), pins: out };
}

/**
 * Pure: one site's layout as the text to paste into ADVENTURE_LAYOUTS, four pins
 * to a line so a diff of a re-capture stays readable.
 */
export function layoutSnippet(siteId, layout) {
  const entries = Object.entries(layout.pins).map(([num, [x, y]]) => `${num}: [${x}, ${y}]`);
  const rows = [];
  for (let i = 0; i < entries.length; i += 4) rows.push(`      ${entries.slice(i, i + 4).join(", ")},`);
  return `  ${JSON.stringify(siteId)}: {\n    aspect: ${layout.aspect},\n    pins: {\n${rows.join("\n")}\n    },\n  },`;
}
