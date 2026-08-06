import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(here, '../../../../.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (check .env at repo root)`);
  return value;
}

export const CHAIN = 'ARC-TESTNET' as const;

export const ESCROW_ADDRESS = required('ESCROW_ADDRESS_V2') as `0x${string}`;
export const REGISTRY_ADDRESS = required('REGISTRY_ADDRESS') as `0x${string}`;
export const MILESTONE_ESCROW_ADDRESS = required('MILESTONE_ESCROW_ADDRESS') as `0x${string}`;

/** Deployer/arbiter wallet — the only role that stays on a raw signed key
 *  (Circle CLI's `wallet import` reads its secret from an interactive TTY
 *  prompt and rejects piped input, so it cannot be scripted headlessly).
 *  Arbitration is a protocol admin action, not part of the agent-to-agent
 *  story, so this is an acceptable place to keep the Part 2/3 raw wallet. */
export const ARBITER_ADDRESS = required('DEPLOYER_ADDRESS') as `0x${string}`;
export const ARBITER_PRIVATE_KEY = required('DEPLOYER_PRIVATE_KEY');

export const MODEL = process.env.LLM_MODEL || 'claude-sonnet-4-6';
