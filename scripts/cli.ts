#!/usr/bin/env node

/**
 * Unified CLI for claw-diary.
 *
 * Usage:
 *   claw-diary summarize [today|week|date YYYY-MM-DD|json]
 *   claw-diary stats
 *   claw-diary search <query>
 *   claw-diary export [md|html|json]
 *   claw-diary clear --yes
 *   claw-diary replay [port]
 *   claw-diary timeline [week|YYYY-MM-DD]
 *   claw-diary collect <before|after|session-start|session-stop>
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const command = process.argv[2];
const rest = process.argv.slice(3);

function rewriteArgv(scriptName: string, args: string[]): void {
  process.argv = [process.argv[0], join(__dirname, scriptName), ...args];
}

switch (command) {
  case 'summarize':
    rewriteArgv('summarizer.js', rest);
    await import('./summarizer.js');
    break;

  case 'stats':
    rewriteArgv('analytics.js', ['stats', ...rest]);
    await import('./analytics.js');
    break;

  case 'search':
    rewriteArgv('analytics.js', ['search', ...rest]);
    await import('./analytics.js');
    break;

  case 'export':
    rewriteArgv('analytics.js', ['export', ...rest]);
    await import('./analytics.js');
    break;

  case 'clear':
    rewriteArgv('analytics.js', ['clear', ...rest]);
    await import('./analytics.js');
    break;

  case 'replay':
    rewriteArgv('server.js', rest);
    await import('./server.js');
    break;

  case 'timeline':
    rewriteArgv('timeline.js', rest);
    await import('./timeline.js');
    break;

  case 'collect':
    rewriteArgv('collector.js', rest);
    await import('./collector.js');
    break;

  default:
    console.error(`claw-diary — Personal AI agent diary

Usage:
  claw-diary summarize [today|week|date YYYY-MM-DD|json]
  claw-diary stats
  claw-diary search <query>
  claw-diary export [md|html|json]
  claw-diary clear --yes
  claw-diary replay [port]
  claw-diary timeline [week|YYYY-MM-DD]
  claw-diary collect <before|after|session-start|session-stop>`);
    process.exit(1);
}
