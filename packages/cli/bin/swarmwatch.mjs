#!/usr/bin/env node
// Keep the bin target in source control so npm can link it before dist exists.
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('SwarmWatch requires Node.js 24 or later.');
  process.exitCode = 1;
} else {
  try {
    await import('../dist/index.js');
  } catch (error) {
    console.error('SwarmWatch could not start. Run npm ci && npm run build in the checkout.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
