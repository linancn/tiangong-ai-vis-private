#!/usr/bin/env node

import { bootstrap } from './index.js';

bootstrap().catch((error) => {
  console.error('Failed to start GPT-Vis SSR service', error);
  process.exit(1);
});
