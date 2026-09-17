export type IntegrationProvider = 'slack' | 'teams' | 'jira' | 'pagerduty';

export interface IntegrationNotification {
  event: string;
  title: string;
  text: string;
  severity?: 'info' | 'warning' | 'critical';
  finding_id?: string;
  run_id?: string;
  url?: string;
}

/** Renders only non-secret provider payloads; credentials belong in transport configuration. */
export function renderIntegrationPayload(
  provider: IntegrationProvider,
  notification: IntegrationNotification,
): Record<string, unknown> {
  if (!notification.event.trim() || !notification.title.trim() || !notification.text.trim())
    throw new Error('integration notification event, title and text are required');
  const metadata = {
    event: notification.event,
    severity: notification.severity ?? 'info',
    ...(notification.finding_id ? { finding_id: notification.finding_id } : {}),
    ...(notification.run_id ? { run_id: notification.run_id } : {}),
    ...(notification.url ? { url: notification.url } : {}),
  };
  switch (provider) {
    case 'slack':
      return {
        text: notification.title,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: notification.title } },
          { type: 'section', text: { type: 'mrkdwn', text: notification.text } },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `\`${notification.event}\` • ${notification.severity ?? 'info'}`,
              },
            ],
          },
        ],
        aqa: metadata,
      };
    case 'teams':
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
                {
                  type: 'TextBlock',
                  text: notification.title,
                  weight: 'Bolder',
                  wrap: true,
                  color: notification.severity === 'critical' ? 'Attention' : 'Default',
                },
                { type: 'TextBlock', text: notification.text, wrap: true },
                {
                  type: 'FactSet',
                  facts: Object.entries(metadata).map(([name, value]) => ({
                    title: name,
                    value: String(value),
                  })),
                },
              ],
            },
          },
        ],
      };
    case 'jira':
      return {
        fields: {
          summary: notification.title,
          description: `${notification.text}\n\nEvent: ${notification.event}`,
          issuetype: { name: 'Bug' },
          labels: ['agentic-qa', `severity-${notification.severity ?? 'info'}`],
          ...(notification.url ? { environment: notification.url } : {}),
        },
        aqa: metadata,
      };
    case 'pagerduty':
      return {
        event_action: notification.severity === 'info' ? 'resolve' : 'trigger',
        payload: {
          summary: notification.title,
          source: 'agentic-qa-kit',
          severity:
            notification.severity === 'critical'
              ? 'critical'
              : notification.severity === 'warning'
                ? 'warning'
                : 'info',
          custom_details: { text: notification.text, ...metadata },
        },
      };
  }
}
