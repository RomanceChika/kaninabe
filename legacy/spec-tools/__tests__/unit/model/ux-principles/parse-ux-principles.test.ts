/**
 * U8(UX 原則の台帳のスキーマ適合)のユニットテスト。
 *
 * 規約網羅(ux-lint.md §UX 原則の台帳・§台帳の整合):
 *   - 正しい台帳が読めること
 *   - id が ux-principles 固定であること
 *   - 原則の id の形・重複・必須キー・知らないキー
 *   - budget は `{ limit: 正の整数 }` だけ
 *   - affects が閉じた値域にあること
 *   - statement が 1 文であること
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseUxPrinciples } from '../../../../lib/model/ux-principles/parse-ux-principles.js';

/** 1 行分の正しい原則。 */
const ROW = {
  id: 'U4',
  statement: '同時に並ぶ操作は目安を超えない',
  derives: ['screen_spec の actions'],
  enforced_by: 'U4',
  budget: { limit: 7 },
};

/** フロントマター相当のマッピングを組み立てる。 */
function frontmatter(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { doc_type: 'ux_principles_spec', scope: 'frontend', id: 'ux-principles', principles: [ROW], ...overrides };
}

/** パースして (台帳, 違反) を返す。 */
function parse(data: Readonly<Record<string, unknown>>) {
  return parseUxPrinciples(data, new SpecReporter('docs/specs/frontend/ux-principles.md'));
}

describe('U8: UX 原則の台帳のパース', () => {
  it('正しい台帳を読める', () => {
    const { value, findings } = parse(frontmatter());

    expect(findings).toEqual([]);
    expect(value?.principles).toHaveLength(1);
    expect(value?.principles[0]).toMatchObject({ id: 'U4', enforcedBy: 'U4', budget: { limit: 7 } });
    expect(value?.principles[0]?.derives).toEqual(['screen_spec の actions']);
  });

  it('derives と budget と affects は任意', () => {
    const { value, findings } = parse(
      frontmatter({ principles: [{ id: 'U6', statement: 'a11y を満たす', enforced_by: 'advisory' }] }),
    );

    expect(findings).toEqual([]);
    expect(value?.principles[0]?.derives).toEqual([]);
    expect(value?.principles[0]?.budget).toBeUndefined();
    expect(value?.principles[0]?.affects).toBeUndefined();
  });

  it('id が ux-principles でなければエラー', () => {
    const { findings } = parse(frontmatter({ id: 'ux' }));

    expect(findings.some((f) => f.message.includes('UX 原則の台帳の id ではありません'))).toBe(true);
  });

  it('原則の id が `U4` / `Y5-steps` の形でなければエラー(行ごと落とす)', () => {
    const { value, findings } = parse(frontmatter({ principles: [{ ...ROW, id: 'u4' }, { ...ROW, id: 'Y5-steps' }] }));

    expect(findings.some((f) => f.message.includes('原則の ID の形ではありません'))).toBe(true);
    expect(value?.principles.map((p) => p.id)).toEqual(['Y5-steps']);
  });

  it('原則の id の重複はエラー', () => {
    const { value, findings } = parse(frontmatter({ principles: [ROW, ROW] }));

    expect(findings.some((f) => f.message.includes('重複'))).toBe(true);
    expect(value?.principles).toHaveLength(1);
  });

  it('必須キー(statement / enforced_by)が無ければエラー', () => {
    const { value, findings } = parse(frontmatter({ principles: [{ id: 'U4' }] }));

    expect(findings.map((f) => f.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('statement がありません'), expect.stringContaining('enforced_by がありません')]),
    );
    expect(value?.principles).toEqual([]);
  });

  it('statement が空ならエラー', () => {
    const { findings } = parse(frontmatter({ principles: [{ ...ROW, statement: '  ' }] }));

    expect(findings.some((f) => f.message.includes('statement が空です'))).toBe(true);
  });

  it('statement が 2 文ならエラー(宣言は落とさない)', () => {
    const { value, findings } = parse(frontmatter({ principles: [{ ...ROW, statement: '一つ目。二つ目。' }] }));

    expect(findings.some((f) => f.message.includes('2 文です'))).toBe(true);
    expect(value?.principles).toHaveLength(1);
  });

  it('知らないキーは弾く', () => {
    const { findings } = parse(frontmatter({ principles: [{ ...ROW, severity: 'error' }], extra: 1 }));

    expect(findings.map((f) => f.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('severity は書けません'), expect.stringContaining('extra は書けません')]),
    );
  });

  it('budget は { limit: 正の整数 } だけ', () => {
    const cases: readonly [unknown, string][] = [
      [7, 'マッピングで書きます'],
      [{}, 'limit がありません'],
      [{ limit: 0 }, '正の整数ではありません'],
      [{ limit: 2.5 }, '正の整数ではありません'],
      [{ limit: 'x' }, 'limit は数値で書きます'],
      [{ limit: 7, per: 1 }, 'per は書けません'],
    ];
    for (const [budget, expected] of cases) {
      const { findings } = parse(frontmatter({ principles: [{ ...ROW, budget }] }));
      expect(findings.some((f) => f.message.includes(expected)), String(expected)).toBe(true);
    }
  });

  it('affects は confirm_required だけ', () => {
    const ok = parse(frontmatter({ principles: [{ ...ROW, id: 'U1', enforced_by: 'U1', affects: 'confirm_required' }] }));
    expect(ok.findings).toEqual([]);
    expect(ok.value?.principles[0]?.affects).toBe('confirm_required');

    const bad = parse(frontmatter({ principles: [{ ...ROW, affects: 'variant' }] }));
    expect(bad.findings.some((f) => f.message.includes('属性の名前の値域'))).toBe(true);
  });

  it('principles が無ければエラー', () => {
    const { findings } = parse(frontmatter({ principles: undefined }));

    expect(findings.some((f) => f.message.includes('principles がありません'))).toBe(true);
  });

  it('principles の要素がマッピングでなければエラー', () => {
    const { findings } = parse(frontmatter({ principles: ['U4'] }));

    expect(findings.some((f) => f.message.includes('マッピングで書きます'))).toBe(true);
  });
});
