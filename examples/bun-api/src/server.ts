import { Hono } from 'hono';

const app = new Hono();

app.get('/', (c) => c.json({ status: 'ok', name: 'example-bun-api' }));

app.get('/items/:id', (c) => {
  const id = c.req.param('id');
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(id)) {
    return c.json({ error: 'invalid id' }, 400);
  }
  return c.json({ id, name: `item-${id}` });
});

app.post('/items', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.name !== 'string') {
    return c.json({ error: 'name required' }, 400);
  }
  return c.json({ id: 'new', name: body.name }, 201);
});

const port = Number(process.env.PORT ?? 3000);
export default { port, fetch: app.fetch };
