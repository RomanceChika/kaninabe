/**
 * 仕組みの保証台帳を読む入口(`loadFrameworkGuaranteeLedger`)のテスト。
 *
 * 製品の台帳が無いのは正常(`available: false`)だが、仕組みの台帳は製品が外せない義務なので、
 * 根を渡したのに無い・読めない・構文が壊れている・読めずに落とした行があるときは**阻害**(空の台帳で緑にならない)。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadFrameworkGuaranteeLedger } from '../../../../lib/model/guarantee/framework-loader.js';

const LEDGER = [
  '---',
  'doc_type: guarantee_spec',
  'scope: framework',
  'id: framework-guarantee-catalog',
  'vocabulary:',
  '  enforcer:',
  '    - id: type_system',
  'guarantees:',
  '  - id: fw_engine',
  '    label: 許可なしでは遷移しない',
  '    enforced_by: [type_system]',
  '    status: enforced',
  '    canaries: [TC-FW-ENGINE-001]',
  '    summary: 説明',
  'test_cases:',
  '  - id: TC-FW-ENGINE-001',
  '    type: unit',
  '    covers: [forbidden]',
  '    spec_ids: [framework-guarantee-catalog]',
  '    implementation: framework/runtime/src/__tests__/a.test.ts::見張る',
  '---',
  '',
].join('\n');

const made: string[] = [];

/** 仕組みの根を作り、台帳の本文を置く(null なら台帳を置かない)。 */
function root(ledger: string | null): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'framework-ledger-'));
  made.push(dir);
  if (ledger !== null) {
    mkdirSync(path.join(dir, 'framework'), { recursive: true });
    writeFileSync(path.join(dir, 'framework/guarantees.md'), ledger);
  }
  return dir;
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('loadFrameworkGuaranteeLedger', () => {
  it('根を渡さなければ not_requested', () => {
    expect(loadFrameworkGuaranteeLedger(undefined)).toEqual({ state: 'not_requested' });
  });

  it('台帳を読めれば loaded(Z0 の違反が無ければ findings は空)', () => {
    const loaded = loadFrameworkGuaranteeLedger(root(LEDGER));

    expect(loaded.state).toBe('loaded');
    if (loaded.state !== 'loaded') return;
    expect(loaded.findings).toEqual([]);
    expect(loaded.model.catalog?.id).toBe('framework-guarantee-catalog');
    expect(loaded.model.catalog?.guarantees.map((g) => g.id)).toEqual(['fw_engine']);
  });

  it('台帳が無ければ blocked(製品の台帳と違い、無いのは正常ではない)', () => {
    const loaded = loadFrameworkGuaranteeLedger(root(null));

    expect(loaded).toMatchObject({ state: 'blocked', reason: expect.stringContaining('framework/guarantees.md がありません') });
  });

  it('フロントマターの構文が壊れていれば blocked(Z0 の違反も運ぶ)', () => {
    const loaded = loadFrameworkGuaranteeLedger(root('---\nid: [壊れた\n---\n'));

    expect(loaded.state).toBe('blocked');
    if (loaded.state !== 'blocked') return;
    expect(loaded.findings.length).toBeGreaterThan(0);
    expect(loaded.findings.every((f) => f.verifier === 'Z0')).toBe(true);
  });

  it('読めずに落とした行があれば blocked(欠けた台帳で突合しない)', () => {
    // 語彙に無い執行者を名指した行は読めずに落ちる(台帳は欠けるが、ファイルそのものは読めている)。
    const withDropped = LEDGER.replace('    enforced_by: [type_system]\n', '    enforced_by: [no_such_enforcer]\n');
    const loaded = loadFrameworkGuaranteeLedger(root(withDropped));

    expect(loaded.state).toBe('blocked');
    if (loaded.state !== 'blocked') return;
    expect(loaded.reason).toContain('読めずに落としました');
  });

  it('予約の綴りの違反(落とした行ではない Z0 の error)は loaded のまま findings で運ぶ', () => {
    const wrong = LEDGER.replaceAll('fw_engine', 'engine');
    const loaded = loadFrameworkGuaranteeLedger(root(wrong));

    expect(loaded.state).toBe('loaded');
    if (loaded.state !== 'loaded') return;
    expect(loaded.findings.some((f) => f.message.includes('fw_ 始まりではありません'))).toBe(true);
  });
});
