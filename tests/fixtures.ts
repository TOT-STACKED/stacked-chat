import JSZip from 'jszip';

/** A valid one-page-per-array-entry PDF whose pages contain the given lines of text (Helvetica). */
export function makePdf(pages: string[][]): Buffer {
  const objs: string[] = [];
  const pageIds = pages.map((_, i) => 3 + i * 2);
  const fontId = 3 + pages.length * 2;
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  pages.forEach((lines, i) => {
    const id = 3 + i * 2;
    const esc = (t: string) => t.replace(/[\\()]/g, '\\$&');
    const stream = 'BT /F1 12 Tf 72 720 Td 16 TL ' + lines.map((l) => `(${esc(l)}) Tj T*`).join(' ') + ' ET';
    objs[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${id + 1} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
    objs[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objs[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let out = '%PDF-1.4\n'; const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) { offsets[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offsets.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A minimal but valid .docx with one paragraph per string. */
export async function makeDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${esc(p)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}
