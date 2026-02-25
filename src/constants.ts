import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export const API_URL = process.env.FORGEREVIEW_API_URL || 'https://api.forgereview.io';
export const CLI_VERSION = pkg.version;
