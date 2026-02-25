#!/usr/bin/env node

import { program } from './cli.js';

// Set FORGEREVIEW_VERBOSE env var if --verbose flag is passed
// This needs to happen before API module is loaded
if (process.argv.includes('-v') || process.argv.includes('--verbose')) {
  process.env.FORGEREVIEW_VERBOSE = 'true';
}

program.parse(process.argv);

