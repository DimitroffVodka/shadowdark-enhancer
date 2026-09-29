/**
 * A minimal, deterministic PDF writer for the synthetic-PDF suite
 * (test/pdf-extract-synth.test.mjs).
 *
 * It writes only what the text extractor can observe: pages with a MediaBox and
 * an optional /Rotate, and text runs at (x, y), optionally drawn sideways
 * through a rotation matrix. The font is the standard-14 Helvetica with
 * WinAnsiEncoding, so nothing is embedded and no font file ships. No dates and
 * no /ID, so the same input always yields the same bytes.
 *
 * @typedef {{x:number, y:number, text:string, size?:number, angle?:number}} Run
 *   `angle` is degrees counter-clockwise; 90 draws the text advancing up the page.
 * @typedef {{width?:number, height?:number, rotate?:number, runs:Run[]}} Page
 */

/** Escape a string for a PDF literal string. Text stays ASCII. */
const lit = (s) => `(${s.replace(/[\\()]/g, "\\$&")})`;

/** One content stream: every run positioned with its own text matrix. */
function contentStream(runs) {
  return runs.map(({ x, y, text, size = 10, angle = 0 }) => {
    const r = (angle * Math.PI) / 180;
    const c = +Math.cos(r).toFixed(6);
    const s = +Math.sin(r).toFixed(6);
    return `BT /F1 ${size} Tf ${c} ${s} ${-s} ${c} ${x} ${y} Tm ${lit(text)} Tj ET`;
  }).join("\n");
}

/**
 * @param {Page[]} pages
 * @returns {Uint8Array} a complete PDF file
 */
export function writePdf(pages) {
  // Object numbers: 1 catalog, 2 page tree, 3 font, then a page + stream pair each.
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  pages.forEach((p, i) => {
    const { width = 612, height = 792, rotate } = p;
    bodies.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}]`
      + `${rotate ? ` /Rotate ${rotate}` : ""} /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    const stream = contentStream(p.runs);
    bodies.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  let out = "%PDF-1.4\n";
  const offsets = [];
  bodies.forEach((b, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${b}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`
    + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")
    + `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // ASCII only, so char index === byte offset above and this encode is exact.
  return new TextEncoder().encode(out);
}
