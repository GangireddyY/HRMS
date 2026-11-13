import { bankDetailsEmail, calendarInviteEmail, digestEmail, invitationEmail, notificationEmail, offerEmail, passwordResetEmail, payslipEmail, scheduledReportEmail, securityAlertEmail } from './templates';

describe('email templates', () => {
  it('escapes names and links in HTML but keeps plain text readable', () => {
    const m = passwordResetEmail('a@x.test', 'Asha <b>', 'https://hr.test/reset?t=1&u=2', 30);
    expect(m.text).toContain('Asha <b>');
    expect(m.html).toContain('Asha &lt;b&gt;');
    expect(m.html).not.toContain('Asha <b>');
    expect(m.html).toContain('https://hr.test/reset?t=1&amp;u=2');
    expect(m.text).toMatch(/30 minutes/);
  });

  it('names the organization and role in invitations and offers', () => {
    expect(invitationEmail('a@x.test', 'Asha', 'Acme', 'Ravi', 'https://hr.test/i', 72).subject).toBe("You're invited to join Acme on HRMS");
    const offer = offerEmail('a@x.test', 'Asha', 'Acme', 'Backend Engineer', 'https://hr.test/o', '30 Nov 2026');
    expect(offer.text).toContain('as Backend Engineer');
    expect(offer.text).toContain('Please respond by 30 Nov 2026');
    expect(offerEmail('a@x.test', 'Asha', 'Acme', null, 'https://hr.test/o', null).text).not.toContain('respond by');
  });

  it('attaches payslips and reports, and mentions the PDF password only as a hint', () => {
    const pdf = { filename: 'payslip.pdf', content: 'JVBERi0=' };
    const slip = payslipEmail('a@x.test', 'Asha', 'Acme', 'November 2026', '₹61,700', 'your PAN in capitals', pdf);
    expect(slip.attachments).toEqual([{ ...pdf, type: 'application/pdf' }]);
    expect(slip.text).toContain('The PDF opens with your PAN in capitals.');
    expect(payslipEmail('a@x.test', 'Asha', 'Acme', 'November 2026', '₹61,700', null, pdf).text).not.toContain('opens with');
    const report = scheduledReportEmail('a@x.test', 'Asha', { title: 'Headcount', organization: 'Acme', period: 'October 2026', rows: 1, manageUrl: 'https://hr.test/r' }, { filename: 'r.csv', content: 'YQ==', type: 'text/csv' });
    expect(report.subject).toBe('[Acme] Headcount (October 2026)');
    expect(report.text).toContain('1 row,');
  });

  it('keeps grievance details out of mailboxes', () => {
    const n = { title: 'New POSH complaint against Ravi', body: 'Details of the incident', url: 'https://hr.test/g/1', organization: 'Acme', category: 'Grievance', discreet: true };
    const m = notificationEmail('a@x.test', 'Asha', n, 'https://hr.test/prefs');
    expect(m.subject).toBe("[Acme] There's an update on a grievance case");
    expect(`${m.text}${m.html}`).not.toMatch(/POSH complaint|incident/);
    const open = notificationEmail('a@x.test', 'Asha', { ...n, discreet: false }, 'https://hr.test/prefs');
    expect(open.text).toContain('Details of the incident');
  });

  it('summarizes digests by organization and sends calendar files', () => {
    const d = digestEmail(
      'a@x.test',
      'Asha',
      'daily',
      [
        { organization: 'Acme', items: [{ title: 'Leave approved', category: 'Leave', at: '2026-11-12' }, { title: 'Payslip ready', url: 'https://hr.test/p', category: 'Payroll', at: '2026-11-12' }] },
        { organization: null, items: [{ title: 'New sign-in', category: 'Security', at: '2026-11-12' }] },
      ],
      'https://hr.test/n',
      'https://hr.test/prefs',
    );
    expect(d.subject).toBe('Your daily HRMS summary: 3 updates waiting for you');
    expect(d.text).toContain('Personal\n- New sign-in');
    const invite = calendarInviteEmail('a@x.test', 'Asha', { title: 'Interview', when: '14 Nov, 10:00', organization: 'Acme', cancelled: true }, 'BEGIN:VCALENDAR');
    expect(invite.subject).toBe('Cancelled: Interview · 14 Nov, 10:00');
    expect(invite.attachments).toEqual([{ filename: 'cancel.ics', content: Buffer.from('BEGIN:VCALENDAR').toString('base64'), type: 'text/calendar' }]);
  });

  it('warns about bank and security changes', () => {
    expect(bankDetailsEmail('a@x.test', 'Asha', 'Your bank account was changed').subject).toBe('Your salary bank account details');
    expect(securityAlertEmail('a@x.test', 'Asha', 'MFA was turned off').text).toContain('reset your password immediately');
  });
});
