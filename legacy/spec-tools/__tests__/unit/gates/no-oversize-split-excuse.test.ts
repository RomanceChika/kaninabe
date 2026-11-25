import { describe, expect, it } from 'vitest';
import { splitExcuses } from '../../helpers/split-excuse.js';

describe('わざと壊す確認: 行数を理由にした分割の説明を捕る', () => {
  it('「境界に意味は無い」型を捕る(`/** */` も行コメントも。import のあとの見出しも)', () => {
    expect(splitExcuses('/**\n * `a.ts` の続きであり、境界に意味は無い(1 ファイル 300 行の制限)。\n */\nexport const x = 1;')).toHaveLength(1);
    expect(splitExcuses("// 分けてあるのは行数制限のためで、責務は同じである。\nexport const x = 1;")).toHaveLength(1);
    expect(splitExcuses("import { a } from './a.js';\n\n/**\n * `a.ts` から切り出したのは 1 ファイル 300 行の都合である。\n */\nexport const x = a;")).toHaveLength(1);
  });

  it('「境界に意味は無い」という断定は、行数の語が同じ文に無くても捕る(仕様上・設計上・意味論)', () => {
    expect(splitExcuses('/**\n * 境界に仕様上の意味は無い。\n */\nexport const x = 1;')).toHaveLength(1);
    expect(splitExcuses('/**\n * 境界に設計上の意味は無い。\n */\nexport const x = 1;')).toHaveLength(1);
    expect(splitExcuses('/**\n * 境界に意味論は無い(入口は a.ts)。\n */\nexport const x = 1;')).toHaveLength(1);
    expect(splitExcuses('/**\n * 境界には意味がある —— 判定と字面である。\n */\nexport const x = 1;')).toEqual([]);
  });

  it('見出しでなくても、途中の節のコメントも見る(コードの後ろの行コメント・ブロックコメント)', () => {
    expect(splitExcuses('export const x = 1;\n// 型は b.ts に分けてある(1 ファイル 300 行の制限)。\nexport type * from "./b.js";\n')).toHaveLength(1);
    expect(splitExcuses('export const x = 1;\n/** 入口は 1 つ。分けたのは 1 ファイル 300 行の上限に当たったため。 */\nexport const y = 2;\n')).toHaveLength(1);
  });

  it('自然な言い換えも捕る(行数の上限・行数上限・超過・サイズの都合・肥大化・長くなった)(束 C3)', () => {
    const excuses = [
      '行数の上限のために分離した。',
      '行数上限に当たったので切り出した。',
      '行数超過のため別ファイルにした。',
      '行数の関係で分けてある。',
      'サイズの都合で別ファイルに移した。',
      'ファイルサイズを抑えるために分割した。',
      '肥大化を避けるため切り出した。',
      '長くなったので分けた。',
      'ファイルが大きくなりすぎたため割った。',
      '300 行に収めるために分離した。',
      '300 行以内にするため別ファイルにした。',
    ];
    for (const excuse of excuses) expect(splitExcuses(`/**\n * ${excuse}\n */\nexport const x = 1;`), excuse).toHaveLength(1);
  });

  it('`max-lines` は綴りが一致するときだけ捕る(`max-lines-per-function` などの別の規則名は捕らない)', () => {
    expect(splitExcuses('// max-lines のために分離した。\nexport const x = 1;')).toHaveLength(1);
    expect(splitExcuses('// max-lines-per-function を避けて分離した。\nexport const x = 1;')).toEqual([]);
    expect(splitExcuses('// max-lines-per-function は別の規則なので、関数ごとに分けて書く。\nexport const x = 1;')).toEqual([]);
  });

  it('行数を指す語だけの文・分割を指す語だけの文は通す(別の意味の「行数」)', () => {
    expect(splitExcuses('/**\n * 依存の向きが行数より先である。ここは写像を集める。\n * `a.ts` から責務で分けた。\n */\nexport const x = 1;')).toEqual([]);
    expect(splitExcuses('// includes の limit には併読する行数の上限を書く\nexport const x = 1;')).toEqual([]);
  });

  it('責務の説明・宣言の説明は通す', () => {
    expect(splitExcuses('/**\n * 判定だけを持つ。字面は `b.ts` が持つ(判定と字面で責務が分かれる)。\n */\nexport const x = 1;')).toEqual([]);
    expect(splitExcuses('/**\n * 1 つの表の全規則を並べる。\n * @oversize 超える理由: 全規則を 1 か所で見せるため。\n */\nexport const x = 1;')).toEqual([]);
    expect(splitExcuses('/**\n * 300 行は信号であって上限ではない。超えるなら宣言を書く。\n */\nexport const x = 1;')).toEqual([]);
  });
});
