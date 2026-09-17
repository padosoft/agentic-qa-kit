import type { BusEvent } from './event-bus.js';

export const LIVE_EVENT_TYPES = [
  'run.requested',
  'run.cancelled',
  'finding.status_changed',
] as const satisfies readonly BusEvent['type'][];

export interface AsyncApiDocument {
  asyncapi: '3.0.0';
  info: { title: string; version: string; description: string };
  servers: Record<string, { host: string; pathname: string; protocol: 'http' | 'https' }>;
  channels: Record<
    string,
    {
      address: string;
      description: string;
      messages: Record<string, { $ref: string }>;
    }
  >;
  operations: Record<
    string,
    {
      action: 'receive';
      channel: { $ref: string };
      messages: Array<{ $ref: string }>;
      'x-aqa-permission': 'runs:read';
    }
  >;
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http'; scheme: 'bearer'; bearerFormat: 'opaque-or-oidc' };
    };
    messages: Record<string, { name: string; title: string; payload: { $ref: string } }>;
    schemas: { BusEvent: Record<string, unknown> };
  };
}

/** Build the versioned event contract consumed by SSE/WebSocket adapters. */
export function buildAsyncApiDocument(): AsyncApiDocument {
  const channels: AsyncApiDocument['channels'] = {};
  const operations: AsyncApiDocument['operations'] = {};
  const messages: AsyncApiDocument['components']['messages'] = {};
  for (const type of LIVE_EVENT_TYPES) {
    const key = type.replaceAll('.', '_');
    const channelRef = `#/channels/${key}`;
    const messageRef = `#/components/messages/${key}`;
    channels[key] = {
      address: '/api/events/stream',
      description: `Tenant-scoped ${type} notifications over SSE.`,
      messages: { [key]: { $ref: messageRef } },
    };
    operations[`receive_${key}`] = {
      action: 'receive',
      channel: { $ref: channelRef },
      messages: [{ $ref: messageRef }],
      'x-aqa-permission': 'runs:read',
    };
    messages[key] = {
      name: type,
      title: type,
      payload: { $ref: '#/components/schemas/BusEvent' },
    };
  }
  return {
    asyncapi: '3.0.0',
    info: {
      title: 'Agentic QA Kit live event contract',
      version: '1',
      description:
        'Tenant-scoped invalidation events. The durable control-plane API remains authoritative after reconnect or missed delivery.',
    },
    servers: { current: { host: 'localhost', pathname: '/', protocol: 'https' } },
    channels,
    operations,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque-or-oidc' },
      },
      messages,
      schemas: {
        BusEvent: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'occurred_at', 'data'],
          properties: {
            id: { type: 'string', minLength: 1 },
            type: { type: 'string', enum: [...LIVE_EVENT_TYPES] },
            occurred_at: { type: 'string', format: 'date-time' },
            org: { type: 'string' },
            project: { type: 'string' },
            data: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  };
}
