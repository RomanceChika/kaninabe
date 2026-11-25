/**
 * 実装 CSS のスコープ変換と読み取り(render/book/ui-css.ts)のテスト。
 *
 * 対象の要求: 「セレクタに見本コンテナを前置きし(html/body/:root はコンテナ自体に置き換え)、
 * `composes:` 行は落として合成元のセレクタ側で継ぐ。値には触れない。
 * クラス・要素ごとのトークン参照と composes を読み取る」。
 */

import { describe, expect, it } from 'vitest';

import { cssClassInfo, scopeCss, scopeSelectors } from '../../../../../lib/generate/render/book/ui-css.js';

describe('scopeSelectors', () => {
  it('通常のセレクタは前置きする(カンマ区切り・擬似クラス・属性つきも)', () => {
    expect(scopeSelectors('.card', '.demo')).toBe('.demo .card');
    expect(scopeSelectors('.a:hover, .b[open]', '.demo')).toBe('.demo .a:hover,\n.demo .b[open]');
    expect(scopeSelectors('button:disabled', '.demo')).toBe('.demo button:disabled');
  });

  it('html / body / :root はコンテナ自体に置き換える(前置きでは届かない)', () => {
    expect(scopeSelectors('body', '.demo')).toBe('.demo');
    expect(scopeSelectors('html, body', '.demo')).toBe('.demo,\n.demo');
    expect(scopeSelectors(':root', '.demo')).toBe('.demo');
  });
});

describe('scopeCss', () => {
  it('全ルールをスコープし、composes 行を落とし、値には触れない', () => {
    const css = [
      '/* コメントは落ちる */',
      '.td { padding: var(--space-3); }',
      '.tdNumeric {',
      '  composes: td;',
      '  text-align: right;',
      '}',
    ].join('\n');

    const scoped = scopeCss(css, '.demo');
    // composes は素の CSS には無い構文なので、合成元のセレクタ側に合成先を並べて意味を残す。
    expect(scoped).toContain('.demo .td,\n.demo .tdNumeric {\n  padding: var(--space-3);\n}');
    expect(scoped).toContain('.demo .tdNumeric {\n  text-align: right;\n}');
    expect(scoped).not.toContain('composes');
    expect(scoped).not.toContain('コメント');
  });

  it('継ぐのは先頭がそのクラスのセレクタだけ(別の要素を指す位置の同名は触らない)', () => {
    const css = [
      '.td:hover { color: red; }',
      '.card .td { margin: 0; }',
      '.tdNumeric { composes: td; text-align: right; }',
    ].join('\n');

    const scoped = scopeCss(css, '.demo');
    expect(scoped).toContain('.demo .td:hover,\n.demo .tdNumeric:hover {');
    // `.card .td` の `.td` は「card の中の td」であり、tdNumeric に置き換えると意味が変わる。
    expect(scoped).toContain('.demo .card .td {');
    expect(scoped).not.toContain('.card .tdNumeric');
  });
});

describe('cssClassInfo', () => {
  it('クラス・要素ごとの var(--…) 参照を宣言順・重複なしで集める(hover 等のルールもマージ)', () => {
    const css = [
      'button { min-height: var(--size-tap-min); color: var(--color-text); }',
      'button:hover { background: var(--color-surface-raised); color: var(--color-text); }',
      '.card { padding: var(--space-6); }',
    ].join('\n');

    const info = cssClassInfo(css);
    expect(info.get('button')?.tokens).toEqual(['--size-tap-min', '--color-text', '--color-surface-raised']);
    expect(info.get('card')?.tokens).toEqual(['--space-6']);
  });

  it('composes の継ぎ先を読み取る(見本マークアップが両方のクラスを書くための材料)', () => {
    const info = cssClassInfo('.tdNumeric { composes: td; text-align: right; }');

    expect(info.get('tdNumeric')?.composes).toEqual(['td']);
  });

  it('カンマ区切りのセレクタは各名前に同じ参照を割り付ける', () => {
    const info = cssClassInfo('.a, .b { gap: var(--space-2); }');

    expect(info.get('a')?.tokens).toEqual(['--space-2']);
    expect(info.get('b')?.tokens).toEqual(['--space-2']);
  });
});
