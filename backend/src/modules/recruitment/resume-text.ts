import { spawn } from 'node:child_process';
import type { ResumeContentType } from '../../contracts';

const TIMEOUT_MS = 20_000;
const MAX_CHARS = 100_000;
const MAX_PAGES = 20;

// Runs in a separate Node process: resumes are untrusted files, so a hostile or huge one can't stall or crash the API
// (pdf.js loads a native canvas module), gets a memory cap and no secrets in its environment, and is killed if it hangs.
const READER = `
process.once('message', async (job) => {
  try {
    let text;
    if (job.type === 'application/pdf') {
      const { PDFParse } = require(job.pdfParse);
      const parser = new PDFParse({ data: new Uint8Array(job.data), verbosity: 0 });
      try {
        text = (await parser.getText({ first: job.pages })).text;
      } finally {
        await parser.destroy();
      }
    } else {
      text = (await require(job.mammoth).extractRawText({ buffer: Buffer.from(job.data) })).value;
    }
    process.send({ text: text.slice(0, job.maxChars) }, () => process.exit(0));
  } catch (e) {
    process.send({ error: e && e.message ? e.message : String(e) }, () => process.exit(0));
  }
});
`;

const childEnv = () => Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'HOME'].filter((k) => process.env[k]).map((k) => [k, process.env[k]!]));

/** Plain text of a PDF (first pages only) or .docx resume; throws if it can't be read in time. */
export function resumeText(data: Buffer, type: ResumeContentType): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=256', '-e', READER], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced', env: childEnv(), windowsHide: true });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => finish(() => {
      child.kill('SIGKILL');
      reject(new Error('Reading the resume took too long'));
    }), TIMEOUT_MS);
    child.once('message', (m: { text?: string; error?: string }) => finish(() => (m.error !== undefined ? reject(new Error(m.error)) : resolve(m.text ?? ''))));
    child.once('error', (e) => finish(() => reject(e)));
    child.once('exit', (code, signal) => finish(() => reject(new Error(`The resume reader stopped (${signal ?? `exit code ${code}`})`))));
    child.send({ type, data, pages: MAX_PAGES, maxChars: MAX_CHARS, pdfParse: require.resolve('pdf-parse'), mammoth: require.resolve('mammoth') });
  });
}
