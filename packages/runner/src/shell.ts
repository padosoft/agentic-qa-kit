import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import type { ProbeRunner } from './run.js';

export interface ShellProbeRunnerOptions {
  /** Must be explicit: shell execution is never enabled by a default. */
  allowShell: boolean;
  cwd: string;
  /** Exact executable paths or basenames permitted by policy. */
  allowedCommands: readonly string[];
  /** Explicit non-secret environment; PATH is copied only for resolution. */
  env?: Readonly<Record<string, string>>;
  maxOutputBytes?: number;
}

function redact(value: string): string {
  return value
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED-AWS-KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED-JWT]')
    .replace(/\b\d{13,19}\b/g, '[REDACTED-PAN]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[REDACTED-EMAIL]');
}

function commandAllowed(command: string, allowed: readonly string[]): boolean {
  return allowed.some((candidate) => candidate === command || candidate === basename(command));
}

/**
 * Execute argv without a shell. This is an explicit integration boundary, not
 * a general-purpose script runner: callers must opt in and allowlist the
 * executable. Probe arguments remain data and are never interpolated into a
 * shell string.
 */
export function makeShellProbeRunner(opts: ShellProbeRunnerOptions): ProbeRunner {
  if (!opts.allowShell) {
    throw new Error('shell probe execution requires allowShell=true');
  }
  if (!opts.cwd) throw new Error('shell probe cwd is required');
  if (opts.allowedCommands.length === 0) throw new Error('shell probe command allowlist is empty');
  const maxOutputBytes = opts.maxOutputBytes ?? 256 * 1024;
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new Error('shell probe maxOutputBytes must be a positive integer');
  }
  const env = opts.env
    ? { ...opts.env, ...(opts.env.PATH ? {} : { PATH: process.env.PATH ?? '' }) }
    : { PATH: process.env.PATH ?? '' };

  return (probe, externalSignal) => {
    if (probe.kind !== 'shell') {
      return Promise.resolve({
        probe_id: probe.id,
        error: `unsupported probe kind "${probe.kind}"`,
      });
    }
    const raw = probe.with.command;
    const args = probe.with.args;
    if (typeof raw !== 'string' || !raw) {
      return Promise.resolve({ probe_id: probe.id, error: 'shell probe requires with.command' });
    }
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      return Promise.resolve({
        probe_id: probe.id,
        error: 'shell probe with.args must be string[]',
      });
    }
    if (!commandAllowed(raw, opts.allowedCommands)) {
      return Promise.resolve({
        probe_id: probe.id,
        error: `shell command is not allowlisted: ${basename(raw)}`,
      });
    }
    return new Promise((resolve) => {
      if (externalSignal?.aborted) {
        resolve({ probe_id: probe.id, error: 'shell probe cancelled before dispatch' });
        return;
      }
      const child = spawn(raw, args as string[], {
        cwd: opts.cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let size = 0;
      let overflow = false;
      let cancelled = false;
      const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > maxOutputBytes) {
          overflow = true;
          child.kill();
          return;
        }
        if (target === 'stdout') stdout += chunk.toString('utf8');
        else stderr += chunk.toString('utf8');
      };
      child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
      child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
      const timeout = setTimeout(() => child.kill(), probe.timeout_ms);
      const abort = () => {
        cancelled = true;
        child.kill();
      };
      externalSignal?.addEventListener('abort', abort, { once: true });
      child.once('error', (error) => {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', abort);
        resolve({ probe_id: probe.id, error: redact(error.message) });
      });
      child.once('close', (code, signal) => {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', abort);
        if (cancelled) {
          resolve({ probe_id: probe.id, error: 'shell probe cancelled' });
          return;
        }
        if (overflow) {
          resolve({ probe_id: probe.id, error: `shell output exceeds ${maxOutputBytes} bytes` });
          return;
        }
        if (signal) {
          resolve({ probe_id: probe.id, error: `shell process terminated by ${signal}` });
          return;
        }
        resolve({
          probe_id: probe.id,
          ...(code === null ? {} : { status: code }),
          body: { stdout: redact(stdout), stderr: redact(stderr), exit_code: code },
        });
      });
    });
  };
}
