// Actual process entry point for the SEA companion binary (this is what
// scripts/build-companion.mjs bundles). Kept separate from
// server/companion-entry.js so that file stays side-effect-free on import
// (just exports `main`) and is directly testable — and so this file can use
// a plain fire-and-forget call instead of top-level await, which esbuild's
// CommonJS output format (required for `node --build-sea`) does not support.
import { main } from './companion-entry.js';

main();
