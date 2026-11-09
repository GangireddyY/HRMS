import type { Json, Kit } from './kit';

const RECRUITER = 'recruiter@acme.test';
const ENG_MANAGER = 'eng.manager@acme.test';
const HR = 'hr.manager@acme.test';
const HR_DIRECTOR = 'hr.director@acme.test';

const BACKEND_DESCRIPTION = `Our payments platform moves salaries, reimbursements and vendor payouts for thousands of employees every month. We are adding UPI collections and instant payouts, and need engineers who enjoy owning a service end to end.

You will design, build and run payment services in TypeScript and PostgreSQL, from the API contract to the on-call rotation. You will work in a team of six with a product manager and a designer, and ship to production several times a week.

What you will do:
- Build reliable APIs for payouts, refunds and reconciliation
- Model money movement in PostgreSQL with strong consistency guarantees
- Own observability for your services: metrics, alerts and runbooks
- Review code and mentor engineers who are newer to payments`;

const BACKEND_REQUIREMENTS = `- 3+ years building backend services in TypeScript, Node.js or a similar language
- Solid SQL and data modelling, ideally PostgreSQL
- Experience running services in production and debugging them under pressure
- Clear written communication; you write design notes before big changes
- Nice to have: payments, UPI or banking integrations`;

/** Richer postings and more public roles, so the careers page, its filters and the posting checklist have real content. */
export async function seedRecruitmentExtras(kit: Kit): Promise<void> {
  await kit.step('Recruitment: a complete posting for Backend Engineer (requirements, experience range)', () => backendPosting(kit));
  await kit.step('Recruitment: Senior Software Engineer, Platform (Pune), closing in 10 days', () =>
    openRole(kit, {
      title: 'Senior Software Engineer, Platform',
      requester: ENG_MANAGER,
      approver: HR,
      department: 'Engineering',
      designation: 'Senior Software Engineer',
      location: 'Pune Office',
      budget: [2_400_000, 3_400_000],
      justification: 'A platform team to own CI, observability and the shared libraries every product team depends on',
      experience: [5, 9],
      closesIn: 10,
      description: `Every product team at Acme builds on our shared platform: the build pipeline, service templates, logging and the libraries for authentication and money. We are forming a dedicated platform team in Pune to make that foundation fast, safe and pleasant to use.

As a senior engineer you will set the technical direction with the engineering manager, pair with product teams to understand their pain, and turn it into tools they love.

What you will do:
- Cut build and deploy times across 40+ services
- Design the service template that new teams start from
- Lead the move to structured logs and tracing
- Coach engineers through design reviews`,
      requirements: `- 5+ years of backend or infrastructure engineering
- Deep experience with CI/CD, containers and cloud infrastructure
- You have improved developer experience for other teams before
- Comfortable leading without authority across teams`,
    }),
  );
  await kit.step('Recruitment: Operations Executive (Bengaluru), open until filled', () =>
    openRole(kit, {
      title: 'Operations Executive',
      requester: HR,
      approver: HR_DIRECTOR,
      department: 'Operations',
      designation: 'Operations Executive',
      location: 'Bengaluru HQ',
      budget: [450_000, 650_000],
      justification: 'Office headcount has doubled; facilities, vendor and travel requests need a dedicated owner',
      experience: [1, 3],
      closesIn: null,
      description: `Our Bengaluru office is growing fast, and the operations team keeps it running: facilities, vendors, travel and the events that bring people together.

You will be the first point of contact for 200+ colleagues and the people who make sure the office simply works.

What you will do:
- Manage facility, housekeeping and security vendors
- Book travel and accommodation within policy
- Track assets such as laptops and access cards
- Plan onboarding days and team events with HR`,
      requirements: `- 1–3 years in office administration, facilities or operations
- Organised, calm under pressure and good with people
- Comfortable with spreadsheets and booking tools
- Kannada or Hindi in addition to English is a plus`,
    }),
  );
}

const ids = async (kit: Kit, table: 'departments' | 'designations' | 'locations', name: string) => {
  const [row] = await kit.sql<{ id: string }>(`SELECT id FROM ${table} WHERE organization_id = :orgId AND name = :name LIMIT 1`, { name });
  if (!row) throw new Error(`No ${table.slice(0, -1)} named ${name}`);
  return row.id;
};

async function backendPosting(kit: Kit) {
  const recruiter = await kit.as(RECRUITER);
  const jobs = (await recruiter.get('/recruitment/jobs?pageSize=100')) as Json[];
  const job = jobs.find((j) => j.title === 'Backend Engineer');
  if (!job) throw new Error('The Backend Engineer job from the main demo seed is missing');
  const detail = (await recruiter.get(`/recruitment/jobs/${job.id}`)) as Json;
  if (detail.requirements) return 'skipped';
  await recruiter.patch(`/recruitment/jobs/${job.id}`, { description: BACKEND_DESCRIPTION, requirements: BACKEND_REQUIREMENTS, experienceMin: 3, experienceMax: 6 });
}

interface Role {
  title: string;
  requester: string;
  approver: string;
  department: string;
  designation: string;
  location: string;
  budget: [number, number];
  justification: string;
  experience: [number, number];
  closesIn: number | null;
  description: string;
  requirements: string;
}

/** A requisition raised, approved by someone else, and opened as a public job — the same path a real team takes. */
async function openRole(kit: Kit, r: Role) {
  const recruiter = await kit.as(RECRUITER);
  const jobs = (await recruiter.get('/recruitment/jobs?pageSize=100')) as Json[];
  if (jobs.some((j) => j.title === r.title)) return 'skipped';
  const requester = await kit.as(r.requester);
  const req = (await requester.post('/recruitment/requisitions', {
    title: r.title,
    departmentId: await ids(kit, 'departments', r.department),
    designationId: await ids(kit, 'designations', r.designation),
    locationId: await ids(kit, 'locations', r.location),
    reason: 'NEW_ROLE',
    justification: r.justification,
    openings: 1,
    budgetMin: r.budget[0],
    budgetMax: r.budget[1],
    submit: true,
  })) as Json;
  await (await kit.as(r.approver)).post(`/recruitment/requisitions/${req.id}/approve`, { note: 'Approved in the quarterly hiring plan' });
  const job = (await recruiter.post('/recruitment/jobs', {
    requisitionId: req.id,
    description: r.description,
    requirements: r.requirements,
    experienceMin: r.experience[0],
    experienceMax: r.experience[1],
    isPublic: true,
    closesOn: r.closesIn === null ? null : kit.day(r.closesIn),
  })) as Json;
  await recruiter.post(`/recruitment/jobs/${job.id}/status`, { status: 'OPEN' });
  kit.log(`${r.title}: ${req.code}, open on the careers page`);
}
