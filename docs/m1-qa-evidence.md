# Milestone 1 QA evidence

## Native desktop smoke test

On 2026-10-08, the project owner confirmed the latest Windows desktop build had been manually verified and reported no issues. This is recorded as manual smoke-test evidence for the native Tauri path (including the Windows save/open workflow); it is not a substitute for automated native-dialog testing.

## Repeatable automated evidence

Run from the repository root:

```powershell
npm run lint
npm test
npm run test:e2e
npm run benchmark
cargo test --manifest-path src-tauri/Cargo.toml
```

The browser E2E suite covers component highlight, single and multi-select deletion, component and Wire context menus, Pin-to-Pin wiring, Wire recoloring/deletion, undo/redo, browser persistence round trips, and dragged-position persistence. Native file-picker automation remains intentionally tracked as a platform test gap because it requires a Windows desktop automation provider.
