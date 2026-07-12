import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const policyPath = path.resolve(__dirname, '../../../policy.md');

let cachedPolicyText: string | undefined;

/**
 * Full-document policy context passed to the agent (N5's documented fallback — `policy.md` is
 * ~76 lines, so retrieving only the relevant clause per invoice is a nice-to-have, not a
 * functional gap; cut first per docs/IMPLEMENTATION-PLAN.md if time runs short). Loaded once and
 * cached — the file doesn't change at runtime, only the thresholds in §6 do, and those come from
 * policy-cache.ts, not this file.
 */
export function getPolicyContext(): string {
  cachedPolicyText ??= readFileSync(policyPath, 'utf-8');
  return cachedPolicyText;
}
