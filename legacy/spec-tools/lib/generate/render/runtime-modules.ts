/**
 * 生成物が読む **`@kaninabe/runtime` の公開サブパス**の唯一の宣言。
 *
 * 生成物(`{生成物の置き場}/**`)は状態機械・権限・ガードの評価器の型と実行計画の型を読む。
 * それらは製品の中には無く、実行時パッケージ `@kaninabe/runtime` が持つ(ADR-0013)ので、生成器は
 * **パッケージ名で書く**。
 *
 * ここに 1 か所で置く理由は 2 つある。
 *
 * 1. **同じ綴りが 10 個の生成器に散っていた**(`'../engine/types'` が 6 本・`'../engine'` が
 *    3 本・`'./plan-types'` が 1 本)。相対パスだったので、生成物の置き場を 1 段動かすと
 *    10 か所を直す形だった —— `framework-dirs.ts` が免除リスト 6 か所を畳んだのと同じ話である。
 * 2. **これは製品の根ではない**(パッケージ名である)ので W3 の相手ではないが、仕組み自身の
 *    住所と同じ扱いで 1 か所に集める(`lib/io/paths.ts` の `FRAMEWORK_*` と対になる)。
 */

/** 評価器の入口(状態機械・権限・ガードの評価そのもの)。 */
export const RUNTIME_ENGINE_MODULE = '@kaninabe/runtime/engine';

/** 評価器の型契約(`MachineTable` / `CreateTable` / `WriteTable` / `DeleteTable`)。 */
export const RUNTIME_ENGINE_TYPES_MODULE = '@kaninabe/runtime/engine/types';

/** 実行計画の型(`RunPlan` とその部品)。 */
export const RUNTIME_PLAN_MODULE = '@kaninabe/runtime/plan';

/** 操作の結末の型(`ActionResult` / `FieldIssue` / `err`)。 */
export const RUNTIME_RESULT_MODULE = '@kaninabe/runtime/result';

/** 送信の意図の冪等キーと、書けたかどうかの境界(`intentKeyOf` / `temporaryFailureOf`。点検 20 回目 B20-1)。 */
export const RUNTIME_INTENT_MODULE = '@kaninabe/runtime/intent';

/** 認証基盤の操作(`platform_ops`)の戻り値の型と拒否の写し(`PlatformOpResult` / `platformOk` / `platformRefused` / `refusalMessage`)。 */
export const RUNTIME_PLATFORM_OP_MODULE = '@kaninabe/runtime/platform-op';

/** 入力の口(`formOf` / `toFieldIssues`)。 */
export const RUNTIME_FORM_MODULE = '@kaninabe/runtime/form';

/** 表示のための日時整形(`formatDateTime`。表示のタイムゾーンは呼び出し側が渡す)。 */
export const RUNTIME_DATETIME_MODULE = '@kaninabe/runtime/datetime';

/** URL の部品(`safeHttpUrl` = 画面の `href` に出してよい URL だけを通す / `readConfigUrl` = 設定の URL の関門)。 */
export const RUNTIME_URL_MODULE = '@kaninabe/runtime/url';

/** 書式つきの本文の描画の部品(`MarkdownView` = 許可リストで無害化した HTML だけを載せる唯一の口)。 */
export const RUNTIME_MARKDOWN_VIEW_MODULE = '@kaninabe/runtime/markdown-view';

/** 変更の有無の判定(`hasAnyChange`)。 */
export const RUNTIME_FORM_CHANGES_MODULE = '@kaninabe/runtime/form-changes';

/** refresh 後の編集フォームの入力の扱い(`reconcileFormDraft` / `acceptSaved` / `resolveConflict` / `conflictsOf`)。 */
export const RUNTIME_FORM_REFRESH_MODULE = '@kaninabe/runtime/form-refresh';

/** 受信 Webhook の段取り(`runInbound` / `InboundRoute` / `InboundPayload`)。 */
export const RUNTIME_INBOUND_MODULE = '@kaninabe/runtime/inbound';

/** 受信 Webhook の署名検証(`verifyInboundSignature`)。 */
export const RUNTIME_INBOUND_SIGNATURE_MODULE = '@kaninabe/runtime/inbound/signature';

/** サービスの認証の秘密の部品(`readServiceSecret` = 長さの下限を守る読みの関門 / `constantTimeEquals` / `matchesAnySecret` = 更新の間の新旧両対応)。 */
export const RUNTIME_SECRET_MODULE = '@kaninabe/runtime/secret';

/** ブラウザ側の守り(`gateDocumentRequest` / `BrowserDefensePolicy` / `staticHeaderEntries`)。 */
export const RUNTIME_BROWSER_DEFENSE_MODULE = '@kaninabe/runtime/http/browser-defense';

/** 要求の出どころの確認と Route Handler の応答の部品(`refuseCrossOrigin` / `logoutResponse` / `isSameOriginRequest`)。 */
export const RUNTIME_REQUEST_ORIGIN_MODULE = '@kaninabe/runtime/http/request-origin';

/** Route Handler の出口の関所(`guardRoute` / `isGuardedRoute`。全部の口をこれで包む — J2 が形を見る。点検 10 回目 B10-1)。 */
export const RUNTIME_ROUTE_GUARD_MODULE = '@kaninabe/runtime/http/route-guard';

/** 口の本体を依存から切り離して観測するテストの道具(`createDependencyLedger` / `observeHandler` / `refusalLeaks`)。生成した見張りテストだけが読む。 */
export const RUNTIME_ROUTE_ISOLATION_MODULE = '@kaninabe/runtime/testing/http/route-isolation';

/** 有料の口の関門を実物のまま叩くテストの道具(`installFakeBackend` / `observeGate` / `gateLeaks` / `sessionCookieHeader`。生成した見張りテストだけが読む)。 */
export const RUNTIME_PAID_GATE_MODULE = '@kaninabe/runtime/testing/http/paid-gate';

/** 製品が渡す宣言の束の**型**(`RuntimeBindings` / `SessionClaims`)。 */
export const RUNTIME_BINDINGS_MODULE = '@kaninabe/runtime/bindings';

/** 実行計画の実行器(`runPlanOperation` / `RunPlanDeps`)。 */
export const RUNTIME_TEMPLATE_MODULE = '@kaninabe/runtime/template';

/**
 * ハーネスが持つ**world の設計図の型**(束 ①-d 手 2)。
 *
 * 生成物は値(どの表にどの行を置くか)を書き出し、**形はここから再輸出する** —— 型を 2 か所で
 * 宣言していたあいだ、片方だけを直した日に黙って食い違う形が残っていた(設計メモ §9-12)。
 * この 3 本は**テストだけが読む**ので、境界のポリシーは `test-world-declaration` の分類から
 * だけ許している(本番コードから引くと `boundaries/dependencies` が赤にする)。
 */
export const RUNTIME_TESTING_RLS_TYPES_MODULE = '@kaninabe/runtime/testing/rls/types';

/** 一致の証明(単発の操作)の world の型。 */
export const RUNTIME_TESTING_EQ_TYPES_MODULE = '@kaninabe/runtime/testing/equivalence/types';

/** 一致の証明(保存点)の world の型。 */
export const RUNTIME_TESTING_SAVE_TYPES_MODULE = '@kaninabe/runtime/testing/save/types';
