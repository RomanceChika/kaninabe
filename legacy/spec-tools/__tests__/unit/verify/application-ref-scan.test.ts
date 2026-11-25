/**
 * 実装走査(V10 の kind: application ref 実在検査の材料)の抽出規則のユニットテスト。
 *
 * 拾い方の正は application-ref-scan.ts の doc コメント:
 *   - `export function {name}` / `export async function {name}` / `export const {name}` を拾う
 *   - 同じ名前が複数回出ても 1 つにまとめる
 *
 * **呼び出し口の走査**も同じファイルにある(束 ⑰-3b)。「export はあるが誰からも呼ばれて
 * いない」を V10 が指摘するための材料であり、コメントの中の言及を数えないことが要点である
 * —— 執行点が消えたとき、真っ先に残るのが doc コメントと単体テストだからである。
 */

import { describe, expect, it } from 'vitest';
import {
  extractExportedNames,
  extractReferencedNames,
} from '../../../lib/verify/application-ref-scan.js';

describe('実装からの export 名の抽出', () => {
  it('export function・export async function・export const の 3 形を拾う', () => {
    const source = [
      "export function calculateSlotFee(a: number): number { return a; }",
      "export async function requireSession(): Promise<string> { return ''; }",
      "export const workshopInputSchema = z.object({});",
    ].join('\n');
    expect([...extractExportedNames(source)].sort()).toEqual([
      'calculateSlotFee',
      'requireSession',
      'workshopInputSchema',
    ]);
  });

  it('同じ名前が複数回出ても 1 つにまとめる', () => {
    const source = 'export function assertStaffNotEmpty() {}\nexport function assertStaffNotEmpty() {}';
    expect(extractExportedNames(source)).toEqual(['assertStaffNotEmpty']);
  });

  it('export を伴わない宣言(モジュール内部の関数)は拾わない', () => {
    expect(extractExportedNames('function helper() {}\nconst local = 1;')).toEqual([]);
  });

  it('export された型・インターフェースは拾わない(application の ref は値だけを指す語彙)', () => {
    expect(extractExportedNames('export interface Foo {}\nexport type Bar = string;')).toEqual([]);
  });

  it('参照が 1 つも無ければ空', () => {
    expect(extractExportedNames('const answer = 42;')).toEqual([]);
  });
});

describe('実装からの参照の抽出(呼び出し口があるか)', () => {
  it('自分の宣言以外の場所に出た名前を拾う', () => {
    const source = [
      "import { helper } from './helper';",
      'export function outer(): number {',
      '  return helper();',
      '}',
    ].join('\n');
    expect(extractReferencedNames(source)).toContain('helper');
  });

  it('自分の宣言だけの名前は拾わない(export はあるが呼び出し口が無い形)', () => {
    expect(extractReferencedNames('export function lonely(): void {}')).not.toContain('lonely');
    expect(extractReferencedNames('export const answer = 42;')).not.toContain('answer');
  });

  it('doc コメントの中の言及は数えない', () => {
    const source = ['/** 仕様: ref: lonely を守る。 */', 'export function lonely(): void {}'].join('\n');
    expect(extractReferencedNames(source)).not.toContain('lonely');
  });

  it('行コメントと文字列リテラルの中の言及も数えない', () => {
    const source = ['// lonely を呼ぶのは誰か', "const message = 'lonely';"].join('\n');
    expect(extractReferencedNames(source)).not.toContain('lonely');
  });

  it('同じ名前が何度出ても 1 つにまとめる', () => {
    expect(extractReferencedNames('helper(); helper(); helper();').filter((name) => name === 'helper')).toHaveLength(1);
  });
});
