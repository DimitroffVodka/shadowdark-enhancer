#!/usr/bin/env bash
# verify.sh — pre-commit / pre-release sanity check for shadowdark-enhancer.
# Run from module root. Exits non-zero if any BLOCKING check fails.
# WARNING checks surface tech debt but don't block commits.
#
# Covers: node --check, eslint (CI's own gate), and the grep wall below.
# It does NOT run `npm test` or `npm run inventory:check` — CI runs those too,
# so a green verify.sh is necessary but not sufficient before pushing.
#
# Flags:
#   --strict   Treat warnings as errors (use during security passes)
#
# Each grep pattern below was a real bug found in this codebase.
# When you find a new class of regression, add to BLOCKING.
# Pre-existing issues being tracked for cleanup go in WARNING.

set -e
strict=0
[[ "$1" == "--strict" ]] && strict=1
block_fail=0
warn_fail=0

scan_block() {
  local label="$1"
  local pattern="$2"
  shift 2
  if grep -nE "$pattern" "$@" 2>/dev/null; then
    echo "[BLOCK] $label"
    block_fail=1
  fi
}

scan_warn() {
  local label="$1"
  local pattern="$2"
  shift 2
  if grep -nE "$pattern" "$@" 2>/dev/null; then
    echo "[WARN]  $label"
    warn_fail=1
  fi
}

echo "=== node --check on .mjs files ==="
mjs_files=$(git ls-files 'scripts/*.mjs' 'scripts/**/*.mjs' 2>/dev/null | while IFS= read -r f; do
  [[ -f "$f" ]] && printf '%s\n' "$f"
done)
for f in $mjs_files; do
  if ! node --check "$f" 2>/dev/null; then
    echo "[BLOCK] syntax: $f"
    node --check "$f"
    block_fail=1
  fi
done

mjs_paths=( $mjs_files )

# CI's first step is `npm run lint` (eslint --max-warnings 0), so verify.sh used
# to pass on a tree that CI would reject. Three pre-existing no-unused-vars
# warnings failed the build that way on 2026-07-28.
echo "=== eslint — CI gate: npm run lint ==="
if [ -x node_modules/.bin/eslint ]; then
  if ! npm run --silent lint; then
    echo "[BLOCK] eslint: npm run lint failed (CI runs this first and fails on it)"
    block_fail=1
  fi
else
  echo "[WARN]  eslint not installed — run 'npm install' to enable this gate"
  warn_fail=1
fi

echo "=== BLOCKING — regressions of previously fixed bugs ==="

# Socketlib auth: handler context is { socketdata: { userId } }, not { senderId }.
scan_block "this.senderId (socketlib gives this.socketdata.userId)" \
  'this\.senderId' "${mjs_paths[@]}"

# Async global leakage between hook handlers (v6.10.15 fix).
scan_block "window._lastPlacedTemplateId (use let-scoped local in same fn)" \
  'window\._lastPlacedTemplateId' "${mjs_paths[@]}"

# Roll.safeEval sandbox exposes bare math fns; Math.* inside arg breaks.
scan_block "Math.* inside Roll.safeEval string arg (v6.10.15 fix)" \
  'Roll\.safeEval\([^)]*Math\.(floor|ceil|round|min|max|abs|PI|sqrt)' "${mjs_paths[@]}"

# Legacy v13 chat render hook. v14 fires renderChatMessageHTML.
scan_block 'Hooks.on("renderChatMessage" (use renderChatMessageHTML in v14)' \
  'Hooks\.on\("renderChatMessage"[^H]' "${mjs_paths[@]}"

# Global DOM monkeypatch — replaced with scoped hook in v6.10.15.
scan_block "Element.prototype.querySelector = (global monkeypatch)" \
  'Element\.prototype\.querySelector\s*=' "${mjs_paths[@]}"

# Heuristic Region pairing — v14 binds template.id === region.id (v6.10.16 fix).
scan_block "existingRegionIds snapshot (use parent.regions.get(template.id))" \
  'existingRegionIds\s*=' "${mjs_paths[@]}"

# Async prepareActorData hook — removed in v6.10.15.
scan_block "prepareActorData hook (use updateActor/renderActorSheet/createItem)" \
  'Hooks\.on\("prepareActorData"' "${mjs_paths[@]}"

# Region delete hook duplication — removed in v6.10.16.
scan_block 'Hooks.on("deleteRegion" (cascade already fires deleteMeasuredTemplate)' \
  'Hooks\.on\("deleteRegion"\s*,\s*\([^)]*\)\s*=>\s*_onDeleteTemplate' "${mjs_paths[@]}"

# Context menu v13 properties.
scan_block "context menu name:/condition: (use label:/visible: in v14)" \
  'menuItems\.push\(\s*\{\s*name:|menuItems\.push\(\s*\{\s*[^}]*condition:' "${mjs_paths[@]}"

# A roll config's targetUuid is normally a TokenDocument uuid, but not always —
# an Actor uuid resolves to an Actor, whose `.actor` is undefined. Reaching for
# `.actor` straight off a targetUuid resolution silently yields null, and the
# caller then does nothing at all: found live when a parry spent its once-a-day
# use and gave back no damage. Resolve through a helper that handles both.
scan_block "(await fromUuid(targetUuid)).actor (handle Actor uuids too)" \
  'fromUuid\((config\.)?targetUuid[^)]*\)[^;]*\)\?\.actor' "${mjs_paths[@]}"

# Content contract: shipped wiring files (class overlays) must carry NO book
# prose — any string literal of 8+ words is expression, not wiring. The paste
# supplies the text; overlays ship only SDE-authored mechanics.
if ! node -e '
const fs = require("fs");
const files = ["scripts/importer/char-content/class-overlays.mjs", "scripts/importer/tables/table-structure-seeds.mjs"];
let bad = 0;
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const m of src.matchAll(/"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`|'"'"'((?:[^'"'"'\\]|\\.)*)'"'"'/g)) {
    const s = m[1] ?? m[2] ?? m[3] ?? "";
    if (s.split(/\s+/).filter(Boolean).length >= 8) {
      console.log(f + ": prose-length string literal: \"" + s.slice(0, 60) + "…\"");
      bad = 1;
    }
  }
}
process.exit(bad);
' ; then
  echo "[BLOCK] content contract: prose-length string in a shipped overlay file"
  block_fail=1
fi

echo "=== WARNING — pre-existing tech debt (use --strict to block) ==="

# Raw eval() — none in this repo today; guard against one sneaking in.
scan_warn "raw eval( — use Roll.safeEval for formulas, new Function for scoped" \
  '^[^/]*[^.]eval\(' "${mjs_paths[@]}"

# Unescaped img.src interpolation — XSS surface; none in this repo today.
scan_warn "raw src=\${...img/image} — wrap in foundry.utils.escapeHTML for XSS safety" \
  'src="\$\{[A-Za-z_$][A-Za-z0-9_$]*\.(img|image)\}"' "${mjs_paths[@]}"

echo
if [ $block_fail -ne 0 ]; then
  echo "verify: FAIL (blocking)"
  exit 1
fi
if [ $strict -eq 1 ] && [ $warn_fail -ne 0 ]; then
  echo "verify: FAIL (strict mode — warnings treated as errors)"
  exit 1
fi
if [ $warn_fail -ne 0 ]; then
  echo "verify: OK with warnings"
  exit 0
fi
echo "verify: OK"
