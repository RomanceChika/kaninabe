/**
 * M7(台帳の各行の `first` = 初出に、その語が実在する)の規約網羅テスト。
 *
 * 対象の要求(book-human-face.md §4「検査」・term-ledger-writing.md):
 *   - `first` のファイルが無ければ error(死んだ初出)
 *   - `first` のファイルに語が無ければ error(語を導入していない文書を初出にしている)
 *   - 語が実在すれば通る
 *   - 英語のまま使う語(`origin: english`)は、初出の行か直後の行に **印つきの 1 行説明**
 *     (`<!-- term: {id} -->`)が要る(ユーザー原則「初出に 1 行説明」)。日本語の語は要らない
 */

import { describe, expect, it } from 'vitest';
import { verifyFirstExists } from '../../../../lib/terms/verifiers/m7-first-exists.js';
import { corpus, ledger, term } from '../../../helpers/terms-builder.js';

describe('M7 初出に語が実在する', () => {
  it('first のファイルに語が書かれていれば通る', () => {
    const findings = verifyFirstExists(
      ledger([term('注釈', { first: 'docs/rules/a.md' })]),
      corpus([], { 'docs/rules/a.md': '`@spec` と `@tc` の注釈を付ける' }),
    );

    expect(findings).toEqual([]);
  });

  it('first のファイルが読めなければ error', () => {
    const findings = verifyFirstExists(
      ledger([term('注釈', { id: 'tag', first: 'docs/rules/gone.md' })]),
      corpus([], { 'docs/rules/gone.md': null }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verifier).toBe('M7');
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('初出の文書が実在しません');
    expect(findings[0]?.location.pointer).toBe('terms.tag.first');
    expect(findings[0]?.counterexample).toEqual({ term: '注釈', first: 'docs/rules/gone.md' });
  });

  it('first のファイルが走査入力に無いときも「実在しない」と同じに扱う(読み込み漏れを緑にしない)', () => {
    const findings = verifyFirstExists(ledger([term('注釈', { first: 'docs/rules/unread.md' })]), corpus([]));

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('初出の文書が実在しません');
  });

  it('first のファイルに語が書かれていなければ error', () => {
    const findings = verifyFirstExists(
      ledger([term('注釈', { id: 'tag', first: 'docs/rules/a.md' })]),
      corpus([], { 'docs/rules/a.md': 'この文書は別の話をしている' }),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain('初出の文書に語が書かれていません');
    expect(findings[0]?.suggestion).toContain('first');
  });

  it('語ごとに判定する(1 語が壊れても他の語の指摘は消えない)', () => {
    const findings = verifyFirstExists(
      ledger([term('注釈', { id: 'tag', first: 'a.md' }), term('窓', { id: 'window', first: 'b.md' })]),
      corpus([], { 'a.md': '注釈', 'b.md': '別の話' }),
    );

    expect(findings.map((finding) => finding.location.pointer)).toEqual(['terms.window.first']);
  });

  describe('英語のまま使う語の初出の 1 行説明(印)', () => {
    const english = (first: string) => term('fixture', { id: 'fixture', origin: 'english', first });

    it('初出の行に印つきの説明があれば通る', () => {
      const text = ['# 規約', '', '`fixture` は固定した題材の一式である。<!-- term: fixture -->', '', '`fixture` を使う。'].join('\n');

      expect(verifyFirstExists(ledger([english('a.md')]), corpus([], { 'a.md': text }))).toEqual([]);
    });

    it('初出の直後の行(次の空でない行)に印つきの説明があっても通る', () => {
      const text = ['# `fixture` の書き方', '', '`fixture` は固定した題材の一式である。<!-- term: fixture -->'].join('\n');

      expect(verifyFirstExists(ledger([english('a.md')]), corpus([], { 'a.md': text }))).toEqual([]);
    });

    it('印が無ければ error(語は書かれていても説明が無い)', () => {
      const findings = verifyFirstExists(
        ledger([english('a.md')]),
        corpus([], { 'a.md': '`fixture` を使う。説明はどこにも無い' }),
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]?.verifier).toBe('M7');
      expect(findings[0]?.severity).toBe('error');
      expect(findings[0]?.message).toContain('初出の 1 行説明');
      expect(findings[0]?.message).toContain('<!-- term: fixture -->');
      expect(findings[0]?.location.pointer).toBe('terms.fixture.first');
    });

    it('印の行に語の綴りが無ければ error(説明は印と同じ行に書く)', () => {
      const text = ['`fixture` を使う。', '', '固定した題材の一式である。<!-- term: fixture -->'].join('\n');
      const findings = verifyFirstExists(ledger([english('a.md')]), corpus([], { 'a.md': text }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('印の行に語が書かれていません');
    });

    it('語の初出より後に説明があれば error(初出の説明にならない)', () => {
      const text = [
        '`fixture` を使う。',
        '',
        '別の話をしている。',
        '',
        '`fixture` は固定した題材の一式である。<!-- term: fixture -->',
      ].join('\n');
      const findings = verifyFirstExists(ledger([english('a.md')]), corpus([], { 'a.md': text }));

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('初出より後');
    });

    it('別の語の印では通らない(id が一致しなければ無いのと同じ)', () => {
      const text = '`fixture` は固定した題材の一式である。<!-- term: world -->';
      const findings = verifyFirstExists(ledger([english('a.md')]), corpus([], { 'a.md': text }));

      expect(findings).toHaveLength(1);
    });

    it('日本語の語(english 以外)は印が要らない', () => {
      const findings = verifyFirstExists(
        ledger([term('注釈', { id: 'tag', origin: 'coined', first: 'a.md' })]),
        corpus([], { 'a.md': '注釈を付ける' }),
      );

      expect(findings).toEqual([]);
    });
  });
});
