import { OFFER_LETTER_PLACEHOLDERS } from '../../contracts';

export type OfferLetterValues = Record<keyof typeof OFFER_LETTER_PLACEHOLDERS, string>;

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Placeholders the template uses that aren't known (shown to whoever edits the template). */
export function unknownPlaceholders(text: string): string[] {
  const known = new Set(Object.keys(OFFER_LETTER_PLACEHOLDERS));
  return [...new Set([...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]!))].filter((k) => !known.has(k));
}

export function fillPlaceholders(text: string, values: OfferLetterValues): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, key: string) => (key in values ? values[key as keyof OfferLetterValues] : whole));
}

/**
 * The template is plain text: blank lines separate paragraphs, lines starting with "- " are a list and **text** is bold.
 * Everything is escaped first, so neither the template nor the values can inject markup.
 */
export function renderLetterBody(template: string, values: OfferLetterValues): string {
  const filled = esc(fillPlaceholders(template, values)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return filled
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n').filter((l) => l.trim());
      if (lines.length && lines.every((l) => l.trimStart().startsWith('- '))) return `<ul>${lines.map((l) => `<li>${l.trimStart().slice(2)}</li>`).join('')}</ul>`;
      return `<p>${lines.join('<br>')}</p>`;
    })
    .join('\n');
}

/** The full letter document: what's frozen at release, hashed and signed. */
export function offerLetterHtml(opts: { subject: string; bodyHtml: string; organization: string; releasedOn: string; reference: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(opts.subject)}</title><style>
body{font-family:Georgia,"Times New Roman",serif;color:#111827;max-width:720px;margin:40px auto;padding:0 24px;line-height:1.6;font-size:15px}
header{border-bottom:2px solid #111827;padding-bottom:12px;margin-bottom:24px}header h1{font-size:20px;margin:0}header p{margin:2px 0 0;color:#4b5563;font-size:13px}
h2{font-size:17px;margin:0 0 16px}ul{padding-left:20px}footer{margin-top:40px;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb;padding-top:8px}
</style></head><body><header><h1>${esc(opts.organization)}</h1><p>${esc(opts.releasedOn)} · Ref. ${esc(opts.reference)}</p></header>
<h2>${esc(opts.subject)}</h2>
${opts.bodyHtml}
<footer>This letter is signed electronically. The signature record (name, time, IP address and the SHA-256 of this document) is kept by ${esc(opts.organization)}.</footer>
</body></html>`;
}
