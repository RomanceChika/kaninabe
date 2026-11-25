/**
 * 語彙漏れ検査(W1)の走査(コメント除去・文字列リテラル抽出)のユニットテスト。
 *
 * 拾い方の正は scan.ts の doc コメント:
 *   - シングル/ダブル/テンプレートの文字列リテラルの中身を、クォートを除いて拾う
 *   - ブロックコメント(JSDoc 含む)・行コメントの中身は対象外
 *   - 行番号はコメントを空白化したうえで(改行は残す)数える
 */

import { describe, expect, it } from 'vitest';
import { collectTypeAliasLiterals, extractLiterals } from '../../../lib/generality/scan.js';

describe('extractLiterals', () => {
  it('シングル・ダブル・テンプレートの文字列リテラルを拾う', () => {
    const source = ["const a = 'staff';", 'const b = "organizer";', 'const c = `channel`;'].join('\n');
    expect(extractLiterals(source).map((hit) => hit.literal)).toEqual(['staff', 'organizer', 'channel']);
  });

  it('行番号を 1 始まりで数える', () => {
    const source = ['const a = 1;', "const b = 'two';", 'const c = 3;'].join('\n');
    expect(extractLiterals(source)).toEqual([{ literal: 'two', line: 2 }]);
  });

  it('ブロックコメント(JSDoc 含む)の中の文字列は拾わない', () => {
    const source = ["/**", " * 例: 'member' → 'members'", " */", "const a = 'real';"].join('\n');
    expect(extractLiterals(source).map((hit) => hit.literal)).toEqual(['real']);
  });

  it('行コメントの中の文字列は拾わない', () => {
    const source = ["// 例: 'fees'", "const a = 'real';"].join('\n');
    expect(extractLiterals(source).map((hit) => hit.literal)).toEqual(['real']);
  });

  it('コメントを空白化しても行番号がずれない(複数行コメントの後ろも正しい行)', () => {
    const source = ['/**', ' * 複数行の', ' * コメント', ' */', "const a = 'after';"].join('\n');
    expect(extractLiterals(source)).toEqual([{ literal: 'after', line: 5 }]);
  });

  it('文字列リテラルが無ければ空', () => {
    expect(extractLiterals('const a = 1;')).toEqual([]);
  });

  it('type X = \'a\' | \'b\'; の構成要素は、同じファイル内であれば値としての出現も含めて拾わない', () => {
    const source = [
      "type World = 'closed' | 'open';",
      "const state = 'closed';",
    ].join('\n');
    // 除外はファイル単位(構文上「型の判別子かどうか」を出現ごとに区別できないため、
    // 同じ綴りが型エイリアスに 1 回でも現れたらファイル内のその語をまとめて除外する)。
    // 'open' はどこにも値として現れないので、そもそも拾われない。
    expect(extractLiterals(source)).toEqual([]);
  });

  it('型エイリアスに無い語は通常どおり拾う(除外はファイル内の型エイリアス語だけに効く)', () => {
    const source = [
      "type World = 'closed' | 'open';",
      "const other = 'fees';",
    ].join('\n');
    expect(extractLiterals(source).map((hit) => hit.literal)).toEqual(['fees']);
  });

  it('const X = [...] as const の形は型判別子として扱わない(値のまま拾う)', () => {
    const source = "const GATE_SUBJECTS = ['requires_auth', 'role_gate'] as const;";
    // as const 配列は STATE_SETTLES のような実在した漏れも同じ構文で書けるため、除外しない。
    expect(extractLiterals(source).map((hit) => hit.literal)).toEqual(['requires_auth', 'role_gate']);
  });
});

describe('collectTypeAliasLiterals', () => {
  it('単純な type X = \'a\' | \'b\'; からメンバーを集める', () => {
    const source = "type World = 'closed' | 'open';";
    expect(collectTypeAliasLiterals(source)).toEqual(new Set(['closed', 'open']));
  });

  it('3 値以上のユニオンも全メンバーを集める', () => {
    const source = "export type FrontmatterDelimiter = 'none' | 'closed' | 'unclosed';";
    expect(collectTypeAliasLiterals(source)).toEqual(new Set(['none', 'closed', 'unclosed']));
  });

  it('type 宣言が無ければ空集合', () => {
    expect(collectTypeAliasLiterals("const a = 'closed';")).toEqual(new Set());
  });
});
