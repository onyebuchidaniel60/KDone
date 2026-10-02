import { crc32 } from "node:zlib";
import type { AssembledManuscript, MetadataOutput } from "@kdone/validation";

/*
 * Deterministic EPUB 3 builder.
 *
 * Output bytes depend only on the inputs: the same manuscript and metadata
 * always produce an identical file, so builds are reproducible and diffable.
 * Entries are STORED (no deflate) which keeps the writer small and the bytes
 * stable across Node versions.
 */

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f),
    date:
      ((date.getFullYear() - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      Math.min(date.getDate(), 31),
  };
}

export function buildZip(entries: ZipEntry[], epoch: Date): Uint8Array {
  const { time, date } = dosDateTime(epoch);
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data) >>> 0;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, entry.data.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    chunks.push(local, entry.data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory header
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + entry.data.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const all = [...chunks, ...central, end];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let position = 0;
  for (const chunk of all) {
    out.set(chunk, position);
    position += chunk.length;
  }
  return out;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface EpubBuildInput {
  manuscript: AssembledManuscript;
  metadata: MetadataOutput;
  /** Fixed epoch keeps output bytes deterministic. */
  epoch?: Date;
}

export function buildEpub(input: EpubBuildInput): Uint8Array {
  const epoch = input.epoch ?? new Date("2000-01-01T00:00:00.000Z");
  const { manuscript, metadata } = input;
  const uuid = `urn:uuid:${deterministicUuid(`${manuscript.title}:${manuscript.version}`)}`;

  const chapterFiles = manuscript.chapters.map((c) => ({
    id: `ch${c.ordinal}`,
    href: `chapter${c.ordinal}.xhtml`,
    ordinal: c.ordinal,
    title: c.title,
    content: c.content,
  }));

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${esc(metadata.language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${esc(uuid)}</dc:identifier>
    <dc:title>${esc(metadata.title)}</dc:title>
    ${metadata.subtitle ? `<dc:title id="sub">${esc(metadata.subtitle)}</dc:title>` : ""}
    <dc:language>${esc(metadata.language)}</dc:language>
    <dc:creator>${esc(metadata.authorNames.join(", "))}</dc:creator>
    <dc:description>${esc(metadata.description)}</dc:description>
    <dc:rights>${esc(metadata.rights)}</dc:rights>
    ${metadata.keywords.map((k) => `<dc:subject>${esc(k)}</dc:subject>`).join("\n    ")}
    <meta property="dcterms:modified">2000-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${chapterFiles
      .map((c) => `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`)
      .join("\n    ")}
  </manifest>
  <spine>
    ${chapterFiles.map((c) => `<itemref idref="${c.id}"/>`).join("\n    ")}
  </spine>
</package>`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
      ${chapterFiles
        .map((c) => `<li><a href="${c.href}">${esc(c.title)}</a></li>`)
        .join("\n      ")}
    </ol>
  </nav>
</body>
</html>`;

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const chapterXhtml = (c: (typeof chapterFiles)[number]) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${esc(c.title)}</title></head>
<body>
  <h1>${esc(c.title)}</h1>
  ${c.content
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p.trim())}</p>`)
    .join("\n  ")}
</body>
</html>`;

  // `mimetype` must be the first entry and stored uncompressed.
  const entries: ZipEntry[] = [
    { name: "mimetype", data: new TextEncoder().encode("application/epub+zip") },
    { name: "META-INF/container.xml", data: new TextEncoder().encode(container) },
    { name: "OEBPS/content.opf", data: new TextEncoder().encode(opf) },
    { name: "OEBPS/nav.xhtml", data: new TextEncoder().encode(nav) },
    ...chapterFiles.map((c) => ({ name: `OEBPS/${c.href}`, data: new TextEncoder().encode(chapterXhtml(c)) })),
  ];

  return buildZip(entries, epoch);
}

function deterministicUuid(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i += 1) {
    h1 = (h1 ^ seed.charCodeAt(i)) * 0x01000193;
    h2 = (h2 + seed.charCodeAt(i) * (i + 1)) >>> 0;
  }
  const hex = (n: number, len: number) => (n >>> 0).toString(16).padStart(len, "0").slice(-len);
  return `${hex(h1, 8)}-${hex(h2, 4)}-4${hex(h1 >> 8, 3)}-${hex(h2 >> 4, 4)}-${hex(h1 + h2, 12)}`;
}

/* -------------------------------------------------------------- Validation */

export interface EpubValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  entryCount: number;
}

/** Structural validation of a produced EPUB. Not a claim about KDP acceptance. */
export function validateEpub(bytes: Uint8Array): EpubValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 22 || view.getUint32(0, true) !== 0x04034b50) {
    return { valid: false, errors: ["Not a ZIP archive"], warnings, entryCount: 0 };
  }

  // Parse the end-of-central-directory record to enumerate entries.
  const eocdOffset = bytes.byteLength - 22;
  if (view.getUint32(eocdOffset, true) !== 0x06054b50) {
    return { valid: false, errors: ["Missing end-of-central-directory record"], warnings, entryCount: 0 };
  }
  const entryCount = view.getUint16(eocdOffset + 10, true);

  const names: string[] = [];
  let position = 0;
  for (let i = 0; i < entryCount; i += 1) {
    if (view.getUint32(position, true) !== 0x04034b50) {
      errors.push(`Malformed local header for entry ${i}`);
      break;
    }
    const nameLength = view.getUint16(position + 26, true);
    const extraLength = view.getUint16(position + 28, true);
    const size = view.getUint32(position + 18, true);
    const name = new TextDecoder().decode(bytes.slice(position + 30, position + 30 + nameLength));
    names.push(name);
    position += 30 + nameLength + extraLength + size;
  }

  if (names[0] !== "mimetype") errors.push('First ZIP entry must be "mimetype"');
  if (!names.includes("META-INF/container.xml")) errors.push("Missing META-INF/container.xml");
  if (!names.includes("OEBPS/content.opf")) errors.push("Missing OEBPS/content.opf");
  if (!names.some((n) => n.endsWith("nav.xhtml"))) errors.push("Missing EPUB 3 navigation document");

  const mimetypeEntry = names.indexOf("mimetype");
  if (mimetypeEntry === 0) {
    const stored = new TextDecoder().decode(bytes.slice(30, 30 + 20));
    if (stored !== "application/epub+zip") errors.push('mimetype must be "application/epub+zip"');
  }

  if (entryCount < 5) warnings.push("Very few entries; confirm the manuscript has content");

  return { valid: errors.length === 0, errors, warnings, entryCount };
}