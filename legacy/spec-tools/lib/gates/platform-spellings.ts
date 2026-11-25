/**
 * **後段の綴りは、その後段の置き場の外の文字列に書かない**(設計メモ framework-modules §20)の判定部。後段ごとの綴りの表
 * (`TARGET_SPELLINGS`)を持ち、表の 1 行 = 「その後段の置き場 `home` の外に書けない綴り」である(後段を足す日は 1 行足す)。
 *
 * **プラットフォーム(Supabase)**:
 *
 * 認証・API 層(いまは Supabase)の約束 —— 現在の実行者を返す認証関数・セッション属性の枝・DB ロールの名前・
 * 外に出すスキーマの名前 —— は、設定 `PlatformProfile`(`lib/model/product/platform-profile.ts` が型・
 * `lib/targets/<後段>/platform-profile.ts` が値)の 1 か所にだけ綴りを持つ。SQL の生成器は設定を引数で受け取って
 * 組み立てる。直書きが 1 本残ると、後段を差し替えた日にそこだけ古い綴りで SQL が出る。
 *
 * 見るのは `lib/**` と `cli/**` の `.ts` のうち後段の置き場(`PLATFORM_HOME`)の**外**のソースの、**文字列リテラルとテンプレート文字列の
 * 文面**と、**パスを組む呼び出し(`join` / `joinPath` / `resolve` / `…Path`)の連続する文字列リテラルの引数を `/` でつないだ形**である(AST で数える。コメントは見ない)。正規表現・識別子・型の名前は文字列ではないので見ない。
 * **免除の口は無い** —— 綴りを書いてよい場所は後段の置き場(`PLATFORM_HOME`)そのものだけで、許可リストも
 * 例外の表も持たない。綴りの粒度は「文面の中のその語が、コードや人向けの文でロール名・関数名・スキーマ名として
 * 使われている形」に絞ってある(別の意味で同じ語が出る実装の語は誤検出になるので選ばない。例: ロール種別
 * `authenticated_default`・仕様の種類名 `api` は見ない)。
 *
 * **見ていないもの**(限界。誤検出が多いか、直せないため。ここに書いて受け入れている):
 * - スキーマ名の**単独の**文字列 `'api'`(仕様の種類名・読み取りの種類名として同じ語が出る)。SQL の文脈
 *   (修飾名・`schema …`・`schema: '…'`)だけを数える。
 * - 散文の「`api` スキーマ」(人向けの文面。適用済みの migration の冒頭コメントに出る `messages-ddl.ts` の説明文は、
 *   C23 の不変により 1 バイトも直せない)。
 * - **`.mjs` / `.js`**(`cli/prove-api-viewdef.mjs` など Supabase の CLI を直接叩く後段の道具のスクリプト。
 *   木を読む口は `.mjs` も読むが、`cli/` は `.ts` だけを検査の母集合にする)。
 * - `auth.` + 列挙に無い名前(`auth.md` / `auth.axis` のような製品・仕様の語は、構造では区別できないので列挙で絞る)。
 *   **列挙は完全ではない**(Supabase Auth の名前は版で増える。足りない名前は、見つけた日に `SUPABASE_AUTH_NAME` へ足す)。
 * - **テンプレート文字列の補間で名前を組み立てる形**(`` `auth.${name}` `` / `'auth.' + name`)。断片は `auth.` だけ・名前は式なので、文面からは名前が読めない。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import ts from 'typescript';
import { joinedLiteralRuns } from './joined-literal-runs.js';

/** 見張る綴り 1 種(名前・文面に当てる正規表現)。 */
export interface PlatformSpelling {
  /** 何の綴りか(違反の説明にそのまま出る)。 */
  readonly name: string;
  /** 文字列リテラルの文面(テンプレート文字列は断片ごと)に当てる正規表現。 */
  readonly pattern: RegExp;
}

/**
 * Supabase Auth の名前空間 `auth.` の下の名前(**列挙**)。`auth.` + 任意の識別子にしないのは、製品・仕様の語の
 * `auth.md`・`auth.ts`(ファイル名)や `auth.axis` / `auth.condition`(仕様の要素 id)を巻き込むためで、構造では
 * 区別できない。SQL・コードの文字列に出る形は 3 種 —— 関数(`auth.uid()` / `auth.jwt()` / `auth.role()` / `auth.email()`)・
 * 表(`auth.users` ほか。外部キーの参照先)・クライアントの口(`client.auth.admin.*` / `auth.signInWithPassword` / `auth.getClaims` ほか)。
 * 前に `/`・`-`・語の文字が付く形(`backend/auth.md`)は数えない。
 */
const SUPABASE_AUTH_NAME: RegExp =
  /(?<![\w/-])auth\.(?:uid|jwt|role|email|users|identities|sessions|refresh_tokens|one_time_tokens|audit_log_entries|flow_state|mfa\w*|oauth\w*|saml_\w+|sso_\w+|admin|signIn\w*|signUp|signOut|getUser|getUserIdentities|getSession|getClaims|setSession|refreshSession|updateUser|reauthenticate|resend|linkIdentity|unlinkIdentity|resetPasswordForEmail|exchangeCodeForSession|verifyOtp|onAuthStateChange|startAutoRefresh|stopAutoRefresh)\b/;

/**
 * 見張る綴り。
 *
 * ロール名は「語の切れ目で独立した 1 語」だけを数える(`_` で続く語・`.` や `:` の隣は数えない —— 種別の語
 * `authenticated_default` や生成物のキー名を巻き込まないため)。スキーマ名は SQL の文脈
 * (`{スキーマ}.{名前}(`・`…schema {スキーマ}`・`schema: '…'`・修飾名の前半が文字列の末尾に来る形)だけを数える
 * (仕様の種類名や読み取りの種類名として同じ語が出る)。
 */
export const PLATFORM_SPELLINGS: readonly PlatformSpelling[] = [
  { name: 'Supabase Auth の名前(認証関数・認証テーブル・認証クライアント)', pattern: SUPABASE_AUTH_NAME },
  { name: 'セッション属性が載る JWT の枝', pattern: /\bapp_metadata\b/ },
  { name: '内部実行の DB ロール名', pattern: /service_role/i },
  { name: '一般利用者の DB ロール名', pattern: /(?<![\w.])(anon|authenticated)(?![\w:])/ },
  { name: '外に出すスキーマ名(SQL の文脈)', pattern: /(?<![\w./-])api\.$|\bapi\.[a-z_]+\(|\bschema\s+api\b|\bschema\s*[:=]\s*['"]api['"]/ },
];

/** プラットフォームの綴りを書いてよい唯一の置き場(後段 `supabase`)。`lib/` 始まりの相対パスに当てる。 */
export const PLATFORM_HOME: RegExp = /^lib\/targets\/supabase\//;

/** ホストの綴りを書いてよい唯一の置き場(後段 `vercel`)。 */
export const HOST_HOME: RegExp = /^lib\/targets\/vercel\//;

/**
 * ホスト(Vercel)の綴り。Cron の登録ファイルの**名前そのもの**(`vercel.json`・`app/vercel.json`・テンプレート文字列の `/vercel.json`)を
 * 文字列として持つと、コアの検査・生成がそのホストの設定ファイルを読み書きする(後段を差し替えた日にそこだけ古いファイル名を見る)。
 *
 * **見ていないもの**: 散文の中の綴り(`(vercel.json と migration)` のように文の途中に出る形)。ハンドブックの章の文面に 1 件あり
 * (`generate/render/book/jobs-page.ts`)、直すと生成物(`docs/book/jobs.md`)が変わるので、仕様の中立化(部品化 ③-d)で扱う。
 * 文字列そのものがファイル名で終わる形(パスとして使う形)だけを数える。
 */
export const HOST_SPELLINGS: readonly PlatformSpelling[] = [
  { name: 'ホストの Cron の登録ファイルの名前(パスとして使う形)', pattern: /(?:^|\/)vercel\.json$/ },
];

/** アプリの枠の綴りを書いてよい唯一の置き場(後段 `nextjs`)。 */
export const APP_FRAME_HOME: RegExp = /^lib\/targets\/nextjs\//;

/**
 * アプリの枠(Next.js)の綴り。**置き場の配置(`ProductLayout`)に移した役割の綴りと、コアが持ってはならない層・規約ファイルの綴り**を見張る。
 * `http-entry`(Route Handler のファイル名 `route.ts` ・モジュール指定 `@/app/…`)・`composition-root` の受信の配線(`composition/inbound/`)と、
 * 画面の器まわり(ページの入口 `page.tsx` ・リクエスト前段 `proxy.ts` ・既定のアイコン `favicon.ico` ・画面テストの置き場 `__screens__`)と、
 * 生成テストの置き場(`__tests__/generated` の下。部品化 ③-c3)と、操作・保存点・フォームの置き場(`_actions` ・`_screens` ・`composition/usecase` ・`components/usecase/generated`。③-c5)と、
 * **ソースの根の下の層のディレクトリ(`src/{層}`)・UI 部品の層(`components`)・E2E の置き場(`e2e`)・設定の雛形(`.env.example`)**(③-c6。W3 の「層の並びは仕組みが決めている形」の許しの撤回 ——
 * コアは層の並びの綴りも持たない。層の 4 名はコアの語だが、`src/` の下に並ぶという形・スタックが足す層の名前は後段の値である)。
 * 後段の置き場(`lib/targets/nextjs/`)の外に、これらがパスの形で出たら赤になる。**免除の口は無い**(置き場そのものが唯一の境界)。
 *
 * **③-e への宿題の一覧 = 見ていないもの**(限界。誤検出が多いか、生成物の文面を変えずには直せないので、ここに 1 か所でまとめて受け入れている。`scripts-code-quality.md` の同じ一覧と対):
 * - **フレームワークの語**: `force-dynamic` ・`server-only`(アプリの枠の後段の生成器へ寄せる日に扱う)。
 * - **リクエスト前段の `matcher` の文法と書式**(`screen/route-match.ts` ・`screen/app-loader.ts`)。ファイル名ではなく記法の写しで、画面の `route` の記法の中立化(部品化 ③-d)と一緒に扱う。
 * - **視覚層の `brand` の値の例**: 製品の仕様(`tokens.md`)が書く `icon: app/src/app/icon.png` のようなパスの値そのもの(製品の宣言であり、コアの文字列ではない)。検査・パーサの案内文からは
 *   Next の綴りを外した(アイコンのファイル名の規約は配置の役割 `app-icon` を与える後段 `nextjs` が持つ。③-d2)。`apple_icon` / `og_image` の欄の削除は review-queue §28 ① の答え待ち。
 * - **生成物に埋め込まれる文面のパス**: ハンドブックの章・生成物のコメントに書かれる `app/src/…` ・`app/e2e/walker…` の案内(`generate/render/book/parts-demo.ts` ・`code-jobs.ts` ・`code-notifications.ts` ・
 *   `code-personal-expectations.ts` ほか)・生成物の doc コメントと JSON の `$generated` の「正は framework-dirs.ts」(土台の表は配置に移った)。直すと生成物のバイトが変わるので、文面を動かす束で直す。
 *   **文字列ぜんたいがパスの形のものだけを数える**ので、散文に埋まった形は数えない。
 * - **生成テストの本文の相対 import**(`../../../__tests__/plan-harness` ほか)は置き場の深さの写し。配置の定義の検査が深さの食い違いを止めるが、本文は配置から組んでいない。
 * - **製品固有の末尾**: ハンドブックが写す資材の末尾(`book-input-sources.ts` の `_styles/ui.module.css` ほか。**製品の宣言へ寄せる宿題**)と、書き方の例の抜粋元の末尾(`examples-page-catalog*.ts`)は、製品の抜粋元の宣言で役割ではない。
 * - **ハーネスのアダプタ**(`harness-adapter` / `save-harness-adapter`。`infrastructure/__tests__/{名前}.ts`): `__tests__` そのものは Next.js に固有の名前でない(テストの置き場の慣習)ので、綴りの表に載せない。
 * - **道具のスクリプトの置き場 `scripts`**: 語の単独で、生成された SQL のコメントに旧い道具の置き場(`docs/scripts/lib/sql/…`)が固定の文面で残る(適用済みの migration は 1 バイトも直せない)ので、綴りの表に載せない。
 * - **ふつうの語としても出うる単独の文字列**(`'route.ts'` ・`'app'` ・`'e2e'` ・`'components'` ・`'src'`。仕様の語・拡張子の名として出る)。**規則は 1 つ: 単独の語は数えず、パスの形(`/` を含む)と、パスを組む呼び出しの連続する文字列リテラルの引数を `/` でつないだ形(下)だけを数える**
   (規約に固有のファイル名・ディレクトリ名 —— `page.tsx` ・`proxy.ts` ・`favicon.ico` ・`.env.example` ・`__screens__` ・`_actions` ・`_screens` —— は単独でもパスの形として数える。ふつうの語として出ないため)。
   散文の中の綴りと、`+` で結んだ断片(`'operation/' + '__tests__/generated'`)は数えない。
 * - **生成物の本文の Next.js の語**: 先頭指令 `'use client'`(`screen-table-ops-body.ts` ほか)・`'use server'`(`code-operation-app.ts` ・`code-usecase-app.ts`)・`next/link` の import(`screen-row-slots.ts`)。生成物の本文は文字列ぜんたいがパスの形でなく、文面を動かすとバイトが変わる。
 * - **Next のビルド出力 `.next`**(`io/paths.ts` ・`io/read-ts-tree.ts`)と、**E2E の道具の規約**(`.spec.mts`: `trace/scan.ts` ・`model/parse-test-case.ts`、`walker*.mts`)。ビルドの出力先・テストの拡張子は後段の値で、単独の語・拡張子の形なので数えない。
 * - **後段どうしの越境**: `lib/targets/supabase/samples/db-tree.ts` ・`db-parity-tree.ts` の `'server-only'` の別名とスタブ(Supabase の置き場が Next の語を持つ)。Supabase の置き場は Next の枠の語を知らない形にする。
 * - **`code-config.ts` の `app/scripts/setup-secrets.mts`**(生成物の案内文のパス)と、**`formal/premise.ts` の `'/api/jobs/run'`**(③-d で仕様の語の側として扱う)。
 * - **型の位置の文字列**(`SlotNode['components']` のような索引): 型の名前は文字列ではないので見ない(代わりに型の別名を使うと、リテラルが残らない)。
 */
export const APP_FRAME_SPELLINGS: readonly PlatformSpelling[] = [
  { name: 'Route Handler のファイルの名前(パスとして使う形 `…/route.ts`)', pattern: /\/route\.ts$/ },
  { name: '受信の配線の置き場(組み立ての根の inbound ディレクトリの下)', pattern: /composition\/inbound\// },
  { name: 'Route Handler のモジュール指定(app 配下の別名の指定)', pattern: /^@\/app(?:\/|$)/ },
  { name: 'ページの入口のファイルの名前(パスとして使う形 `…/page.tsx`)', pattern: /(?:^|\/)page\.tsx$/ },
  { name: 'リクエスト前段のファイルの名前(パスとして使う形 `proxy.ts`)', pattern: /(?:^|\/)proxy\.ts$/ },
  { name: '既定のアイコンのファイルの名前(パスとして使う形 `…/favicon.ico`)', pattern: /(?:^|\/)favicon\.ico$/ },
  { name: '画面テストの置き場のディレクトリ(パスとして使う形 `__screens__`)', pattern: /^(?:[^\s`]*\/)?__screens__(?:\/[^\s`]*)?$/ },
  { name: '生成テストの置き場のディレクトリ(パスとして使う形 `…/__tests__/generated`)', pattern: /(?:^|\/)__tests__\/generated(?:\/[^\s`]*)?$/ },
  { name: 'Server Action の置き場のディレクトリ(パスとして使う形 `_actions`)', pattern: /(?:^|\/)_actions(?:\/[^\s`]*)?$/ },
  { name: '画面の部品の生成物の置き場のディレクトリ(パスとして使う形 `_screens`)', pattern: /(?:^|\/)_screens(?:\/[^\s`]*)?$/ },
  { name: '保存点の配線の置き場のディレクトリ(パスとして使う形 `composition/usecase`)', pattern: /(?:^|\/)composition\/usecase(?:\/[^\s`]*)?$/ },
  { name: '保存点の 1 画面フォームの置き場のディレクトリ(パスとして使う形 `components/usecase/generated`)', pattern: /(?:^|\/)components\/usecase\/generated(?:\/[^\s`]*)?$/ },  // 部品化 ③-c6: コアは層・規約ファイル・製品の根の直下の置き場の綴りを持たない(W3 の「層の並びは仕組みが決めている形」の許しの撤回)。
  // **文字列ぜんたいがパスの形のものだけ**を数える(散文に埋まったパスは数えない —— 日本語の文は空白で切れず、末尾の一致が散文を巻き込むため。
  // パスの 1 段は ASCII の英数字と `_ . @ [ ] ( ) -` だけ)。パターンを正規表現のリテラルで書くのは、綴りの断片を文字列で持つと、この表自身が自分の検査に引っかかるため。
  { name: 'ソースの根の下の層のディレクトリ(パスとして使う形 `src/{層}`)', pattern: /^\/?(?:[A-Za-z0-9_.@\[\]()-]+\/)*src\/(?:app|operation|infrastructure|composition|domain|components)(?:\/[A-Za-z0-9_.@\[\]()-]+)*\/?$/ },
  { name: 'UI 部品の層のディレクトリ(パスとして使う形 `components`)', pattern: /^(?=[^/]*\/)\/?(?:[A-Za-z0-9_.@\[\]()-]+\/)*components(?:\/[A-Za-z0-9_.@\[\]()-]+)*\/?$/ },
  { name: 'E2E の置き場のディレクトリ(パスとして使う形 `e2e`)', pattern: /^(?=[^/]*\/)\/?(?:[A-Za-z0-9_.@\[\]()-]+\/)*e2e(?:\/[A-Za-z0-9_.@\[\]()-]+)*\/?$/ },
  { name: '設定の雛形のファイルの名前(パスとして使う形 `.env.example`)', pattern: /^\/?(?:[A-Za-z0-9_.@\[\]()-]+\/)*\.env\.example$/ },
];

/**
 * **モジュール指定の別名の綴り**(部品化 ③-e1)。生成物の本文が import する先は、置き場の配置が決める(生成物の根は製品の宣言 `roots.generated`・手書きの接続点は配置の役割の `module`)。
 * 別名の接頭辞(ソースの根を指す記号 + `/`)を、アプリの枠の後段の置き場(`lib/targets/nextjs/`)の外の文字列に書くと、生成器が製品の住所の綴りを持つことになり、
 * 配置を差し替えても本文が古い綴りで出る。見るのは**文字列の頭、または引用符・バッククォートの直後**に別名の接頭辞が来る形(import の行の文面・テンプレートの断片・
 * 説明文に埋めた引用)。**免除の口は無い** —— 書いてよい場所は後段 nextjs の置き場だけ(通し実行の道具など、ほかの後段が一時ツリーに別名の指定を書くときも、配置から引いた値を使う)。
 */
export const MODULE_SPECIFIER_SPELLINGS: readonly PlatformSpelling[] = [
  { name: 'ソースの根の別名で始まるモジュール指定(import の行・説明文に埋めた引用)', pattern: /(?:^|['"`])@\// },
];

/** 後段 1 つ分の「その後段の置き場の外に書けない綴り」(後段の名前・置き場・綴り)。 */
export interface TargetSpellings {
  /** 後段の名前(説明用)。 */
  readonly target: string;
  /** 綴りを書いてよい唯一の置き場(`lib/` 始まりの相対パスに当てる)。 */
  readonly home: RegExp;
  /** この後段の外に書けない綴り。 */
  readonly spellings: readonly PlatformSpelling[];
}

/** 後段ごとの綴りの表。**例外の表は持たない**(各後段は自分の置き場の外にだけ綴りを禁じられる)。 */
export const TARGET_SPELLINGS: readonly TargetSpellings[] = [
  { target: 'supabase', home: PLATFORM_HOME, spellings: PLATFORM_SPELLINGS },
  { target: 'vercel', home: HOST_HOME, spellings: HOST_SPELLINGS },
  // 別名の綴りもアプリの枠の綴り(書いてよい場所は後段 nextjs の置き場だけ。ほかの後段も、別名の指定は配置から引いて書く)。
  { target: 'nextjs', home: APP_FRAME_HOME, spellings: [...APP_FRAME_SPELLINGS, ...MODULE_SPECIFIER_SPELLINGS] },
];

/**
 * 後段の置き場(`lib/targets/<後段>/`)と綴りの表(`TARGET_SPELLINGS`)の食い違いを返す(新しい後段を足す日に表の 1 行を忘れても気づけるように)。
 * 食い違いは 3 つ: 置き場があるのに表に行が無い(その後段の綴りを外に書いても見張られない)・表の行の置き場の正規表現が自分の置き場に当たらない・
 * 表に行があるのに置き場が無い(腐った行)。
 *
 * @param files 木のファイルの相対パス(`lib/` 始まり。後段の置き場の名前をここから拾う)
 * @param table 後段ごとの綴りの表(既定は `TARGET_SPELLINGS`)
 * @returns 食い違いの説明(無ければ空)
 */
export function targetSpellingProblems(files: Iterable<string>, table: readonly TargetSpellings[] = TARGET_SPELLINGS): readonly string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    const dir = /^lib\/targets\/([^/]+)\//.exec(file)?.[1];
    if (dir !== undefined) dirs.add(dir);
  }
  const problems: string[] = [];
  for (const dir of [...dirs].sort()) {
    if (!table.some((row) => row.target === dir)) problems.push(`後段の置き場 lib/targets/${dir}/ に、綴りの表(TARGET_SPELLINGS)の行がありません`);
  }
  for (const row of table) {
    if (!dirs.has(row.target)) problems.push(`綴りの表(TARGET_SPELLINGS)の行 ${row.target} に対応する後段の置き場 lib/targets/${row.target}/ がありません`);
    else if (!row.home.test(`lib/targets/${row.target}/x.ts`)) problems.push(`綴りの表(TARGET_SPELLINGS)の行 ${row.target} の置き場(home)が lib/targets/${row.target}/ に当たりません`);
  }
  return problems;
}

/** 見つかった綴り 1 件。 */
export interface SpellingHit {
  /** `lib/` 始まりの相対パス。 */
  readonly file: string;
  /** 行(1 始まり)。 */
  readonly line: number;
  /** どの綴りか(`PlatformSpelling.name`)。 */
  readonly spelling: string;
  /** 見つかった文面(先頭の一部。複数行は 1 行に畳む)。 */
  readonly text: string;
}

/** 文字列リテラルかテンプレート文字列の断片か。 */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return node.text;
  return null;
}

/**
 * 写しの全ファイルから、後段の置き場の外にある綴りを拾う。
 *
 * @param sources `lib/` 始まりの相対パス → 本文(`readTsTree` の結果)
 * @param spellings 見張る綴り(既定は `PLATFORM_SPELLINGS`)
 * @param home 綴りを書いてよい置き場(既定は `PLATFORM_HOME`)
 * @returns 見つかった綴り(ファイル・行の昇順)
 */
export function findPlatformSpellings(
  sources: ReadonlyMap<string, string>,
  spellings: readonly PlatformSpelling[] = PLATFORM_SPELLINGS,
  home: RegExp = PLATFORM_HOME,
): readonly SpellingHit[] {
  const hits: SpellingHit[] = [];
  for (const [file, source] of [...sources].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (home.test(file)) continue;
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
    const visit = (node: ts.Node): void => {
      const text = literalText(node);
      if (text !== null) {
        for (const spelling of spellings) {
          if (!spelling.pattern.test(text)) continue;
          const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
          hits.push({ file, line, spelling: spelling.name, text: text.replace(/\s+/g, ' ').slice(0, 60) });
        }
      }
      if (ts.isCallExpression(node)) {
        for (const run of joinedLiteralRuns(node)) {
          for (const spelling of spellings) {
            // 連続のうち 1 つの引数がすでに当たっているなら、同じ箇所を 2 回言わない。
            if (!spelling.pattern.test(run.text) || run.parts.some((part) => spelling.pattern.test(part))) continue;
            const line = parsed.getLineAndCharacterOfPosition(run.first.getStart(parsed)).line + 1;
            hits.push({ file, line, spelling: spelling.name, text: run.text.replace(/\s+/g, ' ').slice(0, 60) });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }
  return hits;
}

/**
 * 後段ごとの綴りの表の全行について、各後段の置き場の外にある綴りを拾う。
 *
 * @param sources `lib/` 始まりの相対パス → 本文(`readTsTree` の結果)
 * @param table 後段ごとの綴りの表(既定は `TARGET_SPELLINGS`)
 * @returns 見つかった綴り(ファイル・行の昇順。同じ位置は表の順)
 */
export function findTargetSpellings(
  sources: ReadonlyMap<string, string>,
  table: readonly TargetSpellings[] = TARGET_SPELLINGS,
): readonly SpellingHit[] {
  return table
    .flatMap((row) => findPlatformSpellings(sources, row.spellings, row.home))
    .sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
}
