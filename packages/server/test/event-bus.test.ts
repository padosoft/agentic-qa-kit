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

  it('replays bounded tenant-scoped history after an event cursor', async () => {
    const bus = new MemoryEventBus();
    await bus.publish(event);
    await bus.publish({
      ...event,
      id: 'evt-2',
      org: 'other',
    });
    await bus.publish({
      ...event,
      id: 'evt-3',
      data: { finding_id: 'f-3' },
    });
    const replay = await bus.replay({ after_id: 'evt-1', org: 'acme', project: 'shop' });
    assert.equal(replay.cursor_found, true);
    assert.deepEqual(
      replay.events.map((item) => item.id),
      ['evt-3'],
    );
    const expired = await bus.replay({ after_id: 'missing', org: 'acme' });
    assert.equal(expired.cursor_found, false);
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
      const first = {
        ...event,
        id: `evt-pg-${Date.now()}-1`,
        org: 'acme-pg',
        project: 'shop-pg',
      };
      const second = {
        ...first,
        id: `evt-pg-${Date.now()}-2`,
        data: { finding_id: 'f-pg-2' },
      };
      await publisher.publish(first);
      const observed = await Promise.race([
        delivered,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('LISTEN/NOTIFY delivery timeout')), 3_000),
        ),
      ]);
      assert.deepEqual(observed, first);
      await publisher.publish(second);
      const replay = await subscriber.replay({
        after_id: first.id,
        org: first.org,
        project: first.project,
      });
      assert.equal(replay.cursor_found, true);
      assert.deepEqual(
        replay.events.map((item) => item.id),
        [second.id],
      );
    } finally {
      await unsubscribe();
      await publisher.close();
      await subscriber.close();
    }
  });
});
