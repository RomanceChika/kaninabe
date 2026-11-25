/**
 * **世界を時間軸に展開する写像**(世界 + K → SMT-LIB。純粋)。
 *
 * 組み立てるのは次の 4 つだけである。推論も探索も書かない(解くのは Z3)。
 *
 * 1. **宣言** … 手ごとの状態変数(`|workshop.state@3|`)と、ガードが触る欄・自由な原子
 * 2. **初期** … `state_m@0 = initial_m`
 * 3. **遷移関係** … 手ごとに「ちょうど 1 つ起きる」:**stutter**(全機械が不変)か、
 *    ある機械のあるイベントが起こされる(`from` に居て・ガードが立ち・`to` へ移り・他は不変)
 * 4. **時刻の単調性** … `now@{t+1} >= now@{t}`
 *
 * **`by`(誰が実行するか)も不変条件も見ない。** 世界は実行列を多めに認める写しであり、
 * だからこそ「K 手以内に無い」が仕様の問題として読める(設計の凍結メモ §2 の極性)。
 *
 * **宣言行はここで畳む。** 同じ変数が複数のガードから宣言されるので、写像(smt.ts)の
 * 出力をそのまま並べると `declare-const` が重複して Z3 に拒まれる。
 */

import type { GuardExpr } from '../guard/ast.js';
import { translateToSmt, smtValueCode } from '../guard/smt.js';
import { symbol, type SmtRename } from '../guard/smt-names.js';
import { reachKey } from './problems.js';
import { NOW, type ReachEvent, type ReachMachine, type ReachWorld } from './world.js';

/** 展開した世界(スクリプト本体と、問いごとの `assert` の中身)。 */
export interface UnrolledWorld {
  /** 宣言・初期・遷移関係・単調性を並べた SMT-LIB(問いは含まない)。 */
  readonly script: string;
  /** 問いの鍵 → その問いの項(`(assert …)` に包んで足す)。 */
  readonly questions: ReadonlyMap<string, string>;
  /** 展開した手数 K。 */
  readonly bound: number;
  /** K が上限で打ち切られたか。 */
  readonly truncated: boolean;
  /** 世界に入れた機械の id。 */
  readonly machines: readonly string[];
}

/** 宣言(名前ごとに 1 行)と表明(字面ごとに 1 行)を畳む入れ物。 */
interface Script {
  readonly declared: Set<string>;
  readonly declarations: string[];
  readonly asserts: Set<string>;
  readonly assertLines: string[];
  readonly valueIndex: Map<string, number>;
}

/** 手 t での状態変数のシンボル。 */
function stateSymbol(machine: ReachMachine, step: number): string {
  return symbol(`${machine.statePath}@${step}`);
}

/** 値の綴りを整数へ(全手・全機械で 1 つの表を共有する)。 */
function code(script: Script, value: string): number {
  return smtValueCode(script.valueIndex, value);
}

/** 写像が吐いた宣言行を畳んで足す(同じ変数は 1 回だけ宣言する)。 */
function addDeclarations(script: Script, block: string): void {
  for (const line of block.split('\n')) {
    if (line.length === 0) continue;
    const declared = /^\(declare-const (\|[^|]*\||\S+) /u.exec(line)?.[1];
    if (declared !== undefined) {
      if (script.declared.has(declared)) continue;
      script.declared.add(declared);
      script.declarations.push(line);
      continue;
    }
    if (script.asserts.has(line)) continue;
    script.asserts.add(line);
    script.assertLines.push(line);
  }
}

/** 変数 1 本を(まだ無ければ)宣言する。 */
function declare(script: Script, name: string, sort: string): void {
  if (script.declared.has(name)) return;
  script.declared.add(name);
  script.declarations.push(`(declare-const ${name} ${sort})`);
}

/** 表明を 1 行足す(同じ字面は 1 回だけ)。 */
function assert(script: Script, term: string): void {
  const line = `(assert ${term})`;
  if (script.asserts.has(line)) return;
  script.asserts.add(line);
  script.assertLines.push(line);
}

/** `(or …)` を項 1 つに畳む(空は `false`・1 つはそのまま)。 */
function anyOf(terms: readonly string[]): string {
  if (terms.length === 0) return 'false';
  return terms.length === 1 ? (terms[0] ?? 'false') : `(or ${terms.join(' ')})`;
}

/** `(and …)` を項 1 つに畳む(空は `true`・1 つはそのまま)。 */
function allOf(terms: readonly string[]): string {
  if (terms.length === 0) return 'true';
  return terms.length === 1 ? (terms[0] ?? 'true') : `(and ${terms.join(' ')})`;
}

/**
 * 手 t でのガードの名前の付け替え。
 *
 * ガードに現れるパスは世界の正規名へ直し、**手ごとに動くもの**(状態変数・`writes` の欄・
 * `now`・実行者の属性)だけに `@t` を付ける。表に無い名前は写像が自由な `Bool` に逃がした
 * 原子の鍵であり、これは**常に手ごとに別**にする(同じ原子が別の手で同じ真理値を強いられると、
 * 世界が実行列を取りこぼす)。
 */
function renameAt(world: ReachWorld, event: ReachEvent, step: number): SmtRename {
  return (name: string): string => {
    const canonical = event.paths.get(name);
    if (canonical === undefined) return `${name}@${step}`;
    return world.perStep.has(canonical) ? `${canonical}@${step}` : canonical;
  };
}

/** 手 t でのガードの項(ガードが無い・読めないものは `true` = 常に実行できる側へ緩める)。 */
function guardTerm(script: Script, world: ReachWorld, event: ReachEvent, step: number): string {
  const expr: GuardExpr | undefined = event.guard;
  if (expr === undefined) return 'true';
  const translation = translateToSmt(expr, event.env, {
    rename: renameAt(world, event, step),
    valueIndex: script.valueIndex,
  });
  addDeclarations(script, translation.declarations);
  return translation.formula;
}

/** 手 t で機械が `from` のどれかに居る、の項。 */
function fromTerm(script: Script, machine: ReachMachine, event: ReachEvent, step: number): string {
  const current = stateSymbol(machine, step);
  return anyOf(event.from.map((state) => `(= ${current} ${code(script, state)})`));
}

/** 手 t で機械の状態が変わらない、の項。 */
function unchanged(machine: ReachMachine, step: number): string {
  return `(= ${stateSymbol(machine, step + 1)} ${stateSymbol(machine, step)})`;
}

/** 状態変数を全手ぶん宣言し、値域と初期状態を張る。 */
function declareMachines(script: Script, world: ReachWorld): void {
  for (const machine of world.machines) {
    for (let step = 0; step <= world.bound; step += 1) {
      const name = stateSymbol(machine, step);
      declare(script, name, 'Int');
      assert(script, anyOf(machine.states.map((state) => `(= ${name} ${code(script, state)})`)));
    }
    assert(script, `(= ${stateSymbol(machine, 0)} ${code(script, machine.initial)})`);
  }
}

/** `now` を全手ぶん宣言し、単調非減少を張る。 */
function declareClock(script: Script, bound: number): void {
  for (let step = 0; step <= bound; step += 1) declare(script, symbol(`${NOW}@${step}`), 'Real');
  for (let step = 0; step < bound; step += 1) {
    assert(script, `(>= ${symbol(`${NOW}@${step + 1}`)} ${symbol(`${NOW}@${step}`)})`);
  }
}

/** 手 t の遷移関係(stutter か、ちょうど 1 つのイベント)。 */
function stepRelation(script: Script, world: ReachWorld, step: number): string {
  const stutter = allOf(world.machines.map((machine) => unchanged(machine, step)));
  const fires: string[] = [];
  for (const machine of world.machines) {
    const others = world.machines.filter((other) => other.id !== machine.id);
    for (const event of machine.events) {
      fires.push(
        allOf([
          fromTerm(script, machine, event, step),
          guardTerm(script, world, event, step),
          `(= ${stateSymbol(machine, step + 1)} ${code(script, event.to)})`,
          ...others.map((other) => unchanged(other, step)),
        ]),
      );
    }
  }
  return anyOf([stutter, ...fires]);
}

/** 問い (a): その状態に居る手が 1 つでもあるか。 */
function stateQuestion(script: Script, machine: ReachMachine, state: string, bound: number): string {
  const value = code(script, state);
  const terms: string[] = [];
  for (let step = 0; step <= bound; step += 1) terms.push(`(= ${stateSymbol(machine, step)} ${value})`);
  return anyOf(terms);
}

/** 問い (b): `from` に居てガードが立つ手が 1 つでもあるか。 */
function eventQuestion(
  script: Script,
  world: ReachWorld,
  machine: ReachMachine,
  event: ReachEvent,
): string {
  const terms: string[] = [];
  for (let step = 0; step <= world.bound; step += 1) {
    terms.push(allOf([fromTerm(script, machine, event, step), guardTerm(script, world, event, step)]));
  }
  return anyOf(terms);
}

/**
 * 世界を K 手に展開し、スクリプトと問いの項を作る。
 *
 * @param world 組み立て済みの world(lib/reach/world.ts)
 * @returns SMT-LIB のスクリプトと、問いの鍵 → 項
 */
export function unrollWorld(world: ReachWorld): UnrolledWorld {
  const script: Script = {
    declared: new Set(),
    declarations: [],
    asserts: new Set(),
    assertLines: [],
    valueIndex: new Map(),
  };
  declareMachines(script, world);
  declareClock(script, world.bound);
  for (let step = 0; step < world.bound; step += 1) assert(script, stepRelation(script, world, step));

  const questions = new Map<string, string>();
  for (const machine of world.machines) {
    for (const state of machine.states) {
      questions.set(
        reachKey(machine.aggregate, machine.machine, 'state', state),
        stateQuestion(script, machine, state, world.bound),
      );
    }
    for (const event of machine.events) {
      questions.set(
        reachKey(machine.aggregate, machine.machine, 'event', event.id),
        eventQuestion(script, world, machine, event),
      );
    }
  }

  return {
    script: [...script.declarations, ...script.assertLines].join('\n'),
    questions,
    bound: world.bound,
    truncated: world.truncated,
    machines: world.machines.map((machine) => machine.id),
  };
}
