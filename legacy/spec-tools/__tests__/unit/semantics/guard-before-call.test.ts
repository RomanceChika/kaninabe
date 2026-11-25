/**
 * `exportedGuards`(export した関数が、本体の呼び出しの前に関門を呼んで拒否なら返しているか)の規約網羅テスト。
 *
 *   - 関門の結果を変数に入れて `if (…) return` する形・`if (関門(…)) return` の形は緑。別名・名前空間の import も数える
 *   - 呼ばない・結果を捨てる・本体のあとで呼ぶ・分岐や入れ子の関数の中で呼ぶ・コメントに名前があるだけ・別のモジュールの同名・
 *     既定の import の性質(関門のモジュールの公開の口は名前つきの export だけ)は赤
 *   - 本体を呼ばない export は `no_target`
 *   - 数える export の形(関数宣言・const の矢印関数・`export { f }`・既定の export)
 */

import { describe, expect, it } from 'vitest';
import { exportedGuards } from '../../../lib/semantics/guard-before-call.js';
import type { GuardState } from '../../../lib/semantics/guard-before-call.js';

const GUARD = { module: 'pkg/guard', names: ['check', 'checkCore'] } as const;
const TARGET = 'pkg/body';

/** ファイルの頭(関門と本体の import)。 */
const HEAD = ["import { check } from 'pkg/guard';", "import { createBody } from 'pkg/body';", ''].join('\n');

/** 判定を、export 名 → 判定の表にする。 */
function states(source: string): Readonly<Record<string, GuardState>> {
  return Object.fromEntries(exportedGuards('action.ts', source, GUARD, (specifier) => specifier === TARGET).map((guard) => [guard.name, guard.state]));
}

/** 関数 1 本の本体を包む。 */
function action(body: readonly string[]): string {
  return [HEAD, 'export async function act(input: unknown) {', ...body.map((line) => `  ${line}`), '}', ''].join('\n');
}

describe('exportedGuards', () => {
  it('結果を変数に入れて if で返す形・if の条件で呼んで返す形は緑', () => {
    expect(states(action(['const refusal = check(1);', 'if (refusal !== null) return refusal;', 'return createBody()(input);']))).toEqual({ act: 'guarded' });
    expect(states(action(['if (check(1) !== null) { return null; }', 'const run = createBody();', 'return run(input);']))).toEqual({ act: 'guarded' });
  });

  it('別名・名前空間の import も関門として数える', () => {
    const aliased = ["import { checkCore as gate } from 'pkg/guard';", "import { createBody } from 'pkg/body';", 'export const act = async () => {', '  const r = gate();', '  if (r) return r;', '  return createBody()();', '};', ''].join('\n');
    expect(states(aliased)).toEqual({ act: 'guarded' });
    const namespaced = ["import * as guards from 'pkg/guard';", "import * as body from 'pkg/body';", 'export function act() {', '  const r = guards.check();', '  if (r) return r;', '  return body.createBody()();', '}', ''].join('\n');
    expect(states(namespaced)).toEqual({ act: 'guarded' });
  });

  it('呼ばない・結果を捨てる・本体のあとで呼ぶ・返らない if は赤', () => {
    expect(states(action(['return createBody()(input);']))).toEqual({ act: 'unguarded' });
    expect(states(action(['check(1);', 'return createBody()(input);']))).toEqual({ act: 'unguarded' });
    expect(states(action(['const run = createBody();', 'const refusal = check(1);', 'if (refusal) return refusal;', 'return run(input);']))).toEqual({ act: 'unguarded' });
    expect(states(action(['const refusal = check(1);', 'if (refusal) { console.log(refusal); }', 'return createBody()(input);']))).toEqual({ act: 'unguarded' });
  });

  it('分岐・入れ子の関数の中の関門、コメントの中の名前、別のモジュールの同名、既定の import の性質は数えない', () => {
    expect(states(action(['if (input) { const r = check(1); if (r) return r; }', 'return createBody()(input);']))).toEqual({ act: 'unguarded' });
    expect(states(action(['const later = () => check(1);', 'if (later()) return null;', 'return createBody()(input);']))).toEqual({ act: 'unguarded' });
    expect(states(action(['// check(1) を呼ぶ', 'return createBody()(input);']))).toEqual({ act: 'unguarded' });
    const other = ["import { check } from 'elsewhere';", "import { createBody } from 'pkg/body';", 'export function act() {', '  if (check()) return null;', '  return createBody()();', '}', ''].join('\n');
    expect(states(other)).toEqual({ act: 'unguarded' });
    const defaulted = ["import guards from 'pkg/guard';", "import { createBody } from 'pkg/body';", 'export function act() {', '  if (guards.check()) return null;', '  return createBody()();', '}', ''].join('\n');
    expect(states(defaulted)).toEqual({ act: 'unguarded' });
  });

  it('本体を呼ばない export は no_target(入れ子の関数の中の本体の呼び出しは数える)', () => {
    expect(states(action(['return null;']))).toEqual({ act: 'no_target' });
    expect(states(action(['return [1].map(() => createBody()(input));']))).toEqual({ act: 'unguarded' });
  });

  it('関数宣言・const の関数・export { f }・既定の export を数え、export しない関数と型だけの import は数えない', () => {
    const source = [
      HEAD,
      "import type { Body } from 'pkg/body';",
      'function inner(): Body { return createBody(); }',
      'const viaClause = () => createBody()();',
      'export { viaClause as renamed };',
      'export default function () { const r = check(); if (r) return r; return createBody()(); }',
      'export const expressionBody = () => createBody()();',
      '',
    ].join('\n');
    expect(states(source)).toEqual({ renamed: 'unguarded', default: 'guarded', expressionBody: 'unguarded' });
    expect(states(source)).not.toHaveProperty('inner');
  });
});
