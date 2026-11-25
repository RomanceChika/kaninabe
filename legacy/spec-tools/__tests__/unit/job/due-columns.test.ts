/**
 * 期限の比較の列名を構文木で集める純粋関数(`due-columns.ts`)のユニットテスト。
 *
 * 肝は「**期限の比較の呼び出しの第 1 引数**だけを数える」ことで、同じ綴りが別の目的(別の比較・並べ替え・
 * 選ぶ列の一覧・型の位置)に現れても数えない。綴りだけを数えると、`due_from` を「まだ始まっていない」を
 * 外す列に書き換えても接地が通ってしまう(網の穴探し 2026-10-06 の M04)。
 */

import { describe, expect, it } from 'vitest';
import { dueComparedColumns } from '../../../lib/job/due-columns.js';

/** 列名の集合を並びで返す。 */
function columnsOf(source: string): readonly string[] {
  return [...dueComparedColumns('reader.ts', source)].sort();
}

describe('dueComparedColumns', () => {
  it('lte / lt の第 1 引数の文字列リテラルを集める', () => {
    expect(columnsOf("q.lte('due_at', now).lt('closes_at', now);")).toEqual(['closes_at', 'due_at']);
  });

  it('同じ綴りでも gt や order や select の中のものは数えない', () => {
    const source = "q.select('id, due_at').gt('starts_at', now).order('due_at', { ascending: true }).eq('due_at', 1);";

    expect(columnsOf(source)).toEqual([]);
  });

  it('テンプレートリテラル(置換なし)も文字列リテラルとして数える', () => {
    expect(columnsOf('q.lte(`due_at`, now);')).toEqual(['due_at']);
  });

  it('列名を変数から引く形は数えない(リテラルがその場に無い)', () => {
    expect(columnsOf('const COLUMN = "due_at"; q.lte(COLUMN, now);')).toEqual([]);
  });

  it('メンバ呼び出しでない lte(単独の関数)や引数の無い呼び出しは数えない', () => {
    expect(columnsOf("lte('due_at', now); q.lte();")).toEqual([]);
  });

  it('型の位置の文字列リテラルや、入れ子の呼び出しの中の比較も拾う(構文木をすべて辿る)', () => {
    const source = "type Col = 'ignored_at'; async function f() { return await wrap(() => q.lte('nested_at', now)); }";

    expect(columnsOf(source)).toEqual(['nested_at']);
  });
});
