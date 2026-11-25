---
doc_type: architecture
scope: backend
id: ARCH-BE-0001
norms: [PRIN-0001, PRIN-0003, PRIN-0005, PRIN-0007, PRIN-0008, PRIN-0010]
decisions: [ADR-0004, ADR-0006, ADR-0013]
---

# ARCH-BE-0001 — app パッケージの層構成と依存方向

## 目的

実装（`app/`）を、仕様と 1:1 で対応づけられる層に分割し、**依存の向きを機械が執行できる形**で固定する。テストが書けない構造・仕様と乖離しうる構造を、レビューではなくリンターで排除するための土台を定める。

## 概要

- `app/` は Next.js（App Router）+ React + TypeScript（strict）の npm パッケージとする。`docs/`（仕様・検証器・生成器）とは**別パッケージ**である。
- **workspaces で束ねるのは仕組み（framework）と製品（product）であって、`app/` と `docs/` ではない**（[ADR-0013](../../../decisions/common/ADR-0013-framework-runtime-package.md)）。リポジトリルートの `workspaces` は `framework/lint-config` / `framework/runtime` / `app` の 3 つで、**`docs/` は入れない** —— 守っているのは「製品のビルドに検査器のツールチェーン（tsx・z3・vitepress）を持ち込まない」ことであり、そこは変わっていない。
- 層は 6 つ: `src/domain` / `src/operation` / `src/infrastructure` / `src/composition` / `src/app` / `src/components`。
- 依存は**内向きの一方向**に限る。`src/domain` は何も import しない（外部ライブラリも zod 等の生成物が要求するものに限る）。
- DB マイグレーションと RLS ポリシーは、`app/` ではなく**リポジトリルートの `supabase/`** に置く。
- 依存方向・境界の違反は **ESLint の境界ルールで機械執行**する。この文書は「何を執行するか」を定義し、設定の実体は執行対象の一覧に従って別途実装する。

## スコープ

- **対象**: `app/` パッケージのディレクトリ分割、各層の責務、依存方向、境界に関する機械執行の対象、`supabase/` との関係。
- **対象外**:
  - Server Action の内部構造（→ ARCH-BE-0013）
  - 外部連携・非同期ジョブの構造（→ ARCH-BE-0014 / ARCH-BE-0015）
  - どこで実行されるか（Vercel / Cloudflare / Supabase の役割分担）（→ ARCH-0001）
  - 実装のきまり・コード例・テストの書き方（→ process/backend/system/standards/）
  - 仕様（`docs/specs/`）の構成（→ ARCH-SP-0002 / ARCH-SP-BE-0001）

---

## 構成

```text
repo/
├── app/                          # 独立した npm パッケージ（Next.js + React + TS strict）
│   └── src/
│       ├── domain/               # 純粋 TS。依存ゼロ（zod と @kaninabe/runtime のみ）
│       │   └── generated/        # 仕様からの生成物（zod スキーマ・遷移テーブル・スコープ定義・testid・画面の配線表）。コミットする
│       │                         # ※ 汎用状態機械エンジンは framework/runtime（@kaninabe/runtime/engine）に住む。ADR-0013
│       ├── operation/            # 業務手順。Repository / 外部連携の IF を DI で受ける関数
│       │   └── _template/        # 実行計画の実行器（run-plan.ts）。宣言された例外が使う 3 形の定型
│       ├── infrastructure/       # Supabase 実装・外部サービスアダプタ（IF の実装）
│       ├── composition/           # Composition Root（DI 配線のみ）
│       ├── app/                  # Next.js ルート（RSC）+ Server Actions + Route Handlers
│       ├── components/           # UI コンポーネント
│       └── proxy.ts              # 層に属さないフレームワーク入口（リクエスト前段。ARCH-BE-0016）
├── supabase/                     # migrations / RLS ポリシー（app からは import しない）
└── docs/                         # 仕様・ルール・検証器・生成器（別パッケージ）
```

| 層 | 責務 | ここにしか置かないもの | テスト |
|----|------|----------------------|--------|
| `src/domain` | ドメインの型・状態遷移の判定・純粋関数。**依存は zod と `@kaninabe/runtime` だけ** | 生成物（`generated/`）と、DSL 外に漏れた純粋制約関数。汎用エンジンは `@kaninabe/runtime/engine`（ADR-0013） | unit（仕様網羅 100%） |
| `src/operation` | 1 業務操作の手順。Repository IF・外部連携 IF を**引数で受ける**関数 | 永続化と副作用の順序、DSL 外の制約の適用点 | unit（IF モック注入、仕様網羅 100%） |
| `src/infrastructure` | Supabase クライアント実装、外部 SDK のアダプタ、outbox ジョブの読み書き、読み取りクエリの写像 | SQL・SDK 呼び出し・スキーマ変換 | integration（ローカル Supabase の実 DB） |
| `src/composition` | Composition Root。IF と実装を配線するファクトリ関数と、読み取りの入口となるクエリ関数 | 具象の生成（`new` / クライアント初期化） | 配線の存在確認のみ（読み取りのクエリ関数は integration） |
| `src/app` | Next.js のルート（RSC）、Server Actions、Route Handlers | ルーティング・リクエスト境界の受け渡し | integration（Server Action 単位） |
| `src/components` | UI。表示とユーザー操作の受け取り | 表示ロジック・フォーム | UI テスト（後続フェーズ） |

**層に属さないフレームワーク入口**が 1 つだけある。層ではないが、**執行の外に置かない**ために表に載せる。

| 入口 | 責務 | import してよいもの | テスト |
|------|------|-------------------|--------|
| `src/proxy.ts` | Next.js のファイル規約（旧 `middleware`）。**セッション更新だけ**を行う（ARCH-BE-0016 の構成表） | `src/infrastructure` と外部パッケージのみ。業務判断を持たないので `domain` / `operation` / `composition` は不可 | ユニットの対象外（`src/app` と同じ理由。testing/unit.md 7節） |

- ファイル名と置き場所は**フレームワークが決める**（`src` 直下、`app/` と同じ高さ）。層の都合で動かせない。
- 「層に属さない」ことを**黙認しない**。未知のファイルが `src` 直下に増えることは E11 が禁じる。

**層名は `operation`（操作）とする。** 仕様側でこの層に対応する語彙は「操作」であり（`action_spec` の `handles`、ドメインイベント `{aggregate}.{event}`、レビューで数える「16 操作」）、実装のディレクトリ名をその語と同じにする。DDD の application service が定義としては正確だが、**内部で使い続ける語と一致していること**を優先した。Clean Architecture の `usecase` から改名しているのは、あの語が「ビジネスルールの置き場」という事前知識を連れてくるためである。この層に業務判断は 1 つも無く（判断はすべて `domain/engine` への照会に集約される）、ここにあるのは調達と運搬と、実行計画の実行器（`_template/run-plan.ts`）である。名前が実態とズレたまま残ると、リンターと型が止めている「ここに `if` を書く」誘因を、名前の側が生み続ける。

**operation は「実行計画の実行」である**（ADR-0012 ④ / 束 ⑰。移行中）。操作を実行する手順 —— 判断材料の行を読む → 手順ごとに `permit` を立てる → DSL 外の不変条件を実行する → RPC を 1 回呼ぶ → 拒否を 3 分類へ写す —— には**集約ごとの個性が 1 つも無く**、違うのは「どの行のどの列を読むか」「どの規則表に問うか」「どの引数に何を渡すか」だけである。それらはすべて仕様から導けるので、生成物（`domain/generated/{usecase-plans,operation-plans}.ts`）が運び、実行するのは 1 つの関数（`_template/run-plan.ts`）になる。**保存点も単発の操作も同じ関数で走る** —— 1 操作は手順が 1 つの保存点にすぎない。手書きで残るのは、宣言された例外（`runner: manual` の操作・`enforced_by: application` の不変条件の純関数・`computes` の純関数）だけである。束 ⑰-2 で Server Action と Composition Root が全操作で生成物になり、束 ⑰-3 で**ユニットテストも生成物になって手書きの operation が消えた**（56 操作 5,273 行 + その単体テスト 9,802 行）。

いま `src/operation/{集約}/` に残るのは**宣言された例外だけ**である。閉世界（`__tests__/structure/`）がその母集合を仕様から作るので、宣言の無い手書きはそこに置けない。

| 残るもの | 宣言 | 実物 |
|---|---|---|
| 定型では組み立てられない操作 | action_spec の `runner: { kind: manual, reason: … }` | `item/confirm_fees.ts` など 13 本 |
| 人の入口を持たない経路（走査・システム起点の呼び出し口） | `specs/backend/actions/README.md` の `scans:` | `loan/report_overdue.ts` / `invitation/accept.ts` / `membership/activate.ts` |
| `enforced_by: application` の不変条件・`computes` の純関数 | invariant_spec / action_spec | `{集約}/hooks/` / `domain/computes/` |
| 集約ごとのポート（IF の置き場） | — | `{集約}/ports.ts` |

`membership.activate` は**同じ実行計画を人の入口とシステム起点の両方が実行する**（サインインの手書き経路は実行器を呼ぶだけで、判断を持たない）。宣言された例外が使う 3 形の定型（`_template/{transition,update,update-fields}.ts`）は残る —— 作成・削除の定型は計画に吸収されて消えた。

- **`domain/generated/` はコミットする**。理由と鮮度検証は ADR-0006。生成器は `legacy/spec-tools/` に集約する。
- **汎用状態機械エンジンは手書きで 1 回だけ書く**。個別機能に遷移ロジックを書く場所は作らない（ADR-0004）。**置き場は `framework/runtime`（`@kaninabe/runtime/engine`）である** —— どの製品でも同じ 1 本なので、製品の木には住まない（ADR-0013）。
- **`docs/` を workspaces に入れない**。生成物をコミットするため、`app/` のビルドは生成器に依存しない。ツールチェーンの依存（tsx・vitest の設定・検証器の依存関係）を製品ビルドに持ち込まない。束ねるのは `framework/*` と `app` である（ADR-0013 が旧「`app/` と `docs/` を束ねない」を改めた）。

---

## フロー

書き込み（1 ドメインイベント）の代表的な流れ。

1. `src/components` のフォームが、`domain/generated/` の zod スキーマで即時フィードバックを返す。
2. `src/app` の Server Action が呼ばれる。Server Action は `src/composition` から operation を取得する。
3. `src/operation` が `domain/engine` に遷移可否を問い合わせ、Repository IF 経由で永続化し、`effects` を outbox に積む（ARCH-BE-0013 / ARCH-BE-0015）。
4. `src/infrastructure` の Supabase 実装が実際の SQL を発行する。RLS は第二防衛線として同じ制約を DB 側でも守る。

### 読み取り経路

読み取りは Server Action も operation も通さない。RSC が `src/composition/{aggregate}/queries.ts` のクエリ関数を呼び、そのクエリ関数が **JWT 付きクライアント（RLS 有効経路）**を組み立てて `src/infrastructure/{aggregate}/queries.ts` の写像に渡す（ARCH-BE-0016）。

- 読み取りに業務判断が無いため、判断を持たない層（operation）を経由させない。
- **層の役割は書き込みと同じ**。`composition` は配線だけ、DB への問い合わせは `infrastructure` だけに置く（読み取りのための例外は作らない）。
- `service_role`（RLS バイパス）で読んでよいのは、operation / ワーカーが書き込みの前に読む場合だけとする。

---

## 制約・不変条件

- **MUST**: 依存は内向きの一方向のみとする。下記「依存方向」の表に無い方向の import を書いてはならない。
- **MUST**: `src/domain` は他の層・Next.js・Supabase・Node 組み込みモジュールを import しない。
- **MUST**: `src/operation` は具象（Supabase クライアント・外部 SDK）を直接参照せず、IF を引数で受ける。
- **MUST**: 具象の生成（DI 配線）は `src/composition` にのみ置く。
- **MUST**: DB アクセスはサーバー（Server Action / RSC / Route Handler）経由に限る。ブラウザから Supabase に直接アクセスしない（PRIN-0009）。
- **MUST NOT**: `src/app` に業務ロジックを書かない。Server Action は ARCH-BE-0013 の定型に従う薄い層とする。
- **MUST NOT**: `src/components` から `src/operation` / `src/infrastructure` / Supabase クライアントを import しない。参照してよいのは `src/domain` の型と zod スキーマ、および `src/app` が渡す Server Action だけとする。
- **MUST NOT**: `src/domain/generated/` を手で編集しない（次回生成で上書きされる。PRIN-0007）。
- **MUST NOT**: モジュール差し替え（`vi.mock` 等）でテスト対象の依存を置き換えない。注入点は IF と DI に限る（PRIN-0003）。
- **SHOULD**: 層をまたぐ型は `src/domain` の型を使う。層ごとに同じ概念の型を再定義しない（PRIN-0007）。

---

## 実装配置

- path: `app/src/{domain,operation,infrastructure,composition,app,components}/`
- path: `supabase/migrations/`, `supabase/policies/`（RLS。`access_spec` との突合対象）
- pattern: operation は**手で書かない**。実行するのは実行計画（`src/domain/generated/operation-plans.ts`）と唯一の実行器 `@kaninabe/runtime/template` であり、`src/operation/{aggregate}/{operation}.ts` に置くのは**宣言された例外**だけ（`runner: manual` の操作と `scans:` の走査・システム起点の呼び出し口）。その IF は `src/operation/{aggregate}/ports.ts`、実装は `src/infrastructure/{aggregate}/{operation}.repository.ts`
- pattern: 宣言された例外が使う 3 形の定型は `@kaninabe/runtime/template/{transition,update,update-fields}` に 1 つずつ置き、各操作はそこへ設定オブジェクトを渡す（ARCH-BE-0013 / server-actions.md）。作成・削除の定型は実行計画に吸収されて消えた（束 ⑰-3）
- **層の直下に混じる「集約でないディレクトリ」(仕組みの土台)の一覧は 1 か所で宣言する。** 定型（`_template/`）・共有物（`shared/`）・ジョブ基盤（`jobs/`）・接続層（`supabase/`）・保存点（`usecase/`・`facts/`）・生成物（`generated/`）・テスト支援（`__tests__/`）は**フレームワークが形として決めているもの**であり、アプリが選んだ語ではない。正は置き場の配置（アプリの枠の後段の値。`legacy/spec-tools/lib/targets/nextjs/layout.ts` の `source-root` の `structure` = 足す層・土台の宣言・補助ファイルの宣言）と、コアの語である層の 4 名（`legacy/spec-tools/lib/model/framework-dirs.ts` の `CORE_LAYERS`）であり、生成物 `app/src/domain/generated/framework-structure.json` / `structure-expectations.ts` を通して各検査・lint・構造テストがそこを読む（**免除リストを検査ごとに持たない**。束⑯g で 6 か所の写しを畳んだ）。土台を 1 つ増やすときは、まずこの宣言（配置の `structure.baseDirs`）に足す
- pattern: 読み取りは `src/composition/{aggregate}/queries.ts` の `{camelCase(name)}Query`（配線）と `src/infrastructure/{aggregate}/queries.ts` の `select{PascalCase(name)}`（写像）。いずれも `query_spec` の `name` から導く（ARCH-BE-0016）
- pattern: 生成物は `src/domain/generated/{entity}.schema.ts` / `{machine}.transitions.ts`（ADR-0004）
- pattern: 画面まわりの生成物は `src/domain/generated/testids.ts`（testid の骨格）と `src/domain/generated/screens.ts`（画面ごとの部品と遷移の一覧。screenTest が引く）。どちらも正は `screen_spec` である（screen-spec-writing.md）
- pattern: 画面の本体は `src/app/_screens/{screen-name}.tsx` の「依存を引数で受ける関数」、`page.tsx` は既定の依存を渡すだけ。**注入する依存が無い画面（データもセッションも読まない）は `page.tsx` のままでよい**（分ける理由はテストから差し替えられるようにすることだけで、差し替えるものが無ければ分けない）。画面テストは `src/app/__screens__/{screen-name}.test.tsx`（screen-test.md）

---

## 境界・レイヤーに関する追加情報

### 依存方向

| 層 | 依存してよい | 依存してはいけない |
|----|------------|------------------|
| `src/domain` | （なし） | すべて |
| `src/operation` | `src/domain` | `src/infrastructure`, `src/composition`, `src/app`, `src/components`, Supabase, Next.js |
| `src/infrastructure` | `src/domain`, `src/operation` の IF 定義 | `src/composition`, `src/app`, `src/components` |
| `src/composition` | `src/operation`, `src/infrastructure`, `src/domain` | `src/app`, `src/components` |
| `src/app` | `src/composition`, `src/domain`, `src/components` | `src/operation` / `src/infrastructure` の直接参照 |
| `src/components` | `src/domain`（型・zod スキーマのみ） | それ以外のすべての層 |

`src/infrastructure` が `src/operation` を参照してよいのは、**operation が宣言した IF を実装するため**に限る（依存性逆転）。operation の関数本体を呼んではならない。

### 置いてよいもの / 置いてはいけないもの

- OK: `src/app` に「入力の受け取り・composition の呼び出し・結果の返却」
- NG: `src/app` に「状態の判定・権限の判定・SQL・外部 SDK 呼び出し」
- OK: `src/domain` に「生成物・エンジン・純粋関数」
- NG: `src/domain` に「I/O・日時の取得（`now` は引数で受ける）・乱数」

### 機械執行の対象（ESLint 境界ルール）

設定の実体は別途実装するが、**執行する内容はこの一覧を正とする**。

| # | 執行すること | 対象 |
|---|------------|------|
| E1 | 上表の依存方向に反する import の禁止 | 全層 |
| E2 | `src/domain` からの一切の層内 import・Node 組み込み・`next/*`・`@supabase/*` の禁止 | `src/domain` |
| E3 | `src/components` からの `server-only` モジュール・Supabase クライアントの import 禁止 | `src/components` |
| E4 | `src/operation` での具象クライアント生成（`createClient` 等）の禁止 | `src/operation` |
| E5 | `src/domain/generated/` の手編集検出（生成物ヘッダの検査 + `generate:check`） | `src/domain/generated` |
| E6 | モジュール差し替え API（`vi.mock` / `vi.doMock` 等）の使用禁止 | テストコード全体 |
| E7 | サーバー専用モジュールへの `server-only` 付与漏れの検出 | `src/infrastructure`, `src/composition` |
| E8 | 300 行を超えるファイルは冒頭の JSDoc に宣言（`@oversize` / `@split-review`）を持つ（300 行は信号であり上限ではない） | 全層（`legacy/spec-tools` と同じ方針） |
| E9 | 配置 ⇔ 命名の一致。ドメインイベント ID `{aggregate}.{event}` から、ファイルパスと export 名が一意に導かれること | `src/app/_actions`, `src/operation` |
| E10 | export されたシンボル（関数・クラス・型・インターフェース・enum）に説明を持つこと | 全層（テスト・生成物を除く） |
| E11 | 層にも既知の入口にも属さないファイルの検出。分類されないファイルは依存方向の検査（E1）を素通りするため、**存在自体を禁じる** | `src/` 配下すべて |

E9 の変換規則（`{camel(event)}{Pascal(aggregate)}Action` 等）の定義は process/backend/system/standards/conventions/server-actions.md「配置と命名」を正とする。E10 は「縛りの粒度は配置と公開シンボルまで、関数の内側は縛らない」という方針に基づく。

E5 の鮮度検証（生成物が仕様と一致していること）は CI で `generate:check` として実行する（ADR-0006）。

**執行の実態**（どのルール ID・どのオプション・どの DB 制約が E1〜E10 を実現しているか、および DB 側の防衛線を含む全執行者の一覧）は
[process/backend/system/standards/conventions/enforcement/enforcement-matrix.md](../../../process/backend/system/standards/conventions/enforcement/enforcement-matrix.md) を正とする。

---

## 実装のきまり・コード例

- Server Action の書き方: [process/backend/system/standards/conventions/server-actions.md](../../../process/backend/system/standards/conventions/server-actions.md)
- 機械執行ルールの一覧（lint・tsc・DB 制約・CLI 検査）: [process/backend/system/standards/conventions/enforcement/](../../../process/backend/system/standards/conventions/enforcement/README.md)
- テストの書き方: [process/backend/system/standards/conventions/testing/](../../../process/backend/system/standards/conventions/testing/README.md)
- 層ごとの実装のきまり: [process/backend/system/standards/layers/](../../../process/backend/system/standards/layers/README.md)（未整備）
