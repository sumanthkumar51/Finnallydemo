import { Injectable } from '@angular/core';

export type Cell = string | number | null | undefined;

/** PDF report export. jsPDF is loaded on demand so it stays out of the main bundle. */
@Injectable({ providedIn: 'root' })
export class Pdf {
  async table(title: string, columns: string[], rows: Cell[][], filename: string, subtitle = ''): Promise<void> {
    const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait', unit: 'mm' });
    doc.setFontSize(16);
    doc.text(title, 14, 16);
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(`${subtitle ? subtitle + '  ·  ' : ''}Generated ${new Date().toLocaleString()}  ·  ${rows.length} rows`, 14, 22);
    autoTable(doc, {
      head: [columns],
      body: rows.map((r) => r.map((c) => (c == null ? '' : String(c)))),
      startY: 27,
      styles: { fontSize: 8, cellPadding: 1.8 },
      headStyles: { fillColor: [37, 99, 235] },
      alternateRowStyles: { fillColor: [245, 247, 250] },
      didDrawPage: () => {
        const h = doc.internal.pageSize.getHeight();
        doc.setFontSize(8);
        doc.text(`Page ${doc.getNumberOfPages()}`, doc.internal.pageSize.getWidth() - 25, h - 8);
      },
    });
    doc.save(filename);
  }
}
