import PDFDocument from 'pdfkit';

/** A one-page A4 PDF with a heading and a few lines (scanned documents, resumes), so the file opens as something real. */
export function pdfFile(title: string, lines: string[]): Promise<Buffer> {
  const pdf = new PDFDocument({ size: 'A4', margin: 56, info: { Title: title, Creator: 'HRMS demo' } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', (c: Buffer) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });
  pdf.font('Helvetica-Bold').fontSize(18).text(title);
  pdf.moveDown();
  pdf.font('Helvetica').fontSize(11);
  for (const line of lines) pdf.text(line).moveDown(0.4);
  pdf.end();
  return done;
}
