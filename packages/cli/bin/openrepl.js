#!/usr/bin/env node
// Thin launcher: runs the TypeScript entry via tsx (installed as a dev dep).
// For a published build this would point at compiled dist/ instead.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '../src/index.ts');

const child = spawn('npx', ['tsx', entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('exit', (code) => process.exit(code ?? 0));
