#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';
import { parseEventLines, verifyEventChain } from '../audit-verify.js';

function main(): void {
  const path = argv[2];
  if (!path || path === '--help' || path === '-h') {
    stdout.write('Usage: aqa-audit-verify <path-to-events.jsonl>\n');
    exit(path ? 0 : 1);
  }
  const text = readFileSync(path, 'utf8');
  const events = parseEventLines(text);
  const result = verifyEventChain(events);
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    stderr.write(`audit chain BROKEN at index ${result.bad_index}: ${result.reason}\n`);
    exit(2);
  }
  stdout.write(`audit chain OK (${result.count} records)\n`);
}

main();
