# @aqa/pack-api-core

API baseline pack. Auto-applies when the SUT type is `api` and the framework is one of
hono/express/fastify/koa/nestjs.

- Four seed risks: token-replay, idempotency, pagination tenant-leak, rate-limit.
- Two seed scenarios: idempotency double-POST, auth token replay.
- One oracle (`http_status`) and one probe (`invalid_payload`) as building blocks.
