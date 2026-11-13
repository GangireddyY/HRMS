import type { WebhookFormat } from '../../contracts';

export interface ChatEvent {
  event: string;
  summary: string | null;
  organizationName?: string | null;
  link: string;
}

/** `leave.request_approved` → `Leave: request approved`. */
export function eventTitle(event: string): string {
  if (event === 'ping') return 'Test message';
  const [group = '', ...rest] = event.split('.');
  const what = rest.join(' ').replace(/[_.]+/g, ' ').trim();
  const head = group.charAt(0).toUpperCase() + group.slice(1);
  return what ? `${head}: ${what}` : head;
}

/** Slack keeps `<`, `>` and `&` for its own markup. */
const slackEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The request body for a Slack incoming webhook or a Teams (connector or Workflows) webhook. */
export function chatMessage(format: Exclude<WebhookFormat, 'JSON'>, e: ChatEvent): Record<string, unknown> {
  const title = eventTitle(e.event);
  const detail = e.summary ?? (e.event === 'ping' ? 'HRMS alerts are connected to this channel.' : 'Something changed in HRMS.');
  const source = e.organizationName ? `HRMS · ${e.organizationName}` : 'HRMS';
  if (format === 'SLACK') {
    return {
      text: `${title}: ${detail}`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*${slackEscape(title)}*\n${slackEscape(detail)}` } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `${slackEscape(source)} · \`${e.event}\` · <${e.link}|Open HRMS>` }] },
      ],
    };
  }
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true },
            { type: 'TextBlock', text: detail, wrap: true },
            { type: 'TextBlock', text: `${source} · ${e.event}`, isSubtle: true, size: 'Small', wrap: true },
          ],
          actions: [{ type: 'Action.OpenUrl', title: 'Open HRMS', url: e.link }],
        },
      },
    ],
  };
}

/** `https://hooks.slack.com/services/T0/B0/abcd1234` → `https://hooks.slack.com/…1234`. */
export function maskUrl(url: string): string {
  const u = new URL(url);
  const tail = `${u.pathname}${u.search}`.replace(/[/?=&]+$/, '').slice(-4);
  return `${u.protocol}//${u.host}/…${tail}`;
}
