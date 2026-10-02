/**
 * Shadowdark Enhancer — Bastions: where the art is.
 *
 * The exterior of a bastion type is a plain SVG file (assets/bastion/art), so an
 * actor and its token can carry it as their image.
 */

import { MODULE_ID } from "../shared/module-id.mjs";

export const bastionArt = (type) => `modules/${MODULE_ID}/assets/bastion/art/${type}.svg`;
