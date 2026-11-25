/**
 * 結果表が判定を借りてくる口 —— **app の実行器そのもの**(束 ⑳-5b / ⑳-5b-b)。
 *
 * 結果表は「この実行者は、この状態のものを動かせるか」を人に見せる表である。その ✅ / ❌ が
 * 実装と 1 ミリでもずれていたら、表は嘘をつく。だから判定器も、判定の**段取り**も docs 側に
 * 書き写さない —— **一致の証明(⑳-5a / ⑳-5a2)が期待に使っているのと同じ関数を、同じ引数で
 * 呼ぶ**。借りるのは次の 6 本だけである。
 *
 * | 借りるもの | 何をするか | 置き場 |
 * |---|---|---|
 * | `decideShape` | 形ごとの照会そのもの(4 形の分岐 → エンジンの診断) | `domain/step-decision.ts` |
 * | `arrayActorRoles` | **ロール配列**を出発点に立つロールを数える(単発の形) | 同上 |
 * | `decideStepWith` | 手順 1 つの `permit`(ロール解決 → 形ごとの照会) | `operation/_template/run-plan-decide-core.ts` |
 * | `decidePlanWith` | 手順の順に `permit` を立て、**最初に落ちた手順で止める**(実行器の契約) | 同上 |
 * | `envOf` | その手順のガード式の変数に値を割り当てる | 同上 |
 * | `factValue` | 供給元 1 つを値にする(6 つの値域) | `operation/_template/run-plan-facts.ts` |
 *
 * 単発の操作は `decideShape` + `arrayActorRoles`(一致の証明 `@kaninabe/runtime/testing/equivalence/oracle` とまったく同じ
 * 引数)、保存点は `decidePlanWith`(一致の証明 `@kaninabe/runtime/testing/save/oracle` とまったく同じ引数)を呼ぶ。
 * 単発を実行器に寄せないのは、そこでのロールの出発点が**ロール配列**(`p_actor_roles`)であって
 * セッションからの解決ではないからである —— 寄せると「ロール配列」の軸が消える。
 *
 * 束 ⑳-5b では engine の 4 関数(`canFire` 等)だけを借り、ループ・ロール解決・入力の組み立て・
 * 形の分岐は docs 側で書いていた。それは**実行器の 3 つ目の写し**であり、写し間違いが黙って
 * 古くなる形だったので(独立レビュー ⑳-5b 観点 2)、芯ごと借りる形に直した。
 *
 * ## import の仕組み
 *
 * 借りてくる先は土台ディレクトリの宣言(置き場の配置が宣言する土台の表の `src/domain/engine`
 * の隣と `src/operation/_template` = 「5 形の定型そのもの」)である。形ごとの照会
 * (`domain/step-decision.ts`)と判断の芯
 * (`run-plan-decide-core.ts`)は**相対 import しか持たない純関数の束**であり、`server-only` も
 * `@/` の別名も生成物も使っていないので、docs からは**設定を 1 つも足さずに**相対パスで届く
 * (ロールの表は引数で渡す。だから 4 題材の仕様に対しても同じ判断が引ける)。
 *
 * 借りてくるのは**配布物**である(`@kaninabe/runtime` の `exports` が `dist` を指す。ADR-0013 の
 * 配り方 A)。`.ts` を素のまま配っていたあいだは、tsx から見た芯が CommonJS に解決されて
 * 名前付き輸出が静的に見つからず、`import * as` の中身が `{ default: 実体 }` になるため
 * 「`default` があればそれを、無ければ名前空間そのものを」という**この 1 か所だけの作法**が
 * 要った。`tsc` が吐いた `.js` + `.d.ts` を配る形にしたのでその作法は不要になり、束 ①-c で
 * 消した —— 名前付きで値を import するだけである(型も同じ `.d.ts` から来る)。
 *
 * **引く口は公開の入口 `@kaninabe/runtime/template/evaluate` 1 本**で、上の表の「置き場」は実装の
 * 住所にすぎない(内部のファイル名では引かない。ADR-0013「公開する入口は名指し」)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import { arrayActorRoles, decideShape } from '@kaninabe/runtime/step-decision';
import { decidePlanWith, decideStepWith, envOf, factValue } from '@kaninabe/runtime/template/evaluate';

/**
 * 形ごとの照会の口(型は**本物から採る**)。
 */
export type ShapeApi = {
  readonly decideShape: typeof decideShape;
  readonly arrayActorRoles: typeof arrayActorRoles;
};

/**
 * 本物の形ごとの照会。
 *
 * @returns 形の分岐と、配列を出発点にしたロールの数え方
 */
export function appShape(): ShapeApi {
  return { decideShape, arrayActorRoles };
}

/**
 * 実行器の判断の口(型は**本物から採る**)。
 *
 * 署名をここに手で書き写さないのは、書き写した署名は app 側の変更に追いつかないからである。
 */
export type RunnerApi = {
  readonly decideStepWith: typeof decideStepWith;
  readonly decidePlanWith: typeof decidePlanWith;
  readonly envOf: typeof envOf;
};

/** 供給元 1 つを値にする口(型は**本物から採る**)。 */
export type FactsApi = {
  readonly factValue: typeof factValue;
};

/**
 * 本物の供給元の読み方。
 *
 * @returns 供給元 1 つを値にする関数
 */
export function appFacts(): FactsApi {
  return { factValue };
}

/**
 * 本物の実行器の判断。
 *
 * @returns 手順 1 つの判断と、計画ぜんたいの判断
 */
export function appRunner(): RunnerApi {
  return { decideStepWith, decidePlanWith, envOf };
}
