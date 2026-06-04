import type { ExportRow } from "@/lib/export/csv";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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

export function buildExcelWorkbook(rows: ExportRow[], sheetName = "Export") {
  const headers = rows.length > 0 ? Object.keys(rows[0]!) : [];
  const headerRow = headers
    .map((header) => `<Cell><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`)
    .join("");
  const dataRows = rows
    .map((row) => {
      const cells = headers
        .map((header) => `<Cell><Data ss:Type="String">${escapeXml(toCellValue(row[header]))}</Data></Cell>`)
        .join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");

  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="${escapeXml(sheetName)}">
    <Table>
      ${headers.length > 0 ? `<Row>${headerRow}</Row>` : ""}
      ${dataRows}
    </Table>
  </Worksheet>
</Workbook>`;
}
