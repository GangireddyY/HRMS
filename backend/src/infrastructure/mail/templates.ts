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

export function securityAlertEmail(to: string, name: string, event: string): MailMessage {
  return {
    to,
    subject: `Security alert: ${event}`,
    text: `Hi ${name},\n\n${event}. If this was not you, reset your password immediately and contact your administrator.\n`,
    html: layout('Security alert', `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(event)}.</p><p>If this was not you, reset your password immediately and contact your administrator.</p>`),
  };
}
