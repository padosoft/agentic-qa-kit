import { spawn } from 'node:child_process';
import type { Sandbox, ToolCall, ToolCallBudget } from './types.js';

export interface ContainerRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timed_out?: boolean;
  output_limit_exceeded?: boolean;
}

export type ContainerExecutor = (
  runtime: string,
  args: string[],
  timeoutMs: number,
  maxOutputBytes: number,
) => Promise<ContainerRunResult>;

export interface ContainerSandboxOptions {
  budget: ToolCallBudget;
  /** Docker or Podman executable. Defaults to AQA_CONTAINER_RUNTIME, then docker. */
  runtime?: string;
  /** Immutable, pinned image used for every tool call. */
  image?: string;
  /** Permit outbound networking for this sandbox. Default: false. */
  network?: 'none' | 'bridge';
  /** Optional injected executor for deterministic unit tests. */
  executor?: ContainerExecutor;
  /** Refuse mutable tags; required for production profile auto-selection. */
  require_pinned_image?: boolean;
  /** Combined stdout/stderr cap per call. Defaults to 1 MiB. */
  max_output_bytes?: number;
}

const DEFAULT_IMAGE = 'ubuntu:24.04';

/**
 * Run shell tool calls in an isolated, short-lived OCI container.
 *
 * This is deliberately a small policy boundary, not a claim that Docker is a
 * complete hostile-code boundary. Operators should use rootless Docker/Podman,
 * pin images by digest, and add a stronger VM boundary for untrusted tenants.
 */
export class ContainerSandbox implements Sandbox {
  public readonly kind = 'container' as const;
  private calls = 0;
  private readonly budgetCfg: ToolCallBudget;
  private readonly runtime: string;
  private readonly image: string;
  private readonly network: 'none' | 'bridge';
  private readonly executor: ContainerExecutor;
  private readonly maxOutputBytes: number;

  constructor(opts: ContainerSandboxOptions) {
    this.budgetCfg = { ...opts.budget };
    this.runtime = opts.runtime ?? process.env.AQA_CONTAINER_RUNTIME ?? 'docker';
    this.image = opts.image ?? process.env.AQA_CONTAINER_IMAGE ?? DEFAULT_IMAGE;
    if (opts.require_pinned_image && !/^.+@sha256:[0-9a-f]{64}$/u.test(this.image)) {
      throw new Error('container image must be pinned by immutable sha256 digest');
    }
    this.network = opts.network ?? 'none';
    this.executor = opts.executor ?? runContainer;
    this.maxOutputBytes = positiveInteger(opts.max_output_bytes ?? 1_048_576, 'max_output_bytes');
  }

  async invoke(call: ToolCall): Promise<{ ok: boolean; output?: unknown; error?: string }> {
    this.calls += 1;
    if (this.calls > this.budgetCfg.max_calls) {
      return {
        ok: false,
        error: `tool-call budget exhausted (max_calls=${this.budgetCfg.max_calls})`,
      };
    }
    const command = call.args.command;
    if (typeof command !== 'string' || command.trim() === '') {
      return { ok: false, error: 'container tool call requires a non-empty string args.command' };
    }

    const args = [
      'run',
      '--rm',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,nodev,size=64m',
      '--network',
      this.network,
      '--cpus',
      '0.5',
      '--memory',
      '256m',
      '--pids-limit',
      '64',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--user',
      '65532:65532',
      this.image,
      'sh',
      '-c',
      command,
    ];
    const result = await this.executor(
      this.runtime,
      args,
      this.budgetCfg.per_call_timeout_ms,
      this.maxOutputBytes,
    );
    if (result.timed_out) {
      return {
        ok: false,
        error: `container command timed out after ${this.budgetCfg.per_call_timeout_ms}ms`,
      };
    }
    if (result.output_limit_exceeded) {
      return {
        ok: false,
        error: `container output exceeded ${this.maxOutputBytes} bytes`,
      };
    }
    if (result.code !== 0) {
      const detail = result.stderr.trim().slice(0, 2_000);
      return {
        ok: false,
        error: `container exited with code ${result.code ?? 'unknown'}${detail ? `: ${detail}` : ''}`,
      };
    }
    return { ok: true, output: result.stdout };
  }

  callCount(): number {
    return this.calls;
  }

  budget(): ToolCallBudget {
    return { ...this.budgetCfg };
  }
}

function runContainer(
  runtime: string,
  args: string[],
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<ContainerRunResult> {
  return new Promise((resolve) => {
    const child = spawn(runtime, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let outputLimitExceeded = false;
    let outputBytes = 0;
    const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      if (outputLimitExceeded) return;
      const remaining = maxOutputBytes - outputBytes;
      const text = chunk.subarray(0, Math.max(0, remaining)).toString('utf8');
      outputBytes += Buffer.byteLength(text, 'utf8');
      if (target === 'stdout') stdout += text;
      else stderr += text;
      if (chunk.byteLength > remaining) {
        outputLimitExceeded = true;
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => append('stderr', chunk));
    child.on('error', (error: Error) => {
      clearTimeout(timer);
      resolve({
        code: null,
        stdout,
        stderr: `${stderr}${error.message}`,
        timed_out: timedOut,
        output_limit_exceeded: outputLimitExceeded,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr,
        timed_out: timedOut,
        output_limit_exceeded: outputLimitExceeded,
      });
    });
  });
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`container ${name} must be positive`);
  return value;
}
