# Third-party notices and inspiration credits

## Visual inspiration — no reference code included

SwarmWatch acknowledges the creators of its visual references:

| Work | Creator | Links |
| --- | --- | --- |
| **Swarm** — cursor-driven site-building visual concept | **Joel Califa** (`@califa`) | [Live site](https://califa.github.io/swarm-site/) · [Source](https://github.com/califa/swarm-site) · [Creator](https://joelcalifa.com/) |
| **Swarm Rebuild / swarm-cursors** — DOM snapshot and animated page-rebuilding extension | **Dhvanil** (`@DhvanilPatel`) | [Source](https://github.com/DhvanilPatel/swarm-cursors) · [Creator profile](https://github.com/DhvanilPatel) |

Swarm Rebuild itself credits Joel Califa's Swarm for its motion design and describes adapting its animation engine. SwarmWatch researched that reference's public behavior and architecture; it did **not** reuse that engine. No source, icons, fonts, artwork, screenshots, videos, or other assets from either reference are included in SwarmWatch. The source and sample artwork in this repository were independently authored.

At the time reviewed (2026-11-17), swarm-cursors explicitly stated **“None yet”** in its README License section and described the original Swarm site as published without a license. The original swarm-site checkout also had no explicit LICENSE file. Public availability and attribution do not establish permission to copy or redistribute those materials. SwarmWatch's own [MIT License](../LICENSE) covers its independently authored implementation; it does not cover, grant rights to, or relicense either reference. This credit does not imply endorsement or affiliation.

See [Credits](credits.md) for reusable PR/release attribution and [reference analysis](reference-analysis.md) for the exact inspected commit and technical boundaries.

## Installed dependencies

Dependencies retain their own licenses, copyright notices and terms. Their package license texts and notices must accompany distributions when their licenses require it. This summary is informational and does not replace those texts.

| Dependency | License |
| --- | --- |
| React, React DOM | MIT |
| Vite, @vitejs/plugin-react | MIT |
| Zod | MIT |
| ws | MIT |
| chokidar | MIT |
| @babel/parser | MIT |
| magic-string | MIT |
| TypeScript | Apache-2.0 |
| Playwright / @playwright/test | Apache-2.0 |
| Vitest | MIT |
| tsx | MIT |

Exact resolved versions, transitive dependencies and artifact integrity are recorded in [package-lock.json](../package-lock.json). Installed packages provide their own license metadata and license files under `node_modules`. Review the complete dependency tree when preparing any distribution that bundles third-party packages; the table above lists the main direct runtime and development dependencies only.

Node.js and Chromium are separately installed runtimes used to run and test the project; their code is not vendored here and their own distribution licenses apply.
