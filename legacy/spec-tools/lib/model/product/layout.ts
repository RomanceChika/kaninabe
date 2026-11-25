/**
 * 製品の木の**置き場の役割**の契約(`ProductLayout`)— 役割 → 宣言(6 項目)と、役割 + キー → パスの解決。
 *
 * コアは置き場の**役割**(「実装のソースの根」「HTTP の入口」「組み立ての根」…)だけを知り、役割がどのパスに置かれるか(Next.js なら
 * `src/app{URL}/route.ts`)は**アプリの枠の後段**(`role: app_frame`。`lib/targets/nextjs/`)が値として与える(設計メモ framework-modules §20-2)。
 * 契約は**文字列のパスの辞書にしない** —— パスの辞書は、同じパスを 2 つの持ち主が取ることも、生成物と手書きが同じ役割に混ざることも隠す。
 * 役割ごとに次の 6 項目を宣言する(外部レビュー の Q2):
 *
 * | 項目 | 中身 |
 * |---|---|
 * | 多重度(`multiplicity`) | 0 / 1 / キーごとに複数(キーの形: URL のパス・連携 ID) |
 * | 持ち主(`owners`) | 製品の宣言 / 製品が手で書く / どの生成器が書くか |
 * | 基準(`base`) | どの役割からの相対か(`null` はリポジトリルート) |
 * | 生成物か手書きか(`origin`) | `generated` / `handwritten` / `mixed`(持ち主と食い違えば契約違反) |
 * | 読み書きの条件(`access`) | 誰が読み・誰が書くか、いつ成り立つか |
 * | 衝突したら(`onCollision`) | 失敗(`fail`)だけ。**黙って片方を勝たせない** |
 *
 * **語彙は使う役割だけ**(仮の役割を先に作らない。役割は移すかたまりで足す)。いまは `product-root` / `source-root` / `http-entry` /
 * `composition-root`(受信 Webhook の分。キーは連携 ID)と、画面の器まわりの 5 つ(`screen-shell` / `request-gate` / `screen-part` / `screen-test` /
 * `app-icon`)と、生成テストの置き場の 8 つ(`operation-test` / `compute-example-test` / `eq-test` / `eq-save-test` / `rls-test` / `harness-adapter` /
 * `save-harness-adapter` / `cron-route-test`)と、操作・保存点の入口と組み立ての根とフォームの 5 つ(`operation-entry` / `operation-composition` / `save-entry` /
 * `save-composition` / `ui-component`)と、層の読み書きの 2 つ(`operation-logic` / `infrastructure`)と、製品の根の直下の手書きの置き場の 4 つ(`e2e-root` / `env-template` / `script-root` / `app-resource`。部品化 ③-c6)と、
 * **生成物の本文が import する手書きの接続点の 7 つ**(`operation-hooks` / `computes-module` / `preflight-module` / `shared-component` / `auth-composition` / `system-clock` / `db-ports`。部品化 ③-e1)の 35 である。**型の葉は `layout-types.ts`**(生成の文脈が読む。役割の名前・キーの形は葉に書かず、語彙の正はここ)。**渡し方は明示の引数**(`PlatformProfile` と同じ。グローバルな
 * 選択済みの値は作らない)。`roots.app` が null の製品(実装の木を持たない)は `product-root` が 0 個で、解決はどれも null を返す(その製品はアプリの枠の後段を選ばない = 空の配置。
 * 実装の木を宣言する製品は、アプリの枠の後段がちょうど 1 つ要る — `selectTargetSet`)。
 *
 * **層と土台ディレクトリの表**(部品化 ③-c5): `source-root` の役割だけが `structure`(`RoleStructure`。層の直下の「集約でないディレクトリ」= 土台の全数・足す層・載せていない手書きの置き場・
 * 補助ファイル・実行時パッケージのソースの根)を宣言する。層の 4 名(`domain` / `operation` / `infrastructure` / `composition`)はコアの語、土台のディレクトリ名と生成物の置き場の綴りは
 * スタックの木の形なので配置の値が持つ。引き口(解いた表・パスの集合・走査の入力)は `lib/model/framework-base-dirs.ts`、表の整合と、表と役割の食い違い(`placedBy`)の検査は
 * `layout-structure.ts`。逆引き(`classify`)が「操作・集約ではない」と除く土台も、この表が正である。
 *
 * 置き場がここ(前段 `lib/model/product/`)なのは、検査(`check`)・生成器(`emit`)・約束事のモデルの段取り(`orch`)・後段(`target`)の全部が
 * この型と解決を読むため(後段の登録の契約 `lib/target-api/` は check / emit の上にあり、下の層は読めない)。**読むのは型の葉 `layout-types.ts` の型だけ**
 * (値の import は 0)で、解析(検査・生成)を前段に持ち込まない。**アプリの語彙も具体のスタックの綴りも 1 語も持たない**(綴りは後段が値として持つ)。
 *
 * 純関数で、どれも throw しない(解決できなければ null)。**配置そのものの契約の検査(`layoutDefinitionProblems`)と選択の契約の検査
 * (`layoutSelectionProblems`)は `layout-definition.ts`**(解決だけを使う側に検査の道具を道連れにしない)。
 *
 * @oversize 役割の語彙・キーの正規化・パスの解決・逆引き(走査の口と往復)が、同じ「役割 + キー → 置き場」の 1 本の写像の表と裏で、キーの形の語彙を
 *   変える日に全部が一緒に動く。役割ごとの引き口(`httpEntryPath` ・`screenShellPath` ほか)は 1 行の薄い包みで、使う側の import を 1 つの入口(このファイル)に保っている。
 * @split-review 役割ごとの引き口を別ファイルへ出す案は、使い手(検査・生成器 20 本ほど)の import を全部書き換えるのに、出した側が `layoutPath` の解決を読み返す
 *   だけになり、キーの形の語彙(`normalizeKey`)と引き口の対応を 2 枚で見比べることになるので採らなかった。逆引き(`layoutScan` ・`layoutRoundTrips`)は解決と同じ
 *   基準の辿り方(`resolveFrom`)を共有するので、別ファイルにすると基準を辿る関数を公開する必要が出る。割れる境界は役割の数が倍になった日(P3 以降)に見直す。
 */

import { posix } from 'node:path';
import type { ProductLayout } from './layout-types.js';

/** 置き場の役割の閉じた一覧(語彙は移すかたまりで足す。足す日は `ProductLayout` の使い手も見る)。 */
export const LAYOUT_ROLES = [
  'product-root',
  'source-root',
  'http-entry',
  'composition-root',
  'screen-shell',
  'request-gate',
  'screen-part',
  'screen-test',
  'app-icon',
  'operation-test',
  'compute-example-test',
  'eq-test',
  'eq-save-test',
  'rls-test',
  'harness-adapter',
  'save-harness-adapter',
  'cron-route-test',
  'operation-entry',
  'operation-composition',
  'save-entry',
  'save-composition',
  'ui-component',
  'operation-logic',
  'infrastructure',
  'e2e-root',
  'env-template',
  'script-root',
  'app-resource',
  'operation-hooks',
  'computes-module',
  'preflight-module',
  'shared-component',
  'auth-composition',
  'system-clock',
  'db-ports',
  'app-config',
  'root-layout',
  'session-refresh',
  'browser-defense-test',
  'paid-entry-test',
  'platform-op-entry',
  'platform-op-composition',
  'platform-binding',
  'platform-op-test',
] as const;

/**
 * 置き場の役割。
 *
 *   - `product-root` … 実装の木の根(製品の宣言 `product.md` の `roots.app`。リポジトリルートからの相対)
 *   - `source-root` … 実装のソースの根(`@/…` の指す先)。`product-root` の下
 *   - `http-entry` … URL のパスに 1 対 1 で結ばれる HTTP の入口(Route Handler)。キーは URL のパス
 *   - `composition-root` … 組み立ての根(配線)。いまは受信 Webhook の分だけで、キーは連携 ID
 *   - `screen-shell` … 画面の器(1 画面 = 1 URL に結ばれたページの入口)。製品が手で書く・検査は**読むだけ**。キーは仕様の `route`(URL の形。動的セグメントは
 *     `/workshops/:id` の `:param`。置き場の綴りへの写像と逆引きの正規化は後段が持つ)。**逆引き(実在のファイル → route)を持つ**(`classify`)
 *   - `request-gate` … リクエスト前段(ブラウザ側の守り(文書の CSP・要求の出どころ)とセッションの更新・保護範囲の宣言を置く 1 枚)。**生成物**(アプリの枠の後段の
 *     生成器が書く)で、検査(S7)は読むだけ。1 つだけ
 *   - `screen-part` … 画面の部品の生成物(`kind: form` / `table` / `detail` の部品 1 つ = 1 本と、それらが共有する既定のスタイル・競合の表示)。キーはファイル名
 *   - `screen-test` … 画面テスト(手書きの screenTest)の置き場。キーはファイル名(S9 が道案内に示す)
 *   - `app-icon` … アプリ全体の既定のアイコン(アプリの枠が既定で置く残骸。G8 が「残っていないこと」を見る)。1 つだけ
 *
 * 生成テストの置き場(部品化 ③-c3)。**種別ごとに役割を分けた**(キーの形も持ち主の生成器も違い、1 役割の中の変種にすると契約が
 * 「(種別, キー)」の 2 段のキーを持つことになる。画面の器まわりと同じ判断):
 *   - `operation-test` … 操作 1 つの生成ユニットテスト(実行計画の場面)。キーは操作 ID(`{集約}.{イベント}`)
 *   - `compute-example-test` … 計算値の例の表のテスト(純関数 1 本につき 1 枚。置き場ぜんたいが生成物)。キーは純関数の参照。**逆引きを持つ**
 *   - `eq-test` … 集約ごとの、エンジンと RPC の一致の証明(実 DB で実行する)。キーは集約名。**逆引きを持つ**
 *   - `eq-save-test` … ユースケースごとの、保存点の一致の証明(実 DB で実行する)。キーはユースケース名。**逆引きを持つ**
 *   - `rls-test` … 表ごとの RLS の挙動テスト(実 DB で実行する)。キーは表名。**逆引きを持つ**
 *   - `harness-adapter` … ハーネスのアダプタ(生成テストが引く住所に置く配線)のうち、基盤の層(実 DB に触る手足の側)に置くもの。キーはアダプタ名
 *   - `save-harness-adapter` … ハーネスのアダプタのうち、保存点の一致の証明が使う配線の層に置くもの(層境界の帰結。`eq-save-test` と同じ層)。キーはアダプタ名
 *   - `cron-route-test` … Cron 起動口の認可の見張りテスト(カタログから 1 枚)。1 つだけ
 *   - `browser-defense-test` … ブラウザ側の守りの配線の見張りテスト(全応答のヘッダの配線・cookie で認証する口の出どころの確認・要求ごとの描画。1 枚)。1 つだけ
 *   - `paid-entry-test` … 有料の口の関門の見張りテスト(未ログイン 401・役なし 403 を実物の口で叩く。1 枚)。1 つだけ
 *
 * 操作・保存点の入口と組み立ての根(部品化 ③-c4a。**キーの形も持ち主の生成器も違うので役割を分けた**。`composition-root`(受信の配線。キーは連携 ID)に
 * 操作・保存点の分の変種を足す形にすると、契約が「(種別, キー)」の 2 段のキーを持つことになる。③-c2 / ③-c3 と同じ判断):
 *   - `operation-entry` … 単発の操作の入口(Server Action)。キーは操作 ID。**生成物と手書き(`runner: manual`)が同じ役割に居る**(混在)
 *   - `operation-composition` … 単発の操作の組み立ての根(配線)。キーは操作 ID。入口と同じく混在。**import される**(`module`)
 *   - `save-entry` … 保存点(ユースケースの保存の 1 点)の入口(Server Action)。キーは保存点 ID(`{ユースケース}.{保存点}`)。生成物だけ
 *   - `save-composition` … 保存点の組み立ての根。キーは保存点 ID。生成物だけ。**import される**(`module`)
 *   - `ui-component` … 生成されるフォームの部品(保存点 1 つ = 1 画面フォーム)。キーはファイル名。いまは生成物の分だけ(手書きの部品は役割にしていない)
 *
 * 製品の根の直下の手書きの置き場(部品化 ③-c6。**どれも製品が手で書き、検査・生成は読むだけ**。キーの形が違うので役割を分けた):
 *   - `e2e-root` … E2E スモーク(`*.spec.mts`)とウォーカーの置き場(基準は `product-root`)。1 つだけ。読むのは注釈の走査(A 群 / S11)・smoke の形の検査・語彙漏れの走査・設定の参照の走査
 *   - `env-template` … 設定の雛形(`NAME=` の行を並べるファイル)。基準は `product-root`。1 つだけ。読むのは設定の雛形の突合(K2)
 *   - `script-root` … 道具のスクリプトの置き場。基準は `product-root`。1 つだけ。読むのは設定の参照の走査(K1)
 *   - `app-resource` … ソースの根の下の、ハンドブックが写し元として読む資材(スタイル・状態バッジの部品)。キーは基準の役割の下の相対パス(`relative_path`)。製品固有の末尾は読む側の定数
 *
 * 生成物の本文が import する手書きの接続点(部品化 ③-e1。**どれも製品が手で書き、検査・生成は import の指定子を引くだけ**。生成物の本文は別名の綴りを持たず、
 * 役割 + キー → `module` の解決結果だけを受け取る。**生成物の根の下**(生成物の `domain/generated` の下のモジュール)は役割にしない —— 置き場は製品の宣言 `roots.generated` が決めるので、同じ事実を配置に二重に書かない):
 *   - `operation-hooks` … 単発の操作の hooks(application 執行の不変条件)。キーは操作 ID。**import される**(`module`)
 *   - `computes-module` … `computes` が名指す手書きの純関数。キーは純関数の参照。**import される**
 *   - `preflight-module` … 画面の入場判定にかける手書きの純関数の置き場(1 つだけ)。**import される**
 *   - `shared-component` … 画面をまたいで使う手書きの UI 部品(フォームの行・実行器ほか)。キーはファイル名(拡張子なし)。**import される**
 *   - `auth-composition` … 認証の組み立ての根(実行者とセッションの券を解く手書きの配線。1 つだけ)。**import される**
 *   - `system-clock` … 時計の口(1 つだけ)。**import される**
 *   - `db-ports` … DB への口の束を組む配線(`createDbPorts()`。1 つだけ。PostgREST などの接続は配線の中に閉じ、生成した組み立ての根は束を受け取るだけ)。**import される**
 *   - `session-refresh` … リクエスト前段のセッションの更新(1 つだけ)。生成したリクエスト前段が、守りの判定のあとに呼ぶ。**import される**
 *
 * 認証基盤の操作を画面から叩く入口(`platform_ops`。ADR-0019。下限 0 = 宣言する製品だけが使う。**どれもキーを引くだけ**):
 *   - `platform-op-entry` … 操作の入口(Server Action)。キーは操作 ID(`{グループ}.{名前}`)。生成物だけ
 *   - `platform-op-composition` … 操作の組み立ての根(実行者・多要素認証・引数の対応・結果の写し)。キーは操作 ID。生成物だけ。**import される**
 *   - `platform-binding` … 配線先のポート(認証基盤の操作を実際に叩く手書きの配線)。キーはポートの型名。製品が手で書く。**import される**
 *   - `platform-op-test` … 権限表・接続・負例の生成テスト(1 枚)
 *
 * ブラウザ側の守りの配線が読む手書きの置き場(**製品が手で書き、生成テストは読むだけ**):
 *   - `app-config` … アプリの枠の設定(全応答の固定のヘッダを配る口がある 1 枚)。基準は `product-root`。1 つだけ
 *   - `root-layout` … 全画面を包む根のレイアウト(要求ごとの描画を宣言する 1 枚。nonce は要求ごとに描画した文書にしか付かない)。1 つだけ
 *
 * 層の読み書き(部品化 ③-c4b。**層の名前 `operation` / `infrastructure` / `composition` はコアの語**で、配置の値が持つのは層の置き場の根の綴りだけ):
 *   - `operation-logic` … 手書きの操作の本体(`runner: manual` の操作と `scans:` の走査・システム起点の入口)と、層の土台(共有物・ジョブ基盤・保存点の hooks・定型)を含む層ぜんたい。
 *     キーは操作 ID。**逆引きを持つ**(実在のファイル → 操作 ID。集約でないディレクトリ・補助ファイルは操作ではないので null)
 *   - `infrastructure` … 基盤の層(集約のクエリの写像・外部連携のアダプタ・接続層・土台)の、集約または連携 1 つの置き場。キーは集約または連携のディレクトリ名(`spec_name`)で、
 *     置き場の代表は集約のクエリの写像ファイル。**逆引きを持つ**(実在のファイル → ディレクトリ名。土台のディレクトリ・層の直下のファイルは null)
 *
 * **逆引きの衝突**: 同じファイルを 2 つの役割が自分のものと読んではならない(`layoutClassify` が返す役割が 2 つ以上 = 衝突。配置の定義の検査 — `layout-nesting.ts` — が、
 * 役割ごとのキーの見本とその派生で見る)。
 */
export type LayoutRole = (typeof LAYOUT_ROLES)[number];

/**
 * 役割ごとの**多重度の下限**(コアが決める。アプリの枠の後段が与える配置は、これを下回れない)。
 *
 * `product-root` と `source-root` は実装の木そのもの(`roots.app` を宣言する製品は、アプリの枠の後段を選ぶ — `selectTargetSet`)で、
 * 検査・生成・import の閉包のどれもが前提にするので 1。`http-entry` と `composition-root` も 1 —— 製品がどちらの実体(ジョブの起動口・受信口)を 1 つも持たなくても、
 * **置き場を決める口の宣言は要る**(ジョブを採らず受信だけを採る製品で、検査(J2 はジョブを採る製品でだけ回る)は緑のまま、生成が「置き場が決まらない」で止まる
 * 経路を、選択の段で消す)。下限が 1 の役割が配置に宣言されていなければ、配置の定義の問題として選ぶ根の 1 回で止める。
 *
 * **下限 0 は「あるスタックにしか無い概念」**(`request-gate` = リクエスト前段・`app-icon` = アプリの既定のアイコン・`app-config` / `root-layout` / `session-refresh` = 枠の設定・根のレイアウト・前段のセッションの更新)。ほかの枠の後段が持たない概念を、全部の後段に
 * 宣言させない。それを読む検査(S7 の `matcher` の被覆・G8 の既定のアイコンの残骸)は、配置に役割が無いとき**黙って緑にせず**、実行ログが
 * 「配置に <役割> が無い」と名指す(`未実施`)。
 */
export const LAYOUT_ROLE_MIN: Readonly<Record<LayoutRole, 0 | 1>> = {
  'product-root': 1,
  'source-root': 1,
  'http-entry': 1,
  'composition-root': 1,
  'screen-shell': 1,
  'request-gate': 0,
  'screen-part': 1,
  'screen-test': 1,
  'app-icon': 0,
  'operation-test': 1,
  'compute-example-test': 1,
  'eq-test': 1,
  'eq-save-test': 1,
  'rls-test': 1,
  'harness-adapter': 1,
  'save-harness-adapter': 1,
  'cron-route-test': 1,
  'operation-entry': 1,
  'operation-composition': 1,
  'save-entry': 1,
  'save-composition': 1,
  'ui-component': 1,
  'operation-logic': 1,
  'infrastructure': 1,
  'e2e-root': 1,
  'env-template': 1,
  'script-root': 1,
  'app-resource': 1,
  'operation-hooks': 1,
  'computes-module': 1,
  'preflight-module': 1,
  'shared-component': 1,
  'auth-composition': 1,
  'system-clock': 1,
  'db-ports': 1,
  'app-config': 0,
  'root-layout': 0,
  'session-refresh': 0,
  'browser-defense-test': 1,
  'paid-entry-test': 1,
  'platform-op-entry': 0,
  'platform-op-composition': 0,
  'platform-binding': 0,
  'platform-op-test': 0,
};

/**
 * 生成物の本文から import される役割(`module` が必須。基準の役割の `module` にこの役割の置き場を接いだ形と一致すること)。
 * `source-root` と `product-root` は import の起点(`@/…` の `@`)と製品の根で、`module` は起点だけが持つ。
 */
export const LAYOUT_MODULE_ROLES: readonly LayoutRole[] = [
  'http-entry',
  'composition-root',
  'operation-composition',
  'save-composition',
  'operation-hooks',
  'computes-module',
  'preflight-module',
  'shared-component',
  'auth-composition',
  'system-clock',
  'db-ports',
  'session-refresh',
  'platform-op-composition',
  'platform-binding',
];

/** 逆引き(`classify`)を必ず持つ役割の閉じた一覧(型 `ClassifiedRole` の正)。 */
const CLASSIFY_ROLES = [
  'screen-shell',
  'http-entry',
  'compute-example-test',
  'eq-test',
  'eq-save-test',
  'rls-test',
  'operation-entry',
  'operation-composition',
  'save-entry',
  'save-composition',
  'ui-component',
  'operation-logic',
  'infrastructure',
  'operation-hooks',
  'platform-op-entry',
  'platform-op-composition',
] as const;

/**
 * 逆引きの走査の口 `layoutScan` が受け付ける役割(型)。**逆引きを読む呼び出し元がある役割は、ここに入っていないと呼べない**(型が止める)ので、
 * 「呼び出し元が増えたのに必須の一覧に足し忘れた」食い違いは、コンパイルで起きない形になる(役割ごとに手で列挙し直さない)。
 */
export type ClassifiedRole = (typeof CLASSIFY_ROLES)[number];

/**
 * **逆引き(`classify`)を必ず持つ役割**。検査・生成・通し実行が「実在のファイル → キー」の逆引きを読む役割(S7 は画面の器を、J2 は HTTP の入口を、
 * 余分の検出と通し実行の「拾う口」は生成テストの 4 役割を、実装の木を走査した結果と突き合わせる)は、逆引きが無いと走査そのものができず、検査が
 * **黙って全部スキップする**。配置そのものの契約の検査(`layoutDefinitionProblems`)が、これらの役割に `classify` が無い配置を止める
 * (逆引きを読まない役割は持たなくてよい)。**一覧の正は `ClassifiedRole`(`layoutScan` の引数の型)で、ここはその値の並び**。
 */
export const LAYOUT_CLASSIFY_ROLES: readonly LayoutRole[] = CLASSIFY_ROLES;

/** 逆引きを持つ役割(型つき)。全役割を逆引きする口(`layoutClassify`)が、役割を型で絞らずに `layoutScan` を呼ぶための並び。 */
export const LAYOUT_CLASSIFIED_ROLES: readonly ClassifiedRole[] = CLASSIFY_ROLES;

/** 役割のキーの形の閉じた一覧(語彙は移すかたまりで足す)。 */
export const LAYOUT_KEY_SHAPES = ['none', 'url_path', 'integration_id', 'file_name', 'operation_id', 'spec_name', 'save_id', 'relative_path'] as const;

/**
 * 役割のキーの形。`none` = キーを持たない(1 つだけ)・`url_path` = `/api/jobs/run` の形・`integration_id` = 連携の識別子・`file_name` = 区切りを含まないファイル名・
 * `operation_id` = 操作 ID(`{集約}.{イベント}` の 2 語。空白・区切りを含まない)・`spec_name` = 仕様の名前(集約・表・ユースケース・純関数の参照など。空白・区切りを含まない)・
 * `save_id` = 保存点 ID(`{ユースケース}.{保存点}` の 2 語。空白・区切りを含まない)・`relative_path` = 基準の役割の下の相対パス(区切り `/` を含んでよい。空白・先頭の `/`・空のセグメント・`.` / `..` のセグメントを含まない)。
 */
export type LayoutKeyShape = (typeof LAYOUT_KEY_SHAPES)[number];

export type { AuxFileDecl, BaseDirDecl, LayerDecl, ProductLayout, RoleAccess, RoleClassifier, RoleDecl, RoleMultiplicity, RoleOwner, RoleStructure, UnlistedDirDecl } from './layout-types.js';

/** 何の役割も宣言しない配置(アプリの枠の後段が選ばれていない構成。どの解決も null になる)。 */
export const EMPTY_LAYOUT: ProductLayout = {};

/** 相手の区切りで連結する(空の断片は落とす)。 */
function joinSegments(...segments: readonly string[]): string {
  return segments.filter((segment) => segment !== '').join('/');
}

/**
 * URL のパスを `/a/b` の形にそろえる(先頭の `/` が無くても・末尾に `/` があっても同じ。根の URL は空文字)。
 * キーの形が `url_path` の役割の解決と衝突の検査が通る、キーの正規形である。
 *
 * @param url URL のパス
 * @returns 正規形(先頭に `/`・末尾に `/` なし。根は空文字)
 */
export function normalizeUrlPath(url: string): string {
  const trimmed = url.replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed === '' ? '' : `/${trimmed}`;
}

/**
 * URL のパスに `.` / `..` のセグメントがあるか(仕様の誤り — どのファイルシステムの置き場にも、どの URL にもならない。置き場の組み立てで親ディレクトリへ出てしまう)。
 *
 * @param url URL のパス
 * @returns `.` か `..` のセグメントを含むとき true
 */
export function hasDotSegment(url: string): boolean {
  return url.split('/').some((segment) => segment === '.' || segment === '..');
}

/** キーを役割のキーの形に合わせる(合わなければ null。語彙に無い形も null — 配置の定義の検査が先に止める)。 */
function normalizeKey(shape: string, key: string | undefined): string | null {
  if (shape === 'none') return key === undefined || key === '' ? '' : null;
  if (key === undefined) return null;
  if (shape === 'url_path') return /\s/.test(key) || hasDotSegment(key) ? null : normalizeUrlPath(key);
  if (shape === 'integration_id' || shape === 'file_name' || shape === 'spec_name') return key === '' || /[\s/]/.test(key) ? null : key;
  if (shape === 'operation_id' || shape === 'save_id') return /^[^\s/.]+\.[^\s/.]+$/.test(key) ? key : null;
  if (shape === 'relative_path') return /\s/.test(key) || key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..') ? null : key;
  return null;
}

/**
 * キーが役割のキーの形に合うか(キーを持たない役割はキー無し・URL のパスは空白を含まない・連携 ID は空でなく区切りを含まない)。
 * パスが解決できない理由が「キーの形」か「基準が辿れない」かを呼び手が言い分けるために公開する。
 *
 * @param layout 後段が与える配置
 * @param role 役割
 * @param key キー
 * @returns 役割が宣言されていて、キーが形に合うとき true
 */
export function layoutKeyFits(layout: ProductLayout, role: LayoutRole, key?: string): boolean {
  const decl = layout[role];
  return decl !== undefined && normalizeKey(decl.multiplicity.key, key) !== null;
}

/**
 * 役割 + キー → パス。基準の役割を辿って、リポジトリルートから(または `productRoot` が相対のとき製品の根から)のパスを返す。
 *
 * @param layout 後段が与える配置
 * @param productRoot 製品の根(`roots.app`)。**null = 実装の木を持たない**(どの役割も解決できず null)。空文字 `''` は
 *   「製品の根からの相対で返す」(期待ファイル木のように、製品の根の外を知らない呼び手)
 * @param role 役割
 * @param key キー(URL のパス・連携 ID。キーを持たない役割は省略)
 * @returns パス(区切りは `/`)。役割が宣言されていない・キーが形に合わない・基準が辿れない(循環を含む)ときは null
 */
export function layoutPath(layout: ProductLayout, productRoot: string | null, role: LayoutRole, key?: string): string | null {
  if (productRoot === null) return null;
  return resolveFrom(layout, productRoot, role, key, new Set());
}

/** `layoutPath` の本体(基準の役割を辿る。辿った役割を覚えて循環を止める)。 */
function resolveFrom(layout: ProductLayout, productRoot: string, role: string, key: string | undefined, seen: ReadonlySet<string>): string | null {
  const decl = layout[role];
  if (decl === undefined || seen.has(role)) return null;
  const normalized = normalizeKey(decl.multiplicity.key, key);
  if (normalized === null) return null;
  if (decl.place === null) return decl.base === null ? productRoot : null;
  const base = decl.base === null ? '' : resolveFrom(layout, productRoot, decl.base, undefined, new Set([...seen, role]));
  return base === null ? null : joinSegments(base, decl.place(normalized));
}

/**
 * 役割 + キー → import に使うモジュール指定(`@/app/api/jobs/run/route` の形。生成物の本文に出る)。
 *
 * @param layout 後段が与える配置
 * @param role 役割
 * @param key キー
 * @returns モジュール指定。役割が宣言されていない・import されない役割・キーが形に合わないときは null
 */
export function layoutModule(layout: ProductLayout, role: LayoutRole, key?: string): string | null {
  const decl = layout[role];
  if (decl === undefined || decl.module === null) return null;
  const normalized = normalizeKey(decl.multiplicity.key, key);
  return normalized === null ? null : decl.module(normalized);
}

/**
 * 役割の**逆引き**の走査の口(§20-2 の `classify` の、役割 1 つに閉じた最初の部分実装)。
 *
 * @param layout 後段が与える配置
 * @param productRoot 製品の根(`roots.app`。null = 実装の木を持たない = 走査しない。空文字 `''` は「製品の根からの相対」)
 * @param role 役割
 * @returns 走査する根 `dir`(`productRoot` からの相対を接いだ形。リポジトリルートまたは製品の根の相対)と、その下の相対パス → キー。
 *   役割が宣言されていない・逆引きを持たない・基準が辿れないとき、実装の木が無いときは null
 */
export function layoutScan(layout: ProductLayout, productRoot: string | null, role: ClassifiedRole): LayoutScan | null {
  return scanOf(layout, productRoot, role);
}

/** `layoutScan` の本体(役割を型で絞らない内部の口。往復・畳んだ名前が、逆引きを持たない役割にも「null」を返すために使う)。 */
function scanOf(layout: ProductLayout, productRoot: string | null, role: LayoutRole): LayoutScan | null {
  const decl = layout[role];
  const classify = decl?.classify;
  if (decl === undefined || classify === undefined || productRoot === null) return null;
  const base = decl.base === null ? '' : resolveFrom(layout, productRoot, decl.base, undefined, new Set([role]));
  if (base === null) return null;
  return {
    dir: joinSegments(base, classify.dir),
    keyOf: classify.keyOf,
    ...(classify.entryOf === undefined ? {} : { entryOf: classify.entryOf }),
    ...(classify.entryFileName === undefined ? {} : { entryFileName: classify.entryFileName }),
    ...(classify.forbiddenRoots === undefined ? {} : { forbiddenRoots: classify.forbiddenRoots.map((dir) => joinSegments(productRoot, dir)) }),
    ...(classify.staticRoot === undefined ? {} : { staticRoot: { dir: joinSegments(productRoot, classify.staticRoot.dir), extensions: classify.staticRoot.extensions } }),
    ...(classify.frameConfig === undefined
      ? {}
      : {
          frameConfig: {
            files: classify.frameConfig.files.map((file) => joinSegments(productRoot, file)),
            allowedKeys: classify.frameConfig.allowedKeys,
            ...(classify.frameConfig.fixedMembers === undefined ? {} : { fixedMembers: classify.frameConfig.fixedMembers }),
            ...(classify.frameConfig.required === undefined ? {} : { required: classify.frameConfig.required }),
          },
        }),
    ...(classify.frameRootFiles === undefined ? {} : { frameRootFiles: { dir: joinSegments(productRoot, classify.frameRootFiles.dir), files: classify.frameRootFiles.files } }),
  };
}

/** `layoutScan` の結果(走査する根と、その下の相対パス → キー)。 */
export interface LayoutScan {
  /** 走査する根(`productRoot` を接いだ形)。 */
  readonly dir: string;
  /** `dir` からの相対パス → キー(この役割の実体でなければ null)。 */
  readonly keyOf: (relativePath: string) => string | null;
  /** `dir` からの相対パス → 入口のファイルか(キーに結べるかには依らない。省略は `keyOf` が null でないもの。`RoleClassifier.entryOf`)。 */
  readonly entryOf?: (relativePath: string) => boolean;
  /** 入口のファイルとして受ける唯一のファイル名(省略は綴りを問わない。`RoleClassifier.entryFileName`)。 */
  readonly entryFileName?: string;
  /** あってはならない置き場(製品の根を接いだ形。`RoleClassifier.forbiddenRoots`)。 */
  readonly forbiddenRoots?: readonly string[];
  /** 枠がそのまま配る静的な置き場(製品の根を接いだ形)と、置いてよい拡張子(`RoleClassifier.staticRoot`)。 */
  readonly staticRoot?: { readonly dir: string; readonly extensions: readonly string[] };
  /** 枠の設定ファイル(製品の根を接いだ形)と、既定の export に書いてよい鍵の許可表(`RoleClassifier.frameConfig`)。 */
  readonly frameConfig?: { readonly files: readonly string[]; readonly allowedKeys: readonly string[]; readonly fixedMembers?: Readonly<Record<string, string>>; readonly required?: boolean };
  /** 枠が直下のファイルを名前で呼ぶ置き場(製品の根を接いだ形)と、置いてよいコードのファイル(`RoleClassifier.frameRootFiles`)。 */
  readonly frameRootFiles?: { readonly dir: string; readonly files: readonly string[] };
}

/**
 * 役割 + キー → 置き場 → 逆引き、で**戻ってきたキー**(キーの形に正規化したもの)。逆引きを持たない役割・キーが形に合わない・置き場を決められない・
 * 置き場が走査の根の下に無い・逆引きが null を返すときは null。
 */
function reverseKey(layout: ProductLayout, role: LayoutRole, key: string): string | null {
  const decl = layout[role];
  if (decl?.classify === undefined) return null;
  const scan = scanOf(layout, '', role);
  const path = layoutPath(layout, '', role, key);
  if (scan === null || path === null || !path.startsWith(`${scan.dir}/`)) return null;
  const back = scan.keyOf(path.slice(scan.dir.length + 1));
  return back === null ? null : normalizeKey(decl.multiplicity.key, back);
}

/**
 * 役割 + キー → 置き場 → 逆引き、で**同じキーに戻る**か(往復)。置き場に宣言できないキー(例: `_` 始まりの非公開のフォルダの下・`(g)` のようにルーティングで消える
 * 名前・動的なセグメント)は、実装の木を走査しても決して同じキーとして見つからないので、仕様と実装の突合(S7 / J2)が「ある」と言えない。逆引きを持たない役割は常に true(往復の対象ではない)。
 *
 * @param layout 後段が与える配置
 * @param role 役割
 * @param key キー(仕様の `route` など)
 * @returns 逆引きを持たない・往復で同じキーに戻るとき true。キーが形に合わない・置き場を決められない・逆引きで別のキーや null になるときは false
 */
export function layoutRoundTrips(layout: ProductLayout, role: LayoutRole, key: string): boolean {
  const decl = layout[role];
  if (decl?.classify === undefined) return true;
  const back = reverseKey(layout, role, key);
  return back !== null && back === normalizeKey(decl.multiplicity.key, key);
}

/**
 * 置き場の**畳んだ名前**。逆引きを持つ役割は、置き場 → 逆引きで戻ったキーを走査の根と対にした形(ルーティングの規約で同じ実体になる置き場は、同じ名前に畳まれる —
 * 例: `/(g)/x` と `/x` は同じ URL。同じ走査の根を取る別の役割の実体とも名前を共有する — 画面の器 `page` と HTTP の入口 `route` は、同じセグメントに両方は置けない)。
 * 衝突の検査(`layout-claims.ts`)が、パスの一致に加えて、この名前の一致を同じ置き場の取り合いとして数える。
 *
 * @param layout 後段が与える配置
 * @param role 役割
 * @param key キー
 * @returns 畳んだ名前。逆引きを持たない役割・往復できない(畳めない)ときは null
 */
export function layoutFoldedPlace(layout: ProductLayout, role: LayoutRole, key: string): string | null {
  const scan = scanOf(layout, '', role);
  const back = reverseKey(layout, role, key);
  return scan === null || back === null ? null : `${scan.dir}::${back}`;
}

/**
 * 画面の器(ページの入口)の位置。
 *
 * @param layout 後段が与える配置
 * @param roots 製品の根(`app` だけ見る)
 * @param route 仕様の `route`
 * @returns パス。実装の木が無い・配置に無い・キーが形に合わないときは null
 */
export function screenShellPath(layout: ProductLayout, roots: { readonly app: string | null }, route: string): string | null {
  return layoutPath(layout, roots.app, 'screen-shell', route);
}

/**
 * リクエスト前段の位置。
 *
 * @param layout 後段が与える配置
 * @param roots 製品の根(`app` だけ見る)
 * @returns パス。実装の木が無い・配置に無いときは null
 */
export function requestGatePath(layout: ProductLayout, roots: { readonly app: string | null }): string | null {
  return layoutPath(layout, roots.app, 'request-gate');
}

/**
 * 画面の部品の生成物の位置。
 *
 * @param layout 後段が与える配置
 * @param roots 製品の根(`app` だけ見る。`''` は製品の根からの相対)
 * @param file ファイル名
 * @returns パス。実装の木が無い・配置に無い・ファイル名が形に合わないときは null
 */
export function screenPartPath(layout: ProductLayout, roots: { readonly app: string | null }, file: string): string | null {
  return layoutPath(layout, roots.app, 'screen-part', file);
}

/**
 * 画面テストの置き場の位置。
 *
 * @param layout 後段が与える配置
 * @param roots 製品の根(`app` だけ見る)
 * @param file ファイル名
 * @returns パス。実装の木が無い・配置に無い・ファイル名が形に合わないときは null
 */
export function screenTestPath(layout: ProductLayout, roots: { readonly app: string | null }, file: string): string | null {
  return layoutPath(layout, roots.app, 'screen-test', file);
}

/**
 * アプリ全体の既定のアイコンの位置。
 *
 * @param layout 後段が与える配置
 * @param roots 製品の根(`app` だけ見る)
 * @returns パス。実装の木が無い・配置に無いときは null
 */
export function appIconPath(layout: ProductLayout, roots: { readonly app: string | null }): string | null {
  return layoutPath(layout, roots.app, 'app-icon');
}

/**
 * 実装のソースの根(`product-root` の下)。
 *
 * @param layout 後段が与える配置
 * @param roots 製品の根(`app` だけ見る)
 * @returns ソースの根のパス。製品が実装の木を宣言していない・配置に無いときは null
 */
export function sourceRootPath(layout: ProductLayout, roots: { readonly app: string | null }): string | null {
  return layoutPath(layout, roots.app, 'source-root');
}

/**
 * URL のパスに結ばれた HTTP の入口(Route Handler)の位置。
 *
 * @param layout 後段が与える配置
 * @param roots 製品の根(`app` だけ見る)
 * @param url URL のパス
 * @returns パス。実装の木が無い・配置に無い・キーが形に合わないときは null
 */
export function httpEntryPath(layout: ProductLayout, roots: { readonly app: string | null }, url: string): string | null {
  return layoutPath(layout, roots.app, 'http-entry', url);
}

/**
 * 連携 ID に結ばれた組み立ての根(受信 Webhook の配線)の位置。
 *
 * @param layout 後段が与える配置
 * @param roots 製品の根(`app` だけ見る)
 * @param integration 連携 ID
 * @returns パス。実装の木が無い・配置に無い・キーが形に合わないときは null
 */
export function compositionRootPath(layout: ProductLayout, roots: { readonly app: string | null }, integration: string): string | null {
  return layoutPath(layout, roots.app, 'composition-root', integration);
}

/**
 * E2E スモークとウォーカーの置き場(`e2e-root`)の位置。
 *
 * @param layout 後段が与える配置
 * @param roots 製品の根(`app` だけ見る)
 * @returns パス。実装の木が無い・配置に無いときは null
 */
export function e2eRootPath(layout: ProductLayout, roots: { readonly app: string | null }): string | null {
  return layoutPath(layout, roots.app, 'e2e-root');
}

/**
 * 設定の雛形(`env-template`)の位置。
 *
 * @param layout 後段が与える配置
 * @param roots 製品の根(`app` だけ見る)
 * @returns パス。実装の木が無い・配置に無いときは null
 */
export function envTemplatePath(layout: ProductLayout, roots: { readonly app: string | null }): string | null {
  return layoutPath(layout, roots.app, 'env-template');
}

/**
 * 道具のスクリプトの置き場(`script-root`)の位置。
 *
 * @param layout 後段が与える配置
 * @param roots 製品の根(`app` だけ見る)
 * @returns パス。実装の木が無い・配置に無いときは null
 */
export function scriptRootPath(layout: ProductLayout, roots: { readonly app: string | null }): string | null {
  return layoutPath(layout, roots.app, 'script-root');
}

/**
 * ハンドブックが写し元として読む資材(`app-resource`。ソースの根の下の手書きの置き場)の位置。
 *
 * @param layout 後段が与える配置
 * @param roots 製品の根(`app` だけ見る)
 * @param relative 基準の役割の下の相対パス(製品固有の末尾)
 * @returns パス。実装の木が無い・配置に無い・相対パスが形に合わないときは null
 */
export function appResourcePath(layout: ProductLayout, roots: { readonly app: string | null }, relative: string): string | null {
  return layoutPath(layout, roots.app, 'app-resource', relative);
}

/**
 * import の閉包を辿るときの、実装のソースの根の別名(`@/…` の `@/` と、それが指すディレクトリ)。
 *
 * 別名の綴り(`@`)は配置の `source-root` の `module` から来る(閉包を辿る側 `semantics/import-closure.ts` は綴りを持たない。
 * 型は同じ形を向こう側が自分で宣言する —— その側を C24 の写し元の閉包に配置の型ごと引き込まないため)。
 *
 * @param layout 後段が与える配置
 * @param roots 製品の根(`app` だけ見る)
 * @returns 別名(`prefix` は区切り `/` まで含む)。製品が実装の木を宣言していない・配置に `source-root` の `module` が無いときは null
 */
export function sourceAliasOf(layout: ProductLayout, roots: { readonly app: string | null }): { readonly prefix: string; readonly dir: string } | null {
  const dir = sourceRootPath(layout, roots);
  const module = layoutModule(layout, 'source-root');
  return dir === null || module === null ? null : { prefix: `${module}/`, dir };
}

/**
 * パスの正規化(`./` 始まり・`//`・`a/../b`・末尾の `/` を除く。現在のディレクトリ自身は空文字)。**前後の空白は削らない**(空白つきの綴りは、
 * 書き出す先のパスとしても空白つきのまま使われるので、包含の比べでだけ削ると選択の検査が緑で生成が別の場所へ書くことになる。空白つきは外にあるものとして赤にする)。
 * 配置の `source-root` と製品の `roots.generated` の包含の比較に使う(選択の検査と指定の導出が同じ関数で比べる)。
 *
 * @param value パス
 * @returns 正規化したパス
 */
export function normalizedPath(value: string): string {
  const normalized = posix.normalize(value).replace(/\/+$/, '');
  return normalized === '.' ? '' : normalized;
}

/**
 * 基準のパスの中にあるパスの、基準からの相対(同じ場所は空文字)。包含は**正規化したあとで**比べる(`./app/src` と `app/src/` は同じ。前後の空白は削らない)。
 *
 * @param base 基準(例: 配置の `source-root`)
 * @param target 基準の中にあるはずのパス(例: 製品の `roots.generated`)
 * @returns 基準からの相対。基準の外・絶対パスと相対パスの食い違いのときは null
 */
export function pathWithin(base: string, target: string): string | null {
  const from = normalizedPath(base);
  const to = normalizedPath(target);
  if (to === from) return '';
  if (from === '') return to.startsWith('/') || to === '..' || to.startsWith('../') ? null : to;
  return to.startsWith(`${from}/`) ? to.slice(from.length + 1) : null;
}

/**
 * 生成物の根の下のモジュールの import に使う指定(ソースの根の別名 + 製品の宣言 `roots.generated` のソースの根からの相対 + 名前)。
 *
 * 生成物の根は製品の宣言(`roots.generated`)が決めるので、同じ事実を配置の役割に二重に書かない(配置の定義の検査が見るのは「生成物の根がソースの根の中にある」ことだけ。
 * 中にあるかの判定は選択の検査 `layoutRootsProblems` と同じ `pathWithin`。ソースの根そのものを生成物の根にするのも中に数える)。
 * 別名の綴りは配置の `source-root` の `module` から来る。
 *
 * @param layout 後段が与える配置
 * @param roots 製品の根(`app` と `generated`)
 * @param name 生成物のモジュールの名前(拡張子なし。例: `jobs` ・`{表}.labels`)。空文字は決められない
 * @returns 指定。製品が実装の木を宣言していない・配置に `source-root` の置き場か `module` が無い・生成物の根がソースの根の外にある・名前が空のときは null
 */
export function generatedModuleOf(layout: ProductLayout, roots: { readonly app: string | null; readonly generated: string }, name: string): string | null {
  const alias = layoutModule(layout, 'source-root');
  const source = sourceRootPath(layout, roots);
  if (alias === null || source === null || name === '') return null;
  const inside = pathWithin(source, roots.generated);
  if (inside === null) return null;
  return inside === '' ? `${alias}/${name}` : `${alias}/${inside}/${name}`;
}
