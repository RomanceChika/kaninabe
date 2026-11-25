/**
 * 人向けの表示のタグの部品(face-html)のテスト。ラベルの語は 17 語の値域、読み方の印は 4 種、
 * ラベル行・箇条・折りたたみは 1 行 1 ブロック(空行を含まない)。
 */

import { describe, expect, it } from 'vitest';
import {
  esc,
  FACE_LABELS,
  fold,
  HANDS_HEADING,
  kv,
  kvs,
  mark,
  MARK_WORDS,
  oneLine,
  pill,
  prose,
  pts,
  valueOf,
} from '../../../../../lib/generate/render/book/face-html.js';
import { serializeJsonAttr } from '../../../../../lib/kernel/trusted-html.js';

describe('ラベルの語(17 語の値域)', () => {
  it('ちょうど 17 語(15 語に束 ⑧-a2 で 2 語を足した)で、重複が無く、見出しラベルは別の 1 語', () => {
    expect(FACE_LABELS).toHaveLength(17);
    expect(new Set(FACE_LABELS).size).toBe(17);
    expect(FACE_LABELS).toEqual(
      expect.arrayContaining(['主語', '決まること', '例外', '守らせる場所', '原本', '誰が', 'どこへ', '条件', '遷移ガード', '関係する公理', 'いつ', '状態', '形式', '仕様の語', '出どころ', '補足', '例']),
    );
    expect((FACE_LABELS as readonly string[]).includes(HANDS_HEADING)).toBe(false);
  });

  it('読み方の印は 4 種で、それぞれ別の語', () => {
    expect(Object.keys(MARK_WORDS).sort()).toEqual(['acceptance', 'axiom', 'changed', 'derive']);
    expect(new Set(Object.values(MARK_WORDS)).size).toBe(4);
    expect(mark('axiom')).toBe('<span class="bf-mark bf-mark--axiom">必読</span>');
  });
});

describe('書き出しの安全と形', () => {
  it('HTML の記号とテンプレートの波括弧は実体参照にする', () => {
    expect(esc('a < b & "c" {{x}}')).toBe('a &lt; b &amp; &quot;c&quot; &#123;&#123;x&#125;&#125;');
  });

  it('改行は 1 つの空白に詰める(HTML ブロックに空行を入れない)', () => {
    expect(oneLine('一行目\n\n  二行目')).toBe('一行目 二行目');
    expect(kv('補足', esc(oneLine('a\n\nb')))).not.toMatch(/\n/);
  });

  it('JSON の属性は読める形のまま、シングルクォートとアンパサンドだけを実体参照にする', () => {
    const value = [{ id: 'a', label: "it's & more" }];

    expect(serializeJsonAttr(value)).toBe('[{"id":"a","label":"it&#39;s &amp; more"}]');
  });

  it('箇条・ラベル行・群は 1 行 1 ブロック。値が 1 つなら箇条にしない。行が無い群は空', () => {
    expect(pts(['a', 'b'])).toBe('<ul class="bf-pts"><li>a</li><li>b</li></ul>');
    expect(pts(['a'], true)).toContain('bf-blk');
    expect(valueOf(['a'])).toBe('a');
    expect(valueOf(['a', 'b'])).toBe(pts(['a', 'b']));
    expect(kvs([])).toBe('');
    expect(kvs([kv('誰が', '世話役')])).toBe('<div class="bf-kvs"><div class="bf-kv"><div class="bf-k">誰が</div><div class="bf-v">世話役</div></div></div>');
  });

  it('文章は値が無ければ「(まだ書かれていない)」。ピルは悪い知らせだけ別の型', () => {
    expect(prose(undefined)).toContain('(まだ書かれていない)');
    expect(prose('世話役が立てます。', true)).toBe('<p class="bf-prose bf-lede">世話役が立てます。</p>');
    expect(pill('draft', false)).toBe('<span class="bf-pill">draft</span>');
    expect(pill('cancelled', true)).toContain('bf-pill--negative');
  });
});

describe('部品のタグ', () => {
  it('折りたたみは見出しの文字を実体参照にし、中身が無ければ何も出さない', () => {
    expect(fold({ kind: 'table', title: '表 <x>', count: 3, hint: '一言', open: true }, ['本文'])).toEqual([
      '<Fold kind="table" title="表 &lt;x&gt;" count="3" hint="一言" open>',
      '本文',
      '</Fold>',
    ]);
    expect(fold({ kind: 'detail', title: '空' }, [])).toEqual([]);
  });
});
