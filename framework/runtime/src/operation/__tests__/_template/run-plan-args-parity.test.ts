/**
 * 新旧の同値（③-e2A）: 定型 RPC の名前付き引数が、`RpcArg` を経由する新しい組み立てでも
 * **PostgREST に渡る JSON が旧い実装と完全に一致する**ことの固定。
 *
 * 旧い実装（`argValueBefore` / `jsonObjectBefore`）は束の前の `run-plan-args.ts` の写しである。
 * 写しはこのテストの中にしか置かない —— 新旧の差を測る物差しで、実装の正ではない。
 *
 * 表は **14 の供給元 × {absent, null, value}** である。「absent」は供給元が読む carrier が
 * `undefined` のとき（入力の欄・読んだ事実・計算値の戻り）、「null」は `null`、「value」は値。
 * 供給元が carrier を持たないもの（冪等キー・ロール・次の状態・効果・イベント・`not_written`）は
 * 3 つの場面で同じ引数になる（それも表の行として固定する）。
 *
 * 旧い実装が `undefined` を引数に残す 2 つの行（`input_target_id` と `computed` の absent）は、
 * PostgREST が引数ごと落とし「関数が見つからない」で落ちていた入力である。新しい実装は
 * 呼び出し側の誤りとして `ProgrammingError` で止める（表の中で明示する。運ぶ JSON の同値ではなく
 * 「運ばれない」ことの固定）。
 */

import { describe, expect, it } from 'vitest';
import type { RunParam, RunParamSource } from '@kaninabe/runtime/plan';
import { namedArgs, namedRpcArgs } from '../../_template/run-plan-args';
import type { ArgsContext } from '../../_template/run-plan-args';
import { ProgrammingError } from '../../_template/wire';

type State = 'absent' | 'null' | 'value';
const STATES: readonly State[] = ['absent', 'null', 'value'];

/** 場面ごとの carrier の値（`undefined` / `null` / 値）。 */
function carrier(state: State, value: unknown): unknown {
  if (state === 'absent') return undefined;
  return state === 'null' ? null : value;
}

const VALUE = { list: [1, 'x', null, { deep: true }], flag: false, text: 'あ' };

/** 場面から実行の文脈を組む（供給元が読む carrier を、全部同じ場面にする）。 */
function contextOf(state: State): ArgsContext {
  const value = carrier(state, VALUE);
  const text = carrier(state, 'v');
  return {
    resolution: {
      facts: { 'widget.state': text } as ArgsContext['resolution']['facts'],
      actorId: state === 'value' ? 'actor-1' : null,
      session: null,
      input: { id: text, f: value, g: value, h: value },
      now: '2027-06-01T00:00:00.000Z',
    },
    idempotencyKey: 'key-1',
    actorRoles: ['member', 'staff'],
    writeEffects: ['w1', 'w2'],
    computes: { calc: () => value },
  };
}

/** 旧い実装（束の前の `run-plan-args.ts` の `argValue`）。 */
function argValueBefore(source: RunParamSource, ctx: ArgsContext): unknown {
  switch (source.kind) {
    case 'idempotency_key':
      return ctx.idempotencyKey;
    case 'actor':
      return ctx.resolution.actorId;
    case 'actor_roles':
      return [...ctx.actorRoles];
    case 'expected_state':
      return ctx.resolution.facts[source.ref] ?? null;
    case 'next_state':
      return source.state;
    case 'effects':
      return [...source.effects];
    case 'write_effects':
      return [...ctx.writeEffects];
    case 'event_id':
      return source.event;
    case 'input_field':
      return ctx.resolution.input[source.field] ?? null;
    case 'input_target_id':
      return ctx.resolution.input['id'];
    case 'input_values':
      return jsonObjectBefore(source.fields, ctx.resolution.input, false);
    case 'input_changes':
      return jsonObjectBefore(source.fields, ctx.resolution.input, true);
    case 'not_written':
      return null;
    default: {
      const compute = ctx.computes[source.ref];
      if (compute === undefined) throw new Error('unwired');
      return compute(ctx.resolution.facts, ctx.resolution.input);
    }
  }
}

/** 旧い実装の `jsonObject`。 */
function jsonObjectBefore(
  fields: readonly string[],
  input: Readonly<Record<string, unknown>>,
  onlyDefined: boolean,
): Readonly<Record<string, unknown>> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    const value = input[field];
    if (onlyDefined && value === undefined) continue;
    values[field] = value ?? null;
  }
  return values;
}

/** 旧い `namedArgs`（引数名 → 値）。 */
function namedArgsBefore(params: readonly RunParam[], ctx: ArgsContext): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const param of params) args[param.name] = argValueBefore(param.source, ctx);
  return args;
}

/** 表の行: 供給元 1 つ（`rejectedWhenAbsent` は新しい実装が運ばず止める行）。 */
interface Row {
  readonly name: string;
  readonly source: RunParamSource;
  readonly rejectedWhenAbsent?: true;
}

const ROWS: readonly Row[] = [
  { name: 'idempotency_key', source: { kind: 'idempotency_key' } },
  { name: 'actor', source: { kind: 'actor' } },
  { name: 'actor_roles', source: { kind: 'actor_roles' } },
  { name: 'expected_state', source: { kind: 'expected_state', ref: 'widget.state' } },
  { name: 'next_state', source: { kind: 'next_state', state: 'open' } },
  { name: 'effects', source: { kind: 'effects', effects: ['e1', 'e2'] } },
  { name: 'write_effects', source: { kind: 'write_effects' } },
  { name: 'event_id', source: { kind: 'event_id', event: 'widget.open' } },
  { name: 'input_field', source: { kind: 'input_field', field: 'f' } },
  { name: 'input_target_id', source: { kind: 'input_target_id' }, rejectedWhenAbsent: true },
  { name: 'input_values', source: { kind: 'input_values', fields: ['f', 'g', 'missing'] } },
  { name: 'input_changes', source: { kind: 'input_changes', fields: ['f', 'g', 'missing'] } },
  { name: 'computed', source: { kind: 'computed', field: 'x', ref: 'calc' }, rejectedWhenAbsent: true },
  { name: 'not_written', source: { kind: 'not_written', field: 'owner_id', contract: 'untouched' } },
];

/** 載せ忘れを落とす: 値域の全数（`RunParamSource['kind']`）が表にあること。 */
const ALL_KINDS: Record<RunParamSource['kind'], true> = {
  idempotency_key: true,
  actor: true,
  actor_roles: true,
  expected_state: true,
  next_state: true,
  effects: true,
  write_effects: true,
  event_id: true,
  input_field: true,
  input_target_id: true,
  input_values: true,
  input_changes: true,
  computed: true,
  not_written: true,
};

describe('新旧の同値（供給元 × {absent, null, value}）', () => {
  it('表は供給元の全数（14）を持つ', () => {
    expect(ROWS.map((row) => row.source.kind).sort()).toEqual(Object.keys(ALL_KINDS).sort());
    expect(ROWS).toHaveLength(14);
    expect(ROWS.length * STATES.length).toBe(42);
  });

  describe.each(ROWS)('$name', (row) => {
    it.each(STATES)('%s: PostgREST に渡る JSON が旧い実装と完全に一致する', (state) => {
      const ctx = contextOf(state);
      const params: RunParam[] = [{ name: 'p_x', source: row.source }];
      if (row.rejectedWhenAbsent === true && state === 'absent') {
        // 旧: 引数が `undefined` のまま残り、PostgREST が引数ごと落とす。新: 運ばずに止める。
        expect(namedArgsBefore(params, ctx)).toEqual({ p_x: undefined });
        expect(() => namedArgs(params, ctx)).toThrow(ProgrammingError);
        return;
      }
      const before = namedArgsBefore(params, ctx);
      const after = namedArgs(params, ctx);
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
      expect(after).toEqual(before);
    });
  });

  // @spec framework-guarantee-catalog @tc TC-FW-RUNPLAN-002
  it('1 回の呼び出しに全供給元を並べても、引数の順序と JSON が旧い実装と一致する', () => {
    const params: RunParam[] = ROWS.map((row, index) => ({ name: `p_${index}`, source: row.source }));
    const nullCtx = contextOf('null');
    const valueCtx = contextOf('value');
    expect(Object.keys(namedArgs(params, valueCtx))).toHaveLength(14);
    expect(JSON.stringify(namedArgs(params, nullCtx))).toBe(JSON.stringify(namedArgsBefore(params, nullCtx)));
    expect(JSON.stringify(namedArgs(params, valueCtx))).toBe(JSON.stringify(namedArgsBefore(params, valueCtx)));
  });

  it('作成の record: 欄ごとに混ぜた 3 値でも JSON（鍵の順序を含む）が一致し、absent も null で出る', () => {
    const ctx: ArgsContext = {
      ...contextOf('value'),
      resolution: { ...contextOf('value').resolution, input: { a: undefined, b: null, c: 'v', d: 0, e: false } },
    };
    const params: RunParam[] = [{ name: 'p_values', source: { kind: 'input_values', fields: ['a', 'b', 'c', 'd', 'e', 'z'] } }];
    const after = namedArgs(params, ctx);
    expect(JSON.stringify(after)).toBe(JSON.stringify(namedArgsBefore(params, ctx)));
    expect(after).toEqual({ p_values: { a: null, b: null, c: 'v', d: 0, e: false, z: null } });
  });

  it('編集の patch: 欄ごとに混ぜた 3 値でも JSON が一致し、unchanged の鍵は出ない・clear は null', () => {
    const ctx: ArgsContext = {
      ...contextOf('value'),
      resolution: { ...contextOf('value').resolution, input: { a: undefined, b: null, c: 'v', d: 0, e: false } },
    };
    const params: RunParam[] = [{ name: 'p_changes', source: { kind: 'input_changes', fields: ['a', 'b', 'c', 'd', 'e', 'z'] } }];
    const after = namedArgs(params, ctx);
    expect(JSON.stringify(after)).toBe(JSON.stringify(namedArgsBefore(params, ctx)));
    expect(after).toEqual({ p_changes: { b: null, c: 'v', d: 0, e: false } });
    expect(Object.keys(after['p_changes'] as object)).toEqual(['b', 'c', 'd', 'e']);
  });

  it('偽になる値（0 / 空文字 / false）は最上位の欄でも旧い実装と同じに運ばれる（null に畳まれない）', () => {
    const params: RunParam[] = [
      { name: 'p_f', source: { kind: 'input_field', field: 'f' } },
      { name: 'p_id', source: { kind: 'input_target_id' } },
    ];
    for (const falsy of [0, '', false]) {
      const ctx: ArgsContext = {
        ...contextOf('value'),
        resolution: { ...contextOf('value').resolution, input: { id: falsy, f: falsy } },
      };
      expect(JSON.stringify(namedArgs(params, ctx))).toBe(JSON.stringify(namedArgsBefore(params, ctx)));
      expect(namedArgs(params, ctx)).toEqual({ p_f: falsy, p_id: falsy });
    }
  });

  it('実行者が undefined でも、旧い実装と同じに運ばれる（運ばない鍵のまま。null にも別の値にも変えない）', () => {
    const ctx: ArgsContext = {
      ...contextOf('value'),
      resolution: { ...contextOf('value').resolution, actorId: undefined as unknown as null },
    };
    const params: RunParam[] = [{ name: 'p_actor_id', source: { kind: 'actor' } }];

    expect(JSON.stringify(namedArgs(params, ctx))).toBe(JSON.stringify(namedArgsBefore(params, ctx)));
    expect(namedArgs(params, ctx)).toEqual({ p_actor_id: undefined });
  });

  it('Date の欄は旧い実装の JSON.stringify と同じ ISO 8601 になる（作成・編集・最上位）', () => {
    const at = new Date('2027-06-01T09:30:00.000+09:00');
    const ctx: ArgsContext = {
      ...contextOf('value'),
      resolution: { ...contextOf('value').resolution, input: { id: 'i', at } },
    };
    const params: RunParam[] = [
      { name: 'p_at', source: { kind: 'input_field', field: 'at' } },
      { name: 'p_values', source: { kind: 'input_values', fields: ['at'] } },
      { name: 'p_changes', source: { kind: 'input_changes', fields: ['at'] } },
    ];
    expect(JSON.stringify(namedArgs(params, ctx))).toBe(JSON.stringify(namedArgsBefore(params, ctx)));
    expect(namedArgs(params, ctx)['p_at']).toBe('2027-06-01T00:30:00.000Z');
  });

  it('namedRpcArgs は意味を返す（record / patch / value）', () => {
    const ctx: ArgsContext = {
      ...contextOf('value'),
      resolution: { ...contextOf('value').resolution, input: { id: 'i', a: undefined, b: null, c: 'v' } },
    };
    const params: RunParam[] = [
      { name: 'p_id', source: { kind: 'input_target_id' } },
      { name: 'p_values', source: { kind: 'input_values', fields: ['a', 'b', 'c'] } },
      { name: 'p_changes', source: { kind: 'input_changes', fields: ['a', 'b', 'c'] } },
    ];
    expect(namedRpcArgs(params, ctx)).toEqual({
      p_id: { kind: 'value', value: 'i' },
      p_values: {
        kind: 'record',
        fields: { a: { kind: 'absent' }, b: { kind: 'null' }, c: { kind: 'value', value: 'v' } },
      },
      p_changes: {
        kind: 'patch',
        changes: { a: { kind: 'unchanged' }, b: { kind: 'clear' }, c: { kind: 'set', value: 'v' } },
      },
    });
  });
});

describe('入口の正規化の拒否（運べない値は引数に載せない）', () => {
  const bad: readonly [string, unknown][] = [
    ['配列の中の undefined', [1, undefined]],
    ['NaN', Number.NaN],
    ['BigInt', 10n],
    ['入れ子の undefined の鍵', { a: { b: undefined } }],
    ['関数', () => 1],
  ];

  it.each(bad)('入力の欄（最上位・record・patch）に %s があれば止める', (_label, value) => {
    const ctx: ArgsContext = {
      ...contextOf('value'),
      resolution: { ...contextOf('value').resolution, input: { id: 'i', f: value } },
    };
    for (const source of [
      { kind: 'input_field', field: 'f' },
      { kind: 'input_values', fields: ['f'] },
      { kind: 'input_changes', fields: ['f'] },
    ] as const) {
      expect(() => namedArgs([{ name: 'p_x', source }], ctx)).toThrow(ProgrammingError);
    }
  });

  it('計算値と読んだ事実が運べない値を返したときも止める', () => {
    const ctx: ArgsContext = {
      ...contextOf('value'),
      computes: { calc: () => Number.POSITIVE_INFINITY },
    };
    expect(() => namedArgs([{ name: 'p_x', source: { kind: 'computed', field: 'x', ref: 'calc' } }], ctx)).toThrow(
      ProgrammingError,
    );
    const facts = { 'widget.state': Number.NaN } as unknown as ArgsContext['resolution']['facts'];
    const withFacts: ArgsContext = { ...contextOf('value'), resolution: { ...contextOf('value').resolution, facts } };
    expect(() => namedArgs([{ name: 'p_x', source: { kind: 'expected_state', ref: 'widget.state' } }], withFacts)).toThrow(
      ProgrammingError,
    );
  });
});
