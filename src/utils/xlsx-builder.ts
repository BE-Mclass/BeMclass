import zlib from "zlib";

export interface XlsxSheetInput {
  name: string;
  rows: Array<Array<string | number | null | undefined>>;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sanitizeSheetName(name: string, index: number): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").trim();
  const base = cleaned || `Sheet${index + 1}`;
  return base.slice(0, 31);
}

function columnNumberToName(colIndexZeroBased: number): string {
  let n = colIndexZeroBased + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function buildWorksheetXml(
  rows: Array<Array<string | number | null | undefined>>
): string {
  const rowXmlParts: string[] = [];

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const row = rows[rIdx] ?? [];
    const rNum = rIdx + 1;
    const cellParts: string[] = [];

    for (let cIdx = 0; cIdx < row.length; cIdx++) {
      const val = row[cIdx];
      if (val === null || val === undefined || val === "") {
        continue;
      }
      const cellRef = `${columnNumberToName(cIdx)}${rNum}`;
      const styleAttr = rIdx === 0 ? ` s="1"` : "";
      if (typeof val === "number" && Number.isFinite(val)) {
        cellParts.push(`<c r="${cellRef}"${styleAttr}><v>${val}</v></c>`);
      } else {
        const text = escapeXml(String(val));
        cellParts.push(
          `<c r="${cellRef}" t="inlineStr"${styleAttr}><is><t xml:space="preserve">${text}</t></is></c>`
        );
      }
    }

    rowXmlParts.push(`<row r="${rNum}">${cellParts.join("")}</row>`);
  }

  return [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`,
    `<sheetData>${rowXmlParts.join("")}</sheetData>`,
    `</worksheet>`,
  ].join("");
}

// CRC-32 lookup table for ZIP archive construction
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  path: string;
  data: Buffer;
}

function buildZipArchive(entries: ZipEntry[]): Buffer {
  const localFileParts: Buffer[] = [];
  const centralDirParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path, "utf8");
    const uncompressedData = entry.data;
    const compressedData = zlib.deflateRawSync(uncompressedData);
    const entryCrc = crc32(uncompressedData);

    // Local File Header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed (2.0)
    localHeader.writeUInt16LE(0, 6); // general purpose bit flag
    localHeader.writeUInt16LE(8, 8); // compression method: 8 = deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0x21, 12); // mod date
    localHeader.writeUInt32LE(entryCrc, 14);
    localHeader.writeUInt32LE(compressedData.length, 18);
    localHeader.writeUInt32LE(uncompressedData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    localFileParts.push(localHeader, nameBuf, compressedData);

    // Central Directory Header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // bit flag
    centralHeader.writeUInt16LE(8, 10); // compression method: deflate
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0x21, 14); // mod date
    centralHeader.writeUInt32LE(entryCrc, 16);
    centralHeader.writeUInt32LE(compressedData.length, 20);
    centralHeader.writeUInt32LE(uncompressedData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header

    centralDirParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressedData.length;
  }

  const centralDirBuf = Buffer.concat(centralDirParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localFileParts, centralDirBuf, eocd]);
}

/**
 * Membangun file biner OpenXML `.xlsx` multi-sheet yang valid tanpa dependensi eksternal.
 */
export function buildXlsxBuffer(sheets: XlsxSheetInput[]): Buffer {
  const safeSheets =
    sheets.length > 0
      ? sheets
      : [{ name: "Rekap", rows: [["Tidak ada data"]] }];

  const usedNames = new Set<string>();
  const normalizedSheets = safeSheets.map((s, idx) => {
    let candidate = sanitizeSheetName(s.name, idx);
    if (usedNames.has(candidate.toLowerCase())) {
      candidate = `${candidate.slice(0, 27)}_${idx + 1}`;
    }
    usedNames.add(candidate.toLowerCase());
    return {
      name: candidate,
      rows: s.rows,
    };
  });

  const contentTypesXml = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`,
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
    `<Default Extension="xml" ContentType="application/xml"/>`,
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`,
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`,
    ...normalizedSheets.map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ),
    `</Types>`,
  ].join("");

  const rootRelsXml = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`,
    `</Relationships>`,
  ].join("");

  const workbookXml = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`,
    `<sheets>`,
    ...normalizedSheets.map(
      (s, i) =>
        `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    ),
    `</sheets>`,
    `</workbook>`,
  ].join("");

  const workbookRelsXml = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`,
    ...normalizedSheets.map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    ),
    `<Relationship Id="rId${normalizedSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    `</Relationships>`,
  ].join("");

  const stylesXml = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`,
    `<fonts count="2">`,
    `<font><sz val="11"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="11"/><name val="Calibri"/></font>`,
    `</fonts>`,
    `<fills count="2">`,
    `<fill><patternFill patternType="none"/></fill>`,
    `<fill><patternFill patternType="gray125"/></fill>`,
    `</fills>`,
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`,
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`,
    `<cellXfs count="2">`,
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`,
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>`,
    `</cellXfs>`,
    `</styleSheet>`,
  ].join("");

  const entries: ZipEntry[] = [
    { path: "[Content_Types].xml", data: Buffer.from(contentTypesXml, "utf8") },
    { path: "_rels/.rels", data: Buffer.from(rootRelsXml, "utf8") },
    { path: "xl/workbook.xml", data: Buffer.from(workbookXml, "utf8") },
    { path: "xl/_rels/workbook.xml.rels", data: Buffer.from(workbookRelsXml, "utf8") },
    { path: "xl/styles.xml", data: Buffer.from(stylesXml, "utf8") },
    ...normalizedSheets.map((s, i) => ({
      path: `xl/worksheets/sheet${i + 1}.xml`,
      data: Buffer.from(buildWorksheetXml(s.rows), "utf8"),
    })),
  ];

  return buildZipArchive(entries);
}
