# HRMS user guide

A task guide for the people who use HRMS every day: employees, managers, HR staff and administrators. Each section
says where to click and what happens next. What you see depends on your role; if a menu item below is missing, you
don't have that permission (ask your HR administrator). Demo accounts to try it out are listed in [DEMO.md](DEMO.md).

## Contents

1. [Getting around](#1-getting-around)
2. [Employees: everyday tasks](#2-employees-everyday-tasks)
3. [Managers: approvals and your team](#3-managers-approvals-and-your-team)
4. [HR staff: the monthly cycle](#4-hr-staff-the-monthly-cycle)
5. [HR staff: hiring to exit](#5-hr-staff-hiring-to-exit)
6. [Administrators: setting up the organization](#6-administrators-setting-up-the-organization)
7. [Questions and fixes](#7-questions-and-fixes)

---

## 1. Getting around

**Signing in.** Use your work email and password, or **Sign in with SSO** if your company uses single sign-on. If
your organization requires two-step verification, scan the QR code with an authenticator app (Google Authenticator,
Microsoft Authenticator) the first time, then enter the 6-digit code at every sign-in. Forgot your password? Use
**Forgot password** on the sign-in page; the link in the email works once and expires.

**Workspaces.** The switcher at the top of the sidebar moves between:

| Workspace | Who | What's there |
|---|---|---|
| **My Workspace** | Everyone | Your attendance, leave, payslips, learning, requests and profile |
| **HR Operations** | HR staff and managers | People, hiring, attendance, leave, payroll, performance and the rest of HR |
| **Administration** | Administrators | Company settings, users and roles, approval chains, audit, integrations |

**Finding things.** Press <kbd>Ctrl</kbd>+<kbd>K</kbd> (or click the search bar) to jump to any page, person or
action ("apply leave", an employee's name). **Ask AI** answers questions about policies and your own data, within
what your role may see.

**Notifications.** The bell shows what needs you. Under **My Workspace → Notifications** choose email, browser
notifications, WhatsApp, or a daily digest instead of one email per event. The phone app works the same way (see
[MOBILE.md](MOBILE.md)).

**Appearance.** **My Workspace → Appearance** has light, dark and other themes. Tables can switch between list and
grid views, and most lists export to CSV.

---

## 2. Employees: everyday tasks

| I want to… | Go to | What happens next |
|---|---|---|
| Mark attendance | **My Workspace → Attendance → Punch in** | Your location or office network may be checked. Missed a punch? Use **Regularize** on that day; your manager approves it. Offline punches are sent when you're back online. |
| Submit my timesheet | **My Workspace → Timesheets** | Fill each day's hours by project, then **Submit** at the end of the week. Your manager approves or sends it back with a comment. Approved hours feed payroll. |
| Apply for leave | **My Workspace → Leave → Apply** | Pick the type and dates; the balance and any holidays or weekends inside are shown before you submit. It goes to your approvers (see **My approvals** to follow it). You can cancel it yourself until it starts; after that, ask your manager or HR. |
| See my payslip | **My Workspace → Payslips** | Download the PDF of any month. **Salary & tax** shows your structure and lets you choose the tax regime and declare investments, with proof upload. |
| Claim an expense | **My Workspace → Reimbursements → New claim** | Attach the bill. After approval, it is paid with the next payroll. |
| Ask HR something | **My Workspace → HR helpdesk** | Raise a ticket; you're notified when HR replies or resolves it. |
| Request travel | **My Workspace → Business travel** | Add the trip and any advance; approvers are notified. |
| Raise a concern | **My Workspace → Grievances** | Only the people handling grievances can see it. POSH complaints go to the Internal Committee only. |
| Update my details | **My Workspace → Profile** | Some changes (for example bank account) need HR approval and you get an email when they change. |
| Resign | **My Workspace → Resignation & exit** | Your manager and HR are notified; you see your notice period, clearance tasks and final settlement as they progress. |

Also in My Workspace: **Performance** (self-review, goals), **OKRs**, **1:1s** with your manager, **Learning**
(assigned courses and certificates), **Skills**, **Benefits** enrolment, **My assets**, **Policies** to read and
acknowledge, and **Company** news and surveys.

---

## 3. Managers: approvals and your team

**Everything waiting for you is in My Workspace → My approvals**: leave, expenses, travel, timesheets, attendance
fixes, resignations and offers. Each item shows who asked, the details and the approval steps; approve or reject with
an optional comment. Some requests need more than one approver (for example manager, then HR, then finance); after
you approve it moves to the next step, and if a step waits too long it is escalated.

**Going on leave yourself?** Set **My Workspace → Approval cover**: pick a colleague and dates, and your approvals go
to them for that time.

**Your team.** In **HR Operations** you see only your team: **Employees** and **Org chart**, the attendance
**Register**, **Team calendar** for leave, **Timesheets** to approve, **Reviews** and **1:1s**, **Team training**,
and **Requisitions** to ask for a new hire.

---

## 4. HR staff: the monthly cycle

A typical month, in order:

1. **Attendance.** Clear **Attendance → Approvals** (regularizations) and check **Timesheets**. Then **Attendance →
   Monthly closing** locks the month, so loss of pay and overtime are final for payroll.
2. **Leave.** Clear pending **Leave requests**. Balances accrue on their own; **Balances** shows them per person.
3. **Payroll run.** **Payroll → Payroll runs → New run** for the month.
   - The run starts as **Draft**: review each person's pay, add one-off earnings or deductions, and fix any warnings.
   - **Submit** it. Another person with approval rights **approves** it (maker-checker; recent bank-account changes
     are flagged).
   - After approval, download the **bank file** and statutory files (PF ECR, ESI, PT and other state levies), plus
     the **accounting journal** for Tally. These downloads ask for your two-step code again.
   - Mark the run **Paid**. Employees can now see their payslips.
4. **Tax.** Under **Tax proofs & returns** verify investment proofs, and at quarter or year end produce 24Q and Form 16.
   PF, ESI and income-tax rates are kept up to date by the platform team (Platform → Statutory rates) whenever a
   notification or Finance Act changes them; each month's payroll uses the rates in force that month.
5. **Compliance.** **Statutory calendar** lists filing due dates with reminders.

---

## 5. HR staff: hiring to exit

**Hiring.** A manager raises a **Requisition**; once approved, open a **Job**. Tick *Show on the careers page* and
people can apply on your public careers site. **Jobs → Job-board feed** copies a link that job boards such as
Indeed, Jooble or Adzuna import, so your open jobs appear there and update on their own. Move **Candidates** through
the stages, schedule interviews (invites go to calendars) and collect feedback. Create the **Offer** from a letter
template; it is approved, then sent for e-signature. **Hire** turns the candidate into an employee and can start
onboarding.

**Onboarding.** **Onboarding** shows each joiner's checklist (documents, IT, induction) with owners and due dates; the
joiner fills their part from a pre-joining link. **Probation** lists confirmations due.

**During employment.** Keep **Employees** up to date (documents with expiry dates appear under **Document expiry**),
revise **Salaries**, run **Review cycles** and **Improvement plans**, assign **Courses**, issue **Assets**, and answer
the **Helpdesk**.

**Exit.** A resignation appears in **Exits**. Approve it and agree the last working day; clearance tasks go to each
department (assets, IT, finance). The **Settlement** (final pay, leave encashment, gratuity, recoveries) is
calculated, approved and paid through **Settlement payouts**. Relieving and experience letters are issued from the
exit, and the person can join **Alumni**.

**Reports.** **Reports** has the standard reports; **Report builder** makes your own from any dataset, saved for
later or emailed on a schedule.

---

## 6. Administrators: setting up the organization

| Task | Where |
|---|---|
| Company details, logo and brand colour, region and currency, password and sign-in rules, two-step verification, SSO | **Administration → Settings** |
| Legal entities and currencies | **Entities & currencies** |
| Departments, designations, locations (office geofence and allowed networks for punch-in) | **Structure** |
| Holiday calendars per location | **Holidays** |
| Extra fields on employee records | **Custom fields** |
| Invite people and give them roles | **Users**, **Roles & permissions** (restricted permissions such as POSH access need a second person) |
| Who approves what, in what order, with time limits | **Approval chains** |
| Who did what; sign-ins | **Audit log**, **Login history** |
| Data export and erasure requests, retention periods | **Privacy & retention** |
| Connect other tools | **Integrations** (below) |

**Integrations.**
- **API keys:** read-only keys for reporting tools or scripts. Each key can read only what it was given, and never
  more than the person who created it can.
- **Webhooks:** another system receives a signed message when something happens (a new joiner, approved leave…).
- **Slack or Microsoft Teams alerts:** choose **Add webhook or alert → Slack** (or **Microsoft Teams**), paste the
  channel's incoming-webhook URL, pick the events, and **Send test**. The URL is kept secret once saved.
- **Tally:** set the ledger names under **Payroll setup → Accounting (Tally)**, then each payroll run has an
  accounting journal to import.

---

## 7. Questions and fixes

| Problem | What to do |
|---|---|
| "You don't have access" or a menu item is missing | Your role doesn't include it. Ask an administrator to check **Roles & permissions**. |
| Punch-in is refused | You may be outside the office area or network set for your location. Use **Regularize** and add a note. |
| A leave or expense approval is stuck | Open it in **My approvals** to see which step and person it is waiting for. The approver can set **Approval cover**; HR can see it too. |
| I didn't get an email | Check **Notifications** settings (you may have chosen a digest) and your spam folder. |
| Locked out after wrong passwords | Wait for the time shown on the sign-in page, or use **Forgot password**. |
| Lost my authenticator phone | Use one of your recovery codes, or ask an administrator to reset two-step verification. |
| Payroll numbers look wrong | Check the month is closed in **Attendance → Monthly closing**, then open the person's line in the draft run to see their earnings, deductions and loss-of-pay days. |
| The page looks outdated after an update | Reload the page; HRMS refreshes itself once when a new version is out. |

Something not covered here? Raise a ticket in **HR helpdesk**, or ask **Ask AI**.
