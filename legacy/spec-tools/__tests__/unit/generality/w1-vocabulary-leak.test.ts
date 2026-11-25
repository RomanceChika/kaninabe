/**
 * W1(語彙漏れ検査)の判定のユニットテスト。
 *
 * 規約網羅(builder-report-12a.md):
 *   - 走査結果のうち、値域と一致するものだけを Finding にする
 *   - 一致しないものは無視する
 *   - 既知の衝突は `status` で扱いが分かれる(`accepted` は黙って除く / `unresolved` は
 *     項ごとに 1 件の warning。束 ⑲-1)
 */

import { describe, expect, it } from 'vitest';
import {
  collectDomainVocabulary,
  matchVocabularyHits,
  type KnownCollisions,
} from '../../../lib/generality/verifiers/w1-vocabulary-leak.js';
import type { VocabularyScanHit } from '../../../lib/generality/scan.js';
import { aggregate, event, machine, role, roleSpec, specModel } from '../../helpers/model-builder.js';

function hit(file: string, line: number, literal: string): VocabularyScanHit {
  return { file, line, literal };
}

describe('matchVocabularyHits', () => {
  it('値域と一致するリテラルを Finding にする', () => {
    const findings = matchVocabularyHits(
      [hit('legacy/spec-tools/lib/notification/handlers.ts', 10, 'staff_channel')],
      new Set(['staff_channel']),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      verifier: 'W1',
      severity: 'error',
      location: { file: 'legacy/spec-tools/lib/notification/handlers.ts', pointer: 'L10' },
      counterexample: { literal: 'staff_channel' },
    });
  });

  it('値域に無いリテラルは無視する', () => {
    const findings = matchVocabularyHits([hit('a.ts', 1, 'something_else')], new Set(['staff_channel']));
    expect(findings).toEqual([]);
  });

  it('走査結果が空なら Finding も空', () => {
    expect(matchVocabularyHits([], new Set(['fees']))).toEqual([]);
  });

  it('複数のヒットのうち一致するものだけを残す', () => {
    const findings = matchVocabularyHits(
      [hit('a.ts', 1, 'fees'), hit('a.ts', 2, 'unrelated'), hit('b.ts', 3, 'discord')],
      new Set(['fees', 'discord']),
    );
    expect(findings.map((f) => f.counterexample?.literal)).toEqual(['fees', 'discord']);
  });

  it('KNOWN_COLLISIONS(status: accepted)に載る語は、対象ファイルの中でだけ無視する(束⑫a2)', () => {
    const inScope = matchVocabularyHits(
      [hit('legacy/spec-tools/lib/model/trace/parse-action.ts', 10, 'confirm')],
      new Set(['confirm']),
    );
    expect(inScope).toEqual([]);

    // 同じ語でも、既知の衝突の対象外のファイルなら通常どおり検出する。
    const outOfScope = matchVocabularyHits(
      [hit('app/src/components/example.ts', 10, 'confirm')],
      new Set(['confirm']),
    );
    expect(outOfScope).toHaveLength(1);
    expect(outOfScope[0]?.severity).toBe('error');
  });

  it('画面の葉の名前(submit)は、固定語を持つ 1 か所(screen-form-plan.ts)の中でだけ受理する(迂回せず宣言)', () => {
    const inScope = matchVocabularyHits(
      [hit('legacy/spec-tools/lib/generate/render/screen-form-plan.ts', 37, 'submit')],
      new Set(['submit']),
    );
    expect(inScope).toEqual([]);

    // 同じ綴りでも、別のファイル(葉の名前の定数を迂回して直書きしたもの)は通常どおり赤。
    const elsewhere = matchVocabularyHits(
      [hit('legacy/spec-tools/lib/generate/render/screen-form-body.ts', 10, 'submit')],
      new Set(['submit']),
    );
    expect(elsewhere).toHaveLength(1);
    expect(elsewhere[0]?.severity).toBe('error');
  });

  it('確認ダイアログの実行ボタンの葉の名前(confirm)は受理の宣言を持たない(確認の器を重ね表示に統一したので生成器の語ではない)', () => {
    const findings = matchVocabularyHits(
      [hit('legacy/spec-tools/lib/generate/render/screen-form-plan.ts', 52, 'confirm')],
      new Set(['confirm']),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
  });

  it('実際の KNOWN_COLLISIONS に status: unresolved の項は残っていない(transaction_effect は語彙の in_transaction 宣言から読む形にして消した)', () => {
    const findings = matchVocabularyHits(
      [hit('legacy/spec-tools/lib/semantics/operation-catalogs.ts', 10, 'transaction_effect')],
      new Set(['transaction_effect']),
    );

    // 項が無いので、同じ綴りの直書きは宣言の無い漏れ(error)として出る(warning で黙らされない)。
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'W1', severity: 'error' });
  });

  describe('status: unresolved を報告する機構(表を差し替えて固定する)', () => {
    const UNRESOLVED: KnownCollisions = [
      { words: ['stray_word'], filePatterns: ['lib/semantics/stray.ts'], status: 'unresolved', reason: '未解決の穴(テスト用)' },
    ];

    it('消さずに warning で出す(束 ⑲-1)', () => {
      const findings = matchVocabularyHits(
        [hit('legacy/spec-tools/lib/semantics/stray.ts', 10, 'stray_word')],
        new Set(['stray_word']),
        UNRESOLVED,
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ verifier: 'W1', severity: 'warning' });
      expect(findings[0]?.message).toContain('未解決の既知の衝突');
      expect(findings[0]?.counterexample).toMatchObject({
        occurrences: '1',
        at: 'legacy/spec-tools/lib/semantics/stray.ts:10',
      });
    });

    it('未解決の項は**項ごとに 1 件**にまとめる(ヒットの数ではなく消し込みの単位で出す)', () => {
      const findings = matchVocabularyHits(
        [
          hit('legacy/spec-tools/lib/semantics/stray.ts', 10, 'stray_word'),
          hit('legacy/spec-tools/lib/semantics/stray.ts', 20, 'stray_word'),
          hit('legacy/spec-tools/lib/semantics/stray.ts', 5, 'stray_word'),
        ],
        new Set(['stray_word']),
        UNRESOLVED,
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]?.counterexample?.occurrences).toBe('3');
    });

    it('未解決の項と、宣言の無い漏れは別々に出る(error は 1 ヒット = 1 件)', () => {
      const findings = matchVocabularyHits(
        [
          hit('legacy/spec-tools/lib/semantics/stray.ts', 10, 'stray_word'),
          hit('legacy/spec-tools/lib/notification/handlers.ts', 3, 'staff_channel'),
        ],
        new Set(['stray_word', 'staff_channel']),
        UNRESOLVED,
      );

      expect(findings.map((finding) => finding.severity)).toEqual(['error', 'warning']);
    });
  });
});

describe('collectDomainVocabulary', () => {
  it('集約名・ロール ID・状態 ID・イベント ID・settles の語彙を集める', () => {
    const model = specModel(
      [
        aggregate('entry', {
          stateMachines: [
            machine('entry', {
              states: ['draft', 'submitted'],
              initial: 'draft',
              events: [event('submit', { from: ['draft'], to: 'submitted', by: ['member'] })],
              stateSettles: { submitted: ['fees'] },
              settlesVocabulary: { fees: '料金' },
            }),
          ],
        }),
      ],
      roleSpec([role('member'), role('organizer', 'entry.owner_id == actor.id')]),
    );

    const vocabulary = collectDomainVocabulary(model);

    expect(vocabulary.has('entry')).toBe(true);
    expect(vocabulary.has('member')).toBe(true);
    expect(vocabulary.has('organizer')).toBe(true);
    expect(vocabulary.has('draft')).toBe(true);
    expect(vocabulary.has('submitted')).toBe(true);
    expect(vocabulary.has('submit')).toBe(true);
    expect(vocabulary.has('fees')).toBe(true);
  });

  it('none は ReadScope.kind と衝突するため対象語彙から外す', () => {
    const model = specModel(
      [
        aggregate('entry', {
          stateMachines: [
            machine('entry', {
              states: ['none'],
              initial: 'none',
            }),
          ],
        }),
      ],
      roleSpec([]),
    );

    expect(collectDomainVocabulary(model).has('none')).toBe(false);
  });
});
