/**
 * 定型 RPC に付ける `comment on function` の文の組み立て。
 *
 * 文言そのもの(`RPC_BODY_WORDS`)は `messages.ts` にあり、ここは宣言から決まる事実(冪等キー・
 * 0 行の意味・伏せる列)を受けてその語を並べる。使い手は RPC 本文を組む `sql/rpc-body.ts` の 1 本で、
 * 文言の層の葉として置いてある(`messages.ts` を読み、`messages.ts` はここを読まない)。
 */

import { OPERATION_VERBS, RPC_BODY_WORDS } from './messages.js';

/**
 * 再送の方針(`usecase/resend-policy.ts` の `ResendPolicy` と同じ形)。文言の層は導出の層を読まないので、
 * 形だけをここに写す(構造で一致するので、渡す側はそのまま渡せる)。
 */
export type RpcCommentResend = { readonly kind: 'own'; readonly creator: string } | { readonly kind: 'recorded' } | { readonly kind: 'conflict' };

/** 定型 RPC の形 → 動作の名前(`comment on function` の主語)。 */
const RPC_SHAPE_VERBS: Readonly<Record<string, string>> = {
  create: OPERATION_VERBS.create,
  update: OPERATION_VERBS.update,
  delete: OPERATION_VERBS.delete,
  transition: '状態遷移',
};

/** `comment on function` に載せる契約(宣言から機械的に決まる事実)。 */
export interface RpcCommentFacts {
  /** 冪等な再送の方針(作成。それ以外は null)。 */
  readonly resend: RpcCommentResend | null;
  /** 0 行が競合を意味するか(編集・削除・遷移)。 */
  readonly conflictOnZeroRows: boolean;
  /** 監査ログに値を残さない個人の欄。 */
  readonly redacted: readonly string[];
}

/**
 * 定型 RPC に付ける `comment on function` の文。
 *
 * `\df+` しか見ない人にとって、ここが **DB 側に残る唯一の説明**である(D16/D17)。動作の名前
 * だけでは契約が読めないので、宣言から機械的に決まる事実(冪等キー・0 行の意味・伏せる列)を足す。
 *
 * @param label 集約の表示名(仕様の `label`。無ければ集約名)
 * @param shape 形
 * @param facts 宣言から決まる契約
 * @returns コメント本文
 */
export function rpcBodyComment(label: string, shape: string, facts: RpcCommentFacts): string {
  return [
    `${label}の${RPC_SHAPE_VERBS[shape] ?? shape}(生成物)。`,
    ...idempotentNote(facts.resend),
    RPC_BODY_WORDS.commentEnforces,
    ...(facts.conflictOnZeroRows ? [RPC_BODY_WORDS.commentZeroRows] : []),
    ...(facts.redacted.length === 0 ? [] : [`${RPC_BODY_WORDS.commentRedacted}: ${facts.redacted.join(' / ')}。`]),
  ].join('');
}

/** 冪等キーの契約(作成だけ。方針で文が変わる)。 */
function idempotentNote(resend: RpcCommentResend | null): readonly string[] {
  if (resend === null) return [];
  switch (resend.kind) {
    case 'own':
      return [`${RPC_BODY_WORDS.commentIdempotentOwn}: ${resend.creator}。`];
    case 'recorded':
      return [RPC_BODY_WORDS.commentIdempotentRecorded];
    case 'conflict':
      return [RPC_BODY_WORDS.commentIdempotentConflict];
  }
}
