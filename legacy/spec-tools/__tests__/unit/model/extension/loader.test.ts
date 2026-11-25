/**
 * 拡張候補の台帳のローダー(I/O 境界)と、実物の台帳のテスト。
 *
 * 台帳が無い環境で壊れないこと・読めた台帳がモデルになること・壊れた台帳が W5 の error になること。
 * 最後に、**リポジトリに置いた実物の台帳**がスキーマに適合し、`rules` の検査 ID がすべて全検査の表に実在すること
 * (台帳の編集が検査器の側で止まる最初の線)。
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultLedgerFile, EXTENSION_LEDGER_DISPLAY, loadExtensionLedger } from '../../../../lib/model/extension/loader.js';
import { knownCheckIds } from '../../../../lib/compose/all-checks.js';
import { verifyExtensionLedger } from '../../../../lib/extension/verifiers/w5-extension-ledger.js';

const VALID = [
  '---',
  'candidates:',
  '  - id: X-proof-worlds',
  '    statement: 証明の world を組めない',
  '    rules: [T8, T11]',
  '    status: open',
  '    since: "2026-10-03"',
  '    ref: BACKLOG.md',
  '---',
  '',
  '# 拡張候補の台帳',
  '',
].join('\n');

let root = '';
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'extension-loader-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 台帳ファイルを書いて読む。 */
function load(source: string) {
  const file = path.join(root, 'extension-candidates.md');
  writeFileSync(file, source);
  return loadExtensionLedger(file);
}

describe('loadExtensionLedger', () => {
  it('ファイルが無ければ available: false(台帳を持たない構成でも壊れない)', () => {
    const result = loadExtensionLedger(path.join(root, 'extension-candidates.md'));

    expect(result).toEqual({ model: { available: false, ledger: null }, findings: [] });
  });

  it('正しい台帳を読んで、候補を宣言順に持つ(位置は仕組み自身の住所で出る)', () => {
    const { model, findings } = load(VALID);

    expect(findings).toEqual([]);
    expect(model.available).toBe(true);
    expect(model.ledger?.candidates.map((candidate) => candidate.id)).toEqual(['X-proof-worlds']);
    expect(model.ledger?.candidates[0]?.location.file).toBe(EXTENSION_LEDGER_DISPLAY);
    expect(EXTENSION_LEDGER_DISPLAY).toBe('legacy/spec-tools/extension-candidates.md');
  });

  it('フロントマターが無ければ W5 の error で、台帳は null', () => {
    const { model, findings } = load('# 拡張候補の台帳\n');

    expect(model).toEqual({ available: true, ledger: null });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'W5', severity: 'error' });
  });

  it('スキーマ違反は W5 に付け替えて返す', () => {
    const { findings } = load(VALID.replace('status: open', 'status: closed'));

    expect(findings.map((finding) => finding.verifier)).toEqual(['W5']);
    expect(findings[0]?.message).toContain('status closed は値域にありません');
  });

  it('ファイルでないもの(ディレクトリ)を渡されても壊れず、台帳が無い扱いになる', () => {
    const { model, findings } = loadExtensionLedger(root);

    expect(model).toEqual({ available: false, ledger: null });
    expect(findings).toEqual([]);
  });
});

describe('実物の台帳(legacy/spec-tools/extension-candidates.md)', () => {
  it('スキーマに適合し、rules の検査 ID がすべて全検査の表に実在し、重ならない', () => {
    const { model, findings } = loadExtensionLedger(defaultLedgerFile());

    expect(findings).toEqual([]);
    const ledger = model.ledger;
    expect(ledger).not.toBeNull();
    if (ledger === null) return;
    expect(ledger.candidates.length).toBeGreaterThan(0);
    // 警告の出方は見ない(空の結果)。見るのは ID の実在・重なり(どちらも警告に依らない)。
    expect(verifyExtensionLedger({ ledger, findings: [], knownIds: knownCheckIds(), acceptances: [] }).findings).toEqual([]);
  });
});
