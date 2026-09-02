/**
 * Shadowdark Enhancer — hover-to-enlarge for an image grid.
 *
 * A thumbnail grid is sized for scanning, not for choosing: at 56–92px you can
 * tell a dwarf from a dragon and nothing finer. This shows the full-size image
 * beside whatever tile the pointer is on.
 *
 * The tile cannot simply grow in place, which is the reason this exists at all:
 * these grids scroll, so anything scaled past its own cell is clipped by the
 * scroll container. So the preview is ONE reusable element positioned over
 * everything, flipped to the other side of the tile when it would run off the
 * right edge, and clamped vertically to the viewport.
 *
 * `pointer-events: none` on the preview is load-bearing. Without it the preview
 * lands under the cursor, steals the hover from the tile beneath it, and the
 * two flicker against each other.
 *
 * One delegated listener on the grid, never one per tile — the callers have
 * 1,900 and 4,300 tiles respectively.
 */

/**
 * @param {HTMLElement} root  element the preview is appended to (any container;
 *   the preview is position: fixed, so this only decides lifetime, not place)
 * @param {object} opts
 * @param {string} opts.grid  selector for the scrolling grid, resolved under `root`
 * @param {string} opts.item  selector for one tile
 * @param {(tile: HTMLElement) => string|null} opts.src  the FULL-SIZE image for a
 *   tile — deliberately not the thumbnail the grid draws, which is the whole point
 * @param {number} [opts.width]  preview width in px
 * @returns {() => void} teardown, for a caller whose grid outlives one render
 */
export function installHoverPeek(root, { grid: gridSel, item: itemSel, src, width = 320 } = {}) {
  const grid = root?.querySelector?.(gridSel);
  if (!grid || typeof src !== "function") return () => {};

  const peek = document.createElement("img");
  peek.className = "sde-hover-peek";
  peek.alt = "";
  peek.hidden = true;
  peek.style.width = `${width}px`;
  root.append(peek);

  const place = (tile) => {
    const box = tile.getBoundingClientRect();
    const w = peek.offsetWidth || width;
    const h = peek.offsetHeight || width;
    const right = box.right + 12;
    peek.style.left = `${right + w > window.innerWidth ? Math.max(4, box.left - w - 12) : right}px`;
    peek.style.top = `${Math.min(Math.max(4, box.top + box.height / 2 - h / 2), window.innerHeight - h - 4)}px`;
  };

  const onOver = (event) => {
    const tile = event.target.closest?.(itemSel);
    if (!tile) return;
    const path = src(tile);
    if (!path || path === peek.dataset.src) return;
    peek.dataset.src = path;
    peek.src = path;
    peek.hidden = false;
    place(tile);
    // The natural size is unknown until the image loads, so place it again once
    // the real height exists or the first frame sits off-centre.
    peek.onload = () => place(tile);
  };
  const hide = () => { peek.hidden = true; peek.dataset.src = ""; };

  grid.addEventListener("pointerover", onOver);
  grid.addEventListener("pointerleave", hide);
  grid.addEventListener("scroll", hide);

  return () => {
    grid.removeEventListener("pointerover", onOver);
    grid.removeEventListener("pointerleave", hide);
    grid.removeEventListener("scroll", hide);
    peek.remove();
  };
}
