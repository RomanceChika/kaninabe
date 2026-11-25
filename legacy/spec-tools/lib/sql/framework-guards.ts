/**
 * 仕組みが自分で持つ表(`framework-tables.ts` の `jobs` / `domain_events`)の
 * **追記専用の執行点**の設計図。
 *
 * ## なぜ列と同じ設計図の側にあるのか
 *
 * 束 ③-1 は列・型・CHECK・索引を生成物にしたが、**執行点だけが設計図の外に残っていた** ——
 * 権限(`revoke` / `grant`)と、監査ログの改変を拒否するトリガである。どちらも題材の製品では
 * 手書きの migration に埋まっていたので、4 題材を空の DB に起こすと
 * **監査ログが特権から書き換え放題のまま立ち上がる**(しかも形の突合は全部緑になる)。
 *
 * 執行点は「間違っても読み書きが失敗しない」性質を持つ —— だから写し忘れが症状として
 * 現れない。列と同じ 1 か所で持つことだけが、その穴を閉じる。
 *
 * ## 3 枚重ねのうち、ここが持つのは 1 枚
 *
 * 監査ログの追記専用は 3 枚重ねで成り立つ。①既定権限の剥奪と②ポリシー無しの RLS で
 * `anon` / `authenticated` からは読めず書けない。③のトリガが `service_role`(RLS を
 * バイパスする特権)からの改変まで拒否する。②は表の DDL が、①は**権限の migration**
 * (`grants-migration.ts`。どの表でも同じ 1 組なので系に 1 本)が出すので、ここが持つのは③である。
 *
 * **`update` / `delete` の権限を `service_role` にあえて与える。** 権限で塞ぐと
 * 「トリガが効いている」ことを確かめられず、権限設定を緩めた瞬間に無防備になる ——
 * 執行点をトリガ 1 箇所に寄せ、そこを見張りテストで実行する(保証台帳 `audit_append_only`)。
 * `truncate` をあえて与えないのも同じ判断の裏側である(行トリガを発火しないので③に見えない)
 * —— その 1 組の正は `ddl-guards.ts` の `PRIVILEGED_PRIVILEGES` にある。
 *
 * **名前・関数名・発火の宣言は `lib/world/framework-triggers.ts` が正**で、ここが持つのはトリガ関数の**本体(SQL)**だけである
 * (宣言から読める事実を、SQL の翻訳器を道連れにせずに引けるようにするため。設計メモ §11)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DataTableSpec } from '../model/data/types.js';
import { FRAMEWORK_GUARD_WORDS } from '../messages/messages-ddl.js';
import { frameworkTriggerSpecsOf, type FrameworkTriggerName, type FrameworkTriggerSpec } from '../world/index.js';
import { type DdlTrigger, type DdlTriggerFunction } from './ddl-guards.js';
import { triggerFires } from '../model/trigger-fires.js';
import { sqlLiteral } from './guard-to-sql.js';

/** 追記専用トリガ関数の本体と説明(宣言のトリガ名が鍵。名前・関数名・発火は宣言の側が正)。 */
const BODIES_BY_TRIGGER: Readonly<Record<FrameworkTriggerName, Pick<DdlTriggerFunction, 'comment' | 'body'>>> = {
  domain_events_append_only: {
    comment: FRAMEWORK_GUARD_WORDS.appendOnlyFunction,
    body: [
      'raise exception',
      `    ${sqlLiteral(FRAMEWORK_GUARD_WORDS.appendOnlyRefusal)}, tg_op`,
      "    using errcode = 'raise_exception';",
    ],
  },
};

/** 宣言 1 本に本体をつないで、SQL の計画にする。 */
function triggerOf(spec: FrameworkTriggerSpec): DdlTrigger {
  const body = BODIES_BY_TRIGGER[spec.name];
  return {
    name: spec.name,
    ...triggerFires(spec.fires),
    function: { name: spec.functionName, comment: body.comment, body: body.body },
  };
}

/**
 * その表に置くトリガの全数。
 *
 * @param table data_table
 * @returns トリガの計画(執行点を持たない表・仕組みの表でなければ空)
 */
export function frameworkTriggersOf(table: DataTableSpec): readonly DdlTrigger[] {
  return frameworkTriggerSpecsOf(table).map(triggerOf);
}

/**
 * 設計図に書かれた**仕組みの文言**のうち、執行点のもの(関数の説明と拒否の文面)。
 *
 * 出力側の目(`generated-wording.ts`)から見えるようにするため、`frameworkTableWords()` と
 * 同じ流儀で宣言を引くだけにする。
 *
 * @returns 執行点の文言の全数
 */
export function frameworkGuardWords(): readonly string[] {
  return Object.values(BODIES_BY_TRIGGER).flatMap((trigger) => [
    trigger.comment,
    FRAMEWORK_GUARD_WORDS.appendOnlyRefusal,
  ]);
}
