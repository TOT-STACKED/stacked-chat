import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { schema } from '../src/config.js';

/** server.js hands the app an explicit list of settings. A setting added in src/config.ts but not listed there is silently dropped on Render. */
describe('server.js passes every setting the app reads', () => {
  const front = readFileSync(join(process.cwd(), 'server.js'), 'utf8');
  it('lists each key of the app config', () => {
    const missing = Object.keys(schema.shape).filter((k) => !front.includes(k));
    expect(missing).toEqual([]);
  });
});
