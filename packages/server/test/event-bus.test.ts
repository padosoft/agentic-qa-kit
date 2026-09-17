import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type BusEvent, MemoryEventBus, PostgresEventBus } from '../dist/index.js';

const event: BusEvent = {
  id: 'evt-1',
  type: 'finding.created',
  occurred_at: '2026-09-17T12:00:00.000Z',
  org: 'acme',
  project: 'shop',
  data: { finding_id: 'f-1' },
};

describe('EventBus', () => {
  it('fans out valid events and isolates subscriber failures', async () => {
    const bus = new MemoryEventBus();
    const received: string[] = [];
    await bus.subscribe(async (receivedEvent) => {
      received.push(receivedEvent.id);
    });
    await bus.subscribe(() => {
      throw new Error('subscriber failure');
    });
    await bus.publish(event);
    assert.deepEqual(received, ['evt-1']);
    await assert.rejects(
      () => bus.publish({ ...event, data: { value: 'x'.repeat(8_000) } }),
      /payload exceeds/i,
    );
    await bus.close();
  });

  it('unsubscribes idempotently', async () => {
    const bus = new MemoryEventBus();
    let count = 0;
    const unsubscribe = await bus.subscribe(() => {
      count += 1;
    });
    await unsubscribe();
    await unsubscribe();
    await bus.publish(event);
    assert.equal(count, 0);
    await bus.close();
  });

  it('delivers across PostgreSQL LISTEN/NOTIFY clients when configured', async () => {
    const dsn = process.env.AQA_TEST_POSTGRES_DSN;
    if (!dsn) {
      console.warn('SKIP: AQA_TEST_POSTGRES_DSN is required for the live PostgreSQL contract');
      return;
    }
    const channel = `aqa_test_events_${Date.now()}`;
    const publisher = new PostgresEventBus(dsn, channel);
    const subscriber = new PostgresEventBus(dsn, channel);
    let resolveDelivered!: (value: BusEvent) => void;
    const delivered = new Promise<BusEvent>((resolve) => {
      resolveDelivered = resolve;
    });
    const unsubscribe = await subscriber.subscribe(resolveDelivered);
    try {
      await publisher.publish(event);
      const observed = await Promise.race([
        delivered,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('LISTEN/NOTIFY delivery timeout')), 3_000),
        ),
      ]);
      assert.deepEqual(observed, event);
    } finally {
      await unsubscribe();
      await publisher.close();
      await subscriber.close();
    }
  });
});
