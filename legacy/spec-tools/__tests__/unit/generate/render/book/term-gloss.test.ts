/**
 * 台帳の語釈(`{例}` の差し込み)のテスト。表紙の表と `<Term>` の辞書が同じ語釈を使う。
 */

import { describe, expect, it } from 'vitest';
import { termGloss } from '../../../../../lib/generate/render/book/term-gloss.js';
import { bookModel } from '../../../../helpers/book-fixture.js';
import { specModel } from '../../../../helpers/model-builder.js';
import { term } from '../../../../helpers/terms-builder.js';

describe('termGloss', () => {
  it('`{例}` は、その語の例を仕様の宣言から採って差し込む(状態機械は最も状態の多い機械の先頭 3 つまで)', () => {
    const gloss = termGloss(term('状態機械', { id: 'state_machine', gloss: 'ライフサイクル{例}で、矢印に無い移動はできない' }), bookModel());

    expect(gloss).toBe('ライフサイクル(例: 下書き → 受付中)で、矢印に無い移動はできない');
  });

  it('文脈依存ロールの例は宣言から採る', () => {
    expect(termGloss(term('ロール', { id: 'role', gloss: '誰が{例}。' }), bookModel())).toBe('誰が(例: そのorganizer)。');
  });

  it('宣言から例が採れない語は `{例}` が消える。例の差し込み先を持たない語はそのまま', () => {
    expect(termGloss(term('ロール', { id: 'role', gloss: '誰が{例}。' }), specModel([]))).toBe('誰が。');
    expect(termGloss(term('集約', { id: 'aggregate', gloss: '境界を 1 単位にしたもの' }), bookModel())).toBe('境界を 1 単位にしたもの');
  });
});
