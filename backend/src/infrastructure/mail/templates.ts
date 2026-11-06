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
    html: layout('Reset your password', `<p>Hi ${escapeHtml(name)},</p><p>Use the button below to reset your password. The link expires in ${expiresMinutes} minutes.</p>${button(url, 'Reset password')}`),
  };
}

export function invitationEmail(to: string, name: string, organization: string, inviter: string, url: string, expiresHours: number): MailMessage {
  return {
    to,
    subject: `You're invited to join ${organization} on HRMS`,
    text: `Hi ${name},\n\n${inviter} invited you to join ${organization}. Accept the invitation (valid for ${expiresHours} hours):\n\n${url}\n`,
    html: layout(`Join ${organization}`, `<p>Hi ${escapeHtml(name)},</p><p>${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(organization)}</strong>. The invitation is valid for ${expiresHours} hours.</p>${button(url, 'Accept invitation')}`),
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
