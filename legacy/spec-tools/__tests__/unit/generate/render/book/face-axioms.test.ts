/**
 * 公理の人向けの表示のテスト。原文は逐語で折りたたみに残り、本文は原文の文字の切り出し(言い換えない)。
 */

import { describe, expect, it } from 'vitest';
import { axiomBlocks, formalKind, splitStatement } from '../../../../../lib/generate/render/book/face-axioms.js';
import { noException } from '../../../../../lib/generate/render/book/face-html.js';
import { WORKSHOP_INVARIANTS, faceCtx, faceModel } from '../../../../helpers/face-fixture.js';

describe('splitStatement(原文を主文・例外・補足に割る。文字の切り出しだけ)', () => {
  it('括弧の外の文が主文、括弧の中が補足(`。` で割る)', () => {
    const split = splitStatement('受付締切(entry_deadline)は開演日時(starts_at)より前でなければならない');

    expect(split.main).toEqual(['受付締切は開演日時より前でなければならない']);
    expect(split.supplements).toEqual(['entry_deadline', 'starts_at']);
    expect(split.exceptions).toEqual([]);
  });

  it('「例外」「ただし」で始まる文は例外、全角の括弧も同じ', () => {
    const split = splitStatement('承認待ちは 0 件である（entry_deadline）。例外は中止された催しだけである。ただし再開は別である');

    expect(split.main).toEqual(['承認待ちは 0 件である']);
    expect(split.exceptions).toEqual(['例外は中止された催しだけである', 'ただし再開は別である']);
    expect(split.supplements).toEqual(['entry_deadline']);
  });

  it('括弧の中の但し書き(許容・「〜てよい」・除外)は、補足ではなく例外の候補にする', () => {
    const allowed = splitStatement('承認待ちは 0 件である(確定したあとに届いた依頼は残ってよい —— 口は開いている)');
    const tolerated = splitStatement('枠は上限を超えて増えない(引き下げで既存の超過が生じることは許容し、以後の受入が拒否される)');
    const excluded = splitStatement('全員が払う(世話役を除く)');

    expect(allowed.exceptions).toEqual(['確定したあとに届いた依頼は残ってよい —— 口は開いている']);
    expect(allowed.supplements).toEqual([]);
    expect(allowed.main).toEqual(['承認待ちは 0 件である']);
    expect(tolerated.exceptions).toEqual(['引き下げで既存の超過が生じることは許容し、以後の受入が拒否される']);
    expect(excluded.exceptions).toEqual(['世話役を除く']);
  });

  it('頭の節が「〜の場合は」「〜なければ」「〜ても」の文と、「除く」を含む文は例外の候補にする', () => {
    const split = splitStatement(
      '額は単価に等しい。確定時に誰も居なければ、単価は同額とする。確定後に直しても、額は戻らない。中止の場合は、額は払わない。世話役は除く',
    );

    expect(split.main).toEqual(['額は単価に等しい']);
    expect(split.exceptions).toEqual([
      '確定時に誰も居なければ、単価は同額とする',
      '確定後に直しても、額は戻らない',
      '中止の場合は、額は払わない',
      '世話役は除く',
    ]);
  });

  it('条件節でない文は、「ば」を含んでも主文のまま(頭の節だけを見る)', () => {
    expect(splitStatement('催しは、締切を過ぎれば受付を閉じる').main).toEqual(['催しは、締切を過ぎれば受付を閉じる']);
    expect(splitStatement('受付を締める。ばらつきは許さない').exceptions).toEqual([]);
  });

  it('文の途中の定義の括弧(「の」「な」で終わる)は、括弧ごと主文に残す。末尾の括弧は補足になる', () => {
    const split = splitStatement('催しのアクティブな（申込済み・確定済みの）枠は、上限を超えて増えない（capacity）');

    expect(split.main).toEqual(['催しのアクティブな（申込済み・確定済みの）枠は、上限を超えて増えない']);
    expect(split.supplements).toEqual(['capacity']);
    expect(split.exceptions).toEqual([]);
    // 半角の括弧は半角のまま残す(原文のとおり)。
    expect(splitStatement('催しのアクティブな(申込済みの)枠は増えない').main).toEqual(['催しのアクティブな(申込済みの)枠は増えない']);
  });

  it('全部が例外の候補でも、決まることを空にしない(原文をそのまま主文にも置く)', () => {
    const split = splitStatement('ただし再開は別である');

    expect(split.main).toEqual(['ただし再開は別である']);
    expect(split.exceptions).toEqual(['ただし再開は別である']);
  });

  it('入れ子の括弧は最上位の中身にそのまま残る', () => {
    expect(splitStatement('額は固定である(再計算しない(下げない))').supplements).toEqual(['再計算しない(下げない)']);
  });

  it('括弧の外が空なら原文をそのまま主文にする(落とさない)', () => {
    expect(splitStatement('(全部が括弧)').main).toEqual(['(全部が括弧)']);
  });

  it('改行は 1 つの空白に詰める', () => {
    expect(splitStatement('前半\n  後半です').main).toEqual(['前半 後半です']);
  });
});

describe('公理の「例外」欄(拾えなかったときは「無い」と断定しない)', () => {
  const model = faceModel();
  const ctx = faceCtx();

  it('例外の候補が無いときは「原文に例外の文は無い」と言い、補足があればそちらを見るよう促す', () => {
    const plain = { ...WORKSHOP_INVARIANTS[0]!, statement: 'a は b より前でなければならない' };
    const withSupplement = { ...WORKSHOP_INVARIANTS[0]!, statement: 'a(a_col)は b より前でなければならない' };

    expect(noException(false)).toBe('原文に例外の文は無い');
    expect(noException(true)).toBe('原文に例外の文は無い。補足を参照');
    expect(axiomBlocks([plain], null, model, ctx)[0]).toContain('原文に例外の文は無い</div>');
    expect(axiomBlocks([withSupplement], null, model, ctx)[0]).toContain('原文に例外の文は無い。補足を参照');
    expect(axiomBlocks([plain], null, model, ctx)[0]).not.toContain('宣言なし');
  });

  it('例外の候補があれば、例外の欄にその文が出る(括弧の中の但し書きも)', () => {
    const proviso = { ...WORKSHOP_INVARIANTS[0]!, statement: '承認待ちは 0 件である(確定後に届いた依頼は残ってよい)' };
    const block = axiomBlocks([proviso], null, model, ctx)[0];

    expect(block).toContain('<div class="bf-k">例外</div><div class="bf-v">確定後に届いた依頼は残ってよい</div>');
    expect(block).not.toContain('原文に例外の文は無い');
  });
});

describe('formalKind', () => {
  it('formal が無い公理は「式に写せない」', () => {
    expect(formalKind(undefined)).toBe('式に写せない');
    expect(formalKind({ kind: 'uniqueness', keys: ['a'] })).toContain('uniqueness');
  });
});

describe('axiomBlocks', () => {
  const model = faceModel();
  const ctx = faceCtx();

  it('公理 1 本は、行(読み方の印・ラベル行)と直下の原文の折りたたみになる。原文は逐語', () => {
    const [first] = WORKSHOP_INVARIANTS;
    const blocks = axiomBlocks([first!], null, model, ctx);

    expect(blocks[0]).toContain('INV-WORKSHOP-001');
    expect(blocks[0]).toContain('bf-mark--axiom');
    expect(blocks[1]).toBe('<Fold kind="orig" title="原文">');
    expect(blocks[2]).toBe(`<p class="bf-q">${first?.statement}</p>`);
    expect(blocks[3]).toBe('</Fold>');
  });

  it('範囲の中の公理の原本は「この章」、範囲の外は章へのリンク', () => {
    const [first] = WORKSHOP_INVARIANTS;
    const inside = axiomBlocks([first!], null, model, ctx)[0];
    const entry = model.aggregates.get('entry')!;
    const outside = axiomBlocks(entry.invariants!.invariants.slice(0, 1), entry, model, ctx)[0];

    expect(inside).toContain('この章');
    expect(outside).toContain('<a href="./entry.md">');
  });

  it('一意性は短い形で 1 行にまとめ、原文は本数つきで全部残す。読み方の印は必読のまま', () => {
    const part = model.aggregates.get('workshop_part')!;
    const blocks = axiomBlocks(part.invariants!.invariants, null, model, ctx);
    const text = blocks.join('\n');

    expect(blocks.filter((block) => block.startsWith('<div class="bf-axiom"'))).toHaveLength(2);
    expect(text).toContain('短い形');
    expect(text).toContain('INV-PART-002');
  });

  it('守らせる場所(enforced_by)は上段の行に出さない(下段の執行点の表へ)', () => {
    const text = axiomBlocks(WORKSHOP_INVARIANTS, null, model, ctx).join('\n');

    expect(text).not.toContain('守らせる場所');
    expect(text).not.toContain('assertNoRequested');
  });

  it('値は HTML として安全に出す(記号・括弧・波括弧)', () => {
    const odd = { ...WORKSHOP_INVARIANTS[0]!, statement: 'a < b であり {{x}} でもある' };
    const text = axiomBlocks([odd], null, model, ctx).join('\n');

    expect(text).toContain('a &lt; b');
    expect(text).not.toContain('{{x}}');
  });
});
