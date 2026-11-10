# Demo data and logins

`npm run db:seed:demo` (in `backend/`, after `npm run db:migrate` and `npm run db:seed`) creates three organizations — one per subscription plan — with a user for every role and realistic data in every module the plan includes. All records are created through the real API, so they follow the same rules and workflows as anything entered in the app. Nothing is emailed.

It only adds data: existing organizations are untouched, and a demo organization that already exists is skipped (to recreate one, use a fresh database). A demo organization is recognised by its admin account too, so renaming it in Settings doesn't make the seed create a second one. Dates are relative to the day you run it.

It then adds the **Acme scenarios** below (also on their own: `npm run db:seed:demo-extras`, or one area: `npm run db:seed:demo-extras -- payroll|cases|people|security|recruitment|timesheets`). They top up an existing Acme and skip anything already there, so running them again is safe.

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

### Acme scenarios — something to see in every state

| Area | What's there | Where (login) |
|---|---|---|
| Payroll history | August, September and October paid; **November submitted, awaiting approval** | Payroll runs (`payroll@`); approve or send back as `finance@`; trends and year-to-date on Payslips (`employee@`) |
| Salaries | Asha's +12% raise from the 1st of next month; Karthik's earlier, lower salary in his history | Salary & tax (`employee@`, `karthik@`) |
| Loans | Divya's advance ₹10,000 repaid directly (33%); Karthik's loan request waiting for finance | Loans & advances (`divya@`, `finance@`) |
| Reimbursements | Asha: paid, approved-for-next-payroll, rejected and pending claims; Karthik's hotel claim waiting over 7 days | Reimbursements (`employee@`, `payroll@`) |
| Grievances | Farhan's case resolved (his review), Divya's closed, Pooja's withdrawn, Karthik's 5 days past target, Sneha's urgent | Grievances (`hr.manager@`, `farhan@`) |
| POSH | "Internal Committee" role for Kavita and Rohan; one complaint concluded, one under inquiry | POSH annual report (`hr.director@`) |
| Policies | Acceptable use of IT overdue for 18 people; Code of conduct v2 to re-acknowledge; Sales travel fully acknowledged but review overdue; a draft and a retired policy | Policies (`hr.manager@`, `employee@`) |
| Statutory calendar | ESI and professional tax overdue, PF and ESI due within a week, filings with receipts | Statutory calendar (`hr.manager@`) |
| Exits | Manoj's resignation waiting for acceptance | Exits (`hr.manager@`) |
| Documents | Karthik's work permit expired, Manoj's ID this week, Asha's passport this month, Divya's licence later | Document expiry, 60-day window (`hr.manager@`) |
| Probation | Ishaan ends in 10 days, Pooja 3 days overdue, Divya's confirmation recommended and waiting for HR | Probation, Employees (`hr.manager@`) |
| Leave | Divya and Pooja off on the days of Asha's pending leave ("Also away"); Asha's approved leave last month | Leave requests (`team.lead@`), Leave (`employee@`) |
| Training | Pooja's mandatory course overdue; Karthik's POSH-101 certificate expiring, Farhan's expired; a live session next week | Team training (`hr.manager@`), Learning (`pooja@`) |
| Performance | Two check-ins on Sneha's plan; Pooja's goals waiting for approval; 360 feedback on Asha's review | Improvement plans, Reviews (`team.lead@`) |
| Benefits | Farhan adding his wife after his marriage, waiting for HR | Benefit enrolments (`hr.manager@`) |
| Recruitment | Resumes for Sanjay, Ravi and Lata; Sanjay's phone screen waiting for feedback | My interviews (`eng.manager@`) |
| Careers page | Three public roles in three teams: Backend Engineer (full posting), Senior Software Engineer, Platform in Pune (closes in 10 days), Operations Executive | `/careers/acme-technologies` (no sign-in); Job → Job posting tab (`recruiter@`) |
| Onboarding | Pooja's onboarding completed (12/12) | Onboarding → Completed (`hr.manager@`) |
| Sign-in security | Sneha mistyped her password twice yesterday on her phone, then signed in; Ishaan was locked out after repeated wrong passwords (lock already lifted) | Login history and Audit log (`admin@`) |
| Timesheets | Required every week, due Monday, flagged on the payslip when missed (from three weeks ago). Asha: approved two weeks ago, last week waiting for review, this week in progress; Karthik's last week sent back; Pooja's waiting; Divya's still a draft; everyone else missing | Timesheets (`employee@`, `karthik@`); HR → Attendance → Timesheets: review, week status and reminders (`hr.manager@`, `team.lead@`); rules in Payroll setup → Statutory settings (`payroll@`) |

October's tax deduction (TDS) is low because it was worked out before August and September existed, so November's deductions show a large rise against October.

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
