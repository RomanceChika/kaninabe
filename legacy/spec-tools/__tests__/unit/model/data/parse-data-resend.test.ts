/**
 * data_table の `resend`(作成の冪等な再送で既存の行を返すか)と、access_spec の `creates[].delegate`
 * (代理で作ってよい理由)のパーサーの規約網羅テスト(T0 / V1)。
 *
 * 正: ARCH-SP-BE-0001 §作成の再送と実行者の縛り。
 *   - `returns_existing` は真偽値で必須。`true` なら `creator` が必須、`false` なら `creator` は書けない
 *   - マッピングでない・知らないキーは落ちる(読み落とした宣言を「宣言なし」と読み替えない)
 *   - `delegate` は空にできない(緩める宣言なので、読めなければ載せない = 縛る側に倒す)
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseDataTableSpec } from '../../../../lib/model/data/parse-data-table.js';
import { parseAccessSpec } from '../../../../lib/model/parse-access.js';

/** resend だけを差し替えた最小の data_table。 */
function parse(resend: unknown) {
  const reporter = new SpecReporter('docs/specs/backend/data/tables/entries.md');
  return parseDataTableSpec(
    {
      doc_type: 'data_table',
      scope: 'backend',
      id: 'table-entries',
      table: 'entries',
      entity: 'entry',
      ...(resend === undefined ? {} : { resend }),
      test_cases: [
        {
          id: 'TC-TABLE-ENTRIES-001',
          type: 'integration',
          covers: ['success'],
          spec_ids: ['table-entries'],
          implementation: 'app/src/infrastructure/__tests__/schema/data-table-parity.test.ts::entries の突合',
        },
      ],
    },
    'entries.md',
    reporter,
  );
}

/** error の文言。 */
function errors(result: ReturnType<typeof parse>): readonly string[] {
  return result.findings.filter((finding) => finding.severity === 'error').map((finding) => finding.message);
}

describe('data_table の resend', () => {
  it('返す宣言は作成者の欄ごと読める', () => {
    const result = parse({ returns_existing: true, creator: 'owner_id' });

    expect(errors(result)).toEqual([]);
    expect(result.value?.resend).toMatchObject({ returnsExisting: true, creator: 'owner_id' });
  });

  it('返さない宣言は作成者の欄なしで読める', () => {
    const result = parse({ returns_existing: false });

    expect(errors(result)).toEqual([]);
    expect(result.value?.resend).toMatchObject({ returnsExisting: false });
    expect(result.value?.resend?.creator).toBeUndefined();
  });

  it('書かなければ宣言なし(既定を置かない。止めるのは T6 / Y12)', () => {
    const result = parse(undefined);

    expect(errors(result)).toEqual([]);
    expect(result.value?.resend).toBeUndefined();
  });

  it('返すのに作成者の欄が無ければ、監査ログの実行者で確かめる宣言として読む(点検 20 回目 B20-1)', () => {
    const result = parse({ returns_existing: true });

    expect(errors(result)).toEqual([]);
    expect(result.value?.resend?.returnsExisting).toBe(true);
    expect(result.value?.resend?.creator).toBeUndefined();
  });

  it('返さないのに作成者の欄を書けば落ちる(使われない宣言を残さない)', () => {
    const result = parse({ returns_existing: false, creator: 'owner_id' });

    expect(errors(result)).toContain('resend.returns_existing: false に creator は書けません');
    expect(result.value?.resend).toBeUndefined();
  });

  it('returns_existing が無い・真偽値でなければ落ちる', () => {
    expect(errors(parse({ creator: 'owner_id' })).length).toBeGreaterThan(0);
    expect(errors(parse({ returns_existing: 'yes', creator: 'owner_id' })).length).toBeGreaterThan(0);
  });

  it('マッピングでない・知らないキー・識別子でない作成者の欄は落ちる', () => {
    expect(errors(parse(true))).toContain('resend はマッピングで書きます');
    expect(errors(parse({ returns_existing: false, owner: 'x' })).some((message) => message.includes('owner は書けません'))).toBe(true);
    expect(errors(parse({ returns_existing: true, creator: 'owner_id; drop table x' })).length).toBeGreaterThan(0);
  });

  it('作成者の欄が文字列でなければ、「作成者が無い」に読み替えずに落とす', () => {
    const result = parse({ returns_existing: true, creator: 1 });

    expect(errors(result).length).toBeGreaterThan(0);
    expect(result.value?.resend).toBeUndefined();
  });
});

describe('access_spec の creates[].delegate(欄を名指す。点検 10 回目 A10-2)', () => {
  const FILE = 'docs/specs/domain/box/access.md';
  /** creates[0] の delegate を読んだ結果と違反。 */
  function read(delegate: unknown) {
    const result = parseAccessSpec({ doc_type: 'access_spec', entity: 'box', reads: [], creates: [{ by: 'member', delegate }] }, FILE);
    return { decls: result.value?.creates[0]?.delegate?.map(({ location: _location, ...rest }) => rest), messages: result.findings.map((finding) => finding.message).join('\n') };
  }

  it.each([
    { name: '欄 × 理由を規則に載せる', value: [{ field: 'box.approver_id', reason: '窓口担当が代わりに作る' }], decls: [{ entity: 'box', field: 'approver_id', reason: '窓口担当が代わりに作る' }], error: '' },
    {
      name: '複数の欄は宣言順(前後の空白は落とす)',
      value: [{ field: ' box.approver_id ', reason: 'x' }, { field: 'box.payee_id', reason: 'y' }],
      decls: [{ entity: 'box', field: 'approver_id', reason: 'x' }, { entity: 'box', field: 'payee_id', reason: 'y' }],
      error: '',
    },
    { name: '規則単位の 1 文字列(旧い形)は読まずに止める', value: '窓口担当が代わりに作る', decls: undefined, error: 'delegate を 1 つの文字列では書けません' },
    { name: '空の理由は落ちる(緩めない側に倒す)', value: [{ field: 'box.approver_id', reason: '  ' }], decls: undefined, error: 'delegate[0] の理由が空です' },
    { name: 'reason が無い要素は載せない', value: [{ field: 'box.approver_id' }], decls: undefined, error: 'reason がありません' },
    { name: 'field が {集約}.{欄} の形でない', value: [{ field: 'approver_id', reason: '理由' }], decls: undefined, error: '"box.{欄}"(作る集約の欄)の形ではありません' },
    { name: '別の集約の欄は名指せない', value: [{ field: 'owner.id', reason: '理由' }], decls: undefined, error: '"box.{欄}"(作る集約の欄)の形ではありません' },
    {
      name: '同じ欄を 2 回名指せない(2 つ目を落とす)',
      value: [{ field: 'box.approver_id', reason: 'x' }, { field: 'box.approver_id', reason: 'y' }],
      decls: [{ entity: 'box', field: 'approver_id', reason: 'x' }],
      error: 'delegate に box.approver_id が 2 回あります',
    },
    { name: '知らないキーは止める', value: [{ field: 'box.approver_id', reason: '理由', fields: ['x'] }], decls: [{ entity: 'box', field: 'approver_id', reason: '理由' }], error: 'fields' },
  ])('$name', ({ value, decls, error }) => {
    const actual = read(value);
    expect(actual.decls).toEqual(decls);
    if (error === '') expect(actual.messages).toBe('');
    else expect(actual.messages).toContain(error);
  });

  it('deletes には delegate を書けない(縛りは作成だけの話)', () => {
    const result = parseAccessSpec({ doc_type: 'access_spec', entity: 'box', reads: [], deletes: [{ by: 'member', delegate: '理由' }] }, FILE);

    expect(result.findings.some((finding) => finding.message.includes('delegate は書けません'))).toBe(true);
  });
});
