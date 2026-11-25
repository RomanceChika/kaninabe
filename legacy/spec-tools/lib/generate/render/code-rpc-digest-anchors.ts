/**
 * 消去の RPC の期待表(`rpc-expectations.ts` の `digestAnchors`)に、**要約の錨の期待**を写す(点検 23 回目 A23-2 / A23-4)。
 *
 * 錨の表の集合は `usecase/resend-policy.ts`(`digestSaveOf`)、枝の導き方(要約が誰を覆うか)は `usecase/resend-digest-cover.ts`(`digestAnchorsOf` → `digestCoverOf`。T24 と同じ 1 本)が持ち、行が消えうるかは
 * `semantics/row-removal.ts`(T28・T24 と同じ定義)。ここは保存点を計画に起こして、それらを渡すだけである。製品の erase-parity
 * (本文の突合の純関数 `digestAnchorProblems`)が本文の union の枝と錨の無い要約の消し方を突き合わせる。
 *
 * 対象は、要約の表(`framework: resend_digests`)の錨の列を `scrub_via` に載せた RPC だけ。
 *
 * 規約どおりファイル I/O はせず、throw しない純関数。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../../model/types.js';
import type { DataFunctionDecl, DataTableSpec } from '../../model/data/types.js';
import type { UsecaseSpecModel } from '../../model/usecase/types.js';
import type { ActionSpecModel } from '../../model/trace/types.js';
import type { DataTableSpecModel } from '../../model/data/types.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { planSave } from '../../usecase/step-plan.js';
import { resolveSaveParams } from '../../usecase/param-source.js';
import { RESEND_DIGEST_FRAMEWORK, digestSaveOf, type DigestSave } from '../../usecase/resend-policy.js';
import { digestAnchorsOf } from '../../usecase/resend-digest-cover.js';
import { resendDigestEvent } from '../../sql/rpc-resend-digest.js';
import { frameworkAnchorColumnsOf } from '../../sql/framework-tables.js';
import { rowsRemovable } from '../../semantics/row-removal.js';

/**
 * 要約を残す保存点の全数(計画に起こせない保存点は Y8 / Y12 が先に止めるので、ここでは数えない)。
 *
 * @param model ドメイン仕様
 * @param usecases ユースケース仕様
 * @param actions action_spec
 * @param dataTables data_table
 * @returns 保存点
 */
export function digestSaves(
  model: SpecModel,
  usecases: UsecaseSpecModel | undefined,
  actions: ActionSpecModel | undefined,
  dataTables: DataTableSpecModel | undefined,
): readonly DigestSave[] {
  if (usecases === undefined || !usecases.available || dataTables === undefined) return [];
  return usecases.usecases.flatMap((usecase) =>
    usecase.saves.flatMap((save) => {
      const planned = planSave(usecase, save, { domain: model, actions: actions ?? null, dataTables });
      if (!planned.ok) return [];
      const resolved = resolveSaveParams(planned.plan, model);
      if (!resolved.ok) return [];
      const found = digestSaveOf(planned.plan, resolved.steps, resendDigestEvent(usecase.name, save.id));
      return found === null ? [] : [found];
    }),
  );
}

/**
 * その RPC の要約の錨の期待(対象でなければ null)。本人の表は RPC が帰属する表(消去の RPC は本人の表に置く)。
 *
 * @param fn 関数の宣言
 * @param table 帰属表
 * @param tables 全 data_table
 * @param model ドメイン仕様
 * @param saves 要約を残す保存点
 * @returns リテラル(対象でなければ null)
 */
export function digestAnchorsLiteral(fn: DataFunctionDecl, table: DataTableSpec, tables: readonly DataTableSpec[], model: SpecModel, saves: readonly DigestSave[]): LiteralValue | null {
  const store = tables.find((candidate) => candidate.framework === RESEND_DIGEST_FRAMEWORK);
  if (store === undefined) return null;
  const anchorColumns = frameworkAnchorColumnsOf(store.framework);
  if (!(fn.scrubVia?.[store.table] ?? []).some((column) => anchorColumns.includes(column))) return null;
  const entityOf = (name: string): string | undefined => tables.find((candidate) => candidate.table === name)?.entity;
  const anchors = digestAnchorsOf(saves, tables, table.table, (name) => {
    const entity = entityOf(name);
    return entity !== undefined && rowsRemovable(model, tables, entity);
  });
  return anchors.map((anchor) => ({
    event: anchor.event,
    table: anchor.table,
    branches: anchor.branches.map((branch) => ({ from: branch.from, column: branch.column, ...(branch.reverse === true ? { reverse: true } : {}), up: branch.up })),
    removable: anchor.removable,
  }));
}
