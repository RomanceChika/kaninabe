/**
 * 生成物の骨格を取り出す道具(`__tests__/helpers/output-skeleton.ts`)が、注入を見逃さないことの確認。
 * 道具が常に同じ骨格を返す(= taint テストが何も見ていない)状態で緑にならないようにする。
 */

import { describe, expect, it } from 'vitest';
import { cssSkeleton, sqlSkeleton, typeScriptSkeleton } from '../../helpers/output-skeleton.js';

describe('typeScriptSkeleton', () => {
  it('コメントと文字列の中身は骨格に入らない', () => {
    expect(typeScriptSkeleton("/** a */ export const x = 'a';")).toEqual(typeScriptSkeleton("/** b b b */ export const x = 'zzz';"));
  });

  it('コメントを破って足された文は骨格に出る', () => {
    expect(typeScriptSkeleton("/** */ globalThis.X = 1; /* */ export const x = 'a';")).not.toEqual(typeScriptSkeleton("/** */ export const x = 'a';"));
  });

  it('文字列を破って足された式は骨格に出る', () => {
    expect(typeScriptSkeleton("export const x = 'a'; evil(); '';")).not.toEqual(typeScriptSkeleton("export const x = 'a';"));
  });
});

describe('sqlSkeleton', () => {
  it('コメントと文字列の中身は骨格に入らない', () => {
    expect(sqlSkeleton("-- a\nselect 'a';")).toEqual(sqlSkeleton("-- b b\nselect 'it''s';"));
  });

  it('コメントの次の行に足された文は骨格に出る', () => {
    expect(sqlSkeleton("-- a\ndrop table t;\nselect 1;")).not.toEqual(sqlSkeleton('-- a\nselect 1;'));
  });

  it('本文を早く閉じる `$$` は骨格に出る', () => {
    expect(sqlSkeleton("as $$ select '$$ '; $$;")).not.toEqual(sqlSkeleton("as $$ select 'x'; $$;"));
  });
});

describe('cssSkeleton', () => {
  it('コメントの外に出たルールは骨格に出る', () => {
    expect(cssSkeleton(':root { --a: 1; /* x */ }')).not.toEqual(cssSkeleton(':root { --a: 1; } body{display:none}'));
    expect(cssSkeleton(':root { --a: 1; /* x */ }')).toEqual(cssSkeleton(':root { --a: 1; /* y y */ }'));
  });
});
