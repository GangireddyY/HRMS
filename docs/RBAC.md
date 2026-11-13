# RBAC – Roles, Permissions & Access Control

> Source of truth: `backend/src/contracts/permissions.ts` (catalog) and `backend/src/contracts/roles.ts` (system role templates).
> The matrix at the bottom is generated — run `npm run docs:rbac` after changing either file.

## 1. Model

```mermaid
flowchart LR
  U[User] -->|membership per org| M[OrganizationMembership]
  M -->|many| MR[MembershipRole]
  MR --> R[Role (org-scoped)]
  R -->|many| RP[RolePermission + scope]
  RP --> P[Permission (global catalog)]
  O[Organization] --> PL[Plan] --> PF[PlanFeature] --> F[Feature = module]
  O --> OF[OrganizationFeature override]
```

* **Users are global identities**; access is always evaluated **per organization** through an active `OrganizationMembership`.
* **Roles belong to an organization.** The 11 system roles are provisioned into every new organization from templates; organizations can edit them (except locked roles) and create custom roles.
* **Effective permissions** = union of the permissions of all roles assigned to the membership. When the same permission appears in several roles, the **broadest scope wins**.
* **Super Admin** is a *platform role* on the user (`users.platform_role = SUPER_ADMIN`), not an organization role. It grants the platform permissions (`platform.organizations.view|manage`, `platform.plans.manage`, `platform.audit.view`) and **no implicit access to tenant data**.

## 2. Permission levels

| Level | Mechanism | Example |
|---|---|---|
| **Module** | Each permission belongs to a module; modules are entitled by the organization's plan + overrides. Permissions of non-entitled modules are stripped from the effective set and the API returns `FEATURE_NOT_ENTITLED`. | `payroll` not in the Starter plan |
| **Page** | Each permission declares a `page`; routes and menu items require *any* permission of the page. | `/admin/users` requires `user.view` |
| **Action** | Every API route declares the exact permission with `@RequirePermissions(...)`. | `POST /users/invitations` → `user.invite` |
| **Record** | Scopable permissions carry a scope per role: `OWN` < `TEAM` < `DEPARTMENT` < `ORGANIZATION`. Business services translate the scope into query filters (from Phase 2, when the employee/manager hierarchy exists). | Team Lead: `leave.approve` @ TEAM |

## 3. System roles

| Key | Role | Locked | Purpose |
|---|---|:-:|---|
| — | **Super Admin** (platform) | — | Operates the platform: organizations, plans, entitlements, platform audit. |
| `org_admin` | Organization Admin | ✓ | Full administration of one organization (all non-restricted permissions). Locked so administrators cannot lock themselves out. |
| `hr_director` | HR Director | | All HR modules; payroll review/approval; user invites; audit view. |
| `hr_manager` | HR Manager | | Day-to-day HR operations across modules; read-only payroll. |
| `hr_executive` | HR Executive | | Employee records, onboarding, attendance & leave administration. |
| `recruiter` | Recruiter | | Recruitment pipeline; cannot approve requisitions. |
| `payroll_manager` | Payroll Manager | | Configures & processes payroll; **cannot approve** (segregation of duties). |
| `finance_manager` | Finance Manager | | Reviews/approves payroll, disbursement, cost reports. |
| `department_manager` | Department Manager | | Approvals and visibility at DEPARTMENT scope. |
| `team_lead` | Team Lead | | Approvals and visibility at TEAM scope. |
| `employee` | Employee | | Self-service (OWN scope). |
| `auditor` | Auditor | | Read-only `*.view` permissions, audit trail and login history; no bank/statutory identifiers, no grievance cases. |

## 4. Guard rails

* **Privilege-escalation prevention** – a user can only create/edit roles, assign roles, or act on (suspend, revoke sessions of) another user if every permission involved is one they hold at an equal or broader scope (`modules/rbac/escalation.ts`). Removing roles from someone requires the same.
* **Restricted permissions** (`grievance.posh.access`) are never granted by templates — not even to Organization Admin. Only holders of `role.manage` may assign them, so POSH case access is limited to the explicitly appointed Internal Committee.
* **Last administrator** – the last active Organization Admin cannot be suspended or demoted; users cannot change their own roles or suspend themselves.
* **Approval chains decide who approves** – approve/reject for leave, expense claims, travel, resignations and offers is open to any member at the route; the service then allows only the person waiting on the request's current chain step (or their delegate), or, when no chain applies, a holder of the module's approve permission in scope. Everyone else gets 403. This lets an approval chain name approvers who hold no module role.
* **Locked roles** cannot have their permissions changed; system roles cannot be deleted; roles with members cannot be deleted.
* **Immediate effect** – permissions are resolved from the database on every request (not embedded in the JWT), so role changes, suspensions and entitlement changes apply instantly.
* **Catalog sync** – on boot the API upserts the catalog; permissions added in a new release are granted to existing system roles whose template includes them, without re-adding permissions an administrator deliberately removed.

## 5. Platform permissions

| Permission | Super Admin |
|---|:-:|
| `platform.organizations.view` | ✓ |
| `platform.organizations.manage` | ✓ |
| `platform.plans.manage` | ✓ |
| `platform.audit.view` | ✓ |

## 6. Permission matrix (generated)

Legend: ✓ = granted (organization-wide action), `Own` / `Team` / `Dept` / `Org` = granted at that record scope, blank = not granted.

<!-- RBAC-MATRIX:START -->

### Module summary

Cells show *permissions granted / permissions in module* and the broadest **record scope** among the granted scopable permissions (— = no access).

| Module | Organization Admin | HR Director | HR Manager | HR Executive | Recruiter | Payroll Manager | Finance Manager | Department Manager | Team Lead | Employee | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Core Platform | 14/14 | 8/14 | 6/14 | 2/14 | 1/14 | 1/14 | 1/14 | 1/14 | 1/14 | 1/14 | 5/14 |
| Employee Management | 11/11 · Org | 11/11 · Org | 11/11 · Org | 6/11 · Org | 1/11 · Own | 4/11 · Org | 2/11 · Org | 1/11 · Dept | 1/11 · Team | 1/11 · Own | 2/11 · Org |
| Recruitment | 6/6 · Org | 6/6 · Org | 6/6 · Org | — | 5/6 | — | — | 3/6 · Dept | 1/6 | — | 1/6 |
| Onboarding | 4/4 · Org | 4/4 · Org | 4/4 · Org | 3/4 · Org | 1/4 · Org | — | — | 2/4 · Dept | — | — | 1/4 · Org |
| Attendance | 8/8 · Org | 8/8 · Org | 8/8 · Org | 5/8 · Org | 4/8 · Own | 4/8 · Org | 4/8 · Own | 5/8 · Dept | 5/8 · Team | 4/8 · Own | 1/8 · Org |
| Leave Management | 5/5 · Org | 5/5 · Org | 5/5 · Org | 3/5 · Org | 2/5 · Own | 2/5 · Org | 2/5 · Own | 3/5 · Dept | 3/5 · Team | 2/5 · Own | 1/5 · Org |
| Payroll | 14/14 · Org | 8/14 · Org | 4/14 · Own | 3/14 · Own | 3/14 · Own | 10/14 · Org | 11/14 · Org | 4/14 · Dept | 3/14 · Own | 3/14 · Own | 2/14 · Org |
| Performance | 6/6 · Org | 6/6 · Org | 6/6 · Org | 3/6 · Own | 3/6 · Own | 3/6 · Own | 3/6 · Own | 5/6 · Dept | 4/6 · Team | 3/6 · Own | 1/6 · Org |
| Training & Development | 4/4 · Org | 4/4 · Org | 4/4 · Org | 3/4 · Org | 2/4 | 2/4 | 2/4 | 3/4 · Dept | 2/4 | 2/4 | 1/4 |
| Employee Engagement | 5/5 | 5/5 | 5/5 | 4/5 | 3/5 | 3/5 | 3/5 | 3/5 | 3/5 | 3/5 | 1/5 |
| Grievance Management | 3/4 | 3/4 | 3/4 | 1/4 | 1/4 | 1/4 | 1/4 | 1/4 | 1/4 | 1/4 | — |
| Benefits | 3/3 · Org | 3/3 · Org | 3/3 · Org | 2/3 · Own | 2/3 · Own | 2/3 · Own | 2/3 · Own | 2/3 · Own | 2/3 · Own | 2/3 · Own | 1/3 · Org |
| Compliance & Documents | 3/3 | 3/3 | 3/3 | 2/3 | 2/3 | 2/3 | 2/3 | 2/3 | 2/3 | 2/3 | 1/3 |
| Exit Management | 5/5 · Org | 5/5 · Org | 5/5 · Org | 3/5 · Org | 2/5 · Own | 2/5 · Org | 2/5 · Own | 3/5 · Dept | 2/5 · Own | 2/5 · Own | 1/5 · Org |
| Reports & Analytics | 4/4 · Org | 4/4 · Org | 3/4 · Org | 1/4 · Org | 1/4 | 2/4 | 2/4 | 1/4 · Dept | 1/4 · Team | — | 3/4 · Org |

### Core Platform (`core`)

| Permission | Organization Admin | HR Director | HR Manager | HR Executive | Recruiter | Payroll Manager | Finance Manager | Department Manager | Team Lead | Employee | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `organization.view` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  | ✓ |
| `organization.update` | ✓ |  |  |  |  |  |  |  |  |  |  |
| `organization.security.manage` | ✓ |  |  |  |  |  |  |  |  |  |  |
| `organization.structure.manage` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `organization.calendar.manage` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `user.view` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |
| `user.invite` | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| `user.update` | ✓ |  |  |  |  |  |  |  |  |  |  |
| `user.sessions.revoke` | ✓ |  |  |  |  |  |  |  |  |  |  |
| `role.view` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  | ✓ |
| `role.manage` | ✓ |  |  |  |  |  |  |  |  |  |  |
| `audit.view` | ✓ | ✓ |  |  |  |  |  |  |  |  | ✓ |
| `audit.login_history.view` | ✓ |  |  |  |  |  |  |  |  |  | ✓ |
| `self.profile.update` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |

### Employee Management (`employee`)

| Permission | Organization Admin | HR Director | HR Manager | HR Executive | Recruiter | Payroll Manager | Finance Manager | Department Manager | Team Lead | Employee | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `employee.view` (scoped) | Org | Org | Org | Org | Own | Org | Own | Dept | Team | Own | Org |
| `employee.create` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `employee.update` (scoped) | Org | Org | Org | Org |  |  |  |  |  |  |  |
| `employee.delete` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `employee.import` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `employee.export` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `employee.lifecycle.manage` (scoped) | Org | Org | Org |  |  |  |  |  |  |  |  |
| `employee.salary.view` (scoped) | Org | Org | Org |  |  | Org | Org |  |  |  | Org |
| `employee.salary.revise` | ✓ | ✓ | ✓ |  |  | ✓ |  |  |  |  |  |
| `employee.sensitive.view` (scoped) | Org | Org | Org |  |  | Org |  |  |  |  |  |
| `employee.document.manage` (scoped) | Org | Org | Org | Org |  |  |  |  |  |  |  |

### Recruitment (`recruitment`)

| Permission | Organization Admin | HR Director | HR Manager | HR Executive | Recruiter | Payroll Manager | Finance Manager | Department Manager | Team Lead | Employee | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `recruitment.requisition.create` | ✓ | ✓ | ✓ |  | ✓ |  |  | ✓ |  |  |  |
| `recruitment.requisition.approve` (scoped) | Org | Org | Org |  |  |  |  | Dept |  |  |  |
| `recruitment.view` | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  | ✓ |
| `recruitment.manage` | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |
| `recruitment.interview.feedback` | ✓ | ✓ | ✓ |  | ✓ |  |  | ✓ | ✓ |  |  |
| `recruitment.offer.manage` | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  |  |

### Onboarding (`onboarding`)

| Permission | Organization Admin | HR Director | HR Manager | HR Executive | Recruiter | Payroll Manager | Finance Manager | Department Manager | Team Lead | Employee | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `onboarding.view` (scoped) | Org | Org | Org | Org | Org |  |  | Dept |  |  | Org |
| `onboarding.manage` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `onboarding.document.verify` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `onboarding.confirmation.approve` (scoped) | Org | Org | Org |  |  |  |  | Dept |  |  |  |

### Attendance (`attendance`)

| Permission | Organization Admin | HR Director | HR Manager | HR Executive | Recruiter | Payroll Manager | Finance Manager | Department Manager | Team Lead | Employee | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `attendance.view` (scoped) | Org | Org | Org | Org | Own | Org | Own | Dept | Team | Own | Org |
| `attendance.mark` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `attendance.manage` (scoped) | Org | Org | Org | Org |  |  |  |  |  |  |  |
| `attendance.regularize.apply` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `attendance.regularize.approve` (scoped) | Org | Org | Org |  |  |  |  | Dept | Team |  |  |
| `attendance.wfh.apply` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `attendance.configure` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `attendance.close` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |

### Leave Management (`leave`)

| Permission | Organization Admin | HR Director | HR Manager | HR Executive | Recruiter | Payroll Manager | Finance Manager | Department Manager | Team Lead | Employee | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `leave.view` (scoped) | Org | Org | Org | Org | Own | Org | Own | Dept | Team | Own | Org |
| `leave.apply` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `leave.approve` (scoped) | Org | Org | Org |  |  |  |  | Dept | Team |  |  |
| `leave.configure` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `leave.allocate` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |

### Payroll (`payroll`)

| Permission | Organization Admin | HR Director | HR Manager | HR Executive | Recruiter | Payroll Manager | Finance Manager | Department Manager | Team Lead | Employee | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `payroll.view` | ✓ | ✓ | ✓ |  |  | ✓ | ✓ |  |  |  | ✓ |
| `payroll.process` | ✓ |  |  |  |  | ✓ |  |  |  |  |  |
| `payroll.validate` | ✓ |  |  |  |  | ✓ |  |  |  |  |  |
| `payroll.review` | ✓ | ✓ |  |  |  |  | ✓ |  |  |  |  |
| `payroll.approve` | ✓ | ✓ |  |  |  |  | ✓ |  |  |  |  |
| `payroll.disburse` | ✓ |  |  |  |  |  | ✓ |  |  |  |  |
| `payroll.configure` | ✓ |  |  |  |  | ✓ |  |  |  |  |  |
| `payroll.payslip.view` (scoped) | Org | Org | Own | Own | Own | Org | Own | Own | Own | Own | Org |
| `payroll.reimbursement.apply` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `payroll.reimbursement.approve` (scoped) | Org |  |  |  |  | Org | Org | Dept |  |  |  |
| `payroll.settlement.manage` | ✓ | ✓ |  |  |  | ✓ | ✓ |  |  |  |  |
| `payroll.loan.apply` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `payroll.loan.approve` | ✓ | ✓ |  |  |  |  | ✓ |  |  |  |  |
| `payroll.loan.manage` | ✓ |  |  |  |  | ✓ | ✓ |  |  |  |  |

### Performance (`performance`)

| Permission | Organization Admin | HR Director | HR Manager | HR Executive | Recruiter | Payroll Manager | Finance Manager | Department Manager | Team Lead | Employee | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `performance.view` (scoped) | Org | Org | Org | Own | Own | Own | Own | Dept | Team | Own | Org |
| `performance.configure` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `performance.review` (scoped) | Org | Org | Org |  |  |  |  | Dept | Team |  |  |
| `performance.self_assess` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `performance.feedback.give` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `performance.pip.manage` (scoped) | Org | Org | Org |  |  |  |  | Dept |  |  |  |

### Training & Development (`training`)

| Permission | Organization Admin | HR Director | HR Manager | HR Executive | Recruiter | Payroll Manager | Finance Manager | Department Manager | Team Lead | Employee | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `training.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `training.manage` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `training.enroll` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `training.assign` (scoped) | Org | Org | Org | Org |  |  |  | Dept |  |  |  |

### Employee Engagement (`engagement`)

| Permission | Organization Admin | HR Director | HR Manager | HR Executive | Recruiter | Payroll Manager | Finance Manager | Department Manager | Team Lead | Employee | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `engagement.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `engagement.announcement.manage` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| `engagement.survey.manage` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `engagement.survey.respond` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `engagement.recognition.give` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |

### Grievance Management (`grievance`)

| Permission | Organization Admin | HR Director | HR Manager | HR Executive | Recruiter | Payroll Manager | Finance Manager | Department Manager | Team Lead | Employee | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `grievance.submit` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `grievance.view` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `grievance.manage` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `grievance.posh.access` (**restricted**) |  |  |  |  |  |  |  |  |  |  |  |

### Benefits (`benefits`)

| Permission | Organization Admin | HR Director | HR Manager | HR Executive | Recruiter | Payroll Manager | Finance Manager | Department Manager | Team Lead | Employee | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `benefits.view` (scoped) | Org | Org | Org | Own | Own | Own | Own | Own | Own | Own | Org |
| `benefits.manage` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `benefits.enroll` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |

### Compliance & Documents (`compliance`)

| Permission | Organization Admin | HR Director | HR Manager | HR Executive | Recruiter | Payroll Manager | Finance Manager | Department Manager | Team Lead | Employee | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `compliance.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `compliance.manage` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `compliance.policy.acknowledge` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |

### Exit Management (`exit`)

| Permission | Organization Admin | HR Director | HR Manager | HR Executive | Recruiter | Payroll Manager | Finance Manager | Department Manager | Team Lead | Employee | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `exit.view` (scoped) | Org | Org | Org | Org | Own | Org | Own | Dept | Own | Own | Org |
| `exit.resign` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |
| `exit.approve` (scoped) | Org | Org | Org |  |  |  |  | Dept |  |  |  |
| `exit.manage` | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |  |
| `exit.clearance.manage` | ✓ | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |

### Reports & Analytics (`reports`)

| Permission | Organization Admin | HR Director | HR Manager | HR Executive | Recruiter | Payroll Manager | Finance Manager | Department Manager | Team Lead | Employee | Auditor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `reports.view` (scoped) | Org | Org | Org | Org |  |  |  | Dept | Team |  | Org |
| `reports.payroll.view` | ✓ | ✓ |  |  |  | ✓ | ✓ |  |  |  | ✓ |
| `reports.recruitment.view` | ✓ | ✓ | ✓ |  | ✓ |  |  |  |  |  | ✓ |
| `reports.export` | ✓ | ✓ | ✓ |  |  | ✓ | ✓ |  |  |  |  |

<!-- RBAC-MATRIX:END -->
