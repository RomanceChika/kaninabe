/**
 * 有界到達性の**時間軸への展開**(lib/reach/unroll.ts)の単体テスト。
 *
 * 仕様: docs/design/v21-bounded-reachability.md §2 の「1 手の遷移」と §3 の unroll.ts
 *
 * 判定の正しさは Z3 が持つので、ここが見るのは**写した形**である ——
 * 初期状態が張られているか・時刻が単調か・手ごとに別の変数になっているか・
 * そして **`declare-const` が重複していないか**(重複すると Z3 がスクリプトごと拒み、
 * 「判定器が壊れています」に化けて仕様の問題が見えなくなる)。
 */

import { describe, expect, it } from 'vitest';
import { buildWorld } from '../../../lib/reach/world.js';
import { unrollWorld } from '../../../lib/reach/unroll.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  event,
  field,
  machine,
  role,
  specModel,
  writeRule,
} from '../../helpers/model-builder-v8plus.js';
import type { SpecModel } from '../../../lib/model/types.js';

/** 3 状態 1 機械。`close` だけが時刻のガードを持つ。 */
function model(): SpecModel {
  return specModel({
    roles: [role('member'), role('system')],
    aggregates: [
      aggregate({
        name: 'task',
        entity: entitySpec('task', [
          field('state', { kind: 'state', machine: 'task' }),
          field('deadline', { kind: 'datetime' }),
          field('kind', { kind: 'enum', values: ['chore', 'urgent'] }),
          field('owner_id', { kind: 'uuid' }),
        ]),
        stateMachines: [
          machine({
            machine: 'task',
            states: ['open', 'late', 'closed'],
            events: [
              event({ id: 'expire', from: ['open'], to: 'late', guard: 'now >= task.deadline' }),
              event({
                id: 'close',
                from: ['late'],
                to: 'closed',
                guard: 'task.kind == urgent and task.owner_id != nobody',
              }),
            ],
          }),
        ],
        access: accessSpec('task', { writes: [writeRule('member', ['kind'])] }),
      }),
    ],
  });
}

/** 展開済みのスクリプト。 */
function script(): string {
  return unrollWorld(buildWorld(model(), 'task', 'task')).script;
}

describe('unrollWorld — 世界の形', () => {
  it('状態変数は手ごとに別で、初期状態が張られる', () => {
    const text = script();

    expect(text).toContain('(declare-const |task.state@0| Int)');
    expect(text).toContain('(declare-const |task.state@2| Int)');
    expect(text.split('\n').some((line) => /^\(assert \(= \|task\.state@0\| \d+\)\)$/u.test(line))).toBe(true);
  });

  it('時刻は手ごとに別で、単調非減少が張られる', () => {
    const text = script();

    expect(text).toContain('(assert (>= |now@1| |now@0|))');
    expect(text).toContain('(assert (>= |now@2| |now@1|))');
  });

  it('実行中不変の欄は手ごとに分けない(同じ 1 つの定数)', () => {
    const text = script();

    expect(text).toContain('|task.deadline|');
    expect(text).not.toContain('|task.deadline@');
  });

  it('宣言は畳まれている(同じ変数を 2 回宣言しない)', () => {
    const declarations = script()
      .split('\n')
      .filter((line) => line.startsWith('(declare-const '));

    expect(new Set(declarations).size).toBe(declarations.length);
  });

  it('空白を含む名前(実行者の原子を逃がした自由な真偽値)も、手ごとに 1 本ずつ宣言される(綴りの先頭で畳まない)', () => {
    // 実行者の原子は `|atom!actor contains {原子の綴り}@{手}|` という空白を含む名前になる。宣言を畳む鍵を
    // 空白までで切ると、手 0 の宣言が手 1 以降の宣言を飲み込み、Z3 が「unknown constant」で拒む(V21 が判定器の故障に化ける)。
    const withActor = specModel({
      roles: [role('member')],
      aggregates: [
        aggregate({
          name: 'doc',
          entity: entitySpec('doc', [field('state', { kind: 'state', machine: 'doc' }), field('company_id', { kind: 'uuid' })]),
          stateMachines: [
            machine({
              machine: 'doc',
              states: ['draft', 'sent', 'void'],
              events: [
                event({ id: 'send', from: ['draft'], to: 'sent', guard: 'doc.company_id == actor.company_id' }),
                event({ id: 'void', from: ['sent'], to: 'void', guard: 'doc.company_id == actor.company_id' }),
              ],
            }),
          ],
        }),
      ],
    });
    const text = unrollWorld(buildWorld(withActor, 'doc', 'doc')).script;
    const atoms = text.split('\n').filter((line) => line.startsWith('(declare-const |atom!actor contains '));

    expect(atoms.length).toBeGreaterThanOrEqual(2);
    expect(atoms.some((line) => line.includes('@0|'))).toBe(true);
    expect(atoms.some((line) => line.includes('@1|'))).toBe(true);
    for (const line of text.split('\n').filter((entry) => entry.includes('|atom!actor contains ') && !entry.startsWith('(declare-const '))) {
      for (const used of line.match(/\|atom!actor contains [^|]*\|/gu) ?? []) {
        expect(atoms.some((declared) => declared.includes(used)), `${used} が宣言されていない`).toBe(true);
      }
    }
  });

  it('`writes` に載る finite の欄は、手ごとに宣言され値域も手ごとに張られる', () => {
    const text = script();

    expect(text).toContain('(declare-const |task.kind@0| Int)');
    expect(text).toContain('(declare-const |task.kind@2| Int)');
    const ranges = text.split('\n').filter((line) => /^\(assert \(or \(= \|task\.kind@\d\|/u.test(line));
    expect(ranges).toHaveLength(3);
  });

  it('`writes` に無い opaque(uuid)の欄は実行中不変の 1 つの定数になる', () => {
    const text = script();

    expect(text).toContain('(declare-const |task.owner_id| Real)');
    expect(text).not.toContain('|task.owner_id@');
  });

  it('問いは状態とイベントのぶんだけ立つ(鍵は {集約}.{機械}.{種類}.{ID})', () => {
    const { questions } = unrollWorld(buildWorld(model(), 'task', 'task'));

    expect([...questions.keys()].sort()).toEqual([
      'task.task.event.close',
      'task.task.event.expire',
      'task.task.state.closed',
      'task.task.state.late',
      'task.task.state.open',
    ]);
  });
});
