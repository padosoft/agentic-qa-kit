# @aqa/sandbox

Sandbox abstraction for the runner. Two implementations:

- **`ProcessSandbox`** (v0.2 default) — tools run in-process; per-call timeout
  and `max_calls` budget enforced. Suitable for `smoke` / `exploratory`.
- **`ContainerSandbox`** (v0.2 scaffold, v0.3 real impl) — rootless container per
  call, read-only fs, default-deny network. Required for `security` and
  `release-gate` profiles. v0.2 refuses with an explicit error so an operator
  cannot run a hardened profile without realising the container layer is not
  yet wired.

`selectSandbox({ profile, handlers })` picks the right one.
