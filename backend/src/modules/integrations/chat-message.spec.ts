import { chatMessage, eventTitle, maskUrl } from './chat-message';

describe('chat messages', () => {
  it('names events for people', () => {
    expect(eventTitle('leave.request_approved')).toBe('Leave: request approved');
    expect(eventTitle('exit.settlement.paid')).toBe('Exit: settlement paid');
    expect(eventTitle('ping')).toBe('Test message');
  });

  it('escapes Slack markup and links to HRMS', () => {
    const m = chatMessage('SLACK', { event: 'employee.created', summary: 'Employee <A&B> created', organizationName: 'Acme', link: 'https://hr.acme.in' }) as { text: string; blocks: { text?: { text: string }; elements?: { text: string }[] }[] };
    expect(m.text).toBe('Employee: created: Employee <A&B> created');
    expect(m.blocks[0]!.text!.text).toBe('*Employee: created*\nEmployee &lt;A&amp;B&gt; created');
    expect(m.blocks[1]!.elements![0]!.text).toBe('HRMS · Acme · `employee.created` · <https://hr.acme.in|Open HRMS>');
  });

  it('builds a Teams adaptive card', () => {
    const m = chatMessage('TEAMS', { event: 'ping', summary: null, link: 'https://hr.acme.in' }) as { attachments: { content: { body: { text: string }[]; actions: { url: string }[] } }[] };
    expect(m.attachments[0]!.content.body.map((b) => b.text)).toEqual(['Test message', 'HRMS alerts are connected to this channel.', 'HRMS · ping']);
    expect(m.attachments[0]!.content.actions[0]!.url).toBe('https://hr.acme.in');
  });

  it('masks incoming-webhook URLs', () => {
    expect(maskUrl('https://hooks.slack.com/services/T0/B0/abcd1234')).toBe('https://hooks.slack.com/…1234');
    expect(maskUrl('https://prod-12.westus.logic.azure.com/workflows/x/triggers/manual/paths/invoke?sig=zzzzWXYZ')).toBe('https://prod-12.westus.logic.azure.com/…WXYZ');
  });
});
