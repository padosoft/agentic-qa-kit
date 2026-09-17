# @aqa/sandbox

Sandbox abstraction for the runner. Two implementations:

- **`ProcessSandbox`** (v0.2 default) — tools run in-process; per-call timeout
  and `max_calls` budget enforced. Suitable for `smoke` / `exploratory`.
- **`ContainerSandbox`** — Docker/Podman container per call, read-only root
  filesystem, no network by default, CPU/memory/PID limits, dropped Linux
  capabilities, and per-call timeout. Use a pinned image digest in production;
  the implementation is an OCI policy boundary, not a substitute for a VM
  isolation boundary against a hostile tenant.

`selectSandbox({ profile, handlers })` picks the right one.
