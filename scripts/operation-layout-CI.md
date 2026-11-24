# Production operation layout regression

CI runs the geometry check against the verified candidate assets without rebuilding the plugin. To run it locally, install development dependencies and build `dist` first:

```sh
node --test test/operation-layout.test.mjs
node scripts/operation-layout-run.mjs
```

Set `CHROME_BIN` to an installed Chrome, Chromium or Edge executable. No browser is installed automatically. The commands exit nonzero on failure; CI archives `test-results/operation-layout-report.json` if the runner reached report generation.

The runner uses an ephemeral browser profile, a loopback port, the production `createPage` component and its CSS, and the editor assets from `dist`. The matrix covers Chinese and English, widths of 1100/600/320 px, heights of 720/480 px, and empty/modified/status-error responses. Each case covers short and long references and scan warnings, with help collapsed and expanded (36 cases, 216 samples).

The checks require the unified toolbar without the removed mode selector or branch controls, at least 48 px of usable workspace body, and a reachable scroll endpoint without moving the body. Host and RPC responses are mocked; the check does not exercise Git writes or a live DSH page.
