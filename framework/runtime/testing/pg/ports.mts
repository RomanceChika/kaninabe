import type { CommitOutcome, DbPorts, FactReader, FactScalar, Json, RpcCaller, RpcReturn, UsecaseRepository } from '@kaninabe/runtime/ports';
import { receiptOf } from '@kaninabe/runtime/ports';
import { buildFactsCall, buildRpcCall } from './encode.mjs';
import { outcomeOfError } from './failure.mjs';
import type { PgPortsOptions, PgSignature } from './types.mjs';

/**
 * **pg の参照 adapter**: 素の pg のクライアントで、runtime の中立のポート(`DbPorts`)を満たす。
 *
 * 位置づけ: pg の adapter はまず `runtime/testing` の参照実装に留め、公開パッケージは契約(`contract/*`)が
 * 両方の adapter で成り立ってからにする(③-e2 の設計の決定)。
 *
 * PostgREST の adapter(`@kaninabe/adapter-postgrest`)と**同じ契約**を、別の運び方で満たす。違いは運び方だけである:
 *
 * | | PostgREST の adapter | この adapter |
 * |---|---|---|
 * | 呼び方 | `rpc(name, 名前付き引数の JSON)` | `select … from api.fn(名前 => $n::型)` |
 * | 引数の型・戻り値の形 | DB(PostgREST)が決める | 署名の表(`rpc-signatures`)から引く |
 * | 失敗の読み方 | HTTP のエラーの `code` / `details` | `DatabaseError` の SQLSTATE と、接続の失敗の原因コード |
 * | 再試行 | しない | しない |
 *
 * 結果の読み方・受領・拒否の分類・コミットの状態(`not_committed` は接続の前に落ちたと証明できるときだけ)は
 * 契約が決めており、`contract/*` の群が**両方に同じ試験**を当てる。ここは参照の実装なので、接続のプールも再試行も
 * タイムアウトの方針も持たない(呼び側が渡す `client` の仕事)。
 */

/** `p_effects` に載せた効果の ID を、要求の写しとして取り出す(要求の写しであって、積んだことの証明ではない)。 */
function requestedEffectsOf(args: Readonly<Record<string, unknown>>): readonly string[] {
  const effects = args['p_effects'];
  return Array.isArray(effects) ? (effects as readonly unknown[]).filter((id): id is string => typeof id === 'string') : [];
}

/** 結果の読み方の宣言(隣り合う真偽値の取り違えを型で防ぐため、名前つきで渡す)。 */
interface RunOptions {
  /** 0 行を競合と読むか(条件つきで書く定型 RPC は true、jsonb を返す複合 RPC は false)。 */
  readonly emptyIsConflict: boolean;
  /** 引数 `p_effects` を要求した効果として受領に写すか(false なら `null` = 追っていない)。 */
  readonly tracksEffects: boolean;
}

/** 1 行 1 列(`result`)に畳んだ結果を、戻り値の形に読む。 */
function returnedOf(shape: PgSignature['returns'], rows: readonly Readonly<Record<string, unknown>>[]): RpcReturn {
  const result = rows[0]?.['result'];
  if (shape === 'rows') return { shape: 'rows', rows: Array.isArray(result) ? (result as readonly Json[]) : [] };
  return { shape: 'document', document: (result ?? null) as Json };
}

/** 事実の読み取りの口を作る。 */
function factReaderOf(options: PgPortsOptions, schema: string): FactReader {
  return {
    async readFields(view, id, fields) {
      const call = buildFactsCall(schema, view, id, fields);
      let rows: readonly Readonly<Record<string, unknown>>[];
      try {
        rows = (await options.client.query(call.text, call.values)).rows;
      } catch (error) {
        throw new Error(`${view} の取得に失敗しました: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      const row = rows[0]?.['row'];
      if (row === undefined || row === null || typeof row !== 'object') return null;
      const facts: Record<string, FactScalar> = {};
      for (const field of fields) {
        const value = (row as Readonly<Record<string, unknown>>)[field];
        // ガード式が扱えるスカラーだけを載せる(それ以外の型は落とす。PostgREST の adapter と同じ)。
        facts[field] = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null;
      }
      return facts;
    },
  };
}

/** RPC を 1 回流し、契約の形の結果にする(単発の口と複合の口が共有する唯一の入口。再試行しない)。 */
async function runRpc(
  options: PgPortsOptions,
  schema: string,
  rpc: string,
  args: Readonly<Record<string, unknown>>,
  run: RunOptions,
): Promise<CommitOutcome<RpcReturn>> {
  const signature = options.signatures[rpc];
  if (signature === undefined) throw new Error(`署名の表に無い RPC です: ${rpc}(呼べる RPC は署名の表の閉世界だけ)`);
  const call = buildRpcCall(schema, rpc, signature, args);
  let rows: readonly Readonly<Record<string, unknown>>[];
  try {
    rows = (await options.client.query(call.text, call.values)).rows;
  } catch (error) {
    return outcomeOfError(error, options.invariantOfMessage);
  }
  const returned = returnedOf(signature.returns, rows);
  if (run.emptyIsConflict && returned.shape === 'rows' && returned.rows.length === 0) return { kind: 'conflict', op: '' };
  return { kind: 'saved', receipt: receiptOf(returned, run.tracksEffects ? requestedEffectsOf(args) : null) };
}

/**
 * 素の pg のクライアントで `DbPorts`(事実の読み取り・定型 RPC・保存点の複合 RPC)を作る。
 *
 * @param options - 問い合わせの口・署名の表・不変条件の引き方・スキーマ
 * @returns 3 つの口の束(1 回の呼び出し = RPC 1 本 = トランザクション 1 つ。再試行しない)
 * @throws Error 署名の表に無い RPC・引数名、運べない型の値、識別子として危ない綴りで呼んだとき(呼び出し側の誤り)
 */
export function createPgPorts(options: PgPortsOptions): DbPorts {
  const schema = options.schema ?? 'api';
  const rpc: RpcCaller = {
    call: (name, args, callOptions) =>
      runRpc(options, schema, name, args, { emptyIsConflict: true, tracksEffects: callOptions?.tracksEffects ?? true }),
  };
  const usecases: UsecaseRepository = {
    call: (name, args) =>
      runRpc(
        options,
        schema,
        name,
        { p_id: args.id, p_actor_id: args.actorId, p_actor_roles: [...args.actorRoles], p_expected: args.expected, p_input: args.input },
        { emptyIsConflict: false, tracksEffects: false },
      ),
  };
  return { facts: factReaderOf(options, schema), usecases, rpc };
}
