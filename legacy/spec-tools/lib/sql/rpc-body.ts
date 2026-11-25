/**
 * 定型 RPC の migration 1 枚(署名・本文・権限)の組み立て。
 *
 * ## なぜ本文が生成物になるのか
 *
 * 5 形のうち composite 以外の 4 つは、**何をどう書き込むかが宣言から決まる** ——
 * 許可列は `access_spec` の `writes`、楽観的並行制御は引数の `p_expected_…`、監査ログの語彙は
 * 操作 ID、副作用は `effects`、空を渡された列の扱いは `clears` である。決まっているものを
 * 手で書き写すと、写し間違いを見張る機械(`rpc-parity` の断片の突合)が別に要る ——
 * 生成してしまえば、その機械は「生成物どおりの本文が当たっているか」の 1 行で済む。
 *
 * migration が追記専用の歴史であることとの両立は、複合 RPC(`saves[].migration`)と同じ手で
 * 取る —— **ファイル名を仕様に宣言させ(`functions[].migration`)、SQL が変わる仕様変更では
 * 名前を新しくする**(migrations.md §生成 migration)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { sqlCommentText } from '../kernel/safe-text.js';
import { RPC_BODY_WORDS } from '../messages/messages.js';
import type { RpcCommentFacts } from '../messages/messages-rpc-comment.js';
import { rpcBodyComment } from '../messages/messages-rpc-comment.js';
import { sqlLiteral } from './guard-to-sql.js';
import { dropStaleOverloads } from './rpc-signature.js';
import type { RpcBodyFacts, RpcFactsInput } from './rpc-facts.js';
import { collectRpcFacts } from './rpc-facts.js';
import { fkCheckOrderProblems } from './rpc-fk-check-order.js';
import type { RpcBodyBlock } from './rpc-body-shapes.js';
import { createBlock, deleteBlock, transitionBlock, updateBlock } from './rpc-body-shapes.js';
import type { RpcBodyProblem } from './rpc-params.js';
import type { PlatformProfile } from '../model/product/platform-profile.js';
import { privilegedRole } from './platform-sql.js';
import type { EndSessionsWiring } from './rpc-end-sessions.js';

/** 生成の結果。 */
export type RpcBodyResult =
  | { readonly ok: true; readonly sql: string }
  | { readonly ok: false; readonly problems: readonly RpcBodyProblem[] };

/** 生成に要る入力(事実の引き当てと、正を示すための仕様ファイル)。 */
export interface RpcBodyInput extends RpcFactsInput {
  /** この本文の正になる仕様ファイル(リポジトリルート相対)。 */
  readonly specFiles: readonly string[];
  /** 集約の表示名(コメントに載せる。無ければ集約名)。 */
  readonly entityLabel: string;
  /**
   * プラットフォームの設定。RPC の置き場(API スキーマ方式で全 RPC は設定の外に出すスキーマに住む)と、
   * 実行を許す唯一のロール(内部実行。database-guards.md)をここから引く。
   */
  readonly platform: PlatformProfile;
  /** セッションを終える呼び出しの配線(遷移だけが使う。ジョブカタログの `ends_sessions` から呼び手が導く。R11)。 */
  readonly endSessions?: EndSessionsWiring;
}

/**
 * 定型 RPC 1 本の migration を組み立てる。
 *
 * @param input 関数の宣言・表・ドメイン仕様・呼ぶ操作・正の仕様ファイル
 * @returns SQL 1 枚、または理由つきの失敗
 */
export function buildRpcBody(input: RpcBodyInput): RpcBodyResult {
  const collected = collectRpcFacts(input);
  if (!collected.ok) return collected;
  const facts = collected.facts;
  // 書く参照の列の新しい親を先掴みが同じ値で掴めない形は断る(点検 fix26 3 回目 D26c-1・D26c-2。T6 が同じ 1 本を宣言の時点で呼ぶ)。
  const order = fkCheckOrderProblems(input, facts);
  if (order.length > 0) return { ok: false, problems: order };
  const block = blockOf(input.shape, facts, input.endSessions);
  const schema = input.platform.exposedSchema;
  const signature = `${schema}.${input.name}(${input.args.join(', ')})`;
  return {
    ok: true,
    sql: [
      ...header(input),
      '',
      ...dropStaleOverloads(schema, input.name, input.args),
      '',
      `create or replace function ${schema}.${input.name}(`,
      input.params.map((name, index) => `    ${name} ${input.args[index] ?? 'unknown'}`).join(',\n'),
      `) returns setof public.${facts.table}`,
      'language plpgsql',
      'security definer',
      'set search_path = public',
      'as $$',
      'declare',
      ...block.declares,
      'begin',
      ...block.statements,
      'end;',
      '$$;',
      '',
      `comment on function ${signature} is`,
      `    ${sqlLiteral(rpcBodyComment(input.entityLabel, input.shape, commentFacts(input.shape, facts)))};`,
      '',
      `revoke all on function ${signature} from public;`,
      `grant execute on function ${signature} to ${privilegedRole(input.platform)};`,
      '',
    ].join('\n'),
  };
}

/** 形ごとの本文。 */
function blockOf(shape: RpcBodyInput['shape'], facts: RpcBodyFacts, endSessions: EndSessionsWiring | undefined): RpcBodyBlock {
  switch (shape) {
    case 'create':
      return createBlock(facts);
    case 'update':
      return updateBlock(facts);
    case 'delete':
      return deleteBlock(facts);
    case 'transition':
      return transitionBlock(facts, endSessions);
  }
}

/** `comment on function` に載せる契約(形と事実から決まる)。 */
function commentFacts(shape: RpcBodyInput['shape'], facts: RpcBodyFacts): RpcCommentFacts {
  return {
    resend: shape === 'create' ? facts.resend : null,
    conflictOnZeroRows: shape !== 'create',
    redacted: redactedColumns(shape, facts),
  };
}

/**
 * 監査ログで値を伏せる列。
 *
 * 作成は入れる列(`p_values` の欄はここに展開済み。実行者そのものが入る列と id は payload に
 * 載らないので除く)、編集は許可列である。削除・遷移は payload を持たない。
 */
function redactedColumns(shape: RpcBodyInput['shape'], facts: RpcBodyFacts): readonly string[] {
  if (shape === 'create') {
    return facts.personalIn(
      facts.insertColumns.filter((column) => !column.actor && column.name !== 'id').map((column) => column.name),
    );
  }
  if (shape === 'update') return facts.personalIn(facts.writeColumns.map((field) => field.name));
  return [];
}

/** 先頭の AUTO-GENERATED ヘッダ(SQL コメント)。 */
function header(input: RpcBodyInput): readonly string[] {
  return [
    `-- ${RPC_BODY_WORDS.generatedHeader}`,
    '--',
    ...RPC_BODY_WORDS.generatedNote.map((line) => `-- ${line}`),
    ...input.specFiles.map((file) => `--   - ${sqlCommentText(file)}`),
    '--',
    ...RPC_BODY_WORDS.migrationNote.map((line) => `-- ${line}`),
  ];
}
