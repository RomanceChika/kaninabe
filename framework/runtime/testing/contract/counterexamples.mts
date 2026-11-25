import type { CommitOutcome, DbPorts, RpcReturn } from '@kaninabe/runtime/ports';
import type { Channel, ContractDriver } from './types.mjs';

/**
 * 契約テストの**反例の実装**(試験の束が空振りしていないことを示すためのもの)。
 *
 * 契約の試験は「正しい実装で緑になる」だけでは、壊れた実装で赤になることを示さない。ここに、契約を 1 つずつ
 * 破るドライバの包みを置く —— 本物のドライバの口を、わざと壊した振る舞いに包み直す。壊す点は群ごとに 1 つで、
 * 対応する群が赤になり、ほかの群は緑のままである(単体テストが両方を見る)。
 */

/** 口の束の両方の呼び出しを、結果の変換を挟んだものに包む。 */
function mapOutcomes(ports: DbPorts, map: (outcome: CommitOutcome<RpcReturn>) => Promise<CommitOutcome<RpcReturn>> | CommitOutcome<RpcReturn>): DbPorts {
  return {
    facts: ports.facts,
    rpc: { call: async (rpc, args, options) => map(await ports.rpc.call(rpc, args, options)) },
    usecases: { call: async (rpc, args) => map(await ports.usecases.call(rpc, args)) },
  };
}

/** ドライバの口の束だけを差し替えた別のドライバにする(観測はそのまま)。 */
function decorate(driver: ContractDriver, name: string, wrap: (channel: Channel) => DbPorts): ContractDriver {
  return {
    name,
    open: async (situation, scenario) => {
      const channel = await driver.open(situation, scenario);
      return { ports: wrap(channel), sent: () => channel.sent() };
    },
    close: () => driver.close(),
  };
}

/**
 * ① 反例: 最上位の引数の未指定(`undefined`)を NULL にして運ぶ。
 *
 * PostgREST は `undefined` を引数ごと落とし、pg の素朴な実装(`args[name] ?? null`)は NULL にする —— この逆転が
 * 「未指定を null にする」反例である。型は `undefined` を許さないが、実行時に紛れ込んだとき契約が破れる。
 *
 * @param driver - 壊す相手
 * @returns `undefined` を `null` にして運ぶドライバ
 */
export function nullsUndefined(driver: ContractDriver): ContractDriver {
  return decorate(driver, `${driver.name}(未指定を null にする)`, ({ ports }) => ({
    facts: ports.facts,
    usecases: ports.usecases,
    rpc: {
      call: (rpc, args, options) =>
        ports.rpc.call(rpc, Object.fromEntries(Object.entries(args).map(([name, value]) => [name, value ?? null])), options),
    },
  }));
}

/**
 * ② 反例: 業務の拒否(`forbidden`)を、仕様に無い失敗にして返す。
 *
 * @param driver - 壊す相手
 * @returns 拒否の分類を誤るドライバ
 */
export function misclassifiesRefusals(driver: ContractDriver): ContractDriver {
  return decorate(driver, `${driver.name}(拒否を取り違える)`, ({ ports }) =>
    mapOutcomes(ports, (outcome) => (outcome.kind === 'forbidden' ? { kind: 'conflict', op: outcome.op } : outcome)),
  );
}

/**
 * ③ 反例: コミット不明の通信の失敗を、届く前に落ちた(`not_committed`)と言う。
 *
 * @param driver - 壊す相手
 * @returns コミットの状態を偽るドライバ
 */
export function claimsNotCommitted(driver: ContractDriver): ContractDriver {
  return decorate(driver, `${driver.name}(コミット不明を not_committed と言う)`, ({ ports }) =>
    mapOutcomes(ports, (outcome) => (outcome.kind === 'transport_failed' ? { ...outcome, commit: 'not_committed' } : outcome)),
  );
}

/**
 * ④ 反例: コミット不明の失敗を、もう一度送って確かめる(自動の再試行)。
 *
 * @param driver - 壊す相手
 * @returns 通信の失敗を再試行するドライバ
 */
export function retriesTransportFailures(driver: ContractDriver): ContractDriver {
  return decorate(driver, `${driver.name}(再試行する)`, ({ ports }) => ({
    facts: ports.facts,
    rpc: {
      call: async (rpc, args, options) => {
        const first = await ports.rpc.call(rpc, args, options);
        return first.kind === 'transport_failed' ? ports.rpc.call(rpc, args, options) : first;
      },
    },
    usecases: {
      call: async (rpc, args) => {
        const first = await ports.usecases.call(rpc, args);
        return first.kind === 'transport_failed' ? ports.usecases.call(rpc, args) : first;
      },
    },
  }));
}

/**
 * ⑤ 反例: 引数から「今回積んだ」を作る(受領の `outbox` を確定にする)。
 *
 * @param driver - 壊す相手
 * @returns outbox を確定と言うドライバ
 */
export function claimsOutboxCommitted(driver: ContractDriver): ContractDriver {
  return decorate(driver, `${driver.name}(積んだと言う)`, ({ ports }) =>
    mapOutcomes(ports, (outcome) =>
      outcome.kind === 'saved' ? { kind: 'saved', receipt: { ...outcome.receipt, outbox: 'committed_by_this_call' } } : outcome,
    ),
  );
}
