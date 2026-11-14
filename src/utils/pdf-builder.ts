export interface MonthlyPdfReportInput {
  schoolName: string;
  month: string;
  generatedAtWib: string;
  student: {
    nisn: string;
    name: string;
    className: string;
    absenceNumber: number | null;
  };
  summary: {
    hadir: number;
    terlambat: number;
    izin: number;
    sakit: number;
    alpa: number;
    school_days: number;
    attendance_percent: number;
  };
  days: Array<{
    date: string;
    status: string;
    checkInTimeWib: string | null;
    note: string | null;
  }>;
}

function escapePdfText(text: string): string {
  return text
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function padRight(str: string, len: number): string {
  const s = str.slice(0, len);
  return s + " ".repeat(Math.max(0, len - s.length));
}

/**
 * Membangun dokumen PDF 1.4 (`application/pdf`) yang valid dan dapat dibuka di semua PDF reader
 * untuk Laporan Kehadiran Bulanan Siswa (US-31 & FSD §5.4).
 */
export function buildMonthlyAttendancePdfBuffer(
  input: MonthlyPdfReportInput
): Buffer {
  const lines: Array<{ text: string; bold?: boolean; size?: number }> = [];

  lines.push({
    text: `LAPORAN KEHADIRAN BULANAN SISWA - ${input.schoolName.toUpperCase()}`,
    bold: true,
    size: 13,
  });
  lines.push({
    text: `Periode Bulan: ${input.month}   |   Dicetak: ${input.generatedAtWib} WIB`,
    size: 9,
  });
  lines.push({ text: "-".repeat(92), size: 9 });

  // Identitas Siswa
  lines.push({ text: "IDENTITAS SISWA", bold: true, size: 10 });
  lines.push({
    text: `NISN          : ${input.student.nisn}`,
    size: 9,
  });
  lines.push({
    text: `Nama Siswa    : ${input.student.name}`,
    size: 9,
  });
  lines.push({
    text: `Kelas         : ${input.student.className}   |   No. Absen: ${
      input.student.absenceNumber ?? "-"
    }`,
    size: 9,
  });
  lines.push({ text: "-".repeat(92), size: 9 });

  // Ringkasan Bulanan
  lines.push({ text: "RINGKASAN KEHADIRAN BULANAN", bold: true, size: 10 });
  lines.push({
    text: `Hadir: ${input.summary.hadir}   |   Terlambat: ${input.summary.terlambat}   |   Izin: ${input.summary.izin}   |   Sakit: ${input.summary.sakit}   |   Alpa: ${input.summary.alpa}`,
    size: 9,
  });
  lines.push({
    text: `Hari Sekolah Berjalan: ${input.summary.school_days} hari   |   Persentase Kehadiran: ${input.summary.attendance_percent}%`,
    bold: true,
    size: 9,
  });
  lines.push({ text: "-".repeat(92), size: 9 });

  // Tabel Harian
  lines.push({ text: "RINCIAN KEHADIRAN HARIAN", bold: true, size: 10 });
  lines.push({
    text: `${padRight("No", 4)} ${padRight("Tanggal", 12)} ${padRight(
      "Status",
      13
    )} ${padRight("Jam Masuk", 12)} Keterangan`,
    bold: true,
    size: 9,
  });
  lines.push({ text: "-".repeat(92), size: 9 });

  if (input.days.length === 0) {
    lines.push({
      text: "Belum ada catatan kehadiran pada periode bulan ini.",
      size: 9,
    });
  } else {
    input.days.forEach((d, idx) => {
      const noStr = padRight(String(idx + 1), 4);
      const dateStr = padRight(d.date, 12);
      const statusLabel = padRight(d.status.toUpperCase(), 13);
      const timeStr = padRight(d.checkInTimeWib ?? "-", 12);
      const noteStr = (d.note ?? "-").slice(0, 44);
      lines.push({
        text: `${noStr} ${dateStr} ${statusLabel} ${timeStr} ${noteStr}`,
        size: 9,
      });
    });
  }

  // Paginate (max 48 lines per A4 page)
  const MAX_LINES_PER_PAGE = 48;
  const pageChunks: Array<typeof lines> = [];
  for (let i = 0; i < lines.length; i += MAX_LINES_PER_PAGE) {
    pageChunks.push(lines.slice(i, i + MAX_LINES_PER_PAGE));
  }
  if (pageChunks.length === 0) {
    pageChunks.push([]);
  }

  // PDF Object layout:
  // 1: Catalog
  // 2: Pages
  // 3: Font F1 (Courier)
  // 4: Font F2 (Courier-Bold)
  // For each page i (0..N-1):
  //   pageObjId = 5 + i * 2
  //   contentObjId = 6 + i * 2
  const objects: Array<{ id: number; body: string }> = [];
  const pageObjIds: number[] = [];

  for (let i = 0; i < pageChunks.length; i++) {
    const pageObjId = 5 + i * 2;
    const contentObjId = 6 + i * 2;
    pageObjIds.push(pageObjId);

    const chunk = pageChunks[i];
    const streamOps: string[] = ["BT"];
    let y = 800;

    for (const line of chunk) {
      const fontRef = line.bold ? "/F2" : "/F1";
      const fontSize = line.size ?? 9;
      streamOps.push(`${fontRef} ${fontSize} Tf`);
      streamOps.push(`1 0 0 1 40 ${y} Tm`);
      streamOps.push(`(${escapePdfText(line.text)}) Tj`);
      y -= fontSize + 6;
    }
    streamOps.push("ET");

    const streamContent = streamOps.join("\n");
    const streamByteLen = Buffer.byteLength(streamContent, "utf8");

    objects.push({
      id: pageObjId,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>`,
    });
    objects.push({
      id: contentObjId,
      body: `<< /Length ${streamByteLen} >>\nstream\n${streamContent}\nendstream`,
    });
  }

  const allObjects: Array<{ id: number; body: string }> = [
    { id: 1, body: `<< /Type /Catalog /Pages 2 0 R >>` },
    {
      id: 2,
      body: `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjIds.length} >>`,
    },
    {
      id: 3,
      body: `<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`,
    },
    {
      id: 4,
      body: `<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>`,
    },
    ...objects,
  ];

  const parts: string[] = ["%PDF-1.4\n"];
  const offsets: number[] = [0];
  let currentByteOffset = Buffer.byteLength(parts[0], "utf8");

  for (const obj of allObjects) {
    offsets[obj.id] = currentByteOffset;
    const serialized = `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
    parts.push(serialized);
    currentByteOffset += Buffer.byteLength(serialized, "utf8");
  }

  const xrefOffset = currentByteOffset;
  const totalObjs = allObjects.length + 1;
  const xrefLines: string[] = [`xref\n0 ${totalObjs}\n0000000000 65535 f \n`];
  for (let id = 1; id <= allObjects.length; id++) {
    const offStr = String(offsets[id] ?? 0).padStart(10, "0");
    xrefLines.push(`${offStr} 00000 n \n`);
  }

  const trailer = [
    ...xrefLines,
    `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");

  parts.push(trailer);
  return Buffer.from(parts.join(""), "utf8");
}
