import type { MailMessage } from './mail.service';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;background:#f6f7fb;padding:24px">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
<h2 style="margin-top:0;color:#111827">${escapeHtml(title)}</h2>${bodyHtml}
<p style="color:#6b7280;font-size:12px;margin-top:32px">If you did not expect this email, you can ignore it.</p>
</div></body></html>`;
}

function button(url: string, label: string): string {
  return `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${escapeHtml(label)}</a></p>
<p style="color:#6b7280;font-size:12px">Or paste this link into your browser:<br>${escapeHtml(url)}</p>`;
}

export function passwordResetEmail(to: string, name: string, url: string, expiresMinutes: number): MailMessage {
  return {
    to,
    subject: 'Reset your HRMS password',
    text: `Hi ${name},\n\nUse the link below to reset your password. It expires in ${expiresMinutes} minutes.\n\n${url}\n`,
    html: layout(
      'Reset your password',
      `<p>Hi ${escapeHtml(name)},</p><p>Use the button below to reset your password. The link expires in ${expiresMinutes} minutes.</p>${button(url, 'Reset password')}`,
    ),
  };
}

export function invitationEmail(to: string, name: string, organization: string, inviter: string, url: string, expiresHours: number): MailMessage {
  return {
    to,
    subject: `You're invited to join ${organization} on HRMS`,
    text: `Hi ${name},\n\n${inviter} invited you to join ${organization}. Accept the invitation (valid for ${expiresHours} hours):\n\n${url}\n`,
    html: layout(
      `Join ${organization}`,
      `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(organization)}</strong>. The invitation is valid for ${expiresHours} hours.</p>${button(url, 'Accept invitation')}`,
    ),
  };
}

/** The candidate's private link to read, sign (or decline) the offer and, after accepting, complete pre-joining. */
export function offerEmail(to: string, name: string, organization: string, designation: string | null, url: string, acceptBy: string | null): MailMessage {
  const role = designation ? ` as ${designation}` : '';
  const by = acceptBy ? ` Please respond by ${acceptBy}.` : '';
  return {
    to,
    subject: `Your offer from ${organization}`,
    text: `Hi ${name},\n\n${organization} is delighted to offer you a position${role}. Read and sign your offer letter here:${by}\n\n${url}\n\nAfter accepting, use the same link to share your details and documents before you join. Keep this link private.\n`,
    html: layout(
      `Your offer from ${organization}`,
      `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(organization)} is delighted to offer you a position${escapeHtml(role)}.${escapeHtml(by)}</p>${button(url, 'View and sign your offer')}<p>After accepting, use the same link to share your details and documents before you join. Keep this link private.</p>`,
    ),
  };
}

/** The month's payslip as a PDF attachment, when payroll setup turns payslip emails on. */
export function payslipEmail(to: string, name: string, organization: string, period: string, netPay: string, passwordHint: string | null, pdf: { filename: string; content: string }): MailMessage {
  const lock = passwordHint ? ` The PDF opens with ${passwordHint}.` : '';
  return {
    to,
    subject: `Your payslip for ${period}`,
    text: `Hi ${name},\n\nYour payslip for ${period} from ${organization} is attached. Net pay: ${netPay}.${lock}\n\nYou can also see it under Payslips when you sign in.\n`,
    html: layout(
      `Payslip for ${period}`,
      `<p>Hi ${escapeHtml(name)},</p><p>Your payslip for <strong>${escapeHtml(period)}</strong> from ${escapeHtml(organization)} is attached. Net pay: <strong>${escapeHtml(netPay)}</strong>.${escapeHtml(lock)}</p><p>You can also see it under Payslips when you sign in.</p>`,
    ),
    attachments: [{ filename: pdf.filename, content: pdf.content, type: 'application/pdf' }],
  };
}

/** An issued subscription invoice, to the organization's billing contact. */
export function invoiceEmail(to: string, organization: string, number: string, amount: string, dueDate: string, url: string, pdf: { filename: string; content: string }): MailMessage {
  return {
    to,
    subject: `Invoice ${number} for ${organization}: ${amount} due ${dueDate}`,
    text: `Hello,\n\nInvoice ${number} for ${organization}'s HRMS subscription is attached. Amount due: ${amount} by ${dueDate}.\n\nYou can also see your invoices under Organization settings → Billing:\n${url}\n`,
    html: layout(
      `Invoice ${number}`,
      `<p>Hello,</p><p>Invoice <strong>${escapeHtml(number)}</strong> for ${escapeHtml(organization)}'s HRMS subscription is attached.</p><p>Amount due: <strong>${escapeHtml(amount)}</strong> by ${escapeHtml(dueDate)}.</p>${button(url, 'View billing')}`,
    ),
    attachments: [{ filename: pdf.filename, content: pdf.content, type: 'application/pdf' }],
  };
}

/** Sent to the employee whenever their salary bank account is changed or a change is requested. */
export function bankDetailsEmail(to: string, name: string, event: string): MailMessage {
  return {
    to,
    subject: 'Your salary bank account details',
    text: `Hi ${name},\n\n${event}\n\nIf you did not ask for this, contact your HR team right away so your salary isn't paid to the wrong account.\n`,
    html: layout(
      'Salary bank account',
      `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(event)}</p><p><strong>If you did not ask for this, contact your HR team right away</strong> so your salary isn't paid to the wrong account.</p>`,
    ),
  };
}

/**
 * Email copy of an in-app notification. `discreet` (grievances) leaves out the title and body so case details never
 * sit in a mailbox; the reader signs in to see them.
 */
export function notificationEmail(
  to: string,
  name: string,
  n: { title: string; body?: string | null; url?: string | null; organization?: string | null; category: string; discreet?: boolean },
  preferencesUrl: string,
): MailMessage {
  const title = n.discreet ? `There's an update on a ${n.category.toLowerCase()} case` : n.title;
  const body = n.discreet ? 'Sign in to see the details.' : (n.body ?? '');
  const from = n.organization ? `${n.organization} · ${n.category}` : n.category;
  return {
    to,
    subject: n.organization ? `[${n.organization}] ${title}` : title,
    text: `Hi ${name},\n\n${title}${body ? `\n\n${body}` : ''}${n.url ? `\n\nOpen: ${n.url}` : ''}\n\n${from}. Choose which emails you get: ${preferencesUrl}\n`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(name)},</p>${body ? `<p>${escapeHtml(body)}</p>` : ''}${n.url ? `<p><a href="${escapeHtml(n.url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open in HRMS</a></p>` : ''}
<p style="color:#6b7280;font-size:12px">${escapeHtml(from)} · <a href="${escapeHtml(preferencesUrl)}" style="color:#6b7280">Choose which emails you get</a></p>`,
    ),
  };
}

/** A scheduled report-builder report, attached. */
export function scheduledReportEmail(to: string, name: string, report: { title: string; organization: string; period: string | null; rows: number; manageUrl: string }, file: { filename: string; content: string; type: string }): MailMessage {
  const what = `${report.title}${report.period ? ` (${report.period})` : ''}`;
  return {
    to,
    subject: `[${report.organization}] ${what}`,
    text: `Hi ${name},\n\nYour scheduled report "${what}" is attached: ${report.rows} row${report.rows === 1 ? '' : 's'}, limited to what you have access to.\n\nManage scheduled reports: ${report.manageUrl}\n`,
    html: layout(
      report.title,
      `<p>Hi ${escapeHtml(name)},</p><p>Your scheduled report <strong>${escapeHtml(what)}</strong> is attached: ${report.rows} row${report.rows === 1 ? '' : 's'}, limited to what you have access to.</p><p style="color:#6b7280;font-size:12px"><a href="${escapeHtml(report.manageUrl)}" style="color:#6b7280">Manage scheduled reports</a></p>`,
    ),
    attachments: [file],
  };
}

/** An iCalendar invite (or cancellation); calendars show it with add / update / remove buttons. */
export function calendarInviteEmail(to: string, name: string, e: { title: string; when: string; organization: string; cancelled: boolean }, ics: string, method: 'REQUEST' | 'CANCEL'): MailMessage {
  const head = e.cancelled ? `Cancelled: ${e.title}` : e.title;
  return {
    to,
    subject: `${head} · ${e.when}`,
    text: `Hi ${name},\n\n${e.cancelled ? 'This has been cancelled and is removed from your calendar' : 'This has been added to your calendar'}: ${e.title}, ${e.when}.\n\n${e.organization}\n`,
    html: layout(head, `<p>Hi ${escapeHtml(name)},</p><p>${e.cancelled ? 'This has been cancelled' : 'This has been added to your calendar'}:</p><p><strong>${escapeHtml(e.title)}</strong><br>${escapeHtml(e.when)}</p><p style="color:#6b7280;font-size:12px">${escapeHtml(e.organization)}</p>`),
    attachments: [{ filename: e.cancelled ? 'cancel.ics' : 'invite.ics', content: Buffer.from(ics, 'utf8').toString('base64'), type: `text/calendar; method=${method}; charset=UTF-8` }],
  };
}

export interface DigestGroup {
  /** Null = personal notifications (not tied to an organization). */
  organization: string | null;
  items: { title: string; body?: string | null; url?: string | null; category: string; at: string }[];
}

/** Daily / weekly summary of unread notifications, grouped by organization. */
export function digestEmail(to: string, name: string, period: 'daily' | 'weekly', groups: DigestGroup[], inboxUrl: string, preferencesUrl: string): MailMessage {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const title = `${total} update${total === 1 ? '' : 's'} waiting for you`;
  const text = groups
    .map((g) => `${g.organization ?? 'Personal'}\n${g.items.map((i) => `- ${i.title}${i.body ? `: ${i.body}` : ''}${i.url ? ` (${i.url})` : ''}`).join('\n')}`)
    .join('\n\n');
  const html = groups
    .map(
      (g) => `<h3 style="margin:24px 0 8px;font-size:14px;color:#374151">${escapeHtml(g.organization ?? 'Personal')}</h3><ul style="padding-left:18px;margin:0">${g.items
        .map(
          (i) =>
            `<li style="margin:0 0 10px">${i.url ? `<a href="${escapeHtml(i.url)}" style="color:#4f46e5;text-decoration:none">${escapeHtml(i.title)}</a>` : escapeHtml(i.title)}<br><span style="color:#6b7280;font-size:12px">${escapeHtml(i.category)}${i.body ? ` · ${escapeHtml(i.body)}` : ''}</span></li>`,
        )
        .join('')}</ul>`,
    )
    .join('');
  return {
    to,
    subject: `Your ${period} HRMS summary: ${title}`,
    text: `Hi ${name},\n\nYour ${period} summary of unread notifications:\n\n${text}\n\nOpen them all: ${inboxUrl}\nChoose how often you get emails: ${preferencesUrl}\n`,
    html: layout(title, `<p>Hi ${escapeHtml(name)}, here is your ${period} summary of unread notifications.</p>${html}${button(inboxUrl, 'Open notifications')}<p style="color:#6b7280;font-size:12px"><a href="${escapeHtml(preferencesUrl)}" style="color:#6b7280">Choose how often you get emails</a></p>`),
  };
}

export function securityAlertEmail(to: string, name: string, event: string): MailMessage {
  return {
    to,
    subject: `Security alert: ${event}`,
    text: `Hi ${name},\n\n${event}. If this was not you, reset your password immediately and contact your administrator.\n`,
    html: layout('Security alert', `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(event)}.</p><p>If this was not you, reset your password immediately and contact your administrator.</p>`),
  };
}
