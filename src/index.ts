#!/usr/bin/env node

import { program } from './cli.js';

// Propagate global CLI flags to env so shared utilities/services can respect them.
if (process.argv.includes('-v') || process.argv.includes('--verbose')) {
  process.env.FORGEREVIEW_VERBOSE = 'true';
}
if (process.argv.includes('-q') || process.argv.includes('--quiet')) {
  process.env.FORGEREVIEW_QUIET = 'true';
}

program.parse(process.argv);
