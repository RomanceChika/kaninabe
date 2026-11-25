/**
 * Z0(保証台帳のスキーマ適合 + 語彙の閉世界 + 見張りテストの閉世界)のユニットテスト。
 *
 * 規約網羅(guarantee-spec-writing.md §共通形式・§1 行が宣言すること・§検証):
 *   - 正しいカタログが読めること
 *   - id が guarantee-catalog 固定であること
 *   - 保証 ID がスネークケースであること・重複しないこと
 *   - **enforced_by が、同じファイルが宣言した語彙(vocabulary.enforcer)に閉じていること**
 *   - status がフレームワーク固定の値域にあること
 *   - status: enforced ⇒ canaries が 1 つ以上・planned_reason は書けない
 *   - status: planned ⇒ planned_reason が必須・canaries は書けない
 *   - canaries が test_cases に実在すること・孤児の見張りテスト(誰にも参照されない test_case)が無いこと
 *   - vocabulary の欠落・空・語の重複が落ちること
 *   - 未知キーは弾くこと
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseGuaranteeCatalog } from '../../../../lib/model/guarantee/parse-guarantee.js';

/** 最小の語彙(テストごとに上書きする)。 */
const VOCABULARY = {
  enforcer: [{ id: 'rls', label: '行単位セキュリティ(Postgres RLS)' }, { id: 'grant' }],
};

/** 1 行分の正しい保証宣言。 */
const ROW = {
  id: 'rows_by_rls',
  label: '見えてはいけない行は返らない',
  enforced_by: ['rls'],
  status: 'enforced',
  canaries: ['TC-GUAR-ROWS-001'],
  summary: '業務テーブルは全て RLS が有効である',
};

const TEST_CASE = {
  id: 'TC-GUAR-ROWS-001',
  type: 'integration',
  covers: ['forbidden'],
  spec_ids: ['guarantee-catalog'],
  implementation: 'app/src/infrastructure/__tests__/guarantees/rows.test.ts::行が返らない',
};

/** フロントマター相当のマッピングを組み立てる。 */
function frontmatter(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    doc_type: 'guarantee_spec',
    scope: 'backend',
    id: 'guarantee-catalog',
    vocabulary: VOCABULARY,
    guarantees: [ROW],
    test_cases: [TEST_CASE],
    ...overrides,
  };
}

/** パースして (カタログ, 違反) を返す。 */
function parse(data: Readonly<Record<string, unknown>>) {
  const reporter = new SpecReporter('docs/specs/backend/guarantees.md');
  return parseGuaranteeCatalog(data, reporter);
}

describe('Z0: 保証台帳のパース', () => {
  it('正しいカタログを読める', () => {
    const { value, findings } = parse(frontmatter());

    expect(findings).toEqual([]);
    expect(value?.guarantees).toHaveLength(1);
    expect(value?.guarantees[0]?.status).toBe('enforced');
    expect(value?.vocabulary.enforcer[0]?.label).toBe('行単位セキュリティ(Postgres RLS)');
  });

  it('id が guarantee-catalog でなければエラー', () => {
    const { findings } = parse(frontmatter({ id: 'guarantees' }));

    expect(findings.some((f) => f.message.includes('カタログの id ではありません'))).toBe(true);
  });

  it('保証 ID がスネークケースでなければエラー', () => {
    const { value, findings } = parse(frontmatter({ guarantees: [{ ...ROW, id: 'RowsByRls' }] }));

    expect(findings.some((f) => f.message.includes('スネークケース'))).toBe(true);
    expect(value?.guarantees).toEqual([]);
  });

  it('保証 ID の重複はエラー', () => {
    const { value, findings } = parse(frontmatter({ guarantees: [ROW, ROW] }));

    expect(findings.some((f) => f.message.includes('重複'))).toBe(true);
    expect(value?.guarantees).toHaveLength(1);
  });

  it('宣言されていない enforced_by はエラー(語彙の閉世界)', () => {
    const { value, findings } = parse(frontmatter({ guarantees: [{ ...ROW, enforced_by: ['nobody'] }] }));

    expect(findings.some((f) => f.message.includes('vocabulary.enforcer に宣言されていません'))).toBe(true);
    expect(value?.guarantees).toEqual([]);
  });

  it('語彙に足せば同じ値が通る(語彙は仕様側が決める)', () => {
    const { findings } = parse(
      frontmatter({
        vocabulary: { enforcer: [...VOCABULARY.enforcer, { id: 'lint' }] },
        guarantees: [{ ...ROW, enforced_by: ['lint'] }],
      }),
    );

    expect(findings).toEqual([]);
  });

  it('status が値域に無ければエラー', () => {
    const { findings } = parse(frontmatter({ guarantees: [{ ...ROW, status: 'sometimes' }] }));

    expect(findings.some((f) => f.message.includes('値域'))).toBe(true);
  });

  it('status: enforced なのに canaries が無ければエラー', () => {
    const row = { ...ROW } as Record<string, unknown>;
    delete row['canaries'];
    const { value, findings } = parse(frontmatter({ guarantees: [row] }));

    expect(findings.some((f) => f.message.includes('canaries がありません'))).toBe(true);
    expect(value?.guarantees).toEqual([]);
  });

  it('status: enforced なのに planned_reason があればエラー', () => {
    const { findings } = parse(
      frontmatter({ guarantees: [{ ...ROW, planned_reason: '理由' }] }),
    );

    expect(findings.some((f) => f.message.includes('planned_reason があります'))).toBe(true);
  });

  it('status: planned なのに canaries があればエラー', () => {
    const { findings } = parse(
      frontmatter({
        guarantees: [{ ...ROW, status: 'planned', planned_reason: '理由' }],
      }),
    );

    expect(findings.some((f) => f.message.includes('canaries があります'))).toBe(true);
  });

  it('status: planned なのに planned_reason が無ければエラー', () => {
    const row = { ...ROW, status: 'planned' } as Record<string, unknown>;
    delete row['canaries'];
    const { findings } = parse(frontmatter({ guarantees: [row], test_cases: [] }));

    expect(findings.some((f) => f.message.includes('planned_reason がありません'))).toBe(true);
  });

  it('status: planned は正しく読める(canaries 無し・planned_reason 有り)', () => {
    // test_cases は空を許さないため(V1)、既定の enforced 行(ROW)は残し、
    // 隣に status: planned の 2 行目を足す形で確かめる。
    const planned = {
      id: 'route_handler_no_writes',
      label: 'Route Handler はドメインの状態を書けない',
      enforced_by: ['grant'],
      status: 'planned',
      planned_reason: '着手待ち',
      summary: '説明',
    };
    const { value, findings } = parse(frontmatter({ guarantees: [ROW, planned] }));

    expect(findings).toEqual([]);
    expect(value?.guarantees[1]).toMatchObject({ status: 'planned', plannedReason: '着手待ち' });
    expect(value?.guarantees[1]?.canaries).toBeUndefined();
  });

  it('canaries が実在しない test_cases を指すとエラー', () => {
    const { findings } = parse(frontmatter({ guarantees: [{ ...ROW, canaries: ['TC-GUAR-NOWHERE-001'] }] }));

    expect(
      findings.some((f) => f.message.includes('canaries TC-GUAR-NOWHERE-001 に対応する test_cases がありません')),
    ).toBe(true);
  });

  it('孤児の見張りテスト(どの保証からも参照されない test_case)はエラー', () => {
    const { findings } = parse(
      frontmatter({ test_cases: [TEST_CASE, { ...TEST_CASE, id: 'TC-GUAR-ORPHAN-001' }] }),
    );

    expect(
      findings.some((f) => f.message.includes('TC-GUAR-ORPHAN-001 はどの保証の canaries からも参照されていません')),
    ).toBe(true);
  });

  it('test_cases の id の重複は、id を名指しでエラーになる（Z0 が止める。保証の id の重複とは別に）', () => {
    const { findings } = parse(frontmatter({ test_cases: [TEST_CASE, { ...TEST_CASE }] }));

    expect(findings.filter((f) => f.message.includes('テストケース ID TC-GUAR-ROWS-001 が同じファイル内で重複しています'))).toHaveLength(1);
  });

  it('保証の id がテストケースの id と同じ綴りになる形は作れない（保証の id はスネークケース、テストケースの id は TC- 始まり）', () => {
    const { findings } = parse(frontmatter({ guarantees: [{ ...ROW, id: 'TC-GUAR-ROWS-001' }] }));

    expect(findings.some((f) => f.message.includes('TC-GUAR-ROWS-001'))).toBe(true);
  });

  it('同じ保証の canaries に同じ id を 2 度書くと、id を名指してエラーになる(件数の水増し)', () => {
    const { findings } = parse(
      frontmatter({ guarantees: [{ ...ROW, canaries: ['TC-GUAR-ROWS-001', 'TC-GUAR-ROWS-001'] }] }),
    );

    expect(findings.filter((f) => f.message.includes('canaries に TC-GUAR-ROWS-001 が重複しています'))).toHaveLength(1);
  });

  it('別々の保証が同じ見張りテストを共有するのは重複ではない', () => {
    const { findings } = parse(
      frontmatter({ guarantees: [ROW, { ...ROW, id: 'rows_by_rls_again', label: '別の保証' }] }),
    );

    expect(findings.some((f) => f.message.includes('重複'))).toBe(false);
  });

  it('vocabulary が無ければエラー', () => {
    const { findings } = parse(frontmatter({ vocabulary: undefined }));

    expect(findings.some((f) => f.message.includes('vocabulary がありません'))).toBe(true);
  });

  it('語彙の軸が空ならエラー', () => {
    const { findings } = parse(frontmatter({ vocabulary: { enforcer: [] } }));

    expect(findings.some((f) => f.message.includes('vocabulary.enforcer が空です'))).toBe(true);
  });

  it('語彙の語が重複していればエラー', () => {
    const { findings } = parse(
      frontmatter({ vocabulary: { enforcer: [{ id: 'rls' }, { id: 'rls' }] } }),
    );

    expect(findings.some((f) => f.message.includes('enforcer の語 rls が重複'))).toBe(true);
  });

  it('summary が無ければ行ごと落ちる', () => {
    const { value, findings } = parse(frontmatter({ guarantees: [{ ...ROW, summary: undefined }] }));

    expect(findings.some((f) => f.message.includes('summary'))).toBe(true);
    expect(value?.guarantees).toEqual([]);
  });

  it('未知のトップレベルキーはエラー', () => {
    const { findings } = parse(frontmatter({ extra_key: 'x' }));

    expect(findings.some((f) => f.message.includes('extra_key は書けません'))).toBe(true);
  });

  it('保証の行に未知キーがあればエラー', () => {
    const { findings } = parse(frontmatter({ guarantees: [{ ...ROW, extra_key: 'x' }] }));

    expect(findings.some((f) => f.message.includes('extra_key は書けません'))).toBe(true);
  });
});
