# Production operation layout regression

CI entry after dependency installation and the existing editor asset build step:

```sh
node --test test/operation-layout.test.mjs
node scripts/operation-layout-run.mjs
```

Set CHROME_BIN to an existing CI-provided Chrome, Chromium or Edge executable. No automatic browser installation. Both commands return nonzero on failure; archive test-results/operation-layout-report.json even on failure. No package or workflow files were edited.

The runner reuses browser-runner.mjs with an ephemeral profile and loopback port. It bundles production createPage and its source CSS (text loader), not hand-rebuilt markup or the invalid old operation-layout.html. CSSOM rule count and computed flex styles must demonstrate that CSS really applies.

Coverage: zh/en × 1100/600/320 widths × 720/480 heights × all/staged/unstaged, with branch closed/list/preview and help collapsed/expanded (36 cases, 216 samples). Checks at least 48px usable workspace body height, bounded independently scrollable operation/branch areas, scroll endpoint reachability with stationary workspace body, and no operation input/select/textarea horizontal overflow.

Existing dist editor assets are copied to the isolated fixture; the runner itself does not run a full build or full tests. Production Monaco may keep its empty surface lazy without a selected comparison. Host services and RPC responses are mocked; no confirmation endpoint is called. This is production-component geometry acceptance, not live DSH or Git/backend acceptance.
