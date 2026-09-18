# `pack-desktop`

Opt-in contracts for Electron, Tauri and native desktop journeys: least
privilege IPC, renderer sandboxing, signed auto-updates and authenticated
custom-protocol actions.

## Use it

Tag a project with `desktop`, `electron`, `tauri` or `desktop-native` and
install the pack through the normal `aqa` pack workflow.

## Evidence boundary

The pack is provider-neutral and does not launch desktop apps or sign artifacts.
It cannot prove OS packaging, code-signing identity, platform sandbox behavior,
native dependency safety or update CDN availability. Bind the contracts to
disposable signed builds and real platform/device journeys; retain independent
release and supply-chain evidence separately.
