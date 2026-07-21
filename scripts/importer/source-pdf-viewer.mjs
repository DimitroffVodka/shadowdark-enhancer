/**
 * Shadowdark Enhancer — Source PDF Viewer.
 *
 * A tiny singleton ApplicationV2 that embeds Foundry's core PDF.js viewer in an
 * iframe, opened at a specific page. Used by the Importer Hub's "Open PDF p.N"
 * deep-link so the source page renders INSIDE Foundry as a normal window
 * instead of spawning an external browser tab. The iframe src is the same
 * `/scripts/pdfjs/web/viewer.html?file=…#page=N` URL the built-in
 * JournalEntryPagePDFSheet uses — same origin, no CSP issues.
 *
 * The PDF file itself is the user's own uploaded world asset (never bundled).
 */

const { ApplicationV2 } = foundry.applications.api;

export class SourcePdfViewer extends ApplicationV2 {
  static _instance = null;

  static DEFAULT_OPTIONS = {
    id: "sde-source-pdf-viewer",
    tag: "div",
    window: { title: "Source PDF", icon: "fas fa-file-pdf", resizable: true },
    position: { width: 900, height: 820 },
  };

  /** The viewer URL to load (viewer.html?file=…#page=N). */
  #href = "";

  async _renderHTML() {
    return this.#href;
  }

  _replaceHTML(href, content) {
    let frame = content.querySelector("iframe");
    if (!frame) {
      frame = document.createElement("iframe");
      frame.style.cssText = "width:100%;height:100%;border:0;background:#fff;";
      content.style.cssText = "padding:0;height:100%;";
      content.replaceChildren(frame);
    }
    // Reassigning src re-navigates in place; when only the #page fragment
    // differs, PDF.js jumps to the new page without a full reload.
    if (frame.src !== href) frame.src = href;
  }

  /**
   * Open (or re-point) the shared viewer at `href`, titled `title`.
   * Repeated calls reuse the one window and just re-jump the page.
   * @param {string} href  viewer.html URL with a #page fragment
   * @param {string} [title]
   */
  static show(href, title) {
    if (!href) return null;
    const inst = (this._instance ??= new this());
    inst.#href = href;
    if (title) inst.options.window.title = title;
    if (inst.rendered) {
      inst.render();                    // re-run _replaceHTML → re-point iframe
      if (title) inst.window?.title && (inst.window.title.textContent = title);
      inst.bringToFront?.();
    } else {
      inst.render(true);
    }
    return inst;
  }
}
