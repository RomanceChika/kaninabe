import type { CommitOutcome, DbPorts, RpcReturn } from '@kaninabe/runtime/ports';
import type { Call, Channel, ContractDriver, NeutralOutcome, Scenario, Situation } from './types.mjs';

/**
 * 結果を中立の形(契約が約束する部分だけ)にする。
 *
 * 元の失敗(`cause`)・戻り値の中身は落とす。adapter が違えば元の失敗の形は違って当たり前で、
 * 契約が約束するのは「何が起きたか」(種類・コミットの状態・落ちた操作・不変条件・SQLSTATE)である。
 *
 * @param outcome - 口が返した結果
 * @returns 中立の結果
 */
export function neutralOf(outcome: CommitOutcome<RpcReturn>): NeutralOutcome {
  switch (outcome.kind) {
    case 'saved':
      return {
        kind: 'saved',
        shape: outcome.receipt.returned.shape,
        requestedEffects: outcome.receipt.requestedEffects,
        outbox: outcome.receipt.outbox,
      };
    case 'conflict':
    case 'forbidden':
    case 'guard_unsatisfied':
      return { kind: outcome.kind, op: outcome.op };
    case 'invariant_violated':
      return { kind: 'invariant_violated', invariant: outcome.invariant };
    case 'transport_failed':
      return { kind: 'transport_failed', commit: outcome.commit };
    case 'unknown_failure':
      return { kind: 'unknown_failure', commit: outcome.commit, sqlstate: outcome.sqlstate };
  }
}

/**
 * 呼び出しを、口の束の該当する口に通す。
 *
 * @param ports - 口の束
 * @param call - 呼び出し
 * @returns 口が返した結果
 */
export function runCall(ports: DbPorts, call: Call): Promise<CommitOutcome<RpcReturn>> {
  return call.port === 'rpc' ? ports.rpc.call(call.rpc, call.args, call.options) : ports.usecases.call(call.rpc, call.args);
}

/** 開いて・呼んで・結果を取った 1 回。 */
export interface Ran {
  readonly channel: Channel;
  readonly outcome: CommitOutcome<RpcReturn>;
}

/**
 * 状況のために口を開き、その状況の呼び出しを 1 回流す。
 *
 * @param driver - 当てる adapter
 * @param situation - 起こす状況
 * @param scenario - その状況の呼び出しと期待
 * @returns 開いた口(観測つき)と結果
 */
export async function ran(driver: ContractDriver, situation: Situation, scenario: Scenario): Promise<Ran> {
  const channel = await driver.open(situation, scenario);
  const outcome = await runCall(channel.ports, scenario.call);
  return { channel, outcome };
}
