/**
 * ハンドブックの例外の登録簿(`lib/kernel/trusted-html.ts`)の、**ページごと・生成の実行ごと**の切り出し。
 *
 * 登録は生成器ごとの記録から切り出して、その生成器が出すページの分だけを無害化に渡す(別のページで登録した文字列が、ここでは例外として通らない)。
 * 実行の始めに登録簿を空にする(前の実行の登録が残らない)。定数(読み込みのときの登録)だけは残る。
 */

import { describe, expect, it } from 'vitest';
import { currentTrusted, reportTrustedProblem, resetTrusted, serializeJsonAttr, sliceTrusted, trustConstant, trustJsonAttr, trustSnippet } from '../../../lib/kernel/trusted-html.js';

describe('登録簿のページごとの切り出し', () => {
  it('切り出しは、その位置以降の登録だけを持つ(前の生成器の登録は、別のページでは例外にならない)', () => {
    const registry = resetTrusted();
    trustSnippet('<div class="first-page">一つ目</div>');
    const from = registry.log.length;
    trustSnippet('<div class="second-page">二つ目</div>');
    trustJsonAttr(serializeJsonAttr([{ id: 'a' }]));

    const second = sliceTrusted(registry, from);

    expect([...second.snippets]).toEqual(['<div class="second-page">二つ目</div>']);
    expect(second.jsonAttrs.size).toBe(1);
    expect(sliceTrusted(registry, 0).snippets.size).toBe(2);
  });

  it('問題は全体で共有される(どのページの登録の不具合も、書き込みの出口が拾う)', () => {
    const registry = resetTrusted();
    const slice = sliceTrusted(registry, registry.log.length);

    reportTrustedProblem('見つけた食い違い');
    reportTrustedProblem('見つけた食い違い');

    expect(slice.problems).toEqual(['見つけた食い違い']);
    expect(registry.problems).toBe(slice.problems);
  });

  it('JSON の食い違いは登録のときに問題になる', () => {
    const registry = resetTrusted();

    trustJsonAttr('[1, 2]');
    trustJsonAttr('{"a":1}');

    expect(registry.problems).toHaveLength(2);
  });
});

describe('実行ごとの初期化', () => {
  it('resetTrusted は前の実行の登録を捨てる', () => {
    resetTrusted();
    trustSnippet('<span class="left-over">残り</span>');

    const fresh = resetTrusted();

    expect(fresh.snippets.has('<span class="left-over">残り</span>')).toBe(false);
    expect(fresh.log).toEqual([]);
    expect(currentTrusted()).toBe(fresh);
  });

  it('定数は初期化しても残り、切り出しにも入る', () => {
    const constant = trustConstant('<!-- この登録は定数 -->');

    const fresh = resetTrusted();

    expect(fresh.snippets.has(constant)).toBe(true);
    expect(sliceTrusted(fresh, 0).snippets.has(constant)).toBe(true);
  });

  it('短すぎる文字列は登録しない', () => {
    const registry = resetTrusted();

    trustSnippet('<b>x</b>');
    trustSnippet('<b>');

    expect(registry.log.map(([, value]) => value)).toEqual(['<b>x</b>']);
  });
});
