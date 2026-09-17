import type { ApiHandler, ApiMethod } from './api.js';

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string; description: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http'; scheme: 'bearer'; bearerFormat: 'opaque-or-oidc' };
    };
    schemas: Record<string, JsonSchema>;
  };
}

interface OpenApiOperation {
  operationId: string;
  summary: string;
  'x-aqa-permission': string | null;
  parameters?: Array<{
    name: string;
    in: 'path' | 'query';
    required: boolean;
    schema: { type: 'string' };
  }>;
  requestBody?: {
    required: boolean;
    content: { 'application/json': { schema: JsonSchema } };
  };
  responses: Record<
    string,
    { description: string; content?: { 'application/json': { schema: JsonSchema } } }
  >;
  security?: Array<{ bearerAuth: [] }>;
}

type JsonSchema = Record<string, unknown>;

const DOMAIN_SCHEMA_REFS = {
  Run: '@aqa/schemas/schemas/v1/run.schema.json',
  RunRequest: '@aqa/schemas/schemas/v1/run-request.schema.json',
  Finding: '@aqa/schemas/schemas/v1/finding.schema.json',
  Profile: '@aqa/schemas/schemas/v1/profile.schema.json',
  RiskMap: '@aqa/schemas/schemas/v1/risk-map.schema.json',
  Scenario: '@aqa/schemas/schemas/v1/scenario.schema.json',
  Project: '@aqa/schemas/schemas/v1/project.schema.json',
  Notification: '@aqa/schemas/schemas/v1/notification.schema.json',
  Agent: '@aqa/schemas/schemas/v1/agent.schema.json',
  SsoConfig: '@aqa/schemas/schemas/v1/sso-config.schema.json',
} as const;

/**
 * Build the public HTTP contract from the exact route table used by the
 * server. This deliberately starts with transport/resource metadata; domain
 * payload schemas remain the versioned JSON Schemas in @aqa/schemas.
 */
export function buildOpenApiDocument(routes: readonly ApiHandler[]): OpenApiDocument {
  const paths: OpenApiDocument['paths'] = {};
  for (const route of routes) {
    const path = route.path.replaceAll(/:([A-Za-z][A-Za-z0-9_]*)/g, '{$1}');
    const method = route.method.toLowerCase() as Lowercase<ApiMethod>;
    const parameters = [
      ...extractParameters(route.path, 'path'),
      ...(method === 'get' ? extractQueryParameters(route.path) : []),
    ];
    const operation: OpenApiOperation = {
      operationId: operationId(route.method, route.path),
      summary: `${route.method} ${route.path}`,
      'x-aqa-permission': route.requires,
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(method === 'post' || method === 'put' || method === 'patch'
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: requestSchema(route),
                },
              },
            },
          }
        : {}),
      responses: {
        '200': {
          description: 'Successful response',
          content: { 'application/json': { schema: responseSchema(route) } },
        },
        '400': { description: 'Invalid request' },
        '401': { description: 'Authentication required' },
        '403': { description: 'Insufficient permission or tenant scope' },
        '404': { description: 'Resource not found' },
      },
      ...(route.requires !== null ? { security: [{ bearerAuth: [] }] } : {}),
    };
    const existing = paths[path] ?? {};
    existing[method] = operation;
    paths[path] = existing;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Agentic QA Kit Control Plane API',
      version: '1',
      description:
        'Versioned transport contract for tenant-scoped runs, findings, packs, configuration and audit evidence. Payloads reference @aqa/schemas v1.',
    },
    servers: [{ url: '/', description: 'Current AQA server' }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'opaque-or-oidc' },
      },
      schemas: componentSchemas(),
    },
  };
}

function componentSchemas(): Record<string, JsonSchema> {
  const schemas: Record<string, JsonSchema> = {};
  for (const [name, ref] of Object.entries(DOMAIN_SCHEMA_REFS)) schemas[name] = { $ref: ref };
  schemas.RunList = envelope('runs', { $ref: '#/components/schemas/Run' });
  schemas.RunResponse = envelope('run', { $ref: '#/components/schemas/Run' });
  schemas.FindingList = envelope('findings', { $ref: '#/components/schemas/Finding' });
  schemas.ProfileList = envelope('profiles', { $ref: '#/components/schemas/Profile' });
  schemas.ScenarioList = envelope('scenarios', { $ref: '#/components/schemas/Scenario' });
  return schemas;
}

function envelope(property: string, item: JsonSchema): JsonSchema {
  return {
    type: 'object',
    required: [property],
    properties: { [property]: { type: 'array', items: item } },
  };
}

function ref(name: keyof typeof DOMAIN_SCHEMA_REFS): JsonSchema {
  return { $ref: `#/components/schemas/${name}` };
}

function requestSchema(route: ApiHandler): JsonSchema {
  if (route.path === '/api/runs' && route.method === 'POST') return ref('RunRequest');
  if (route.path.startsWith('/api/profiles')) return ref('Profile');
  if (route.path.startsWith('/api/scenarios')) return ref('Scenario');
  if (route.path.startsWith('/api/risks')) return ref('RiskMap');
  if (route.path === '/api/sso/config') return ref('SsoConfig');
  return { type: 'object', additionalProperties: true };
}

function responseSchema(route: ApiHandler): JsonSchema {
  if (route.path === '/api/runs') return { $ref: '#/components/schemas/RunList' };
  if (route.path === '/api/runs/:id') return { $ref: '#/components/schemas/RunResponse' };
  if (route.path === '/api/findings') return { $ref: '#/components/schemas/FindingList' };
  if (route.path === '/api/profiles') return { $ref: '#/components/schemas/ProfileList' };
  if (route.path === '/api/scenarios') return { $ref: '#/components/schemas/ScenarioList' };
  return { type: 'object', additionalProperties: true };
}

function extractParameters(
  template: string,
  location: 'path',
): NonNullable<OpenApiOperation['parameters']> {
  return [...template.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/g)].map((match) => ({
    name: match[1] as string,
    in: location,
    required: true,
    schema: { type: 'string' },
  }));
}

function extractQueryParameters(template: string): NonNullable<OpenApiOperation['parameters']> {
  // Query parsing is intentionally represented generically until each route
  // graduates its request schema; the parameter is useful to generated
  // clients without pretending to know route-specific filters.
  if (template === '/api/runs' || template === '/api/findings') {
    return [{ name: 'limit', in: 'query', required: false, schema: { type: 'string' } }];
  }
  return [];
}

function operationId(method: ApiMethod, path: string): string {
  const slug = path
    .split('/')
    .filter(Boolean)
    .map((part) => (part.startsWith(':') ? `by_${part.slice(1)}` : part.replaceAll('-', '_')))
    .join('_');
  return `${method.toLowerCase()}_${slug || 'root'}`;
}
