/**
 * Route Handler が export している HTTP メソッド(`semantics/route-exports.ts`)のテスト。
 *
 * 数える形は、関数宣言・クラス・変数・名前つき再輸出(別名・`from` つき)・名前空間の再輸出。型だけの再輸出と、メソッド名でない export は数えない。
 * 名前を数えられない形(分割代入・`export * from`)は `unreadableRouteExports` が返す(4 回目 C4-6。J2 の閉世界が error にする)。
 */

import { describe, expect, it } from 'vitest';
import { exportedHttpMethods, HTTP_METHODS, unreadableRouteExports } from '../../../lib/semantics/route-exports.js';

describe('exportedHttpMethods', () => {
  it('`export async function GET` を数える', () => {
    expect(exportedHttpMethods('route.ts', 'export async function GET(request: Request) { return new Response(); }')).toEqual(['GET']);
  });

  it('`export const POST = …` を数える(複数の宣言も)', () => {
    expect(exportedHttpMethods('route.ts', 'export const GET = async () => new Response(), POST = async () => new Response();')).toEqual(['GET', 'POST']);
  });

  it('`export { GET }`・`export { handler as POST }`・`export { PUT } from` を数える', () => {
    const source = 'const GET = 1, handler = 2;\nexport { GET, handler as POST };\nexport { PUT } from "./other";';

    expect(exportedHttpMethods('route.ts', source)).toEqual(['GET', 'POST', 'PUT']);
  });

  it('並びは HTTP_METHODS の表のとおり(出現順ではない)・重複なし', () => {
    const source = 'export const DELETE = 1;\nexport const GET = 1;\nexport const GET2 = 1;\nexport { GET };';

    expect(exportedHttpMethods('route.ts', source)).toEqual(['GET', 'DELETE']);
  });

  it('メソッド名でない export・export していない宣言・型だけの再輸出・分割代入は数えない(分割代入は unreadableRouteExports が拾う)', () => {
    const source = [
      "export const dynamic = 'force-dynamic';",
      'function POST() {}',
      'export type { GET } from "./t";',
      'export { type PUT } from "./t";',
      'export const { DELETE } = obj;',
      'export type * from "./types";',
    ].join('\n');

    expect(exportedHttpMethods('route.ts', source)).toEqual([]);
  });

  // 値として export される名前は、形によらず数える(数え漏れは検査の素通りになる)。
  const namedRows: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ['クラス', 'export class PATCH {}', ['PATCH']],
    ['enum', 'export enum OPTIONS { A }', ['OPTIONS']],
    ['名前空間', 'export namespace HEAD { export const x = 1; }', ['HEAD']],
    ['名前空間の再輸出', 'export * as GET from "./impl";', ['GET']],
    ['import = の再輸出', 'import impl = require("./impl");\nexport import DELETE = impl.handler;', ['DELETE']],
    ['文字列の別名', 'const h = 1;\nexport { h as "PUT" };', ['PUT']],
    ['型だけの import = は数えない', 'export import type POST = require("./t");', []],
  ];
  it.each(namedRows)('%s を数える', (_name, source, expected) => {
    expect(exportedHttpMethods('route.ts', source)).toEqual(expected);
  });


  it('HTTP_METHODS は Next.js の Route Handler が受ける 7 つ', () => {
    expect([...HTTP_METHODS]).toEqual(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
  });
});

describe('unreadableRouteExports(メソッドを数えられない export の形)', () => {
  const rows: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ['オブジェクトの分割代入(C4-6 の反例)', 'const probeMethods = { GET: () => new Response() };\nexport const { GET } = probeMethods;', ['destructuring']],
    ['配列の分割代入', 'export const [GET] = fns;', ['destructuring']],
    ['識別子と分割代入の混在', 'export const POST = 1, { GET } = obj;', ['destructuring']],
    ['let の分割代入', 'export let { GET } = obj;', ['destructuring']],
    ['export * from', "export * from './impl';", ['star']],
    ['両方(出現順)', "export * from './a';\nexport const { GET } = o;", ['star', 'destructuring']],
    ['名前で書いた関数', 'export async function GET() { return new Response(); }', []],
    ['名前で書いた変数', 'export const POST = async () => new Response();', []],
    ['名前つきの再輸出', "export { GET } from './impl';", []],
    ['名前空間の再輸出(名前は数えられる)', "export * as GET from './impl';", []],
    ['型だけの全再輸出', "export type * from './types';", []],
    ['export していない分割代入', 'const { GET } = obj;', []],
    ['既定の export', 'export default function handler() {}', []],
  ];
  it.each(rows)('%s', (_name, source, expected) => {
    expect(unreadableRouteExports('route.ts', source).map((form) => form.kind)).toEqual(expected);
  });

  it('指摘に添える綴りは文の先頭の 1 行(長ければ 80 字で切る)', () => {
    const long = `export const { GET } = ${'x'.repeat(200)};`;
    const [form] = unreadableRouteExports('route.ts', long);
    expect(form?.text).toHaveLength(80);
    expect(form?.text.endsWith('…')).toBe(true);
    expect(unreadableRouteExports('route.ts', 'export const {\n  GET,\n} = obj;')[0]?.text).toBe('export const {');
  });
});
