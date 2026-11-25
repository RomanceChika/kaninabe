/**
 * **作成の後に変えない列を DB が凍らせる**トリガ(`triggers[].freezes`。点検 fix26 2 回目 D26b-2・3・5・7 の根の直し)。
 *
 * 「この列を変える口が無い」を、関数の本文・ポリシー・権限・外部キーの連鎖を読んで静的に証明する照らしは、読みの穴を 4 回続けて出した
 * (トリガの返り値の書き換え・列だけの権限・連鎖・動的 SQL・ビュー経由)。証明をやめ、**執行**に切り替える —— 凍らせた列を書き換える
 * 更新は、どの経路から来ても(BEFORE のトリガの書き換え・外部キーの連鎖・列の権限・動的 SQL)行の最後の姿で比べて断る。
 *
 * - 発火は `after update` の行トリガで、**列を絞らない**(PostgreSQL の `update of` は SET に書いた列でしか発火しないので、BEFORE のトリガが
 *   `new` を書き換える経路を見落とす)。AFTER の行トリガは BEFORE のトリガが走った後の行を見る。
 * - 本文は OLD と NEW の凍らせた列を `is distinct from` で比べ(null も値として比べる)、違えば不変条件の違反の口(`check_violation`・
 *   制約名はトリガ名。`ddl-cross-check-body.ts` の `refusalLines`)で断る。何も読まないので呼び出し主体の権限で実行する。
 * - 宣言が通る形は {@link freezeProblemsOf} が決め、生成する側(ここ)と検査する側(T17)が同じ 1 本を呼ぶ。凍らせた列を作成の後に
 *   書き換える宣言があれば通さない。何を数えるかの持ち主は `model/written-after-create.ts` の `rewritesOfFrozen`(編集・遷移の宣言・
 *   外部キーの `set_null / set_default`・個人列・更新で発火する供給と導出・`insert_at`・作成でない操作の `computes`。点検 fix26 3 回目
 *   D26c-3)で、ここは表・集約・action_spec から入力を集めて呼ぶだけ。宣言の値だけを見る(SQL の本文の字面は数えない。本文が書き換えても
 *   凍結のトリガが断るので漏れない)。`computes` は action_spec にあり、生成器の DDL の経路は action_spec を持たないので T17 だけが見る ——
 *   T17 が error で止めるので、検査を通った宣言では生成器の判定と食い違わない。
 *
 * 不変条件の書き込みの端の覆い(`ddl-ref-check-edges.ts`)は、凍らせた列の `update of` の端を覆いに数える(この 1 本が空を返す = 本文を生成できる宣言だけ。点検 fix26 3 回目 D26c-4)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { SpecModel } from '../model/types.js';
import type { DataTableSpec, DataTriggerDecl } from '../model/data/types.js';
import { rewritesOfFrozen, type FrozenRewrite } from '../model/written-after-create.js';
import { firesOnUpdate, parseFires, updatedColumnsOf } from '../model/trigger-fires.js';
import { insertAtColumnsOf } from '../model/data/types.js';
import type { ActionSpec } from '../model/trace/types.js';
import { groundOperation } from '../semantics/operation-ground.js';
import { findEntitySpec } from '../semantics/domain-lookup.js';
import { DDL_WORDS } from '../messages/messages-ddl.js';
import { refusalLines } from './ddl-cross-check-body.js';
import type { DdlTrigger } from './ddl-guards.js';

/** 凍結のトリガが受け入れる発火の宣言(列を絞らない AFTER の行トリガの更新)。 */
export const FREEZE_FIRES = 'after update';

/** 宣言が通らない理由 1 件(T17 が生成できない理由として読む)。 */
export interface FreezeProblem {
  readonly reason: string;
}

/**
 * `freezes` を宣言したトリガが本文を生成できるか(できなければその理由の全部)。
 *
 * @param trigger トリガの宣言(`freezes` を持つもの)
 * @param table テーブル仕様
 * @param domain ドメイン仕様(欄と書き換えの宣言を引く)
 * @param actions action_spec(作成でない操作の `computes` を引く。無ければ数えない —— 生成器の DDL の経路)
 * @returns 通らない理由(宣言順)。空なら生成できる
 */
export function freezeProblemsOf(trigger: DataTriggerDecl, table: DataTableSpec, domain: SpecModel, actions: readonly ActionSpec[] = []): readonly FreezeProblem[] {
  const columns = trigger.freezes ?? [];
  const entity = table.entity === undefined ? null : findEntitySpec(domain, table.entity);
  const specs = table.entity === undefined ? undefined : domain.aggregates.get(table.entity);
  const plan = parseFires(trigger.fires ?? '');
  const shapeOk = plan.timing === 'after' && plan.level === 'row' && plan.condition === null && plan.events.join(' ') === 'update' && !/\bof\b/iu.test(trigger.fires ?? '');
  const problems: FreezeProblem[] = [
    ...(columns.length === 0 ? [{ reason: 'freezes に凍らせる列が 1 つも無い' }] : []),
    ...(shapeOk && !trigger.deferred ? [] : [{ reason: `fires は "${FREEZE_FIRES}"(列を絞らない AFTER の行トリガ。update of は SET の列でしか発火しない)だけを書く` }]),
    ...(trigger.supplies.length > 0 || trigger.derives !== undefined ? [{ reason: '凍結のトリガは値を供給しない(supplies / derives と併記できない)' }] : []),
    ...(table.functions.find((fn) => fn.name === trigger.functionName)?.handwritten === undefined ? [] : [{ reason: `関数 ${trigger.functionName} が handwritten を宣言している(本文は生成物)` }]),
  ];
  const context = {
    frozen: new Set(columns),
    specs,
    table,
    personal: new Set((entity?.fields ?? []).filter((field) => field.personal).map((field) => field.name)),
    computed: computedColumns(domain, actions, table.entity),
    insertAt: insertAtColumnsOf(table),
    watchedOnUpdate,
  };
  for (const column of columns) {
    const field = entity?.fields.find((candidate) => candidate.name === column);
    if (column === 'id' || field === undefined) {
      problems.push({ reason: `凍らせる列 ${column} が ${table.table} の欄(主キー id の外)に無い` });
      continue;
    }
    if (field.type.kind === 'state') problems.push({ reason: `凍らせる列 ${column} は状態の欄(遷移が書き換える)` });
    for (const rewrite of rewritesOfFrozen(column, context)) problems.push({ reason: `凍らせる列 ${column} ${rewriteReason(rewrite)}` });
  }
  return problems;
}

/** 書き換える宣言 1 つの理由の文。 */
function rewriteReason(rewrite: FrozenRewrite): string {
  switch (rewrite.kind) {
    case 'declaration':
      return 'を作成の後に書き換える宣言がある(access_spec の writes / transition_writes・遷移の records_* / clears)';
    case 'parent_delete':
      return `の外部キーが on_delete: ${rewrite.onDelete}(親を消すと子の列が書き換わる)`;
    case 'personal':
      return 'は個人列(消去の匿名化が書き換える)';
    case 'supplied_on_update':
      return `を更新で発火するトリガが供給・導出する(見ている元の列 ${rewrite.watched === 'all' ? '全部' : rewrite.watched.join(', ')} のうち凍っていない列の更新で引き直す)`;
    case 'insert_at':
      return 'は末尾の番号の insert_at(差し込みが同じ親のほかの行の番号を振り直す)';
    case 'computes':
      return 'を作成でない操作の action_spec の computes が書く';
  }
}

/** 発火の宣言が更新で見る列(列を名指さない update が混じれば全部。`updatedColumnsOf` は混在を狭く読むので、凍結では広い側に倒す)。 */
function watchedOnUpdate(fires: string | undefined): readonly string[] | 'all' | null {
  if (!firesOnUpdate(fires)) return null;
  if (fires === undefined || /\bupdate\b(?!\s+of\b)/iu.test(fires)) return 'all';
  return updatedColumnsOf(fires) ?? 'all';
}

/** 作成でない操作の `computes` がその集約に書く列。 */
function computedColumns(domain: SpecModel, actions: readonly ActionSpec[], entity: string | undefined): ReadonlySet<string> {
  const columns = new Set<string>();
  for (const action of actions) {
    if (groundOperation(domain, action.handles.raw).kind === 'create') continue;
    for (const decl of action.computes) if (decl.entity === entity) columns.add(decl.field);
  }
  return columns;
}

/**
 * その表の凍結のトリガの計画(宣言が通るものだけ。宣言順)。
 *
 * @param table テーブル仕様
 * @param domain ドメイン仕様
 * @returns 生成するトリガ(無ければ空)
 */
export function freezeTriggersIn(table: DataTableSpec, domain: SpecModel): readonly DdlTrigger[] {
  return table.triggers
    .filter((trigger) => trigger.freezes !== undefined && freezeProblemsOf(trigger, table, domain).length === 0)
    .map((trigger) => {
      const columns = trigger.freezes ?? [];
      const changed = columns.map((column) => `new.${column} is distinct from old.${column}`).join(' or ');
      return {
        name: trigger.name,
        fires: FREEZE_FIRES,
        function: {
          name: trigger.functionName,
          comment: `${DDL_WORDS.freezeTrigger}(${columns.join(', ')})`,
          body: [`if ${changed} then`, ...refusalLines(trigger.name, trigger.invariant ?? DDL_WORDS.freezeWord, `${columns.join(', ')}${DDL_WORDS.freezeRefusal}`), 'end if;', 'return null;'],
        },
      };
    });
}
