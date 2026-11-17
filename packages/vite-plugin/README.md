# SwarmWatch Vite bridge

Add `swarmwatch()` to the plugins in a React + Vite development app. Instrumentation is active only during Vite serve; production builds contain no bridge or added source attributes.

The dashboard origin defaults to HTTP port 4317. The CLI sets `SWARMWATCH_DASHBOARD_ORIGIN` for the development process it launches. Override it explicitly with `swarmwatch({ dashboardOrigin: 'http://localhost:4318' })` when connecting an independently running app.

`localhost` and `127.0.0.1` are accepted as exact aliases at the configured protocol and port, so the dashboard URL printed by the CLI and IPv4 loopback URLs both work. No other host, port or protocol is implicitly allowed. An explicitly configured IPv6 `[::1]` origin is accepted only as itself. The bridge also validates the parent Window and connection nonce.

DOM changes are emitted only during a short Vite HMR burst, identified by `hmrId`. Outside that burst, mutations update the baseline without producing development animations. Trusted pointer, keyboard and input interactions cancel the burst, so clicking the app immediately after a source edit is not shown as agent work. This is conservative correlation: asynchronous app changes outside the 1.5-second HMR window are omitted, full page reloads establish a new baseline, and an HMR-correlated change is not proof of an agent's internal intent.
