import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const root = new URL('../../../', import.meta.url);

function asset(relativePath: string): string {
  return readFileSync(new URL(relativePath, root), 'utf8');
}

describe('observability deployment assets', () => {
  it('ships a credential-free Collector pipeline with bounded processors', () => {
    const config = asset('integrations/observability/otel-collector/config.yaml');
    for (const required of [
      'receivers:',
      'memory_limiter:',
      'batch:',
      'pipelines:',
      'traces:',
      'metrics:',
      '${env:AQA_TEMPO_ENDPOINT}',
    ])
      assert.match(config, new RegExp(escapeRegExp(required)));
    assert.doesNotMatch(config, /(password|token|secret|api[_-]?key)\s*:/i);
  });

  it('ships alerts for failure, backlog, budget and missing telemetry', () => {
    const rules = asset('integrations/observability/prometheus/aqa-rules.yml');
    for (const required of [
      'AqaRunFailureRatioHigh',
      'AqaRunnerQueueBacklog',
      'AqaLlmBudgetDenials',
      'AqaTelemetryMissing',
      'aqa:run_failure_ratio',
      'aqa:llm_budget_denial_ratio',
    ])
      assert.match(rules, new RegExp(escapeRegExp(required)));
    assert.doesNotMatch(rules, /(password|token|secret|api[_-]?key)\s*:/i);
  });

  it('ships a valid dashboard with only Prometheus datasource references', () => {
    const dashboard = JSON.parse(asset('integrations/observability/grafana/aqa-overview.json')) as {
      panels?: Array<{ targets?: Array<{ expr?: string }> }>;
      __inputs?: Array<{ pluginId?: string }>;
    };
    assert.equal(dashboard.__inputs?.[0]?.pluginId, 'prometheus');
    assert.equal(dashboard.panels?.length, 4);
    assert.ok(dashboard.panels?.every((panel) => panel.targets?.every((target) => target.expr)));
    assert.doesNotMatch(
      asset('integrations/observability/grafana/aqa-overview.json'),
      /(password|token|secret|api[_-]?key)\s*:/i,
    );
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
