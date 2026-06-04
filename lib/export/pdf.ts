import type { ExportRow } from "@/lib/export/csv";

function sanitizePdfText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function toCellValue(value: ExportRow[string]) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}

export function buildPdfDocument(title: string, rows: ExportRow[]) {
  const headers = rows.length > 0 ? Object.keys(rows[0]!) : [];
  const lines = [
    title,
    "",
    headers.join(" | "),
    ...rows.map((row) => headers.map((header) => toCellValue(row[header])).join(" | ")),
  ].slice(0, 120);

  const contentStream = [
    "BT",
    "/F1 10 Tf",
    "40 780 Td",
    ...lines.flatMap((line, index) =>
      index === 0
        ? [`(${sanitizePdfText(line)}) Tj`]
        : ["0 -14 Td", `(${sanitizePdfText(line)}) Tj`]
    ),
    "ET",
  ].join("\n");

  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj",
    `4 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += `${object}\n`;
  }

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}
