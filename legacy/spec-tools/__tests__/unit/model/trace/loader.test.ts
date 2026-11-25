/**
 * action_spec ローダー(I/O 境界)のテスト。
 *
 * 規約(scripts-code-quality.md)により fixture ファイルを使うのはローダー自身のテストだけ。
 * 検証器のテストは verifiers/ 配下でモデルをリテラル構築する。
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadActionSpecModel } from '../../../../lib/model/trace/loader.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../../fixtures');
const REPO_ROOT = path.resolve(FIXTURES, '..');

/** fixture ディレクトリを repoRoot 固定で読む(Finding のパスを安定させるため)。 */
function load(name: string) {
  return loadActionSpecModel(path.join(FIXTURES, name), { repoRoot: REPO_ROOT });
}

describe('loadActionSpecModel', () => {
  it('正常なツリーから action_spec と unhandled 宣言を読む', () => {
    const { model, findings } = load('actions-valid');

    expect(findings).toEqual([]);
    expect(model?.actions).toHaveLength(1);
    expect(model?.actions[0]).toMatchObject({
      id: 'entry-submit-action',
      relPath: 'entry/submit.md',
      handles: { raw: 'entry.submit' },
    });
    expect(model?.unhandled).toEqual([
      expect.objectContaining({ event: 'entry.withdraw', reason: '取下げの画面が未着手のため' }),
    ]);
  });

  it('A10 の走査宣言(scans / unscanned)を読む', () => {
    const { model, findings } = load('actions-valid');

    expect(findings).toEqual([]);
    expect(model?.scans).toEqual([
      expect.objectContaining({
        event: 'entry.close',
        implementation: 'app/src/operation/entry/close.ts',
        testCases: [
          expect.objectContaining({
            id: 'TC-ENTRY-CLOSE-001',
            implementation: expect.objectContaining({
              file: 'app/src/operation/__tests__/entry/close.test.ts',
              testName: '締切で自動的に閉じる',
            }),
          }),
        ],
      }),
    ]);
    expect(model?.unscanned).toEqual([
      expect.objectContaining({ event: 'entry.expire', reason: '期限切れの走査は未実装のため' }),
    ]);
  });

  it('retired(欠番にしたテストケース ID)を読む', () => {
    const { model, findings } = load('actions-valid');

    expect(findings).toEqual([]);
    expect(model?.actions[0]?.retired).toEqual([
      expect.objectContaining({ id: 'TC-ENTRY-SUBMIT-999' }),
    ]);
  });

  it('A12 の未処理台帳(test_tag_baseline)を読む', () => {
    const { model, findings } = load('actions-valid');

    expect(findings).toEqual([]);
    expect(model?.testTagBaseline).toEqual([
      expect.objectContaining({ file: 'app/src/domain/__tests__/engine/machine.test.ts' }),
    ]);
  });

  it('location.file をリポジトリルートからの相対パスにする', () => {
    const { model } = load('actions-valid');

    expect(model?.actions[0]?.location.file).toBe('fixtures/actions-valid/entry/submit.md');
  });

  it('README.md と template.{doc_type}.md は仕様として読まない', () => {
    const { model } = load('actions-valid');

    expect(model?.actions.map((a) => a.relPath)).toEqual(['entry/submit.md']);
  });

  it('スキーマ違反は A0 の Finding として返り、そのファイルはモデルに載らない', () => {
    const { model, findings } = load('actions-invalid');

    expect(model?.actions).toEqual([]);
    expect(findings.every((f) => f.verifier === 'A0')).toBe(true);
    const messages = findings.map((f) => f.message);
    expect(messages).toContainEqual(expect.stringContaining('doc_type が action_spec ではありません'));
    expect(messages).toContainEqual(expect.stringContaining('scope は backend'));
    expect(messages).toContainEqual(expect.stringContaining('ドメインイベント ID の形式ではありません'));
  });

  it('Finding は 3 点セット(message / location / suggestion)を必ず持つ', () => {
    const { findings } = load('actions-invalid');

    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.message).not.toBe('');
      expect(finding.suggestion).not.toBe('');
      expect(finding.location.file).toBe('fixtures/actions-invalid/entry/submit.md');
    }
  });

  it('ディレクトリが無ければ model は null になり、理由を返す', () => {
    const { model, findings } = load('actions-nonexistent');

    expect(model).toBeNull();
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('ディレクトリが見つかりません');
  });

  it('壊れたツリーでも読める仕様はすべて載せる(1 件の失敗で全体を捨てない)', () => {
    const { model, findings } = load('actions-broken');

    expect(findings).toEqual([]);
    expect(model?.actions.map((a) => a.relPath).sort()).toEqual([
      'entry/send.md',
      'entry/submit.md',
      'workshop/approve.md',
    ]);
  });
});
