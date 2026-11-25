/**
 * 宣言リストの共通ローダー(lib/model/decl-list.ts)のテスト。
 *
 * A4 の `unhandled`・S10 の `unexposed` はこの 1 つの読み方を共有する(U 群の受け入れは `ux:` へ移り、screen_spec の中で読むのでここを通らない)。
 * ここが見るのは**規則そのもの**(識別子の決め方・空値・欠落・型不正・キーの不在・綴り違いの
 * キー)であり、各群の語彙(どのキーをどう解釈するか)は各ローダーのテストが持つ。
 *
 * 各フィクスチャは基本的に**そのテストが渡す specs とキーの全体が一致する**ように分けてある
 * (`good` / `blank` のように 1 キーずつ)。呼び出し側(readCoverageDecls・readGuideDecls)は
 * 1 回の呼び出しでその README が持つ全キーを渡す実装になっており、ここも同じ前提を守らないと
 * 「渡さなかったキー」が(このテストにとっては)綴り違いの未知キーとして誤検出されてしまう。
 * 複数キーを同時に扱う挙動だけは 1 つのフィクスチャ(`decls`)にまとめて確かめる。
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { declValue, readDeclLists, type DeclListSpec } from '../../../lib/model/decl-list.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures');

/** 指定ディレクトリの README を、渡した宣言で読む。 */
function read(specs: readonly DeclListSpec[], dir: string) {
  const absolute = path.join(FIXTURES, dir, 'README.md');
  return readDeclLists({ absolute, file: `fixtures/${dir}/README.md`, verifierId: 'X0', specs });
}

const GOOD: DeclListSpec = { key: 'good', fields: ['event', 'reason'], suggestion: 'good を直す' };
const TRIPLE: DeclListSpec = {
  key: 'triple',
  fields: ['check', 'subject', 'reason'],
  suggestion: 'triple を直す',
  identify: (values) => `${values['check'] ?? ''}.${values['subject'] ?? ''}`,
};
const BLANK: DeclListSpec = { key: 'blank', fields: ['event', 'reason'], suggestion: 'blank を直す' };
const MISSING: DeclListSpec = { key: 'missing', fields: ['event', 'reason'], suggestion: 'missing を直す' };
const NOT_A_LIST: DeclListSpec = { key: 'not_a_list', fields: ['event'], suggestion: 'not_a_list を直す' };

describe('宣言リストの共通ローダー', () => {
  it('2 フィールドの宣言を読み、識別子で位置を作る', () => {
    const result = read([GOOD], 'decls-good');

    expect(result.findings).toEqual([]);
    const decls = result.decls.get('good') ?? [];
    expect(decls).toHaveLength(1);
    expect(declValue(decls[0]!, 'event')).toBe('a.one');
    expect(declValue(decls[0]!, 'reason')).toBe('理由が書いてある');
    expect(decls[0]?.location).toEqual({ file: 'fixtures/decls-good/README.md', pointer: 'good.a.one' });
  });

  it('3 フィールドの宣言と、識別子の作り方の差し替えを扱える', () => {
    const result = read([TRIPLE], 'decls-triple');

    expect(result.findings).toEqual([]);
    expect(result.decls.get('triple')?.[0]?.location.pointer).toBe('triple.U1.screen-x/a.one');
  });

  it('値が空の宣言は違反にし、宣言としては採らない', () => {
    const result = read([BLANK], 'decls-blank');

    expect(result.decls.get('blank')).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toBe('a.two の reason が空です');
    expect(result.findings[0]?.suggestion).toBe('a.two の reason を書く');
    expect(result.findings[0]?.verifier).toBe('X0');
  });

  it('空値の直し方は宣言ごとに差し替えられる', () => {
    const result = read(
      [{ ...BLANK, emptySuggestion: (id, field) => `${id} の ${field} を日本語で書く` }],
      'decls-blank',
    );

    expect(result.findings[0]?.suggestion).toBe('a.two の reason を日本語で書く');
  });

  it('フィールドの欠落を違反にする', () => {
    const result = read([MISSING], 'decls-missing');

    expect(result.decls.get('missing')).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('reason がありません');
  });

  it('リストで書かれていないキーを違反にする', () => {
    const result = read([NOT_A_LIST], 'decls-not-a-list');

    expect(result.decls.get('not_a_list')).toEqual([]);
    expect(result.findings[0]?.message).toContain('リストで書きます');
  });

  it('キーが無いのは正常(宣言なし)', () => {
    const result = read([{ key: 'absent', fields: ['event'], suggestion: 'absent を直す' }], 'decls-empty');

    expect(result.findings).toEqual([]);
    expect(result.decls.get('absent')).toEqual([]);
  });

  it('README が無いディレクトリでも黙って空になる', () => {
    const result = read([GOOD], 'app-routes');

    expect(result.findings).toEqual([]);
    expect(result.decls.get('good')).toEqual([]);
  });

  it('複数のキーを 1 回の読み取りで扱える(宣言順に違反が並ぶ)', () => {
    const result = read([GOOD, BLANK, MISSING], 'decls');

    expect(result.decls.get('good')).toHaveLength(1);
    expect(result.findings.map((finding) => finding.location.pointer)).toEqual([
      'blank.a.two',
      'missing[0].reason',
    ]);
  });

  describe('綴り違いのキー(allowlist)', () => {
    it('宣言していないキーが README にあれば違反にする(「宣言なし」として黙らせない)', () => {
      // `unexposd:` は `unexposed` の綴り違い。渡した specs のどのキーにも一致しないので、
      // 差分読み(record[spec.key] === undefined)だけでは「宣言なし」として黙って通っていた。
      const result = read(
        [{ key: 'unexposed', fields: ['event', 'reason'], suggestion: 'unexposed を直す' }],
        'decls-typo',
      );

      expect(result.decls.get('unexposed')).toEqual([]);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.message).toBe('README のフロントマター に unexposd は書けません');
      expect(result.findings[0]?.suggestion).toContain('unexposed');
      expect(result.findings[0]?.verifier).toBe('X0');
    });

    it('共通 frontmatter キー(doc_type / scope 等)は違反にしない', () => {
      const result = read([GOOD], 'decls-good');

      expect(result.findings).toEqual([]);
    });
  });
});
