/**
 * 単発の操作の **名前付き引数**(`RunCall` の `named`)の字面。
 *
 * 解決済みの供給元(`lib/usecase/param-source.ts` の `ParamSource`)を、実行器が読む形
 * (`RunParamSource`)に写すだけの写像である。**新しい規約はここに 1 つも無い** ——
 * 名前 → 供給元の規約は `param-source.ts` が唯一の正であり、ここは「複合 RPC(SQL)の側」
 * (`usecase-sql.ts`)と対になる「定型 RPC(TS)の側」の字面にすぎない。
 */

import type { BuiltOperation } from '../../usecase/operation-plan.js';
import type { ParamSource, ResolvedParam } from '../../usecase/param-source.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { preconditionFailure } from '../../kernel/generator-precondition.js';
import { renderLiteral } from '../../gen-kit/code-emit.js';

/**
 * `call: { kind: 'named', params: [...] }` のリテラル。
 *
 * @param operation 組み立て済みの操作
 * @returns インデント済みのオブジェクトリテラル
 */
export function renderNamedParams(operation: BuiltOperation): string {
  const params: LiteralValue[] = operation.params.map((param) => ({
    name: param.name,
    source: sourceLiteral(operation, param),
  }));
  return renderLiteral({ kind: 'named', params }, 2);
}

/**
 * 供給元 1 つを実行器が読む形に写す。
 *
 * 写せない供給元は**単発の操作には現れない**ものである(保存点の中で先に作った行の id・
 * 2 本目以降の作成の採番)。現れたら導出の前提が壊れているので、黙って落とさず
 * **A15 を示して Finding の形で止める**(scripts-code-quality.md §生成器は throw しない)。
 */
function sourceLiteral(operation: BuiltOperation, param: ResolvedParam): LiteralValue {
  const source: ParamSource = param.source;
  switch (source.kind) {
    case 'idempotency_key':
    case 'actor':
    case 'actor_roles':
    case 'input_target_id':
      return { kind: source.kind };
    case 'expected_state':
      // 単発では予測しないので、値は必ず「読んだ行の状態」である(`literal` は null)。
      return { kind: 'expected_state', ref: `${source.entity}.${source.field}` };
    case 'next_state':
      return { kind: 'next_state', state: source.state };
    case 'effects':
      return { kind: 'effects', effects: [...source.effects] };
    case 'write_effects':
      return { kind: 'write_effects' };
    case 'event_id':
      return { kind: 'event_id', event: source.event };
    case 'input_field':
      return { kind: 'input_field', field: source.field };
    case 'input_values':
    case 'input_changes':
      return { kind: source.kind, fields: source.fields.map((field) => field.name) };
    case 'computed':
      return { kind: 'computed', field: source.field, ref: source.ref };
    case 'not_written':
      return { kind: 'not_written', field: source.field, contract: source.contract };
    default:
      // 単発の操作の計画が仕様から決まることは A15 が先に見ている。
      return preconditionFailure('A15', [
        {
          message: `操作 ${operation.op} の引数 ${param.name} の供給元(${source.kind})は単発の操作に現れません`,
          suggestion:
            '保存点の中で先に作った行の id・2 本目以降の作成の採番は単発の操作には現れない供給元である。' +
            'その操作を保存点として宣言するか、呼ぶ RPC の引数を規約の形に直す',
          counterexample: { operation: operation.op, param: param.name, source: source.kind },
          location: { file: operation.plan.usecase.location.file, pointer: operation.op },
        },
      ]);
  }
}
