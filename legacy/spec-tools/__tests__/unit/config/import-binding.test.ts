/**
 * 束縛の解決(`resolveImport` / `isShadowed`)の表: `var` の巻き上げ・ブロック内の関数宣言・別スコープの宣言の扱い。
 *
 * 隠す側(本物と認めない)は、関数スコープの `var`(if / for / while / try / switch / ラベル付きの入れ子・位置の前後を問わない)と
 * ブロック内の `function` 宣言(緩いモードの巻き上げを保守的に)。隠さない側は、別の関数の中の宣言・ブロックスコープの let / const・
 * 別の名前。外部レビュー(入れ子ブロックの `var` を見落とすと、恒等関数が本物の関門に見える)。
 */

import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { allowedImports, parseSource, resolveImport, walk } from '../../../lib/config/import-binding.js';

const GATE = [{ module: '@kaninabe/runtime/gate', imported: 'gate' }];
const IMPORT = "import { gate } from '@kaninabe/runtime/gate';\n";

/** 末尾の `gate(…)` 呼び出し(最後に現れるもの)が本物の import に解決できるか。 */
function resolves(body: string): boolean {
  const file = parseSource(`${IMPORT}${body}`, 'x.ts');
  const bound = allowedImports(file, GATE);
  let last: ts.Identifier | undefined;
  walk(file, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'gate') last = node.expression;
  });
  if (last === undefined) throw new Error('gate の呼び出しがありません');
  return resolveImport(last, bound) !== null;
}

describe('resolveImport: 隠されていなければ本物', () => {
  it.each([
    ['最上位の呼び出し', 'gate();'],
    ['関数の中の呼び出し', 'function f() { return gate(); }'],
    ['別の関数の中の var は外側を隠さない', 'function other() { var gate = 1; return gate; }\nfunction f() { return gate(); }'],
    ['入れ子の関数の中の var は外側の関数を隠さない', 'function f() { const inner = () => { var gate = () => 1; return gate; }; void inner; return gate(); }'],
    ['入れ子のブロックの let / const は外では隠さない', 'function f() { if (true) { let gate = () => 1; void gate; } return gate(); }'],
    ['入れ子のブロックの const は外では隠さない', 'function f() { { const gate = () => 1; void gate; } return gate(); }'],
    ['別の名前の var', 'function f() { if (true) { var other = 1; void other; } return gate(); }'],
    ['クラスのメソッドの中の var は外側を隠さない', 'class C { m() { var gate = 1; return gate; } }\nfunction f() { return gate(); }'],
    ['クラスの static ブロックの var は外側を隠さない', 'class C { static { var gate = 1; void gate; } }\nfunction f() { return gate(); }'],
  ])('%s', (_name, body) => {
    expect(resolves(body)).toBe(true);
  });
});

describe('resolveImport: 巻き上げられる宣言は本物を隠す', () => {
  it.each([
    ['if の中の var', 'function f() { if (true) { var gate = () => 1; } return gate(); }'],
    ['else の中の var', 'function f() { if (false) { void 0; } else { var gate = () => 1; } return gate(); }'],
    ['for の初期化の var', 'function f() { for (var gate = 0; gate < 1; gate++) { void 0; } return gate(); }'],
    ['for-in の var', 'function f(o: object) { for (var gate in o) { void 0; } return gate(); }'],
    ['for-of の var', 'function f(o: string[]) { for (var gate of o) { void 0; } return gate(); }'],
    ['while の中の var', 'function f() { while (true) { var gate = () => 1; break; } return gate(); }'],
    ['do-while の中の var', 'function f() { do { var gate = () => 1; } while (false); return gate(); }'],
    ['try の中の var', 'function f() { try { var gate = () => 1; } catch { void 0; } return gate(); }'],
    ['catch の中の var', 'function f() { try { void 0; } catch { var gate = () => 1; } return gate(); }'],
    ['finally の中の var', 'function f() { try { void 0; } finally { var gate = () => 1; } return gate(); }'],
    ['switch の case の中の var', 'function f(k: number) { switch (k) { case 1: var gate = () => 1; break; default: break; } return gate(); }'],
    ['ラベル付きブロックの中の var', 'function f() { out: { var gate = () => 1; break out; } return gate(); }'],
    ['入れ子の入れ子の var', 'function f() { if (true) { for (;;) { if (true) { var gate = () => 1; } break; } } return gate(); }'],
    ['呼び出しより後ろにある var(巻き上げ)', 'function f() { const r = gate(); if (r) { var gate = () => 1; } return r; }'],
    ['分割代入の var', 'function f(o: { a: () => number }) { if (true) { var { a: gate } = o; } return gate(); }'],
    ['アロー関数の本体の var', 'const f = () => { if (true) { var gate = () => 1; } return gate(); };'],
    ['メソッドの本体の var', 'class C { m() { if (true) { var gate = () => 1; } return gate(); } }'],
    ['ブロックの中の関数宣言(保守的)', 'function f() { { function gate() { return 1; } } return gate(); }'],
    ['if の中の関数宣言(保守的)', 'function f() { if (true) { function gate() { return 1; } } return gate(); }'],
    ['入れ子の関数の中から外側の関数の var を見る', 'function f() { if (true) { var gate = () => 1; } const g = () => gate(); return g(); }'],
    ['最上位の入れ子ブロックの var', 'if (true) { var gate = () => 1; }\ngate();'],
  ])('%s', (_name, body) => {
    expect(resolves(body)).toBe(false);
  });
});
