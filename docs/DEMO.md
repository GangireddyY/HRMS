# Demo data and logins

`npm run db:seed:demo` (in `backend/`, after `npm run db:migrate` and `npm run db:seed`) creates three organizations — one per subscription plan — with a user for every role and realistic data in every module the plan includes. All records are created through the real API, so they follow the same rules and workflows as anything entered in the app. Nothing is emailed.

It only adds data: existing organizations are untouched, and a demo organization that already exists is skipped (to recreate one, use a fresh database). Dates are relative to the day you run it.

**Password for every demo user: `Demo@Hrms2026`**

The Super Admin (platform console) is the account from `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` in `backend/.env`; it sees all organizations, plans and their modules.

## Acme Technologies — Enterprise plan (every module)

| Role | Login | Person | Try |
|---|---|---|---|
| Organization Admin | `admin@acme.test` | Aarav Mehta | Administration: settings, structure, users, roles & permissions, audit log |
| HR Director | `hr.director@acme.test` | Kavita Rao | Approve the salary increase for Karthik (Performance → cycle → Salary increases) |
| HR Manager | `hr.manager@acme.test` | Neha Sharma | Everything HR: employees, onboarding, performance cycle, benefits, policies, grievances, exits, reports |
| HR Executive | `hr.executive@acme.test` | Rohan Das | Day-to-day HR operations |
| Recruiter | `recruiter@acme.test` | Simran Kaur | Backend Engineer job: candidates at every stage, interviews, a hired candidate |
| Payroll Manager | `payroll@acme.test` | Vikram Iyer | Last month's paid payroll run, payslips, reimbursements, loans, the settlement for Gautam |
| Finance Manager | `finance@acme.test` | Anita Desai | Payroll approval, the pending loan request, reports |
| Department Manager (Engineering) | `eng.manager@acme.test` | Rajesh Kumar | Team approvals (regularization), Karthik's completed review, the pending interview |
| Team Lead | `team.lead@acme.test` | Priya Nair | Leave and work-from-home approvals, Asha's review in progress, interview feedback |
| Department Manager (Sales) | `sales.manager@acme.test` | Arjun Singh | Sales team, an improvement plan, a pending requisition |
| Auditor | `auditor@acme.test` | Meera Joshi | Read-only audit trail and reports |
| Employee | `employee@acme.test` | Asha Patel | Self-service: attendance, leave, payslips, benefits (family cover), skills, learning, policies, survey |
| Employee | `karthik@acme.test` | Karthik Reddy | Completed review, loan request, regularization, sick leave |
| Employee | `divya@acme.test` · `pooja@acme.test` · `farhan@acme.test` · `sneha@acme.test` · `manoj@acme.test` | | Leave, WFH, reimbursements, a grievance, a roster, an improvement plan |
| Employee on notice | `nikhil@acme.test` | Nikhil Jain | Resignation accepted, last day in 30 days |
| Former employee | `former.employee@acme.test` | Gautam Sinha | Completed exit: settlement statement, relieving and experience letters, alumni profile |
| Intern (new joiner) | `intern@acme.test` | Ishaan Malhotra | Onboarding checklist in progress |

What's in it: 21 people in 5 departments and 2 locations, holidays, shifts with overtime, a rotation and roster, an attendance device; 10 days of attendance with late arrivals, overtime, a missed punch and work-from-home; leave types with pending, approved and rejected requests; payroll structures, statutory details, salaries and last month's approved and paid run; reimbursements, a loan request and a disbursed salary advance; a requisition → job → candidates (applied, screening, interviews, offer accepted and hired with onboarding) and a pending requisition; a performance cycle with a completed review, goals in progress and a salary-increase recommendation awaiting approval; an improvement plan; courses, a classroom session and enrolments; a skill matrix with role requirements and a verified skill; announcements (one needing acknowledgement, a pinned event), an anonymous survey with responses, recognitions and suggestions; grievances; a health plan with family cover and a waiver; published policies with acknowledgements and the statutory calendar; one resignation on notice and one completed exit.

## Brightleaf Retail — Growth plan (no benefits or grievances)

| Role | Login | Person |
|---|---|---|
| Organization Admin | `admin@brightleaf.test` | Rahul Khanna |
| HR & Payroll Manager | `hr@brightleaf.test` | Sunita Pillai |
| Finance Manager | `finance@brightleaf.test` | Deepak Shah |
| Store Manager (Department Manager) | `store.manager@brightleaf.test` | Fatima Sheikh |
| Employees | `employee@brightleaf.test` · `kiran@brightleaf.test` · `suresh@brightleaf.test` | Amit Patil, Kiran More, Suresh Naik |

Attendance, leave, salaries and last month's approved payroll, an open job with a candidate, an announcement. Benefits and grievances aren't in the plan, so they don't appear.

## Nimbus Labs — Starter plan (core HR)

| Role | Login | Person |
|---|---|---|
| Organization Admin | `admin@nimbus.test` | Tara Bose |
| Team Lead | `team.lead@nimbus.test` | Dev Sen |
| Employees | `employee@nimbus.test` · `arnab@nimbus.test` | Riya Ghosh, Arnab Dutta |

Employees, attendance, leave and announcements — only the Starter modules are available.
