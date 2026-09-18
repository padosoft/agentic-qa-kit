# `pack-mobile-native`

Opt-in contracts for iOS, Android, React Native and Expo journeys: offline
mutation safety, permission minimization, deep-link authentication and session
recovery.

## Use it

Tag a project with `mobile`, `mobile-native`, `ios`, `android`, `react-native`
or `expo` and install the pack through the normal `aqa` pack workflow.

## Evidence boundary

The pack is provider-neutral and does not drive simulators, devices or app
stores. It cannot prove OS-specific lifecycle behavior, jailbreak/root
resistance, push-provider delivery, accessibility or device-farm coverage. Bind
the contracts to real disposable app builds and device/emulator journeys;
provide platform, store and production evidence separately.
