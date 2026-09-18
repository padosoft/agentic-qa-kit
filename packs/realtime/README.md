# `pack-realtime`

Opt-in contracts for WebSocket, SSE and streaming journeys: connection
lifecycle, bounded backpressure, tenant isolation, cursor replay and ordering.

## Use it

Tag a project with `realtime`, `websocket`, `sse`, `streaming` or
`grpc-streaming` and install the pack through the normal `aqa` pack workflow.

## Evidence boundary

The pack is provider-neutral and does not open sockets, run a broker or create
load. It does not prove network proxy behavior, broker durability, exactly-once
delivery, mobile background semantics or production capacity. Bind the
contracts to disposable endpoints and bounded fixtures; provide provider,
browser/device and production rollout evidence separately.
