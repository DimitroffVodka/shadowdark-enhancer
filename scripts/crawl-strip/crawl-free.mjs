import { MODULE_ID } from "../shared/module-id.mjs";
import { freeCrawlActive } from "./crawl-state-core.mjs";
import { marchOf } from "../party/party-movement.mjs";

/**
 * Is this crawl "free movement": no feet, no rolled order, no turn lock? The world setting asks for it, and so does a
 * party that is marching, because one person moving everyone leaves nobody a turn of their own. Combat is exempt.
 */
export const crawlFree = (mode) => freeCrawlActive(game.settings.get(MODULE_ID, "crawlFreeMovement") || !!marchOf(), mode);
