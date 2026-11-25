/**
 * action_spec のスキーマ適合(A0)の規約網羅テスト。
 * 対象の要求: action-spec-writing.md §スキーマ(doc_type / scope / id / handles / input /
 * errors / test_cases の必須と形式、および covers の値域)。
 */

import { describe, expect, it } from 'vitest';
import { parseActionSpec } from '../../../../lib/model/trace/parse-action.js';

const FILE = 'docs/specs/backend/actions/entry/submit.md';

/** 最小の正常なフロントマター。テストごとに一部を差し替える。 */
function valid(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    doc_type: 'action_spec',
    scope: 'backend',
    id: 'entry-submit-action',
    handles: 'entry.submit',
    input: ['entry.id'],
    errors: { inherits: 'common', additional: [] },
    test_cases: [
      {
        id: 'TC-ENTRY-SUBMIT-001',
        type: 'unit',
        covers: ['success'],
        spec_ids: ['entry.submit'],
        implementation: 'app/src/operation/__tests__/entry/submit.test.ts::下書きから提出できる',
      },
    ],
    ...overrides,
  };
}

/** メッセージだけを取り出す(比較を読みやすくするため)。 */
function messages(data: unknown): string[] {
  return parseActionSpec(data, FILE, 'entry/submit.md').findings.map((f) => f.message);
}

describe('parseActionSpec', () => {
  it('正常なフロントマターを型付きモデルに変換する', () => {
    const result = parseActionSpec(valid(), FILE, 'entry/submit.md');

    expect(result.findings).toEqual([]);
    expect(result.value).toMatchObject({
      id: 'entry-submit-action',
      handles: { raw: 'entry.submit', machine: 'entry', event: 'submit' },
      input: [{ raw: 'entry.id', entity: 'entry', field: 'id' }],
      errors: { inherits: 'common', additional: [] },
      relPath: 'entry/submit.md',
    });
    expect(result.value?.testCases[0]?.implementation).toMatchObject({
      file: 'app/src/operation/__tests__/entry/submit.test.ts',
      testName: '下書きから提出できる',
    });
  });

  it('doc_type が違えば違反になる', () => {
    expect(messages(valid({ doc_type: 'state_spec' }))).toContainEqual(
      expect.stringContaining('doc_type が action_spec ではありません'),
    );
  });

  it('scope が backend でなければ違反になる', () => {
    expect(messages(valid({ scope: 'common' }))).toContainEqual(
      expect.stringContaining('scope は backend'),
    );
  });

  it('handles が無ければモデルを構築しない', () => {
    const { handles, ...withoutHandles } = valid();
    void handles;

    expect(parseActionSpec(withoutHandles, FILE, 'entry/submit.md').value).toBeNull();
  });

  it('handles が {machine}.{event} 形式でなければ違反になる', () => {
    expect(messages(valid({ handles: 'submit' }))).toContainEqual(
      expect.stringContaining('ドメインイベント ID の形式ではありません'),
    );
  });

  it('id が handles から導かれるものと違えば違反になる', () => {
    expect(messages(valid({ id: 'entry-send-action' }))).toContainEqual(
      expect.stringContaining('id が handles'),
    );
  });

  it('input が無ければモデルを構築しない(空リストは明示が必要)', () => {
    const { input, ...withoutInput } = valid();
    void input;

    expect(parseActionSpec(withoutInput, FILE, 'entry/submit.md').value).toBeNull();
  });

  it('input が [] なら正常', () => {
    const result = parseActionSpec(valid({ input: [] }), FILE, 'entry/submit.md');

    expect(result.findings).toEqual([]);
    expect(result.value?.input).toEqual([]);
  });

  it('input の要素が {entity}.{field} 形式でなければ違反になる', () => {
    expect(messages(valid({ input: ['id'] }))).toContainEqual(
      expect.stringContaining('"{entity}.{field}" の形式ではありません'),
    );
  });

  it('errors.inherits が common 以外なら違反になる', () => {
    expect(messages(valid({ errors: { inherits: 'none' } }))).toContainEqual(
      expect.stringContaining('errors.inherits は common'),
    );
  });

  it('errors.additional の kind / when を読む', () => {
    const data = valid({
      errors: { inherits: 'common', additional: [{ kind: 'external_unavailable', when: '決済が応答しない' }] },
    });

    const result = parseActionSpec(data, FILE, 'entry/submit.md');

    expect(result.findings).toEqual([]);
    expect(result.value?.errors.additional).toEqual([
      expect.objectContaining({ kind: 'external_unavailable', when: '決済が応答しない' }),
    ]);
  });

  it('test_cases が空ならモデルを構築しない(1 つ以上が必須)', () => {
    expect(parseActionSpec(valid({ test_cases: [] }), FILE, 'entry/submit.md').value).toBeNull();
  });

  it('type が unit / integration 以外なら違反になり、そのケースは落ちる', () => {
    const data = valid({ test_cases: [{ ...(valid()['test_cases'] as unknown[])[0] as object, type: 'e2e' }] });

    const result = parseActionSpec(data, FILE, 'entry/submit.md');

    expect(result.findings.map((f) => f.message)).toContainEqual(
      expect.stringContaining('unit / integration のどちらでもありません'),
    );
    expect(result.value?.testCases).toEqual([]);
  });

  it('implementation に :: が無ければ違反になる', () => {
    const base = (valid()['test_cases'] as unknown[])[0] as object;
    const data = valid({ test_cases: [{ ...base, implementation: 'app/src/x.test.ts' }] });

    expect(messages(data)).toContainEqual(expect.stringContaining('"{テストファイルパス}::{テスト名}"'));
  });

  it('implementation のパスが .test.ts で終わらなければ違反になる', () => {
    const base = (valid()['test_cases'] as unknown[])[0] as object;
    const data = valid({ test_cases: [{ ...base, implementation: 'app/src/x.ts::名前' }] });

    expect(messages(data)).toContainEqual(expect.stringContaining('"{テストファイルパス}::{テスト名}"'));
  });

  it('spec_ids が空なら違反になる', () => {
    const base = (valid()['test_cases'] as unknown[])[0] as object;

    expect(messages(valid({ test_cases: [{ ...base, spec_ids: [] }] }))).toContainEqual(
      expect.stringContaining('spec_ids が空です'),
    );
  });

  it('テストケース ID が同一ファイル内で重複したら違反になる', () => {
    const base = (valid()['test_cases'] as unknown[])[0] as object;

    expect(messages(valid({ test_cases: [base, base] }))).toContainEqual(
      expect.stringContaining('重複しています'),
    );
  });

  it('テストケース ID の形式が TC-... でなければ違反になる', () => {
    const base = (valid()['test_cases'] as unknown[])[0] as object;

    expect(messages(valid({ test_cases: [{ ...base, id: 'case-1' }] }))).toContainEqual(
      expect.stringContaining('"TC-{AGGREGATE}-{EVENT}-{NNN}" の形式ではありません'),
    );
  });

  it('covers を意味クラスのリストとして読む', () => {
    const base = (valid()['test_cases'] as unknown[])[0] as object;
    const data = valid({ test_cases: [{ ...base, covers: ['success', 'forbidden'] }] });

    const result = parseActionSpec(data, FILE, 'entry/submit.md');

    expect(result.findings).toEqual([]);
    expect(result.value?.testCases[0]?.covers).toEqual(['success', 'forbidden']);
  });

  it('covers が無ければエラーになり、そのケース自体は読める', () => {
    // 宣言の無いケースは A7 の判定に寄与しない。書き漏らしを許すと
    // 「必要な意味クラスを満たしている」という結論がそのぶん甘くなるのでエラーとする。
    const base = (valid()['test_cases'] as unknown[])[0] as object;
    const { covers, ...withoutCovers } = base as { covers?: unknown };
    void covers;

    const result = parseActionSpec(valid({ test_cases: [withoutCovers] }), FILE, 'entry/submit.md');

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('error');
    expect(result.findings[0]?.message).toContain('covers がありません');
    expect(result.value?.testCases[0]?.covers).toBeUndefined();
  });

  it('covers に値域の外の値があれば違反になる', () => {
    const base = (valid()['test_cases'] as unknown[])[0] as object;
    const data = valid({ test_cases: [{ ...base, covers: ['success', 'timeout'] }] });

    const result = parseActionSpec(data, FILE, 'entry/submit.md');

    expect(result.findings.map((f) => f.message)).toContainEqual(
      expect.stringContaining('covers の timeout は意味クラスではありません'),
    );
    expect(result.findings.every((f) => f.severity === 'error')).toBe(true);
    expect(result.value?.testCases[0]?.covers).toEqual(['success']);
  });

  it('境界: covers が空リストなら違反になり、宣言が無いものとして扱う', () => {
    const base = (valid()['test_cases'] as unknown[])[0] as object;

    const result = parseActionSpec(valid({ test_cases: [{ ...base, covers: [] }] }), FILE, 'entry/submit.md');

    expect(result.findings.map((f) => f.message)).toContainEqual(
      expect.stringContaining('covers が空です'),
    );
    expect(result.value?.testCases[0]?.covers).toBeUndefined();
  });

  it('境界: フロントマターがマッピングでなければモデルを構築しない', () => {
    expect(parseActionSpec(['a'], FILE, 'entry/submit.md').value).toBeNull();
  });

  describe('ux(方針の導出の上書き)', () => {
    it('ux が無ければ undefined になる', () => {
      const result = parseActionSpec(valid(), FILE, 'entry/submit.md');
      expect(result.value?.ux).toBeUndefined();
    });

    it('confirm と reason を読む', () => {
      const data = valid({ ux: { confirm: 'none', reason: '画面に overlay が無いため' } });
      const result = parseActionSpec(data, FILE, 'entry/submit.md');

      expect(result.findings).toEqual([]);
      expect(result.value?.ux).toMatchObject({ confirm: 'none', reason: '画面に overlay が無いため' });
    });

    it('reason を省略しても構造は読める(reason 必須は V14 の担当)', () => {
      const data = valid({ ux: { confirm: 'required' } });
      const result = parseActionSpec(data, FILE, 'entry/submit.md');

      expect(result.findings).toEqual([]);
      expect(result.value?.ux).toMatchObject({ confirm: 'required' });
      expect(result.value?.ux?.reason).toBeUndefined();
    });

    it('confirm が値域の外なら違反になる', () => {
      const data = valid({ ux: { confirm: 'always', reason: 'x' } });
      const result = parseActionSpec(data, FILE, 'entry/submit.md');

      expect(result.findings.map((f) => f.message)).toContainEqual(
        expect.stringContaining('ux.confirm "always" は値域にありません'),
      );
      expect(result.value?.ux).toBeUndefined();
    });

    it('ux がマッピングでなければ違反になる', () => {
      const data = valid({ ux: 'none' });
      const result = parseActionSpec(data, FILE, 'entry/submit.md');

      expect(result.findings.map((f) => f.message)).toContainEqual(
        expect.stringContaining('ux がマッピングになっていません'),
      );
      expect(result.value?.ux).toBeUndefined();
    });
  });
  describe('computes（実行時に純関数が決める値）', () => {
    it('reads を省略した computes は材料の宣言が空のまま読める', () => {
      const data = valid({ computes: [{ field: 'entry.slot_fee_amount', ref: 'confirmedSlotFee' }] });
      const result = parseActionSpec(data, FILE, 'entry/submit.md');

      expect(result.findings).toEqual([]);
      expect(result.value?.computes).toMatchObject([
        { entity: 'entry', field: 'slot_fee_amount', ref: 'confirmedSlotFee', reads: [] },
      ]);
    });

    it('reads は "{entity}.{field}" に割って持つ（宣言順）', () => {
      const data = valid({
        computes: [
          {
            field: 'entry.slot_fee_amount',
            ref: 'confirmedSlotFee',
            reads: ['entry.kind', 'workshop.seat_fee'],
          },
        ],
      });
      const result = parseActionSpec(data, FILE, 'entry/submit.md');

      expect(result.findings).toEqual([]);
      expect(result.value?.computes[0]?.reads).toMatchObject([
        { raw: 'entry.kind', entity: 'entry', field: 'kind' },
        { raw: 'workshop.seat_fee', entity: 'workshop', field: 'seat_fee' },
      ]);
    });

    it('reads が "{entity}.{field}" の形でなければ違反になる（実在は A19 が見る）', () => {
      const data = valid({
        computes: [{ field: 'entry.slot_fee_amount', ref: 'confirmedSlotFee', reads: ['kind'] }],
      });
      const result = parseActionSpec(data, FILE, 'entry/submit.md');

      expect(result.findings.map((f) => f.message)).toContainEqual(
        expect.stringContaining('computes[0].reads の "kind" が "{entity}.{field}" の形式ではありません'),
      );
    });

    describe('shape と examples（例の表）', () => {
      /** 例の表つきの computes 1 件。 */
      function withExamples(extra: Record<string, unknown>): Record<string, unknown> {
        return valid({
          computes: [{ field: 'entry.slot_fee_amount', ref: 'confirmedSlotFee', reads: ['entry.kind'], ...extra }],
        });
      }

      it('shape を省略すると facts_input・examples は空のまま読める', () => {
        const result = parseActionSpec(withExamples({}), FILE, 'entry/submit.md');

        expect(result.findings).toEqual([]);
        expect(result.value?.computes[0]).toMatchObject({ shape: 'facts_input', examples: [] });
      });

      it('shape: input と、given の facts / input と expect を持つ例の行を宣言順に読む', () => {
        const result = parseActionSpec(
          withExamples({
            shape: 'input',
            examples: [
              { note: '一つめ', given: { input: { a: 1, nested: { list: [true, null, 'x'] } } }, expect: { total: 3 } },
              { note: '二つめ', given: { facts: { 'entry.kind': 'performance' }, input: {} }, expect: null },
            ],
          }),
          FILE,
          'entry/submit.md',
        );

        expect(result.findings).toEqual([]);
        expect(result.value?.computes[0]?.shape).toBe('input');
        expect(result.value?.computes[0]?.examples).toMatchObject([
          { note: '一つめ', facts: {}, input: { a: 1, nested: { list: [true, null, 'x'] } }, expect: { total: 3 } },
          { note: '二つめ', facts: { 'entry.kind': 'performance' }, input: {}, expect: null },
        ]);
      });

      it('shape が値域に無ければ違反になる', () => {
        const result = parseActionSpec(withExamples({ shape: 'formula' }), FILE, 'entry/submit.md');

        expect(result.findings.map((f) => f.message)).toContainEqual(
          expect.stringContaining('computes[0].shape "formula" は値域にありません'),
        );
        expect(result.value?.computes[0]?.shape).toBe('facts_input');
      });

      it('examples の行に知らない鍵・note の欠落・given の欠落・expect の欠落があれば違反になり、その行は落とす', () => {
        const result = parseActionSpec(
          withExamples({
            examples: [
              { note: 'a', given: {}, expect: 1, formula: 'x' },
              { given: {}, expect: 1 },
              { note: 'c', expect: 1 },
              { note: 'd', given: {} },
              { note: 'e', given: { facts: {} }, expect: 1 },
            ],
          }),
          FILE,
          'entry/submit.md',
        );
        const messages = result.findings.map((f) => f.message);

        expect(messages).toContainEqual(expect.stringContaining('examples の要素 に formula は書けません'));
        expect(messages).toContainEqual(expect.stringContaining('note がありません'));
        expect(messages).toContainEqual(expect.stringContaining('computes[0].examples[2].given がありません'));
        expect(messages).toContainEqual(expect.stringContaining('computes[0].examples[3].expect がありません'));
        expect(result.value?.computes[0]?.examples.map((row) => row.note)).toEqual(['a', 'e']);
      });

      it('given の鍵が未知・facts がマッピングでない・expect が値でないなら違反になる', () => {
        const result = parseActionSpec(
          withExamples({
            examples: [
              { note: 'a', given: { fact: {} }, expect: 1 },
              { note: 'b', given: { facts: [1] }, expect: 1 },
              { note: 'c', given: { input: { when: new Date(0) } }, expect: 1 },
              { note: 'd', given: {}, expect: new Date(0) },
              { note: 'e', given: {}, expect: { when: () => 1 } },
            ],
          }),
          FILE,
          'entry/submit.md',
        );
        const messages = result.findings.map((f) => f.message);

        expect(messages).toContainEqual(expect.stringContaining('given に fact は書けません'));
        expect(messages).toContainEqual(expect.stringContaining('given.facts がマッピング'));
        expect(messages).toContainEqual(expect.stringContaining('given.input がマッピング'));
        expect(messages).toContainEqual(expect.stringContaining('examples[3].expect が値'));
        expect(messages).toContainEqual(expect.stringContaining('examples[4].expect が値'));
      });

      it('computes の要素に知らない鍵があれば違反になる', () => {
        const result = parseActionSpec(withExamples({ formula: 'a + b' }), FILE, 'entry/submit.md');

        expect(result.findings.map((f) => f.message)).toContainEqual(
          expect.stringContaining('computes の要素 に formula は書けません'),
        );
      });

      it('examples が配列でなければ違反になる', () => {
        const result = parseActionSpec(withExamples({ examples: 'many' }), FILE, 'entry/submit.md');

        expect(result.findings.length).toBeGreaterThan(0);
        expect(result.value?.computes[0]?.examples).toEqual([]);
      });
    });
  });
});

describe('parseActionSpec の owner(作成の持ち主の欄の明示。点検 9 回目 A9-1)', () => {
  /** owner を足した作成の action_spec を読む。 */
  function read(owner: unknown) {
    const result = parseActionSpec(valid({ id: 'entry-create-action', handles: 'entry.create', input: [], owner }), FILE, 'entry/create.md');
    return { owner: result.value?.owner, messages: result.findings.map((finding) => finding.message) };
  }

  it.each([
    { name: '{集約}.{欄} を読む', value: 'entry.owner_id', owner: { raw: 'entry.owner_id', entity: 'entry', field: 'owner_id' }, message: undefined },
    { name: '書かなければ持たない(推測で補わない)', value: undefined, owner: undefined, message: undefined },
    { name: '欄名だけ(集約が無い)は形の違反', value: 'owner_id', owner: undefined, message: 'owner が "{entity}.{field}" の形式ではありません' },
    { name: 'リスト(2 本以上の持ち主)は書けない', value: ['entry.owner_id'], owner: undefined, message: 'owner は文字列で書きます' },
  ])('$name', ({ value, owner, message }) => {
    const actual = read(value);
    expect(actual.owner === undefined ? undefined : { raw: actual.owner.raw, entity: actual.owner.entity, field: actual.owner.field }).toEqual(owner);
    if (message === undefined) expect(actual.messages).toEqual([]);
    else expect(actual.messages.join('\n')).toContain(message);
  });
});
