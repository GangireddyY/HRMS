/** Webhook event groups (an event is an audited action such as `leave.request_approved`). */
export const WEBHOOK_EVENT_GROUPS = [
  { key: 'employee', label: 'Employees' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'leave', label: 'Leave' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'performance', label: 'Performance' },
  { key: 'recruitment', label: 'Recruitment' },
  { key: 'training', label: 'Training' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'benefits', label: 'Benefits' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'exit', label: 'Exits' },
  { key: 'assets', label: 'Assets' },
  { key: 'helpdesk', label: 'Helpdesk' },
  { key: 'travel', label: 'Travel' },
  { key: 'organization', label: 'Organization' },
  { key: 'user', label: 'Users & roles' },
] as const;

/** Never sent to webhooks: sign-in and security events, confidential cases, the audit trail itself. */
export const WEBHOOK_EXCLUDED_PREFIXES = ['auth.', 'grievance.', 'audit.', 'privacy.', 'integration.', 'platform.', 'security.'] as const;

/** "*", "leave.*" or an exact event like "leave.request_approved". */
export const WEBHOOK_EVENT_PATTERN = /^(\*|[a-z][a-z_]*\.\*|[a-z][a-z_]*\.[a-z][a-z_.]*)$/;

export const API_KEY_MAX_PER_ORG = 25;
/** API keys are read-only: only these kinds of permission can be given to one. */
export const API_KEY_PERMISSION_PATTERN = /\.(view|read)$|^reports\./;
