/**
 * 生成の文脈から、変異の目録の実測を**起動する**口(組み立ての根が生成器へ渡す)。
 *
 * 回すのは**この側**(変異の層)で、生成器の側(`lib/generate/**`)は結果の `MutationReport`
 * (データ。`kernel/mutation-report.ts`)を受け取るだけである。変異の検出器は生成器(DDL・RLS・RPC 本文)を呼ぶので、
 * 生成器が変異を起動すると両者が互いを読む形になる —— 起動を組み立ての根(CLI と通し実行のハーネス)
 * に置き、生成器は変異の層を値で読まない(`CLOSURE_BANS`。設計メモ framework-modules §13)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import type { GenerateContext } from '../gen-kit/generator.js';
import { mutationReportOf, mutationSubjectOf } from './matrix.js';
import type { MutationRunOutcome } from '../kernel/mutation-report.js';

/**
 * 変異の目録の実測を回す(材料が足りなければ `unavailable`。回せなかった理由を持つ)。
 *
 * 目録を載せる保証の章が出るとき(保証台帳が読めている)で、変異の対象になる data_table が読めている
 * ときだけ回す。変異の題材に渡す文脈は**実測の欄を持たない完成前の文脈**である(実測の結果は、実測が
 * 見る入力に入らない)。
 *
 * @param model ドメイン仕様全体
 * @param context 実測の欄を除く、完成した文脈
 * @returns 実測の結果(`ran`)、または回せなかった理由(`unavailable`)
 */
export function mutationReportOfContext(model: SpecModel, context: GenerateContext): MutationRunOutcome {
  if (context.guarantees?.available !== true) return { state: 'unavailable', reason: '保証台帳が無い' };
  if (context.guarantees.catalog === null) return { state: 'unavailable', reason: '保証台帳が読めていない' };
  if (context.dataTables?.available !== true) return { state: 'unavailable', reason: 'テーブル仕様が読めていない' };
  return {
    state: 'ran',
    report: mutationReportOf(
      mutationSubjectOf({
        name: '',
        model,
        guards: context.guards,
        actions: context.actions,
        dataTables: context.dataTables,
        jobs: context.jobs,
        context,
      }),
    ),
  };
}
