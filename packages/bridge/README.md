# Framework-independent local DOM bridge

The bridge observes the real app's DOM; it does not reconstruct, proxy, rewrite, or execute the app. Include a classic script in an HTML page served by your local development server:

```html
<script src="http://127.0.0.1:4317/bridge.js"
        data-sw-dashboard="http://127.0.0.1:4317"></script>
```

The SwarmWatch server serves that endpoint with its own exact dashboard-origin allowlist. The optional data attribute is a human-readable configuration hint; it cannot expand the server-provided allowlist. If your app has a Content Security Policy, permit this local script using your app's supported development configuration. Nothing bypasses CSP or iframe security.

The server uses `bridgeScript(dashboardOrigins, {mode: 'file-change'})` to serialize a self-contained classic script. This package has no frontend framework or runtime dependency. Vite's optional plugin uses the same observer with `{mode:'hmr'}` and supplies real HMR controls.

The dashboard first sends `{channel:'swarmwatch',kind:'connect',nonce}`. Every incoming control must come from the exact configured parent origin and parent Window. A generic development control is `{channel:'swarmwatch',kind:'file-change',nonce,eventId,filePath,timestamp}` and must refer to an actual recent file event. The bridge checks the nonce, freshness, ID deduplication, and safe project-relative non-secret path. No command or source contents are accepted.

DOM mutations and measured layout changes are reported only within a short file-event window. A bounded buffer retains up to 100 unreported deltas for 500ms so a real file event arriving just after DOM repaint can correlate them. It never emits on a timer without a file control. Each delta has a unique ID, `observation:'file-change'`, and `triggerEventId`. Without explicit `data-sw-file` attributes, source mapping remains `unknown`; timing establishes correlation, not a component identity or an agent's intent. Trusted pointer, keyboard, and input activity cancels pending work, and controls older than that interaction cannot reopen it.

Initial rendering and full-page reloads establish a baseline and deliberately produce no fabrication animation. A framework-independent hot update must change the existing DOM for region animation; a server that only reloads the entire page still provides real file events and the current preview. Private form fields, editable text, `[data-sw-private]`, script/style contents, and sensitive file paths are excluded. Measurements are capped at 2,500 elements and 100 deltas per scan; wire batches contain at most 50 deltas. This is conservative local development instrumentation, not a complete or lossless screen recorder.
