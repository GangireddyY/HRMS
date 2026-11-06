# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow SemVer.

## [0.6.1] – 2026-11-05

### Added
- Employee records for existing users: `POST /employees/from-members` (`employee.create`) creates records for active or invited users without one (name, work email and joining date from the account, generated employee code, Joined history event, one audit entry). `linkable-members` now returns roles and joining date; `GET /users/:id` returns the linked employee record.
- Web: Employees page shows how many users have no employee record yet and opens a dialog to create them in bulk; the user detail page shows the linked employee code or a **Create employee record** button (opens the new record for completion).
- Tests: backend `people.e2e-spec.ts` bulk creation; Playwright `people.spec.ts` covering both paths.

## [0.6.0] – 2026-11-05 – Attendance

### Added
- Migration `20261105140000_attendance`: `shifts` (hours, grace, half/full-day thresholds, weekly offs; one default per organization), `employees.shift_id`, `holidays`, `attendance_records` (one per employee and work date), `attendance_regularizations` (one pending request per day) and `attendance_periods` (closed months). Composite tenant foreign keys and check constraints throughout; all models tenant-scoped.
- Time-zone aware rules (`AttendanceRulesService`, `common/utils/zoned-time.ts`): work dates and shift times use the employee's location time zone (or the organization's); night shifts that end the next day are supported; late minutes after the grace period; worked minutes decide Present / Half day / Absent; calendar days resolve to Present, Half day, Absent, In progress, Missed punch-out, Holiday, Weekly off, Upcoming or Not employed.
- API `/attendance`: `today`, `punch-in` (records IP and optional browser location) / `punch-out`, month `calendar` (own or in scope), daily `register` with summary and filters, HR corrections (`PUT /attendance/records`, audited with a required note), regularization requests (apply, own list, team review list, approve / reject with note, cancel; managers and requesters are notified; nobody reviews their own request), monthly closing (blocked while requests are pending; locks punches, corrections and approvals; reopen is audited), shifts CRUD (`attendance.configure`). `/holidays` CRUD (`organization.calendar.manage`). Employees can be assigned a shift.
- Web: My Workspace → Attendance (live punch card, month calendar, summary, request corrections, own requests) and a punch card on Home; HR operations → Attendance: Register (date, summary tiles that filter, department/status/search), employee month view with corrections, Regularizations (approve / reject), Monthly closing, Shifts; Administration → Holidays; Shift field on the employee form and profile.
- Tests: backend `attendance.e2e-spec.ts` (punching, calendar statuses, scopes, regularization flow and notifications, closing, shifts and night shifts) and `zoned-time.spec.ts` (time zones and DST); Playwright `attendance.spec.ts`; new pages in the responsive checks.

## [0.5.0] – 2026-11-05 – Organization structure & Employee Management

### Added
- Migration `20261105120000_people_core`: `departments` (with parent hierarchy), `designations` (optional level), `locations`, `employees` and `employee_lifecycle_events`. All cross-references are composite `(id, organization_id)` foreign keys, so records can never point at another organization's data; check constraints guard status, employment type, gender, dates and self-references. All five models are tenant-scoped.
- Organization structure API (`/departments`, `/designations`, `/locations`): readable by every member, managed with `organization.structure.manage`; duplicate names/codes and department cycles are rejected, in-use entries can't be deleted (mark inactive instead); audited.
- Employees API (`/employees`): directory with search, filters, sorting and pagination; create with generated codes (EMP-0001…) and optional link to a user account; profile updates; lifecycle actions (transfer, promotion, manager change with reporting-loop prevention, status change incl. exit, probation confirmation) recorded as history with readable before/after values; self-service contact updates (`PATCH /employees/me`); CSV export (spreadsheet-formula safe); deletion guarded for managers and records referenced elsewhere.
- Record scope engine (`EmployeeScopeService`): OWN = own record, TEAM = own + direct reports, DEPARTMENT = own department, ORGANIZATION = all; out-of-scope records return 404. Reused by upcoming Attendance and Leave modules.
- Bank and statutory identifiers (PAN, UAN, bank account, IFSC) encrypted at rest with AES-256-GCM, returned only with `employee.sensitive.view`, every view and change audited without values.
- Web: Administration → Structure (departments, designations, locations); HR operations → Employees (directory, add/edit form, employee profile with employment, contact, reporting lines, linked account, bank & statutory card, lifecycle actions and history timeline); My profile shows the employee's own employment details and lets them update contact and emergency details. `downloadFile()` in the HTTP client; `AppTextarea` gained `disabled`.
- Tests: backend `people.e2e-spec.ts` (structure rules, codes, linking, all scopes, lifecycle, encryption and audit, CSV, tenant isolation); Playwright `people.spec.ts`; new pages added to the responsive checks.

## [0.4.3] – 2026-11-05 – Animated product showcase

### Added
- Organization logo upload. `POST /organizations/current/logo` (multipart `file`, `organization.update`) accepts PNG, JPEG or WebP up to 1 MB; the type is detected from the file signature (SVG and disguised files are rejected), stored in the new tenant-scoped `organization_logos` table (migration `20261105100000_organization_logos`) with a SHA-256 checksum, and audited (`organization.logo_updated` / `organization.logo_removed`). `DELETE /organizations/current/logo` removes it. `GET /organizations/:id/logo` serves it publicly for `<img>` tags with ETag, immutable caching for versioned URLs, `nosniff` and a locked-down CSP. `organizations.logo_url` now holds the versioned API-relative URL and is no longer editable through `PATCH /organizations/current`.
- Settings → Company profile: logo section with preview, upload/replace (button or drag-and-drop), remove with confirmation, and client-side type/size checks; the sidebar workspace switcher shows the logo. `http.upload()` and `apiAssetUrl()` in the HTTP client.
- Logos are normalized on upload with `sharp` (new backend dependency): EXIF rotation applied, empty borders (transparent or a solid background) trimmed, scaled to at most 1024 px on the longest edge and re-encoded as WebP (metadata stripped; unreadable images rejected). Uploads up to 5 MB are accepted. The settings preview is a wide white frame. The expanded sidebar has a dedicated brand area at the top (links to the workspace home) whose backdrop adapts to the logo (`useLogoAppearance`): logos with their own background become a compact badge in that colour, transparent logos sit directly on the sidebar and only get a contrasting backdrop when their WCAG contrast with the sidebar is too low; the settings preview follows the same rule and suggests a transparent PNG for logos with a solid background and the switcher below shows the workspace; the collapsed sidebar shows square logos in the tile and the initial for wide wordmarks.
- Sign-in page (large screens): animated mind map of everything HRMS covers (`ProductMindMap.vue`), built from the real module catalogue. A radar hub sits at the centre; seven lifecycle branches (Hire → Onboard → Manage → Pay → Grow → Govern → Exit) and two platform branches (Security, Platform) leave from blips on its rim, with the modules and capabilities as leaves. The map draws itself in, then features one item every 2.6s: the radar beam turns clockwise to that branch, its blip pings, a flowing connector runs hub → branch → item, and the item's description is shown below. Hovering, clicking or focusing an item features it; motion pauses on hover/focus and is static under `prefers-reduced-motion`. Branch data and capability descriptions live in `modules/auth/showcase.ts`.
- `shared/utils/module-icons.ts`: one icon per module.
- Product logo: a person inside the employee-lifecycle ring. `AppLogo` (SVG, follows the active brand colour theme) is used in the sign-in header and in the platform workspace switcher (organizations keep their initial); `favicon.svg` and the README use the same mark.

### Changed
- Role detail: a searchable "Switch role" dropdown (system roles first; each option shows type, users and permission count) and a "New role" button in the page header; the permission modules list is the page's sticky side menu next to the permissions card. Permissions and Details tabs. Details uses a settings layout (label and help on the left, field on the right), a role information panel (type, key, users, permissions, created, updated), Reset/Save, and a separate "Delete role" section for custom roles. Switching roles or leaving with unsaved permission changes asks for confirmation. The permissions editor adapts to its container width (container queries). `AppSelect` options accept an optional `description` line; page-header actions span the full width on phones. On large screens the role page uses the new route meta `fill`: the shell stops scrolling, the header and tabs stay fixed, the modules side menu scrolls internally (search stays on top) and the permission list scrolls on its own with the module title pinned; the unsaved-changes bar overlays the bottom without hiding the last rows. `AppTabs` gained a `fill` prop.
- Role detail (earlier in this release): details (name, description) in one row above a full-width permissions editor. The editor has a module navigator (icon, granted/total, progress; horizontal chips on small screens) and shows the selected module's permissions grouped by page, each with a switch and an Own / Team / Department / Organization segmented scope control (radio group with arrow-key support; choosing a scope grants the permission). Search covers all modules. "Grant all" / "Clear" per module; a sticky bar shows the number of unsaved changes with Discard and Save permissions.
- Organization sign-up is a two-step form (Organization → Your account) with a step switcher and progress bar, so it fits without scrolling. "Continue" validates the organization name inline; the final step validates name, email and password inline before calling the API; server field errors flag the affected step and return to it; values are kept when moving between steps.
- Sign-in and both sign-up steps share one card height on large screens (`.auth-page-tall`); the "Create an organization" / "Already have an account?" links sit at the bottom of the card.

### Fixed
- Hand cursor on everything clickable (buttons, tabs, options, radios, switches, checkboxes, menu items, selects) via a base style, since Tailwind 4 gives buttons the default arrow; disabled controls show "not allowed".
- System role names can no longer be changed: `PATCH /roles/:id` returns 403 when renaming a system role (descriptions stay editable; custom roles can still be renamed). The role page shows the name as read-only with a lock and an explanation, and only sends the description for system roles.
- Reduced-motion rule now also stops infinite animations (`animation-iteration-count: 1`).
- Auth pages fully follow light/dark mode: light mode uses a bright brand-tinted canvas with dark text and light glass panels; dark mode keeps the deep brand canvas. Colours come from new `hero-*` tokens (`canvas`, `ink`, `accent`, `solid`, `on-solid`, `panel`) in `main.css`, so the canvas, headline, showcase, radar, marquee and footer all switch with the theme toggle and the colour theme. In dark mode the form card (`.auth-card`) uses brand-tinted surfaces, borders and muted text instead of neutral black.
- Sign-in page fills wide screens: removed the 1600px content cap and the showcase width cap; the headline, form card (480px) and spacing scale up at 1536px+.

## [0.4.2] – 2026-11-05 – Sign-in experience

### Changed
- Auth layout: full-screen brand canvas (animated, theme-aware aurora, grid texture) with the headline, floating product illustration and feature chips on the left, and the form as a floating card on top of it on the right (full-width card on phones); theme toggle and footer on the canvas. Motion is disabled under `prefers-reduced-motion`.
- Sign-in: large fields, "Forgot password?" beside the label, enabled Sign in button with inline validation (empty / malformed email, missing password), divider and full-width "Create an organization" button. Forgot-password page restyled to match.
- `AppInput`: `size="lg"`, a `label-action` slot (outside the `<label>`, so it never changes the field's accessible name) and a Caps Lock warning on password fields.

## [0.4.1] – 2026-11-05 – Custom form controls and full-width layout

### Added
- `AppSelect` rebuilt as a custom listbox (search for long lists, check marks, keyboard + type-ahead, placeholder as "no value", rendered in a body-level popover so cards and dialogs never clip it); `AppDatePicker` (calendar, keyboard grid navigation, min/max, Today/Clear); `AppSearchInput` (clear button, Escape); `AppOtpInput` (per-digit boxes, paste, one-time-code autofill); number steppers in `AppInput`; auto-growing `AppTextarea` with counter; refreshed role picker. `useFloating` / `useOutsideClose` composables position popovers.

### Changed
- Pages fill the available width (the 1280 px content cap was removed); wide screens get extra grid columns.

## [0.4.0] – 2026-11-04 – Modern UI

### Changed
- New design language across every page: zinc neutrals, inset shell (page panel floating on the sidebar), layered shadows, larger radii, Inter Variable (self-hosted), sentence-case labels, refined dark mode.
- Shell: workspace/organization switcher moved into the sidebar header; topbar shows breadcrumbs, compact search, theme toggle, notifications and account menu; pill-style navigation with active icon tint.
- Components rebuilt: gradient buttons (+ `outline`, `link`, `xs`), tinted badges with dots, gradient avatars, stat cards (trend, link), data table (sentence-case headers, hover, refined sort), pagination with Previous/Next, segmented tabs, custom checkbox/switch/select, inputs with leading icons, password strength meter, alerts with titles, empty/error states, bottom-sheet modals, toasts, dropdowns, command palette with key hints.
- Pages: auth split screen with theme-aware gradient mesh; dashboards with timeline activity, plan distribution bars and linked stat cards; settings form in a two-column section layout; subscription banner with seat usage; notifications, sessions and permission matrix refreshed; modern 404/403 pages; charts with rounded bars and themed tooltips.
- Status values are shown as readable labels (`MFA_CHALLENGE` → "MFA challenge", `INVITED` → "Invited").

### Added
- Sidebar style preference (Light / Dark / Brand) with previews on the Appearance page, plus a live app preview.
- Playwright test for dark mode with the dark sidebar on every device size.

### Fixed
- The organization time-zone select showed blank for `Asia/Kolkata` because Chromium lists the legacy alias `Asia/Calcutta`; canonical names and the saved value are now always offered.

## [0.3.6] – 2026-11-04 – Super Admin variables

### Changed
- `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` renamed to `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` (used by `npm run db:seed` and the production bootstrap). Update existing `backend/.env*` files.

## [0.3.5] – 2026-11-04 – No seeded organizations

### Changed
- `npm run db:seed` creates only the subscription plans and the Super Admin (`SEED_SUPERADMIN_*`). The demo organization and `SEED_DEMO_ORG_ADMIN_*` were removed: organizations are created by their owners through sign-up (the owner becomes the Organization Admin) or by the Super Admin from the platform console.
- Playwright: a `setup` project signs up the e2e Organization Admin (`E2E_ORG_ADMIN_*` in `backend/.env.test`) before the device projects; new test signs up an organization through the UI and checks the owner gets Organization Admin access.

## [0.3.4] – 2026-11-04 – SendGrid email

### Added
- SendGrid is the only email service, via the official `@sendgrid/mail` 8.1.6 SDK: `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`, optional `SENDGRID_SANDBOX_MODE`. Click/open tracking is disabled because emails carry one-time tokens. API errors are logged with SendGrid's message (never the key) and reported to the caller.
- Boot validation: keys must start with `SG.`; production requires a key and refuses sandbox mode. Without a key in development, emails are printed to the API log.
- Unit tests for the mail service and mail configuration.

### Removed
- SMTP support (`nodemailer`, `SMTP_*`, `MAIL_FROM`) and the Mailpit container from docker compose.

## [0.3.3] – 2026-11-04 – Database configuration variables

### Changed
- The backend reads the database connection from `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (plus optional `DB_SSL`) instead of a single `DATABASE_URL`. Applies to the API, the migration CLI, tests, CI and docker-compose. Update existing `backend/.env` / `.env.test` files accordingly.
- Production boot refuses `DB_USER=postgres` (the superuser).
- The test-database guard checks `DB_NAME` (must contain "test").

## [0.3.2] – 2026-11-04 – Responsive verification

### Added
- Playwright runs every spec at desktop, tablet (Galaxy Tab S4) and phone (Pixel 7) sizes; new `responsive.spec.ts` checks every page for horizontal overflow and tests the navigation drawer.
- `AppDataTable` card layout below 768 px (labelled fields, "Sort by" menu replacing the hidden column headers).

### Changed
- Permission matrix stacks the scope selector under each permission on phones; module headers wrap.

### Fixed
- The closed mobile navigation drawer was only moved off-screen, so its links stayed reachable by Tab and screen readers; it is now hidden until opened, closes on Escape and on navigation, focuses its close button when opened, and the menu button reports `aria-expanded`.

## [0.3.1] – 2026-11-04 – Two self-contained applications

### Changed
- `packages/shared` removed. The contracts (permission catalog, role templates, API envelope & error codes, password rules) now live in `backend/src/contracts`; the backend imports them relatively and the frontend compiles the same files through the `@contracts` alias, so there is still a single source of truth. Their tests run in the backend unit suite.
- npm workspaces removed: `backend/` and `frontend/` are independent npm projects with their own `node_modules` and `package-lock.json`. The root `package.json` has no dependencies and only forwards scripts (`install:all`, `dev:backend`, `dev:frontend`, `build`, `typecheck`, `test`, …). The combined `npm run dev` was dropped; start backend and frontend in separate terminals.
- Docker: the backend image builds from the `backend/` context; the frontend image still uses the repository root (it needs `backend/src/contracts`). CI installs each project with `npm ci --prefix <app>`.
- `backend/tsconfig.json` uses `Node16` module resolution and no `baseUrl` (both flagged as deprecated by TypeScript 6).

### Security
- Added `.dockerignore` files: local `.env` secrets, `node_modules` and build output no longer enter Docker build contexts.

## [0.3.0] – 2026-11-04 – Frontend structure, component library & themes

### Added
- **Color themes**: Indigo (default), Ocean, Emerald, Violet, Rose, Amber, Slate, combined with light / dark / system mode. Brand colors are CSS variables (`app/styles/themes.css`) behind Tailwind's `brand-*` utilities, so all components follow the active theme; sidebar tint and focus ring derive from it. Preferences persist per browser and are applied before first paint.
- `core/theme/` (theme catalog, `useThemeStore`, `useThemePalette` for charts, `ThemeSwitcher`), a topbar light/dark toggle, a quick switcher in the account menu, and **My Workspace → Appearance** (`/me/appearance`) with a live preview.
- `@/shared/components` barrel exporting the whole UI library.
- Tests: theme store unit tests; Playwright `appearance.spec.ts` (switch, persist across reload, reset, account-menu switcher).

### Changed
- Frontend reorganized into `app/` (router, styles), `core/` (http, auth, navigation, theme), `shared/` (components grouped as forms / data / feedback / layout, composables, stores, utils), `layouts/` (+ `shell/`) and feature `modules/<domain>/` folders with their own `api/`, `types.ts`, `<domain>.routes.ts`, `pages/` and `components/`.
- The single `api/endpoints.ts` / `api/types.ts` were split per module (`authApi`, `usersApi`, `rolesApi`, `organizationApi`, `auditApi`, `notificationsApi`, `platformApi`); `ListQuery` moved to `core/http/http-client.ts`.
- Consistent naming: `App*` prefix for every shared component (`FormField` → `AppFormField`, `DataTable` → `AppDataTable`, `StatCard` → `AppStatCard`, `ConfirmHost` → `AppConfirmDialog`, `ToastHost` → `AppToaster`, …), `*.store.ts`, `use-*.ts`, `*.api.ts`, `*.routes.ts`; `LoginActivityChart` → `SignInActivityChart`, `MyHomePage` → `AccountHomePage`, `AdminDashboardPage` → `OrganizationDashboardPage`.
- Theme state moved out of the UI store into the theme store; the UI store now only holds shell state.

## [0.2.1] – 2026-11-04 – Per-application environment files

### Changed
- `frontend/` now has its own env files: `.env` / `.env.example` (dev), `.env.e2e` (Playwright mode), `.env.production` (build); Vite and Playwright read ports, proxy target, API base path and app name from them.
- `backend/` gained `.env.test.example` and `.env.docker.example` templates; compose loads `backend/.env.docker` for the backend containers, and the root `.env.docker` now holds infrastructure secrets only.
- Root `tsconfig.base.json` removed; `backend` and `packages/shared` tsconfigs are self-contained.
- Compose services renamed `api` → `backend`, `web` → `frontend`.

## [0.2.0] – 2026-11-04 – Restructure & ORM change

### Changed
- Repository layout: `apps/api` → `backend/` (`@hrms/backend`), `apps/web` → `frontend/` (`@hrms/frontend`); `packages/shared` unchanged.
- ORM: **Prisma replaced by Sequelize 6.37 + sequelize-typescript 2.1** (pg driver). Models live in `backend/src/database/models`; the database schema is unchanged.
- Migrations: Prisma Migrate replaced by plain SQL migrations run with **Umzug** (`backend/src/database/migrations/*.up.sql|*.down.sql`, tracked in `schema_migrations`), with `up`, `down`, `status` and `baseline` commands (`baseline` adopts databases created by the Prisma migrations without running SQL).
- Tenant isolation: the Prisma client extension is replaced by Sequelize hooks on tenant models — scoping is now the **default** for every query on those models, and identity/platform/bootstrap paths opt out explicitly with `skipTenantScope: true`. Cross-tenant creates, saves and bulk updates are rejected; queries without a tenant context fail closed.
- Production release step: `node dist/database/migrate.js up && node dist/cli/bootstrap.js`.
- `User` default scope hides password hashes and MFA secrets.

### Fixed
- Audit diffs are computed from cloned snapshots (Sequelize returns live `dataValues` from `get({ plain: true })`).

## [0.1.0] – 2026-11-04 – Phase 1: Foundation

### Added
- Monorepo (npm workspaces): `apps/api` (NestJS 11, Prisma 6), `apps/web` (Vue 3.5, Vite 7, Tailwind 4), `packages/shared` (contracts).
- PostgreSQL schema & migrations: identity, sessions, rotating refresh tokens, action tokens, password history, MFA recovery codes, login events, plans/features, organizations, entitlement overrides, security policies, memberships, permissions, roles, role permissions, membership roles, audit logs (append-only trigger), notifications.
- Authentication: login with lockout, TOTP MFA with recovery codes and replay protection, refresh-token rotation with reuse detection, session management, login history, forgot/reset password, invitations, change password, organization switching, organization-mandated MFA and password expiry (restricted sessions).
- Multi-tenancy: tenant-scoped Prisma client (auto-scoping, fail-closed), composite tenant foreign keys, membership validation per request, organization lifecycle with session revocation.
- Plans & entitlements with per-organization overrides and user limits; self-service and platform-provisioned organizations.
- RBAC: 92-permission catalog across 15 modules, 11 organization role templates + platform Super Admin, record scopes, custom roles, locked roles, privilege-escalation prevention, restricted POSH permission, last-admin guard, catalog sync on boot.
- Audit trail with redacted diffs; organization and platform audit views; organization login history.
- In-app notifications.
- Web: design system, four workspace layouts, permission-filtered navigation, global search, notification bell, light/dark themes, auth pages, self-service, administration, HR dashboard and platform administration pages.
- Tests: Vitest (shared, web), Jest unit + Supertest integration on PostgreSQL (API), Playwright E2E.
- Dockerfiles, docker-compose stack (Postgres, Redis, Mailpit, MinIO), GitHub Actions CI, production bootstrap CLI.
- Documentation: PRD, FRD, ARCHITECTURE, DATABASE, API, RBAC (generated matrix), SECURITY, DEPLOYMENT, TESTING.

### Security
- Audit-log redaction no longer masks non-secret fields that merely resemble sensitive names (e.g. `passwordMinLength`, `companySize`).
- Recruiter template no longer includes `recruitment.requisition.approve` (segregation of duties).
