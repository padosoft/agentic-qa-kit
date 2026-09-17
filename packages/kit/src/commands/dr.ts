import { readFileSync } from 'node:fs';
import {
  type BackupInventory,
  assertRestoreDrillEvidence,
  backupInventorySha256,
  parseBackupInventory,
  verifyBackupInventory,
} from '@aqa/compliance';

export interface DrInventoryOptions {
  inventoryFile: string;
  publicKeyFile?: string;
}

export interface DrRestoreOptions extends DrInventoryOptions {
  evidenceFile: string;
}

export interface DrInventoryResult {
  ok: boolean;
  backup_id?: string;
  inventory_sha256?: string;
  signature?: 'not_present' | 'verified';
  error?: string;
}

export interface DrRestoreResult extends DrInventoryResult {
  drill_id?: string;
  observed_rpo_minutes?: number;
  observed_rto_minutes?: number;
}

export function runDrInventory(opts: DrInventoryOptions): DrInventoryResult {
  try {
    const { inventory, signature } = readInventory(opts);
    return {
      ok: true,
      backup_id: inventory.backup_id,
      inventory_sha256: backupInventorySha256(inventory),
      signature,
    };
  } catch (error) {
    return { ok: false, error: safeMessage(error) };
  }
}

export function runDrRestore(opts: DrRestoreOptions): DrRestoreResult {
  try {
    const { inventory, signature } = readInventory(opts);
    const evidence = assertRestoreDrillEvidence(readJson(opts.evidenceFile), inventory);
    return {
      ok: true,
      backup_id: inventory.backup_id,
      inventory_sha256: backupInventorySha256(inventory),
      signature,
      drill_id: evidence.drill_id,
      observed_rpo_minutes: evidence.observed_rpo_minutes,
      observed_rto_minutes: evidence.observed_rto_minutes,
    };
  } catch (error) {
    return { ok: false, error: safeMessage(error) };
  }
}

function readInventory(opts: DrInventoryOptions): {
  inventory: BackupInventory;
  signature: 'not_present' | 'verified';
} {
  const value = readJson(opts.inventoryFile);
  if (isRecord(value) && ('inventory' in value || 'signature' in value)) {
    if (!opts.publicKeyFile) throw new Error('signed backup inventory requires --public-key');
    const publicKey = readFileSync(opts.publicKeyFile, 'utf8');
    const verified = verifyBackupInventory(value, publicKey);
    if (!verified.ok) throw new Error(verified.reason ?? 'backup inventory signature failed');
    return { inventory: parseBackupInventory(value.inventory), signature: 'verified' };
  }
  return { inventory: parseBackupInventory(value), signature: 'not_present' };
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('DR evidence file must be readable JSON');
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
