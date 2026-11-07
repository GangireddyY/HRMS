import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import { API, TestContext, addMember, bearer, createOrgWithAdmin, createTestApp, createUser, login, resetDatabase, uniqueEmail } from './helpers';

function pdf(lines: string[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    for (const l of lines) doc.text(l);
    doc.end();
  });
}

async function docx(lines: string[]): Promise<Buffer> {
  const zip = new JSZip();
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${lines.map((l) => `<w:p><w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const RESUME = [
  'Kavya Iyer',
  'kavya.iyer@example.com | +91 99887 76655',
  'Total experience: 4 years',
  'Experience',
  'Product Designer at Initech',
  'Figma, user research, Payments Domain',
];

describe('Resume parsing (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('prefills candidate details from PDF and Word resumes and keeps skills on the candidate', async () => {
    const org = await createOrgWithAdmin(ctx);
    const h = bearer((await login(ctx, org.admin.email)).accessToken);
    const user = await createUser(ctx, { email: uniqueEmail('e'), firstName: 'Esha', lastName: 'Emp' });
    await addMember(ctx, org.organization.id, user.id, ['employee']);
    const eh = bearer((await login(ctx, user.email)).accessToken);
    await ctx.http().post(`${API}/skills`).set(h).send({ name: 'Payments Domain', category: 'DOMAIN' });

    const fromPdf = await ctx.http().post(`${API}/recruitment/resumes/parse`).set(h).attach('file', await pdf(RESUME), 'kavya.pdf');
    expect(fromPdf.status).toBe(201);
    expect(fromPdf.body.data).toMatchObject({
      readable: true,
      parsed: { firstName: 'Kavya', lastName: 'Iyer', email: 'kavya.iyer@example.com', phone: '+91 99887 76655', experienceYears: 4, currentTitle: 'Product Designer', currentCompany: 'Initech' },
    });
    expect(fromPdf.body.data.parsed.skills).toEqual(expect.arrayContaining(['Figma', 'User Research', 'Payments Domain']));

    const fromDocx = await ctx.http().post(`${API}/recruitment/resumes/parse`).set(h).attach('file', await docx(RESUME), 'kavya.docx');
    expect(fromDocx.body.data.parsed).toMatchObject({ firstName: 'Kavya', email: 'kavya.iyer@example.com', experienceYears: 4 });

    // An unreadable PDF is accepted but nothing is read from it; other files are refused; only recruiters may parse.
    const blank = await ctx.http().post(`${API}/recruitment/resumes/parse`).set(h).attach('file', Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n'), 'scan.pdf');
    expect(blank.body.data).toEqual({ readable: false, parsed: { skills: [] } });
    expect((await ctx.http().post(`${API}/recruitment/resumes/parse`).set(h).attach('file', Buffer.from('plain text'), 'cv.pdf')).status).toBe(422);
    expect((await ctx.http().post(`${API}/recruitment/resumes/parse`).set(eh).attach('file', await pdf(RESUME), 'kavya.pdf')).status).toBe(403);

    // Uploading a resume to a candidate without skills fills them; a recruiter's own list is never overwritten.
    const cand = (await ctx.http().post(`${API}/recruitment/candidates`).set(h).send({ firstName: 'Kavya', lastName: 'Iyer', email: 'kavya.iyer@example.com' })).body.data;
    expect(cand.skills).toEqual([]);
    const uploaded = (await ctx.http().post(`${API}/recruitment/candidates/${cand.id}/resume`).set(h).attach('file', await pdf(RESUME), 'kavya.pdf')).body.data;
    expect(uploaded.skills).toEqual(expect.arrayContaining(['Figma', 'Payments Domain']));
    const edited = (await ctx.http().patch(`${API}/recruitment/candidates/${cand.id}`).set(h).send({ skills: [' Figma ', 'figma', 'Design Systems', ''] })).body.data;
    expect(edited.skills).toEqual(['Figma', 'Design Systems']);
    expect((await ctx.http().post(`${API}/recruitment/candidates/${cand.id}/resume`).set(h).attach('file', await pdf([...RESUME, 'Python']), 'v2.pdf')).body.data.skills).toEqual(['Figma', 'Design Systems']);
    expect((await ctx.http().patch(`${API}/recruitment/candidates/${cand.id}`).set(h).send({ skills: Array.from({ length: 51 }, (_, i) => `S${i}`) })).status).toBe(422);

    const found = await ctx.http().get(`${API}/recruitment/candidates?search=design%20sys`).set(h);
    expect(found.status).toBe(200);
    expect(found.body.data.map((c: { id: string }) => c.id)).toEqual([cand.id]);
  });
});
