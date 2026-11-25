/**
 * エンジンが解釈する**規則表の中身**(遷移 / 作成 / 削除 / 編集)の唯一の組み立て。
 *
 * 生成物(`{machine}.transitions.ts` / `{entity}.{creates,deletes,writes}.ts`)の本体は
 * どれも「仕様の宣言を、エンジンの型契約(`app/src/domain/engine/types.ts`)と同じ形の
 * プレーンなデータに写したもの」である。写す規則をここ 1 か所に置くのは、**同じ表を読む
 * 相手が 2 つになった**からである(束 ⑳-5b)——
 *
 *   1. 生成器(`code-transitions` / `code-creates` / `code-deletes` / `code-writes`)が
 *      `renderLiteral` で TS のリテラルにして書き出す
 *   2. 結果表(`lib/results/`)が**同じデータをそのままエンジンに渡して**判定を採る
 *
 * 2 が 1 の写しを持つと、結果表が「実装とは違う表」を判定させて人に見せることになる ——
 * 表の作り方は 1 つでなければならない。
 *
 * **データはエンジンの型(`MachineTable` など)のまま運ぶ**。汎用の値型に潰すのは文字列に
 * する直前(`renderLiteral`)だけで、結果表は型を戻す必要が無い(エンジンの型の欄を変えれば、
 * 組み立てのここで型エラーになる)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type {
  AccessSpec,
  CreateRule,
  DeleteRule,
  EventDef,
  StateMachineSpec,
  WriteRule,
} from '../model/types.js';
import type { GuardServices } from '../guard/ast.js';
import type {
  CreateRuleDef,
  CreateTable,
  DeleteRuleDef,
  DeleteTable,
  GuardExprData,
  MachineTable,
  TransitionDef,
  WriteRuleDef,
  WriteTable,
} from '@kaninabe/runtime/engine';
import { guardExprData } from '../guard/expr-data.js';
import type { SpecModel } from '../model/types.js';
import { actorBoundFields, ruleBoundFields } from '../usecase/actor-bound.js';

/**
 * 状態機械 1 つの遷移表(`MachineTable` と同じ形)。
 *
 * @param machine state_spec の宣言
 * @param guards ガード式の解析
 * @returns 遷移表のデータ
 */
export function machineTableData(machine: StateMachineSpec, guards: GuardServices): MachineTable {
  return {
    machine: machine.machine,
    states: machine.states,
    initial: machine.initial,
    final: machine.final,
    transitions: machine.events.map((event) => transitionData(event, machine, guards)),
  };
}

/**
 * 作成規則表(`CreateTable` と同じ形)。
 *
 * @param access access_spec の宣言
 * @param guards ガード式の解析
 * @param binding 規則の縛り(`self`)を導く材料(null なら縛りを載せない)
 * @returns 作成規則表のデータ
 */
export function createTableData(
  access: AccessSpec,
  guards: GuardServices,
  binding: CreateBinding | null = null,
): CreateTable {
  const fields = binding === null ? [] : actorBoundFields(binding.domain, access.entity, binding.inputFields);
  const roles = binding?.domain.roles.roles ?? [];
  return {
    entity: access.entity,
    rules: access.creates.map((rule) => {
      const self = ruleBoundFields(rule, roles, fields).map((field) => `${access.entity}.${field}`);
      return { ...createRuleData(rule, guards), ...(self.length === 0 ? {} : { self }) };
    }),
  };
}

/**
 * 作成規則の**縛り**(`self`)を導くのに要るもの(`usecase/actor-bound.ts`)。
 *
 * 渡さなければ縛りは載らない —— 生成物と実行計画と DB は必ず渡す。渡さないのは縛りに依らない読み手だけである。
 */
export interface CreateBinding {
  readonly domain: SpecModel;
  /** その作成が入力に受ける欄(action_spec の `input`)。 */
  readonly inputFields: readonly string[];
}

/**
 * 削除規則表(`DeleteTable` と同じ形)。
 *
 * @param access access_spec の宣言
 * @param guards ガード式の解析
 * @returns 削除規則表のデータ
 */
export function deleteTableData(access: AccessSpec, guards: GuardServices): DeleteTable {
  return {
    entity: access.entity,
    rules: access.deletes.map((rule) => deleteRuleData(rule, guards)),
  };
}

/**
 * 編集規則表(`WriteTable` と同じ形)。
 *
 * @param access access_spec の宣言
 * @param guards ガード式の解析
 * @returns 編集規則表のデータ
 */
export function writeTableData(access: AccessSpec, guards: GuardServices): WriteTable {
  return {
    entity: access.entity,
    rules: access.writes.map((rule) => writeRuleData(rule, guards)),
  };
}

/**
 * イベント 1 件を TransitionDef にする。
 *
 * ガードは生文字列のままではエンジンが評価できないため AST に変換して埋め込むが、
 * 原文も guardSource として残す(エラーメッセージや突合のため)。verify を通った仕様だけが
 * 生成器の入力になる(CLI はスキーマエラー時に生成を中止する)のでパース不能は起こらない前提だが、
 * 万一そうなっても throw せず「guard 省略 + guardSource だけ残す」に縮退する。
 *
 * otherwise_forbidden(from に無い状態での禁止理由)も出力に含める。実装はこれを拒否の理由文として
 * そのまま返すため(server-actions.md「戻り値の型」)、仕様の文言を実装側で書き直させないための経路になる。
 *
 * 鍵の並びは `event` → `from` → `to` → `by` → (`guard` → `guardSource`)→
 * `otherwiseForbidden` → `effects` である(生成物の字面がこの順で固定されている)。
 */
function transitionData(
  event: EventDef,
  machine: StateMachineSpec,
  guards: GuardServices,
): TransitionDef {
  return {
    event: event.id,
    from: event.from,
    to: event.to,
    by: event.by,
    ...guardData(event.guard, guards),
    ...(event.otherwiseForbidden === undefined ? {} : { otherwiseForbidden: event.otherwiseForbidden }),
    effects: effectsFor(machine, event.id),
  };
}

/** そのイベントに紐づく副作用(outbox ジョブ ID)を、effects の宣言順に集約する。 */
function effectsFor(machine: StateMachineSpec, eventId: string): readonly string[] {
  const jobs: string[] = [];
  for (const effect of machine.effects) {
    if (effect.on !== eventId) continue;
    for (const job of effect.do) jobs.push(job);
  }
  return jobs;
}

/**
 * creates 1 件を CreateRuleDef にする。
 *
 * `when` は生文字列のままではエンジンが評価できないため AST に変換して埋め込むが、
 * 原文も guardSource として残す(エラーメッセージや突合のため)。パース不能な式は
 * 検証(V1/V2)で先に落ちる前提だが、万一そうなっても throw せず
 * 「guard 省略 + guardSource だけ残す」に縮退する(遷移表と同じ方針)。
 */
function createRuleData(rule: CreateRule, guards: GuardServices): CreateRuleDef {
  return { by: rule.by, ...guardData(rule.when, guards) };
}

/** deletes 1 件を DeleteRuleDef にする(`when` の扱いは creates と同じ)。 */
function deleteRuleData(rule: DeleteRule, guards: GuardServices): DeleteRuleDef {
  return { by: rule.by, ...guardData(rule.when, guards) };
}

/**
 * writes 1 件を WriteRuleDef にする。
 *
 * `when` の扱いは creates / deletes と同じ(AST + 原文を両方載せ、パース不能なら guard を
 * 落として guardSource だけ残す)。
 */
function writeRuleData(rule: WriteRule, guards: GuardServices): WriteRuleDef {
  return {
    by: rule.by,
    fields: [...rule.fields],
    ...guardData(rule.when, guards),
    ...(rule.effects !== undefined && rule.effects.length > 0 ? { effects: [...rule.effects] } : {}),
  };
}

/**
 * ガード式を AST と原文の 2 つの鍵で載せる(宣言が無ければ何も載せない)。
 *
 * 鍵の並びは `guard` → `guardSource` である —— 生成物の字面がこの順で固定されているので、
 * 入れ替えると差分が出る(生成物の鮮度チェックが拾う)。
 */
function guardData(
  source: string | undefined,
  guards: GuardServices,
): { readonly guard?: GuardExprData; readonly guardSource?: string } {
  if (source === undefined) return {};
  const parsed = guards.parse(source);
  const data = parsed.ok ? guardExprData(parsed.expr) : null;
  // エンジンに反映できない節点(`is null`)を含む式も、パース不能と同じく原文だけを残す。
  return data === null ? { guardSource: source } : { guard: data, guardSource: source };
}
