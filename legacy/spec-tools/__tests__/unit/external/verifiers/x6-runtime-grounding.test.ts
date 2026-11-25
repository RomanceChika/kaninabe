/**
 * X6(実行時の約束の接地)のユニットテスト。
 *
 * 規約網羅(external-spec-writing.md §検証 X6):
 *   - `timeout_ms` を持つ行のアダプタが生成物から待ち時間を読んでいること
 *   - 待ち時間を生の数値で書いていないこと(`AbortSignal.timeout(5000)` は error)
 *   - `retry: inline` の行のアダプタが `retryMax` を読んでいること
 *   - `idempotency_source: external_key` はアダプタに冪等キーの受け渡しがあること
 *   - `idempotency_source: local_ledger` は**台帳が実在する**こと(outbound はアダプタが
 *     `ledger` を引いている・inbound は `event_id_table` の宣言)
 *   - `app/` が無い構成では 3 段そろって飛ぶこと(X1 と同じ扱い)
 *
 * この検証器は**実装のソースを読む**ので、ここだけは一時ディレクトリに実ファイルを置く
 * (K1 の env 走査のテストと同じ扱い。検証器そのものは I/O をせず、読むのは実行口である)。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyRuntimeGrounding } from '../../../../lib/external/verifiers/x6-runtime-grounding.js';
import { externalCatalog, integration } from '../../../helpers/external-builder.js';
import type { IntegrationDecl } from '../../../../lib/model/external/types.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';

/** アダプタの置き場(ビルダーの既定の `adapter` と揃える)。 */
const ADAPTER = 'app/src/infrastructure/discord/webhook.ts';

/** 生成物を読んでいる健全なアダプタの中身。 */
const GOOD_ADAPTER = [
  "import { EXTERNAL_EXPECTATIONS } from '@/domain/generated/external-expectations';",
  'const TIMEOUT_MS = EXTERNAL_EXPECTATIONS.discord_webhook.timeoutMs;',
  'export const signal = AbortSignal.timeout(TIMEOUT_MS);',
].join('\n');

/** 二重反映を防ぐ源を宣言しない行(待ち時間だけを見るテスト用。理由は X0 が必須にする)。 */
const NO_IDEMPOTENCY = { idempotencySource: 'none', idempotencyReason: '二度届いてよい' } as const;

let root = '';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'x6-'));
  mkdirSync(path.join(root, 'app/src'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** アダプタの実ファイルを置く。 */
function writeAdapter(body: string, relative = ADAPTER): void {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, body);
}

/** 1 行を検証する。 */
function verify(decl: IntegrationDecl): ReturnType<typeof verifyRuntimeGrounding> {
  return verifyRuntimeGrounding({ roots: TEST_ROOTS, layout: TEST_LAYOUT, catalog: externalCatalog([decl]), repoRoot: root });
}

describe('X6: 実行時の約束の接地', () => {
  it('アダプタが生成物から待ち時間を読んでいれば通る', () => {
    writeAdapter(GOOD_ADAPTER);

    expect(verify(integration('discord_webhook', { retry: 'job', ...NO_IDEMPOTENCY }))).toEqual([]);
  });

  it('アダプタが生成物を読んでいなければエラー(値を実装へ書き写している)', () => {
    writeAdapter('const TIMEOUT_MS = 5000;\nexport const x = TIMEOUT_MS;');

    const findings = verify(integration('discord_webhook', { retry: 'job', ...NO_IDEMPOTENCY }));

    expect(findings.some((f) => f.message.includes('timeout_ms(5000ms)を読んでいる実装がありません'))).toBe(true);
  });

  it('待ち時間を生の数値で書いていればエラー', () => {
    writeAdapter(`${GOOD_ADAPTER}\nexport const raw = AbortSignal.timeout(5000);`);

    const findings = verify(integration('discord_webhook', { retry: 'job', ...NO_IDEMPOTENCY }));

    expect(findings.some((f) => f.message.includes('生の数値で書いています'))).toBe(true);
  });

  it('retry: inline の行は retryMax も読んでいないとエラー', () => {
    writeAdapter(GOOD_ADAPTER);

    const findings = verify(
      integration('discord_webhook', {
        retry: 'inline',
        retryMax: 3,
        idempotencySource: 'none',
        idempotencyReason: '席だけなので二重反映しない',
      }),
    );

    expect(findings.some((f) => f.message.includes('retry_max(3 回)を読んでいる実装がありません'))).toBe(true);
  });

  it('idempotency_source: external_key はアダプタに冪等キーの受け渡しが要る', () => {
    writeAdapter(GOOD_ADAPTER);

    const findings = verify(
      integration('discord_webhook', { retry: 'job', idempotencySource: 'external_key' }),
    );

    expect(findings.some((f) => f.message.includes('冪等キーの受け渡し(idempotencyKey)がありません'))).toBe(true);
  });

  it('idempotency_source: external_key でアダプタが冪等キーを渡していれば通る', () => {
    writeAdapter(`${GOOD_ADAPTER}\nexport const key = (idempotencyKey: string): string => idempotencyKey;`);

    expect(
      verify(integration('discord_webhook', { retry: 'job', idempotencySource: 'external_key' })),
    ).toEqual([]);
  });

  it('idempotency_source: local_ledger なのにアダプタに台帳が無ければエラー(retry: job は台帳ではない)', () => {
    writeAdapter(GOOD_ADAPTER);

    const findings = verify(integration('discord_webhook', { retry: 'job' }));

    expect(findings.some((f) => f.message.includes('送信済みを覚えている台帳(ledger)がありません'))).toBe(true);
  });

  it('idempotency_source: local_ledger でアダプタが台帳を引いていれば通る', () => {
    writeAdapter(`${GOOD_ADAPTER}\nexport const sent = (key: string) => deliveryLedger.has(key);`);

    expect(verify(integration('discord_webhook', { retry: 'job' }))).toEqual([]);
  });

  it('コメントに書いてあるだけでは接地と認めない(生ソースの字面では見ない)', () => {
    writeAdapter(
      ['// 正は EXTERNAL_EXPECTATIONS.discord_webhook.timeoutMs', 'const TIMEOUT_MS = 1;', 'export const x = TIMEOUT_MS;'].join('\n'),
    );

    const findings = verify(integration('discord_webhook', { retry: 'job', ...NO_IDEMPOTENCY }));

    expect(findings.some((f) => f.message.includes('timeout_ms(5000ms)を読んでいる実装がありません'))).toBe(true);
  });

  it('app/ が無ければ 3 段そろって飛ぶ(仕様だけのリポジトリでも壊れない)', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'x6-noapp-'));
    try {
      const findings = verifyRuntimeGrounding({ roots: TEST_ROOTS, layout: TEST_LAYOUT,
        catalog: externalCatalog([integration('discord_webhook', { retry: 'none', ...NO_IDEMPOTENCY })]),
        repoRoot: empty,
      });

      expect(findings).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
