/**
 * サービスの認証の秘密の読み口の数え上げ(K6 の材料)のテスト。
 * 関門 `readServiceSecret` は**本物の import に束縛できるときだけ**数える(同名のローカル関数・別モジュール・包み直し・引数の食い違いは数えない)。
 */

import { describe, expect, it } from 'vitest';
import { countSecretReads } from '../../../lib/config/secret-read-scan.js';

const GATE_IMPORT = "import { readServiceSecret } from '@kaninabe/runtime/secret';\n";

/** 名前ごとの (raw, guarded) を取り出す。 */
function counts(source: string): Record<string, { raw: number; guarded: readonly number[] }> {
  return Object.fromEntries(countSecretReads(source, 'x.ts').map((read) => [read.name, { raw: read.raw, guarded: read.guarded }]));
}

describe('countSecretReads', () => {
  it.each([
    ['関門を通した読み', `${GATE_IMPORT}const s = readServiceSecret('K', process.env['K'], 32);`, { K: { raw: 1, guarded: [32] } }],
    ['ドットの形でも通る', `${GATE_IMPORT}const s = readServiceSecret('K', process.env.K, 16);`, { K: { raw: 1, guarded: [16] } }],
    ['別名の import でも通る', "import { readServiceSecret as rs } from '@kaninabe/runtime/secret';\nrs('K', process.env['K'], 32);", { K: { raw: 1, guarded: [32] } }],
    ['素の参照は関門に数えない', 'const s = process.env["K"];', { K: { raw: 1, guarded: [] } }],
    ['現在と旧い値の 2 本', `${GATE_IMPORT}[readServiceSecret('K', process.env['K'], 32), readServiceSecret('P', process.env['P'], 32)];`, { K: { raw: 1, guarded: [32] }, P: { raw: 1, guarded: [32] } }],
    ['関門の外の素の参照が混ざる', `${GATE_IMPORT}readServiceSecret('K', process.env['K'], 32); const x = process.env['K'];`, { K: { raw: 2, guarded: [32] } }],
  ])('%s', (_name, source, expected) => {
    expect(counts(source)).toEqual(expected);
  });

  it.each([
    ['import が無い(同名のローカル関数)', "function readServiceSecret(a: string, b: string | undefined, c: number) { return b; }\nreadServiceSecret('K', process.env['K'], 32);"],
    ['別モジュールの同名 import', "import { readServiceSecret } from './local';\nreadServiceSecret('K', process.env['K'], 32);"],
    ['型だけの import', "import type { readServiceSecret } from '@kaninabe/runtime/secret';\nreadServiceSecret('K', process.env['K'], 32);"],
    ['名前の食い違い(第 1 引数と第 2 引数)', `${GATE_IMPORT}readServiceSecret('K', process.env['OTHER'], 32);`],
    ['名前が文字列リテラルでない', `${GATE_IMPORT}const n = 'K'; readServiceSecret(n, process.env['K'], 32);`],
    ['下限が数値リテラルでない', `${GATE_IMPORT}readServiceSecret('K', process.env['K'], MIN);`],
    ['下限が 0', `${GATE_IMPORT}readServiceSecret('K', process.env['K'], 0);`],
    ['引数が 4 つ', `${GATE_IMPORT}readServiceSecret('K', process.env['K'], 32, 1);`],
    ['第 2 引数が env の包み直し', `${GATE_IMPORT}readServiceSecret('K', String(process.env['K']), 32);`],
    ['引数の影(ローカル変数が関門を隠す)', `${GATE_IMPORT}function f(readServiceSecret: (...a: unknown[]) => unknown) { return readServiceSecret('K', process.env['K'], 32); }`],
    ['外部レビュー: 入れ子ブロックの var は関数スコープで関門を隠す', `${GATE_IMPORT}function f() { if (true) { var readServiceSecret = (_n: string, v: string | undefined, _m: number) => v; } return readServiceSecret('K', process.env['K'], 32); }`],
    ['for の中の var が呼び出しより後ろにあっても隠す(巻き上げ)', `${GATE_IMPORT}function f() { const v = readServiceSecret('K', process.env['K'], 32); for (var readServiceSecret = 0; readServiceSecret < 1; readServiceSecret++) { void v; } return v; }`],
  ])('関門に数えない: %s', (_name, source) => {
    const read = counts(source)['K'];
    expect(read?.guarded ?? []).toEqual([]);
  });

  it('環境変数名の形でない参照は拾わない', () => {
    expect(counts("process.env['lower']")).toEqual({});
  });
});
