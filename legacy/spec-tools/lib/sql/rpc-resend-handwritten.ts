/**
 * **本文が手書きの作成 RPC** に要求する、再送の入力の比べの期待(点検 20 回目 B20-1 の残り)。
 *
 * 再送の枝の本体(SQL の字面と拒否の語)は `rpc-resend.ts` が持つ。ここはその枝を通らない手書きの本文に、
 * 同じ振る舞いを要求する期待を導くだけである(生成器 `generate/render/code-rpc-expectations.ts` が呼び、
 * rpc-parity の `resend-input-check.ts` が実 DB の本文と突き合わせる)。`rpc-resend.ts` と分けたのは、そちらが形式モデル
 * (冪等な作成・楽観的並行制御)の写し元の閉包に入っていて、実行計画の型をそこへ引き込まないため。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DataFunctionDecl, DataTableSpec } from '../model/data/types.js';
import type { BuiltOperation } from '../usecase/operation-plan.js';
import { RESEND_INPUT_MISMATCH, RESEND_SIGNAL_SETTING } from './rpc-resend.js';
import { RESEND_TARGET_DELETED } from './rpc-resend-digest.js';

/** 手書きの作成 RPC に要求する、再送の入力の比べ(拒否の語と、比べなければならない列)。 */
export interface HandwrittenResendExpectation {
  /** 入力が違う再送を断る拒否の語(`sql/rpc-resend.ts` の 1 か所から引く)。 */
  readonly word: string;
  /** 既存の行と今回の入力を比べる列(作成の入力から入る列。トリガが供給する列は除く。辞書順)。 */
  readonly compared: readonly string[];
  /**
   * 再送で既存の行を返すときに立てる印の設定の名前(`rpc-resend.ts` の `RESEND_SIGNAL_SETTING`。点検 22 回目 A22-1)。
   * 保存点の複合 RPC は錨の作成 RPC のこの印で「再送だった」を知り、以降の手順を実行しない。手書きの本文も同じ印を立てる。
   */
  readonly signal: string;
  /**
   * 1 回目の行が消された後の同じ鍵の押し直しを断る拒否の語(`rpc-resend-digest.ts` の `RESEND_TARGET_DELETED`。点検 23 回目 O23-2)。
   * 生成の作成 RPC は行を入れた後に監査ログの 1 回目の作成を見て断る(`rpc-resend.ts` の `refuseRecreated`)。手書きの本文も同じ語で断る。
   */
  readonly deleted: string;
}

/**
 * **本文が手書きの作成 RPC** に、再送の入力の比べを要求する(点検 20 回目 B20-1 の残り)。
 *
 * 生成の作成 RPC は再送の枝を `sql/rpc-resend.ts` から出すので、持ち主の確かめと入力の比べ(違えば
 * `resend_input_mismatch`)が必ず入る(rpc-parity は本文の丸ごと一致で見る)。手書きの本文(`shape: composite`・
 * `handwritten`)はその 1 か所を通らないので、同じ鍵で入力の違う再送に 1 回目の行を黙って返しうる
 * (製品の実例: テンプレートの複製のために手書きに留まった作成が、作成者だけを確かめ入力を比べていなかった)。
 *
 * 対象は「その関数が**作成の操作の RPC**であり(実行計画の最初の手順が create)、表が `resend.returns_existing: true`
 * を宣言している」ものだけである。比べる列は、その操作が入力から渡す欄(`input_values` / `input_field`)のうち、
 * トリガが供給しない列 —— 生成の作成 RPC の `resendComparedColumns` と同じ母集合を、手書きの本文には引数の字面が
 * 無いので実行計画の側から引く。rpc-parity はこの期待から、本文に拒否の語と各列の比べ(`.{列} is distinct from`)が
 * あることを見る。
 *
 * @param fn 関数の宣言
 * @param table 帰属表
 * @param operations 全操作の実行計画
 * @returns 期待(対象でなければ null)
 */
export function handwrittenResendExpectation(
  fn: Pick<DataFunctionDecl, 'name' | 'migration'>,
  table: Pick<DataTableSpec, 'resend' | 'triggers'>,
  operations: readonly Pick<BuiltOperation, 'plan' | 'params'>[],
): HandwrittenResendExpectation | null {
  if (fn.migration !== undefined || table.resend?.returnsExisting !== true) return null;
  const creates = operations.filter((operation) => operation.plan.rpcName === fn.name && operation.plan.steps[0]?.kind === 'create');
  if (creates.length === 0) return null;
  const supplied = new Set(table.triggers.flatMap((trigger) => trigger.supplies));
  const columns = new Set<string>();
  for (const operation of creates) {
    for (const param of operation.params) {
      if (param.source.kind === 'input_values') for (const field of param.source.fields) columns.add(field.name);
      if (param.source.kind === 'input_field') columns.add(param.source.field);
    }
  }
  return {
    word: RESEND_INPUT_MISMATCH,
    signal: RESEND_SIGNAL_SETTING,
    deleted: RESEND_TARGET_DELETED,
    compared: [...columns].filter((column) => column !== 'id' && !supplied.has(column)).sort((a, b) => a.localeCompare(b)),
  };
}
