// Dev/npm entry point (`npm run server` / `serve` / `companion`). The SEA
// companion binary uses server/companion-entry.js's `--serve` subcommand
// instead, which calls the same startServer() but after resolving from an
// installed, self-contained binary rather than a cloned repo.
import { startServer } from './index.js';

startServer();
