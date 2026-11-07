import { CANDIDATE_SKILLS_MAX, type ParsedResume } from '../../contracts';

/**
 * Reads candidate details out of a resume's plain text with conservative heuristics: anything uncertain is left out
 * rather than guessed, because recruiters review the result before saving it.
 */

/** Matched case-insensitively. */
const SKILLS = [
  'JavaScript', 'TypeScript', 'Node.js', 'React', 'React Native', 'Angular', 'Vue.js', 'Next.js', 'Nuxt', 'Svelte', 'jQuery', 'HTML', 'CSS', 'Sass', 'Tailwind CSS', 'Bootstrap', 'Redux', 'GraphQL', 'REST APIs', 'NestJS', 'Express.js',
  'Python', 'Django', 'Flask', 'FastAPI', 'Java', 'Spring Boot', 'Kotlin', 'Scala', 'C++', 'C#', '.NET', 'ASP.NET', 'PHP', 'Laravel', 'Ruby on Rails', 'Golang', 'Rust', 'Perl', 'Objective-C', 'Dart', 'Flutter', 'Android', 'iOS', 'SwiftUI',
  'SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Oracle', 'SQL Server', 'SQLite', 'Elasticsearch', 'Cassandra', 'DynamoDB', 'Firebase', 'Snowflake', 'BigQuery',
  'AWS', 'Azure', 'Google Cloud', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'Jenkins', 'GitHub Actions', 'GitLab CI', 'CI/CD', 'DevOps', 'Linux', 'Bash', 'PowerShell', 'Git', 'Microservices', 'Kafka', 'RabbitMQ', 'Nginx',
  'Machine Learning', 'Deep Learning', 'NLP', 'Computer Vision', 'TensorFlow', 'PyTorch', 'scikit-learn', 'Pandas', 'NumPy', 'Data Analysis', 'Data Science', 'Data Engineering', 'Spark', 'Hadoop', 'Airflow', 'Power BI', 'Tableau', 'Looker', 'Statistics',
  'Selenium', 'Cypress', 'Playwright', 'Jest', 'JUnit', 'Manual Testing', 'Automation Testing', 'Performance Testing', 'JIRA', 'Confluence', 'Agile', 'Scrum', 'Kanban',
  'Figma', 'Sketch', 'Adobe XD', 'Photoshop', 'Illustrator', 'InDesign', 'UI Design', 'UX Design', 'User Research', 'Wireframing', 'Prototyping',
  'Project Management', 'Product Management', 'Stakeholder Management', 'Team Leadership', 'People Management', 'Business Analysis', 'Requirements Gathering', 'PMP', 'PRINCE2', 'Six Sigma',
  'SAP', 'Salesforce', 'HubSpot', 'Zoho', 'Tally', 'QuickBooks', 'MS Office', 'Microsoft Excel', 'Advanced Excel', 'MS Word', 'PowerPoint', 'Google Sheets', 'VBA',
  'Accounting', 'Bookkeeping', 'Financial Analysis', 'Financial Modelling', 'Budgeting', 'Taxation', 'GST', 'TDS', 'Auditing', 'Payroll', 'Accounts Payable', 'Accounts Receivable', 'IFRS',
  'Recruitment', 'Talent Acquisition', 'Onboarding', 'Employee Relations', 'HR Operations', 'Performance Management', 'Compensation and Benefits', 'Labour Law',
  'Digital Marketing', 'SEO', 'SEM', 'Content Writing', 'Copywriting', 'Social Media Marketing', 'Google Ads', 'Google Analytics', 'Email Marketing', 'Brand Management', 'Market Research', 'Lead Generation', 'B2B Sales', 'Business Development', 'Account Management', 'CRM',
  'Customer Service', 'Customer Success', 'Negotiation', 'Communication', 'Public Speaking', 'Problem Solving', 'Supply Chain', 'Logistics', 'Procurement', 'Inventory Management', 'Quality Assurance', 'AutoCAD', 'SolidWorks', 'MATLAB',
];
/** Ordinary words too — matched only with this exact capitalisation. */
const EXACT = ['Go', 'Swift', 'Ruby', 'Excel', 'Spring', 'Express', 'Sales', 'Marketing', 'Leadership'];
const ALIASES: Record<string, string> = { nodejs: 'Node.js', 'node js': 'Node.js', reactjs: 'React', 'react.js': 'React', vuejs: 'Vue.js', vue: 'Vue.js', angularjs: 'Angular', postgres: 'PostgreSQL', k8s: 'Kubernetes', 'amazon web services': 'AWS', 'ms excel': 'Microsoft Excel', 'c sharp': 'C#', expressjs: 'Express.js', nextjs: 'Next.js' };

const HEADINGS: [RegExp, string][] = [
  [/^(?:work |professional |relevant |employment |career )?(?:experience|history|employment(?: history)?|work history|career history)$/, 'experience'],
  [/^(?:education|academics?|academic (?:background|qualifications?)|qualifications?|educational qualifications?)$/, 'education'],
  [/^(?:skills|technical skills|key skills|core skills|core competencies|competencies|expertise|technologies|tech stack|tools)$/, 'skills'],
  [/^(?:projects?|key projects|personal projects|certifications?|courses|trainings?|achievements|awards|publications|languages|interests|hobbies|personal (?:details|information)|references|declaration|summary|profile|professional summary|career objective|objective|about me)$/, 'other'],
];
const TITLE = /\b(engineer|developer|programmer|manager|analyst|designer|consultant|lead|architect|executive|officer|specialist|intern|associate|director|head|administrator|accountant|scientist|tester|recruiter|coordinator|representative|supervisor|technician|advisor|strategist|writer|editor|founder|president|vp|principal|trainee|assistant|partner|controller|auditor|counsel|nurse|teacher)\b/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DATE = String.raw`(?:(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s*[,'’]?\s*|(\d{1,2})\s*[/.-]\s*)?((?:19|20)\d{2})`;
const RANGE = new RegExp(`${DATE}\\s*(?:-|–|—|to|till|until)\\s*(?:${DATE}|(present|current|now|till date|to date|date|ongoing))`, 'gi');
const BULLET = /^[•·▪●◦○■□➢►✓*-]\s*/;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordPattern = (term: string, flags: string) => new RegExp(`(?<![\\p{L}\\p{N}+#.])${escape(term)}(?![\\p{L}\\p{N}+#]|\\.[\\p{L}])`, flags);
const titleCase = (w: string) => (w === w.toUpperCase() || w === w.toLowerCase() ? w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase()) : w);
const clip = (s: string, n: number) => s.replace(/\s+/g, ' ').replace(/^[\s,;:|·•–—-]+|[\s,;:|·•–—-]+$/g, '').slice(0, n).trim();

export function resumeLines(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[\t\u00a0 ]+/g, ' ').trim())
    .filter((l) => l && !/^--\s*\d+\s+of\s+\d+\s*--$/.test(l));
}

function sections(lines: string[]) {
  const out: Record<string, string[]> = { header: [], experience: [], education: [], skills: [], other: [] };
  let current = 'header';
  for (const line of lines) {
    const key = line.length <= 40 ? HEADINGS.find(([re]) => re.test(line.toLowerCase().replace(/[:\s]+$/, '').replace(/&/g, 'and')))?.[1] : undefined;
    if (key) current = key;
    else out[current]!.push(line);
  }
  return out;
}

function nameOf(lines: string[]): { firstName: string; lastName: string } | null {
  for (const raw of lines.slice(0, 8)) {
    const line = raw.replace(/^name\s*[:-]\s*/i, '');
    if (/[@\d]|https?:|www\.|resume|curriculum|vitae|\bcv\b/i.test(line) || TITLE.test(line)) continue;
    const words = line.split(' ');
    if (words.length < 2 || words.length > 4 || !words.every((w) => /^\p{L}[\p{L}.'’-]*$/u.test(w))) continue;
    const cased = words.map(titleCase);
    return { firstName: cased[0]!, lastName: cased.slice(1).join(' ') };
  }
  return null;
}

function phoneOf(text: string): string | undefined {
  for (const m of text.matchAll(/(?<![\d/])\+?\d[\d ().-]{6,18}\d(?![\d/])/g)) {
    const raw = m[0];
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 13 || /^(19|20)\d{2}\D+(19|20)\d{2}$/.test(raw)) continue;
    const phone = raw.replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
    return phone.length <= 20 ? phone : `${raw.startsWith('+') ? '+' : ''}${digits}`;
  }
  return undefined;
}

const monthNo = (name: string | undefined, num: string | undefined, fallback: number) => {
  if (name) return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  const n = num ? Number(num) : NaN;
  return n >= 1 && n <= 12 ? n : fallback;
};

/** Total months covered by date ranges such as "Jan 2019 – Present" (overlaps counted once). */
export function rangeMonths(text: string, today: Date): number {
  const spans: [number, number][] = [];
  const now = today.getUTCFullYear() * 12 + today.getUTCMonth();
  for (const m of text.matchAll(RANGE)) {
    const start = Number(m[3]) * 12 + monthNo(m[1], m[2], 1) - 1;
    const end = m[7] ? now : Number(m[6]) * 12 + monthNo(m[4], m[5], 12) - 1;
    if (end >= start && end <= now && now - start <= 50 * 12) spans.push([start, end]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const s of spans) {
    if (cur && s[0] <= cur[1] + 1) cur[1] = Math.max(cur[1], s[1]);
    else {
      if (cur) total += cur[1] - cur[0] + 1;
      cur = [s[0], s[1]];
    }
  }
  if (cur) total += cur[1] - cur[0] + 1;
  return total;
}

function experienceOf(text: string, experience: string[], today: Date): number | undefined {
  const stated: number[] = [];
  for (const m of text.matchAll(/(\d{1,2}(?:\.\d{1,2})?)\s*\+?\s*(?:years?|yrs?)(?:\s*(?:and\s*)?(\d{1,2})\s*months?)?[^.\n]{0,40}?\b(?:experience|exp\b)/gi)) stated.push(Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0));
  for (const m of text.matchAll(/(?:total\s+)?experience\s*(?:of|:|-)?\s*(?:about|over|around|nearly|more than)?\s*(\d{1,2}(?:\.\d{1,2})?)\s*\+?\s*(?:years?|yrs?)(?:\s*(?:and\s*)?(\d{1,2})\s*months?)?/gi)) stated.push(Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0));
  const years = stated.filter((y) => y > 0 && y <= 50);
  const value = years.length ? Math.max(...years) : experience.length ? rangeMonths(experience.join('\n'), today) / 12 : 0;
  return value > 0 ? Math.min(60, Math.round(value * 10) / 10) : undefined;
}

function roleOf(header: string[], experience: string[]): { title?: string; company?: string } {
  const split = (line: string) => {
    const at = line.match(/^(.{2,100}?)\s+(?:at|@)\s+(.{2,100})$/i);
    if (at && TITLE.test(at[1]!)) return { title: at[1]!, company: at[2]! };
    const parts = line.split(/\s+[|·–—-]\s+|\s*[|·]\s*|,\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const t = parts.findIndex((p) => TITLE.test(p));
    if (t < 0) return null;
    const company = parts.find((p, i) => i !== t && !TITLE.test(p));
    return company ? { title: parts[t]!, company } : null;
  };
  const clean = (l: string) => l.replace(BULLET, '').replace(RANGE, '').replace(/\(\s*\)/g, '').trim();
  for (const line of header.slice(0, 10)) {
    const at = clean(line).match(/^(.{2,100}?)\s+(?:at|@)\s+(.{2,100})$/i);
    if (at && TITLE.test(at[1]!)) return { title: clip(at[1]!, 150), company: clip(at[2]!, 150) };
  }
  // The most recent job comes first: either "Title | Company" on one line, or a title line next to a company line.
  const window = experience.slice(0, 6).filter((l) => !BULLET.test(l)).map(clean).filter((l) => l.length >= 2);
  const companyLike = (l: string | undefined) => !!l && !TITLE.test(l) && l.split(' ').length <= 8 && /^[\p{Lu}\d]/u.test(l);
  for (const [i, line] of window.slice(0, 4).entries()) {
    const r = split(line);
    if (r) return { title: clip(r.title, 150), company: clip(r.company, 150) };
    if (!TITLE.test(line) || line.split(' ').length > 8) continue;
    const company = companyLike(window[i - 1]) ? window[i - 1] : companyLike(window[i + 1]) && !split(window[i + 1]!) ? window[i + 1] : undefined;
    return { title: clip(line, 150), ...(company ? { company: clip(company, 150) } : {}) };
  }
  return {};
}

function skillsOf(text: string, vocabulary: string[]): string[] {
  const found = new Map<string, { name: string; at: number }>();
  const add = (name: string, at: number) => {
    const key = name.toLowerCase();
    if (at >= 0 && (!found.has(key) || found.get(key)!.at > at)) found.set(key, { name, at });
  };
  for (const term of [...new Set([...SKILLS, ...vocabulary.filter((v) => v.trim().length >= 2)])]) add(term, text.search(wordPattern(term, 'iu')));
  for (const term of EXACT) add(term, text.search(wordPattern(term, 'u')));
  for (const [alias, name] of Object.entries(ALIASES)) add(name, text.search(wordPattern(alias, 'iu')));
  return [...found.values()].sort((a, b) => a.at - b.at).map((s) => s.name).slice(0, Math.min(30, CANDIDATE_SKILLS_MAX));
}

/** Parses the text of a resume. `vocabulary` adds the organisation's own skill names to the built-in list. */
export function parseResume(text: string, vocabulary: string[] = [], today = new Date()): ParsedResume {
  const lines = resumeLines(text);
  const joined = lines.join('\n');
  const parts = sections(lines);
  const out: ParsedResume = { skills: [] };

  const name = nameOf(parts.header.length ? parts.header : lines);
  if (name) Object.assign(out, name);
  const email = joined.match(/[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i)?.[0];
  if (email) out.email = email.toLowerCase();
  const phone = phoneOf(joined);
  if (phone) out.phone = phone;
  const linkedin = joined.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9_%-]{2,100})/i);
  if (linkedin) out.linkedinUrl = `https://www.linkedin.com/in/${linkedin[1]}`;

  const role = roleOf(parts.header, parts.experience);
  if (role.title) out.currentTitle = role.title;
  if (role.company) out.currentCompany = role.company;
  const years = experienceOf(joined, parts.experience, today);
  if (years !== undefined) out.experienceYears = years;

  const notice = joined.match(/notice\s*period\s*(?:of|:|-|is)?\s*(\d{1,3})\s*(days?|weeks?|months?)/i);
  if (notice) {
    const days = Number(notice[1]) * (/^w/i.test(notice[2]!) ? 7 : /^m/i.test(notice[2]!) ? 30 : 1);
    if (days <= 365) out.noticePeriodDays = days;
  } else if (/notice\s*period\s*(?:of|:|-|is)?\s*(?:immediate|none|nil|0\b)|immediate\s+joiner/i.test(joined)) out.noticePeriodDays = 0;
  const location = joined.match(/^(?:current\s+)?(?:location|city|based in|address)\s*[:-]\s*(.{2,200})$/im);
  if (location) out.location = clip(location[1]!.split(/\s+[|•]\s+/)[0]!, 120);

  out.skills = skillsOf(joined, vocabulary);
  return out;
}
