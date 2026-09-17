# ADR-190: Pinned and opaque agent trajectory evidence

## Context

An agent result is not reproducible evidence if the model identity, step order,
or token budget can drift between calls. Persisting prompts and tool responses
would also create a high-risk secret and PII sink.

## Decision

`@aqa/runner` provides `AgentTrajectoryRecorder` for host-owned agent drivers.
It pins one provider/model identity for a trajectory, enforces maximum steps and
tokens before emitting evidence, assigns contiguous sequence numbers, and
records `llm_call`/`tool_call` events with SHA-256 digests and usage metadata.
Snapshots contain the same opaque step summary; raw prompts, completions and
tool payloads remain in host memory.

## Consequences

Replay/evaluation systems have a stable, content-addressed trajectory summary
and can distinguish budget or identity failures from model output failures.
Provider authentication, semantic scoring, durable trajectory storage and
MCP-specific protocol validation remain adapter/deployment responsibilities.
