/**
 * 拡張候補の台帳のスキーマ適合(W5 のスキーマの部分)のユニットテスト。
 *
 * 見るのは、正しい台帳が読めること・必須キーと値域(`id` の形・`rules` の形・`status`・`since`)・
 * `id` の一意、そして**未知のキー(理由欄など)を書けないこと**(理由つきの受け入れの口を作らない)。
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseExtensionLedger } from '../../../../lib/model/extension/parse-candidates.js';

/** 1 行分の正しい候補。 */
const ROW = {
  id: 'X-proof-worlds',
  statement: '証明の world を組めない',
  rules: ['T8', 'T11'],
  status: 'open',
  since: '2026-10-03',
  ref: 'BACKLOG.md',
};

/** パースして (台帳, 違反) を返す。 */
function parse(data: Readonly<Record<string, unknown>>) {
  return parseExtensionLedger(data, new SpecReporter('legacy/spec-tools/extension-candidates.md'));
}

/** 違反の文面に含まれるか。 */
function mentions(findings: readonly { readonly message: string }[], text: string): boolean {
  return findings.some((finding) => finding.message.includes(text));
}

describe('W5: 拡張候補の台帳のパース', () => {
  it('正しい台帳を読んで、候補を宣言順に持つ', () => {
    const { value, findings } = parse({ candidates: [ROW, { ...ROW, id: 'X-derived-columns', rules: ['T15'], status: 'decided' }] });

    expect(findings).toEqual([]);
    expect(value?.candidates.map((candidate) => candidate.id)).toEqual(['X-proof-worlds', 'X-derived-columns']);
    expect(value?.candidates[0]).toMatchObject({ rules: ['T8', 'T11'], status: 'open', since: '2026-10-03' });
    expect(value?.candidates[1]?.status).toBe('decided');
    expect(value?.candidates[0]?.location).toEqual({
      file: 'legacy/spec-tools/extension-candidates.md',
      pointer: 'candidates.X-proof-worlds',
    });
  });

  it('候補が 0 件の台帳も正しい(宿題が無い状態)', () => {
    const { value, findings } = parse({ candidates: [] });

    expect(findings).toEqual([]);
    expect(value?.candidates).toEqual([]);
  });

  it('candidates が無ければ error', () => {
    const { findings } = parse({});

    expect(mentions(findings, 'candidates がありません')).toBe(true);
  });

  it('トップレベルの未知のキーは書けない', () => {
    const { findings } = parse({ candidates: [], others: [] });

    expect(mentions(findings, 'others は書けません')).toBe(true);
  });

  it('理由の欄(reason)を足せない(汎用の受け入れの口を作らない)。行は落ちる', () => {
    const { value, findings } = parse({ candidates: [{ ...ROW, reason: '仕組みは変えるべきでない' }] });

    expect(mentions(findings, 'reason は書けません')).toBe(true);
    expect(findings.some((finding) => finding.suggestion.includes('理由つきの受け入れの口はこの台帳に作らない'))).toBe(true);
    // 未知のキーは違反として記録するが、行そのものは読める(他の違反と一度に指摘するため)。
    expect(value?.candidates).toHaveLength(1);
  });

  it.each(['id', 'statement', 'rules', 'status', 'since', 'ref'])('必須キー %s が無ければ行ごと落ちる', (key) => {
    const { value, findings } = parse({ candidates: [{ ...ROW, [key]: undefined }] });

    expect(mentions(findings, `${key} がありません`)).toBe(true);
    expect(value?.candidates).toEqual([]);
  });

  it('id が X- 接頭辞のケバブケースでなければ落ちる', () => {
    for (const id of ['proof-worlds', 'X-Proof', 'X_proof', 'X-']) {
      const { value, findings } = parse({ candidates: [{ ...ROW, id }] });

      expect(mentions(findings, '接頭辞のケバブケースではありません')).toBe(true);
      expect(value?.candidates).toEqual([]);
    }
  });

  it('id が重複していれば 2 行目を落とす', () => {
    const { value, findings } = parse({ candidates: [ROW, { ...ROW, rules: ['T15'] }] });

    expect(mentions(findings, 'X-proof-worlds が重複しています')).toBe(true);
    expect(value?.candidates).toHaveLength(1);
  });

  it('rules が空・検査 ID の形でなければ落ちる', () => {
    const empty = parse({ candidates: [{ ...ROW, rules: [] }] });
    const shaped = parse({ candidates: [{ ...ROW, rules: ['t8', 'T'] }] });

    expect(mentions(empty.findings, 'rules が空です')).toBe(true);
    expect(empty.value?.candidates).toEqual([]);
    expect(shaped.findings.filter((finding) => finding.message.includes('検査 ID の形ではありません'))).toHaveLength(2);
    expect(shaped.value?.candidates).toEqual([]);
  });

  it('status が値域になければ落ちる', () => {
    const { value, findings } = parse({ candidates: [{ ...ROW, status: 'closed' }] });

    expect(mentions(findings, 'status closed は値域にありません')).toBe(true);
    expect(value?.candidates).toEqual([]);
  });

  it('since が YYYY-MM-DD の形でなければ落ちる', () => {
    const { value, findings } = parse({ candidates: [{ ...ROW, since: '2026/10/03' }] });

    expect(mentions(findings, 'YYYY-MM-DD の形ではありません')).toBe(true);
    expect(value?.candidates).toEqual([]);
  });

  it('scope は任意で、値域の語なら読める(書かなければ絞り無し)', () => {
    const { value, findings } = parse({
      candidates: [{ ...ROW, id: 'X-tables', rules: ['T2'], scope: 'framework_tables' }, { ...ROW, id: 'X-other', rules: ['T15'] }],
    });

    expect(findings).toEqual([]);
    expect(value?.candidates[0]?.scope).toBe('framework_tables');
    expect(value?.candidates[1]).not.toHaveProperty('scope');
  });

  it('scope が値域になければ落ちる(値域を直し方に言う)', () => {
    const { value, findings } = parse({ candidates: [{ ...ROW, scope: 'everything' }] });

    expect(mentions(findings, 'scope everything は値域にありません')).toBe(true);
    expect(findings.find((finding) => finding.message.includes('scope everything'))?.suggestion).toContain('framework_tables');
    expect(value?.candidates).toEqual([]);
  });

  it('candidates の要素がマッピングでなければ error', () => {
    const { findings } = parse({ candidates: ['X-proof-worlds'] });

    expect(mentions(findings, 'マッピングで書きます')).toBe(true);
  });
});
