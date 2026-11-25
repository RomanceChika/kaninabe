/**
 * 用語の台帳のスキーマ適合(M11)のユニットテスト。
 *
 * 規約網羅(term-ledger-writing.md §1 行が宣言すること):
 *   - 正しい台帳が読めること
 *   - id が term-ledger 固定であること
 *   - 必須キー(term / id / gloss / origin / first / face)が揃うこと・未知キーは弾くこと
 *   - origin / face が値域にあること・id がスネークケースで一意・term が一意
 *   - avoid が文字列のリストで、自分の term や他の語の term を禁じていないこと
 *   - first が相対パスであること
 *   - not(この語を使わない用法)は 1 行の文字列(空・複数行・文字列でなければ弾く)
 *   - gloss は 1 文(句点で区切られた文が 2 つ以上なら弾く。宣言は落とさない)
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseTermLedger } from '../../../../lib/model/terms/parse-terms.js';

/** 1 行分の正しい語の宣言。 */
const ROW = {
  term: 'fixture',
  id: 'fixture',
  gloss: 'テストが使う固定の入力',
  origin: 'english',
  first: 'docs/rules/a.md',
  face: 'framework',
  avoid: ['固定物'],
};

/** フロントマター相当のマッピングを組み立てる。 */
function frontmatter(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { doc_type: 'term_ledger', scope: 'common', id: 'term-ledger', terms: [ROW], ...overrides };
}

/** パースして (台帳, 違反) を返す。 */
function parse(data: Readonly<Record<string, unknown>>) {
  return parseTermLedger(data, new SpecReporter('docs/specs/terms.md'));
}

describe('M11: 用語の台帳のパース', () => {
  it('正しい台帳を読める(avoid は省略してよい)', () => {
    const { value, findings } = parse(
      frontmatter({ terms: [ROW, { ...ROW, term: '窓', id: 'window', avoid: undefined }] }),
    );

    expect(findings).toEqual([]);
    expect(value?.terms).toHaveLength(2);
    expect(value?.terms[0]).toMatchObject({ term: 'fixture', origin: 'english', face: 'framework', avoid: ['固定物'] });
    expect(value?.terms[1]?.avoid).toEqual([]);
  });

  it('id が term-ledger でなければ error', () => {
    const { findings } = parse(frontmatter({ id: 'terms' }));

    expect(findings.some((f) => f.message.includes('台帳の id ではありません'))).toBe(true);
  });

  it('doc_type が term_ledger でなければ error', () => {
    const { findings } = parse(frontmatter({ doc_type: 'spec' }));

    expect(findings.length).toBeGreaterThan(0);
  });

  it('terms が無ければ error', () => {
    const { findings } = parse({ doc_type: 'term_ledger', scope: 'common', id: 'term-ledger' });

    expect(findings.some((f) => f.message.includes('terms がありません'))).toBe(true);
  });

  it.each(['term', 'id', 'gloss', 'origin', 'first', 'face'])('必須キー %s が無ければ error', (key) => {
    const row: Record<string, unknown> = { ...ROW };
    delete row[key];

    const { findings } = parse(frontmatter({ terms: [row] }));

    expect(findings.some((f) => f.message.includes(`${key} がありません`))).toBe(true);
  });

  it('未知のキーは弾く(綴り違いが黙って無視されない)', () => {
    const { findings } = parse(frontmatter({ terms: [{ ...ROW, aliases: ['x'] }] }));

    expect(findings.some((f) => f.message.includes('aliases は書けません'))).toBe(true);
  });

  it('origin が値域に無ければ error', () => {
    const { findings } = parse(frontmatter({ terms: [{ ...ROW, origin: 'invented' }] }));

    expect(findings.some((f) => f.message.includes('origin invented は値域'))).toBe(true);
  });

  it('face が値域に無ければ error', () => {
    const { findings } = parse(frontmatter({ terms: [{ ...ROW, face: 'reader' }] }));

    expect(findings.some((f) => f.message.includes('face reader は値域'))).toBe(true);
  });

  it('id がスネークケースでなければ error', () => {
    const { findings } = parse(frontmatter({ terms: [{ ...ROW, id: 'Closed World' }] }));

    expect(findings.some((f) => f.message.includes('スネークケースではありません'))).toBe(true);
  });

  it('id が重複すれば error', () => {
    const { findings } = parse(frontmatter({ terms: [ROW, { ...ROW, term: '別の語', avoid: [] }] }));

    expect(findings.some((f) => f.message.includes('id fixture が重複'))).toBe(true);
  });

  it('term が重複すれば error', () => {
    const { findings } = parse(frontmatter({ terms: [ROW, { ...ROW, id: 'other', avoid: [] }] }));

    expect(findings.some((f) => f.message.includes('term fixture が重複'))).toBe(true);
  });

  it('first が絶対パス・親ディレクトリ参照なら error', () => {
    const absolute = parse(frontmatter({ terms: [{ ...ROW, first: '/docs/a.md' }] }));
    const parent = parse(frontmatter({ terms: [{ ...ROW, first: '../a.md' }] }));

    expect(absolute.findings.some((f) => f.message.includes('リポジトリルートからの相対パス'))).toBe(true);
    expect(parent.findings.some((f) => f.message.includes('リポジトリルートからの相対パス'))).toBe(true);
  });

  it('avoid が文字列のリストでなければ error', () => {
    const { findings } = parse(frontmatter({ terms: [{ ...ROW, avoid: '固定物' }] }));

    expect(findings.length).toBeGreaterThan(0);
  });

  it('avoid に自分の term を挙げたら error(使う語と禁じる語が同じ)', () => {
    const { findings } = parse(frontmatter({ terms: [{ ...ROW, avoid: ['fixture'] }] }));

    expect(findings.some((f) => f.message.includes('自分の term'))).toBe(true);
  });

  it('avoid に他の語の term を挙げたら error(台帳が自分で矛盾している)', () => {
    const other = { ...ROW, term: '窓', id: 'window', avoid: [] };
    const { findings } = parse(frontmatter({ terms: [{ ...ROW, avoid: ['窓'] }, other] }));

    expect(findings.some((f) => f.message.includes('別の語の term'))).toBe(true);
  });

  it('avoid の綴りが空なら error・重複は 1 つにする', () => {
    const empty = parse(frontmatter({ terms: [{ ...ROW, avoid: [''] }] }));
    const dup = parse(frontmatter({ terms: [{ ...ROW, avoid: ['固定物', '固定物'] }] }));

    expect(empty.findings.length).toBeGreaterThan(0);
    expect(dup.value?.terms[0]?.avoid).toEqual(['固定物']);
  });

  it('要素がマッピングでなければ error(残りの要素は読む)', () => {
    const { value, findings } = parse(frontmatter({ terms: ['文字列', ROW] }));

    expect(findings.length).toBeGreaterThan(0);
    expect(value?.terms).toHaveLength(1);
  });
});

describe('M11: not(この語を使わない用法)', () => {
  it('not は 1 行の文字列として読める(省略すれば null)', () => {
    const { value, findings } = parse(
      frontmatter({ terms: [{ ...ROW, not: 'samples:db などの通し実行はこの語で呼ばない' }, { ...ROW, term: '窓', id: 'window' }] }),
    );

    expect(findings).toEqual([]);
    expect(value?.terms[0]?.not).toBe('samples:db などの通し実行はこの語で呼ばない');
    expect(value?.terms[1]?.not).toBeNull();
  });

  it('not が空・複数行・文字列でなければ error', () => {
    const blank = parse(frontmatter({ terms: [{ ...ROW, not: '  ' }] }));
    const multi = parse(frontmatter({ terms: [{ ...ROW, not: '1 行目\n2 行目' }] }));
    const list = parse(frontmatter({ terms: [{ ...ROW, not: ['a'] }] }));

    expect(blank.findings.some((f) => f.message.includes('not が空です'))).toBe(true);
    expect(multi.findings.some((f) => f.message.includes('not が複数行です'))).toBe(true);
    expect(list.findings.length).toBeGreaterThan(0);
  });
});

describe('M11: gloss は 1 文', () => {
  it('末尾に句点が 1 つあるだけの 1 文は通る(句点の無い 1 文も通る)', () => {
    const one = parse(frontmatter({ terms: [{ ...ROW, gloss: '固定した入力の一式。' }] }));
    const none = parse(frontmatter({ terms: [{ ...ROW, gloss: '固定した入力の一式' }] }));

    expect(one.findings).toEqual([]);
    expect(none.findings).toEqual([]);
  });

  it('句点で区切られた 2 文は error(文の数と直し方を載せる)。宣言は落とさない', () => {
    const { value, findings } = parse(frontmatter({ terms: [{ ...ROW, gloss: '固定した入力の一式。使わない語もある' }] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('gloss が 2 文です');
    expect(findings[0]?.suggestion).toContain('not');
    expect(findings[0]?.location?.pointer).toBe('terms[0].gloss');
    expect(value?.terms).toHaveLength(1);
  });

  it('3 文なら 3 文と数える(間の空文や末尾の句点は数えない)', () => {
    const { findings } = parse(frontmatter({ terms: [{ ...ROW, gloss: 'A。B。。C。' }] }));

    expect(findings[0]?.message).toContain('gloss が 3 文です');
  });
});
