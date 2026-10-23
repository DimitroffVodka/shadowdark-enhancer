// Thin wrapper: the engine ships with foundry-mcp-live (see engine.mjs and README.md).
import { engineUrl } from "./engine.mjs";
await import(engineUrl("shot.mjs"));
