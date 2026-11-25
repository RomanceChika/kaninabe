/**
 * 「一通り試すとは何か(L2 網羅台帳)」の章(HTML の本。render/book/html/sweep-chapter.ts)のテスト。
 *
 * 行データの組み立て自体は render/l2-sweep.ts のテストが見るので、ここでは章の骨格
 * (wholeFile 出力・出す条件・節の見出しと表・章末の一覧)だけを検める。
 */

import { describe, expect, it } from 'vitest';

import { bookHtmlGenerator } from '../../../../../lib/generate/render/book/html/generator.js';
import { bookFile } from '../../../../../lib/generate/render/book/chapters.js';
import { bookHtmlFiles, pageText } from '../../../../helpers/book-html.js';
import { aggregate, entitySpec, event, field, machine, roleSpec, specModel } from '../../../../helpers/model-builder.js';
import { actionSpec, testCase } from '../../../../helpers/trace-builder.js';
import { GEN_CTX } from '../../../../helpers/generate-context.js';
import { TEST_ROOTS } from '../../../../helpers/product-roots.js';

/**
 * entry.submit(guard なし・from が状態を尽くす・by が全人間ロール)を持つ最小ドメイン。
 * ロール universe を明示的に `member` / `system` の 2 つだけに絞る(既定の anonymous を含めると、
 * `by: [member]` が「全人間ロール」ではなくなり、forbidden の証拠が余分に要求される)。
 */
function model() {
  const entry = aggregate('entry', {
    entity: entitySpec('entry', { fields: [field('id', { kind: 'uuid' }, { auto: true })] }),
    stateMachines: [
      machine('entry', {
        states: ['draft'],
        initial: 'draft',
        events: [event('submit', { from: ['draft'], to: 'draft', by: ['member'] })],
      }),
    ],
  });
  return specModel([entry], roleSpec(['member', 'system']));
}

/** 章の本文(読む字)。 */
function textOf(ctx: typeof GEN_CTX): string {
  return pageText(bookHtmlFiles(model(), ctx).get(bookFile(TEST_ROOTS, 'sweep.html')) ?? '');
}

describe('網羅台帳の章(HTML): 出す条件と出力先', () => {
  it('action_spec を読めていない環境では生成しない(actions と同じ条件)', () => {
    expect(bookHtmlFiles(model(), GEN_CTX).has(bookFile(TEST_ROOTS, 'sweep.html'))).toBe(false);
  });

  it('action_spec があれば docs/book/sweep.html を wholeFile で生成する', () => {
    const ctx = { ...GEN_CTX, actions: { actions: [], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] } };
    const sections = bookHtmlGenerator.generate(model(), ctx).filter((section) => section.file === bookFile(TEST_ROOTS, 'sweep.html'));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.wholeFile).toBe(true);
  });
});

describe('網羅台帳の章(HTML): 節と証拠', () => {
  it('5 グループの見出しがすべて出る(対象が無いグループはその旨を書く)', () => {
    const ctx = { ...GEN_CTX, actions: { actions: [], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] } };
    const text = textOf(ctx);

    expect(text).toMatch(/^状態遷移$/m);
    expect(text).toMatch(/^画面 × 操作$/m);
    expect(text).toContain('まだ対象が無い');
    expect(text).toMatch(/^読み取り経路$/m);
    expect(text).toMatch(/^通知$/m);
    expect(text).toMatch(/^ジョブ$/m);
  });

  it('covers が一致するテストケースが確認しているテスト列に載る', () => {
    const ctx = {
      ...GEN_CTX,
      actions: {
        actions: [
          actionSpec({
            handles: 'entry.submit',
            testCases: [testCase({ id: 'TC-ENTRY-SUBMIT-001', implementation: 'app/e.test.ts::成立', covers: ['success'] })],
          }),
        ],
        unhandled: [],
        scans: [],
        unscanned: [],
        testTagBaseline: [],
      },
    };
    const text = textOf(ctx);

    expect(text).toContain('TC-ENTRY-SUBMIT-001');
  });

  it('証拠 0 件の行が「押さえるテストが1本も無い行」に集まる', () => {
    const ctx = { ...GEN_CTX, actions: { actions: [], unhandled: [], scans: [], unscanned: [], testTagBaseline: [] } };
    const text = textOf(ctx);

    expect(text).toMatch(/^押さえるテストが1本も無い行$/m);
    expect(text).toContain('[状態遷移] entry.submit — 成立');
  });

  it('全行に証拠があれば「無し」と正直に書く', () => {
    const ctx = {
      ...GEN_CTX,
      actions: {
        actions: [
          actionSpec({
            handles: 'entry.submit',
            testCases: [testCase({ id: 'TC-ENTRY-SUBMIT-001', implementation: 'app/e.test.ts::成立', covers: ['success'] })],
          }),
        ],
        unhandled: [],
        scans: [],
        unscanned: [],
        testTagBaseline: [],
      },
    };
    const text = textOf(ctx);

    expect(text).toContain('無し(全行に、確認しているテストが 1 本以上ある)。');
  });
});
