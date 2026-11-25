/**
 * **別の集約の列との等式**の不変条件(`formal.type: check` で、式がもう 1 つの集約の欄を読むもの)を、
 * DB のコミット時評価の制約トリガにする計画と、その**判定の 1 本**。
 *
 * 例: 「店舗の責任者は、店舗と同じ会社の従業員である」(`store.company_id == staff_member.company_id`)。
 * この条件は **2 つの表のどちら側からも破れる** —— 店舗の側(責任者を付け替える・店舗の会社を変える)と、
 * 責任者の側(従業員が別の会社へ移る)である。片側だけを守ると、守っていない側から条件が破れる。だから
 * 計画は**両端のそれぞれに 1 本ずつ**トリガを立てる(`side`)。どちらの端の宣言かは、トリガを宣言した
 * 表の entity で決まる(不変条件が住む集約の表 = `host`、相手の集約の表 = `referenced`)。
 *
 * ## 読み方(DSL の解釈。曖昧なら最も厳しい側に倒す)
 *
 * - 式は **2 つの集約**だけを読む —— 不変条件が住む集約(`host`)と、式の中のもう 1 つの集約(`other`)。
 *   3 つ以上の集約を読む式・`actor` / `now` / `contains` を含む式は生成しない(理由を報告する)。
 * - `host` から `other` へ届く道は `context` の**1 段の参照の欄**(`{other}: {host}.{列}`)だけ。2 段の中継は生成しない。
 * - その参照の欄は **required(NOT NULL)**でなければならない。空にできる欄は「空のとき条件が適用されない」のか
 *   「空なら拒否」なのかが宣言から読めないので生成しない(曖昧さを許す側に倒さない)。
 * - 比較に使う欄が空(NULL)で、相手の行が在るなら、**拒否する**(`COALESCE(式, false)`。行の CHECK と
 *   トリガの本文が既にそう読んでいる —— 式全体を 1 回だけ閉じる Kleene 論理の規約)。
 * - 宣言は **`deferred: true` の `after` の制約トリガ**。複数の手順(責任者を替えてから従業員の会社を直す等)で
 *   途中状態を通る操作を許し、コミット時に最終の姿だけを見る(`ddl-check-triggers.ts` の遅延トリガと同じ理由)。
 * - `fires` は、その側から条件が破れる更新を**漏れなく**見ていなければならない。見る列は式が読む列
 *   (host 側は参照の欄を足す)に、**それらの列を別のトリガ(`supplies`)が書き換える場合のそのトリガの発火列**を
 *   足したもの。`update of {列}` は SET に書かれた列でしか発火せず、BEFORE トリガが書き換えた列は数えない
 *   —— 数えないと、写しの列を埋めるトリガ経由の変更が素通りする。
 *
 * 式・参照の欄・どちらの端かの**形**の判定は `lib/model/data/cross-check-shape.ts`(索引の導出も同じ形を読む)。ここは、その形に
 * 発火・遅延の約束を重ねて「生成できるか」を答える。
 *
 * 判定が 1 本なのは、生成する側(`ddl-check-triggers.ts`)と、生成できないことを報告する側(T17)が同じ関数を
 * 呼ぶためである。純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { crossShapeOf, watchedColumnsOf, type CrossEnd, type CrossShape, type CrossSide } from '../model/data/cross-check-shape.js';
import type { DataTableSpec, DataTriggerDecl } from '../model/data/types.js';
import type { SpecModel } from '../model/types.js';
import { parseFires, updatedColumnsOf } from '../model/trigger-fires.js';

export type { CrossEnd, CrossSide };

/** 本文が結合に付ける別名(不変条件が住む集約の表 / 相手の集約の表)。 */
export const HOST_ALIAS = 't';
export const OTHER_ALIAS = 'r';

/** 生成できる宣言から決まる計画。 */
export interface CrossCheckPlan extends CrossShape {
  /** この宣言の表(`side` の端)で、`fires` が見ていなければならない列(`'all'` は列を絞れない)。 */
  readonly watched: readonly string[] | 'all';
}

/** 判定の結果(別の集約の等式でない / 出せる / 出せない理由つき)。 */
export type CrossJudgement =
  | { readonly kind: 'none' }
  | { readonly kind: 'ok'; readonly plan: CrossCheckPlan }
  | { readonly kind: 'refused'; readonly reason: string };

/** `fires` が見るべき列と発火の種類を満たしているか(満たさなければ理由)。 */
function firesProblem(fires: string, side: CrossSide, watched: readonly string[] | 'all'): string | null {
  const plan = parseFires(fires);
  if (plan.timing === null || plan.events.length === 0) return 'fires からいつ・何で実行するかを読めない';
  const need = side === 'host' ? ['insert', 'update'] : ['update'];
  const missingEvents = need.filter((event) => !plan.events.includes(event));
  if (missingEvents.length > 0) {
    return `${side === 'host' ? '行の側' : '相手の側'}の制約トリガは ${need.join(' / ')} で発火しなければならない(fires に ${missingEvents.join(' / ')} が無い)`;
  }
  const updated = updatedColumnsOf(fires);
  if (updated === 'all') return null;
  if (updated === null) return 'fires から更新で見る列を読めない';
  if (watched === 'all') {
    return 'この表の列を書き換える別のトリガが全部の更新で発火するので、列を絞れない(fires の update に列を名指さない)';
  }
  const missing = watched.filter((column) => !updated.includes(column));
  return missing.length === 0
    ? null
    : `fires の update of が ${missing.join(' / ')} を見ていない(その列の更新で条件が破れても発火しない。` +
        '式が読む列と、それを別のトリガが書き換える場合のそのトリガの発火列を並べる)';
}

/**
 * トリガ 1 本について、別の集約の列との等式として生成できるかを判定する。
 *
 * @param trigger トリガの宣言
 * @param table そのトリガを宣言した表
 * @param domain ドメイン仕様
 * @param tables 全 data_table(相手の物理テーブル名を引く)
 * @returns 別の集約の等式でない(`none`)・生成できる(`ok`)・生成できない理由(`refused`)
 */
export function crossCheckOf(
  trigger: DataTriggerDecl,
  table: DataTableSpec,
  domain: SpecModel,
  tables: readonly DataTableSpec[],
): CrossJudgement {
  const judged = crossShapeOf(trigger, table, domain, tables);
  if (judged.kind === 'none') return judged;
  if (judged.kind === 'refused') return { kind: 'refused', reason: judged.reason };
  const shape = judged.shape;
  if (trigger.deferred !== true) {
    return {
      kind: 'refused',
      reason: '別の集約の列との等式はコミット時評価の制約トリガ(deferred: true)でなければならない(途中状態を通る操作を弾かない)',
    };
  }
  const watched = watchedColumnsOf(table, shape.side === 'host' ? [...shape.hostColumns, shape.refColumn] : shape.otherColumns);
  const problem = firesProblem(trigger.fires ?? '', shape.side, watched);
  if (problem !== null) return { kind: 'refused', reason: problem };
  return { kind: 'ok', plan: { ...shape, watched } };
}
