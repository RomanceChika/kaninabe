/**
 * 保証 fw_neutralize_outbound の見張り: 外部連携が宣言した無害化の部品(`sends.neutralize`)を、手書きのアダプタが呼んでいなければ X7 が止める。
 * 検査の表(止める形・受け入れる形の全部)は `unit/external/verifiers/x7-neutralize.test.ts` が持ち、ここは台帳の見張りとして最小の一対を固定する。
 * アダプタのソースを読む検査なので、一時ディレクトリに実ファイルを置く。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyNeutralize } from '../../lib/external/verifiers/x7-neutralize.js';
import { externalCatalog, integration } from '../helpers/external-builder.js';
import { UNSELECTED } from '../helpers/verify-inputs.js';
import { specModel } from '../helpers/model-builder.js';
import { TEST_ROOTS } from '../helpers/product-roots.js';

const ADAPTER = integration('discord_webhook').adapter;
let root = '';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'neutralize-guarantee-'));
  mkdirSync(path.dirname(path.join(root, ADAPTER)), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function check(adapterBody: string) {
  writeFileSync(path.join(root, ADAPTER), adapterBody);
  const decl = integration('discord_webhook', {
    retry: 'job',
    idempotencySource: 'none',
    idempotencyReason: '二度届いてよい',
    sends: { fields: [], text: 't', neutralize: { kind: 'apply', parts: [{ kind: 'discord_mentions' }] } },
  });
  return verifyNeutralize({ domain: specModel([]), catalog: externalCatalog([decl]), repoRoot: root, roots: TEST_ROOTS, actionSpecs: UNSELECTED });
}

describe('外へ送る自由文の無害化(X7)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-NEUTRALIZE-002
  it('宣言した部品をアダプタが呼んでいなければ X7 が止める', () => {
    const good = "import { neutralizeDiscordMentions, allowedDiscordMentionsOf } from '@kaninabe/runtime/neutralize';\nneutralizeDiscordMentions(t); allowedDiscordMentionsOf(p);";
    expect(check(good)).toEqual([]);
    const findings = check('export const send = (t: string) => t;');
    expect(findings.map((finding) => finding.counterexample?.['missing']).sort()).toEqual(['allowedDiscordMentionsOf', 'neutralizeDiscordMentions']);
    expect(findings.every((finding) => finding.verifier === 'X7' && finding.severity === 'error')).toBe(true);
  });
});
