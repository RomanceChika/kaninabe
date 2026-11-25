# kaninabe — 仕様駆動フレームワーク

> 仕様を正にして、検証・文書・実装の部品・テストを仕様から導く、Web アプリ開発の仕組み。版は安定していない(README を先に読むこと)。
> このファイルは、AI がこの木で最初に読む入口である。ここに書いてある文書は、すべてこの木の中にある。

## 作業の大原則

1. **仕様が正(Spec as Truth)**。実装・テスト・文書はすべて仕様(`docs/specs/`)から導出される。実装を先に変えて仕様を後追いさせない。([PRIN-0001](docs/rules/principles/common/PRIN-0001-spec-as-truth.md))
2. **作業を始める前に、下のルーティング表で該当する文書を読む**。ルールの背景は各文書の frontmatter(`norms:` / `decisions:`)を上に辿る。原則の一覧は [docs/rules/principles/common/README.md](docs/rules/principles/common/README.md)。
3. 製品の宣言は [product.md](product.md)(仕様・生成物の置き場、使う仕様の種類)。この木ではデモ製品(図書館の題材)が置かれている。自分の製品に使うときは、`product.md` と `docs/specs` を差し替える。
4. サブエージェントはこのファイルを読まない。**オーケストレーターが必読文書のパスをプロンプトに明示する責務を持つ**。

## タスク種別ごとのルーティング(必読の文書)

| やること | 読む文書 |
|---------|---------|
| ドメイン仕様の追加・変更 | [Playbook: domain-spec-change.md](docs/rules/process/common/specification/playbooks/domain-spec-change.md) → [書き方: domain-spec-writing.md](docs/rules/process/common/specification/standards/domain-spec-writing.md) |
| システム全体を仕様化する(新規 / 全面改訂) | [system-spec-route.md](docs/rules/process/common/specification/playbooks/system-spec-route.md)(構想 → シミュレーション → 案 → 決定 → 本採用) |
| DSL の拡張を検討する(「これが書けない」に当たった) | [dsl-extension-triage.md](docs/rules/process/common/specification/playbooks/dsl-extension-triage.md)(**表現力を買う前に、形を変える**) |
| 仕様のレビュー(人間) | [human-review-guide.md](docs/rules/process/common/specification/playbooks/human-review-guide.md) |
| Server Action 仕様(action_spec)の追加 | [action-spec-writing.md](docs/rules/process/backend/specification/standards/action-spec-writing.md) + [テンプレート](docs/specs/backend/actions/template.action_spec.md) |
| 画面仕様(screen_spec / chrome_spec)の追加 | [screen-spec-writing.md](docs/rules/process/frontend/specification/standards/screen-spec-writing.md) + [テンプレート](docs/specs/frontend/screens/template.screen_spec.md) |
| ユースケース仕様(usecase_spec)の追加 | [usecase-spec-writing.md](docs/rules/process/frontend/specification/standards/usecase-spec-writing.md) + [テンプレート](docs/specs/frontend/usecases/template.usecase_spec.md) + [ADR-0011](docs/rules/decisions/common/ADR-0011-usecase-layer-two-origins.md) |
| UX 原則(閾値・受け入れ)を変える | [ux-lint.md](docs/rules/process/frontend/specification/standards/ux-lint.md) + [テンプレート](docs/specs/frontend/template.ux_principles_spec.md)(閾値は台帳の `budget` を書き換える。検査のコードは触らない) |
| 通知を足す・宛先を変える | [notification-spec-writing.md](docs/rules/process/backend/specification/standards/notification-spec-writing.md) + [テンプレート](docs/specs/backend/template.notification_spec.md)(通知はカタログに載っているものが全部) |
| 外から届く `surface`(api スキーマのビュー)を触る | [surface-spec-writing.md](docs/rules/process/backend/specification/standards/surface-spec-writing.md) + [テンプレート](docs/specs/backend/template.surface_spec.md) |
| ジョブ(バッチ・スケジュール実行)を足す・変える | [job-spec-writing.md](docs/rules/process/backend/specification/standards/job-spec-writing.md) + [テンプレート](docs/specs/backend/template.job_spec.md) + [ARCH-BE-0015](docs/rules/architecture/system/backend/ARCH-BE-0015-async-job-execution.md) |
| HTTP の入口(`route.ts`)を足す | [route-handlers.md](docs/rules/process/backend/system/standards/conventions/route-handlers.md)(口は宣言に載るものが全部) |
| サインイン時の挙動・ログインの関門を変える | [auth-spec-writing.md](docs/rules/process/backend/specification/standards/auth-spec-writing.md) + [テンプレート](docs/specs/backend/template.auth_spec.md) |
| 「起こりえないこと」を保証として宣言する | [guarantee-spec-writing.md](docs/rules/process/backend/specification/standards/guarantee-spec-writing.md) + [テンプレート](docs/specs/backend/template.guarantee_spec.md) |
| 環境変数・設定を足す | [config-spec-writing.md](docs/rules/process/backend/specification/standards/config-spec-writing.md) + [テンプレート](docs/specs/backend/template.config_spec.md) |
| 外部連携を足す・縮退やタイムアウトを変える | [external-spec-writing.md](docs/rules/process/backend/specification/standards/external-spec-writing.md) + [テンプレート](docs/specs/backend/template.external_spec.md) + [ARCH-BE-0014](docs/rules/architecture/system/backend/ARCH-BE-0014-external-integration.md) |
| 読み取りクエリ仕様(query_spec)の追加 | [query-spec-writing.md](docs/rules/process/backend/specification/standards/query-spec-writing.md) + [テンプレート](docs/specs/backend/queries/template.query_spec.md) |
| テーブル仕様(data_table)の追加・変更 | [ARCH-SP-BE-0001 §テーブル仕様](docs/rules/architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md) + [テンプレート](docs/specs/backend/data/template.data_table.md) |
| 日時・タイムゾーンの扱い | [datetime.md](docs/rules/process/backend/system/standards/conventions/datetime.md) |
| 画面のスタイルを書く | [styling.md](docs/rules/process/frontend/system/standards/conventions/styling.md)(生値の色や余白は書けない。トークンを仕様に足してから `generate`) |
| 実装の層構造・依存 | [ARCH-BE-0001](docs/rules/architecture/system/backend/ARCH-BE-0001-app-layer-structure.md) |
| Server Action・操作の実装 | **手で書かない**。仕様を書いて `generate` する([server-actions.md](docs/rules/process/backend/system/standards/conventions/server-actions.md) / [ARCH-BE-0013](docs/rules/architecture/system/backend/ARCH-BE-0013-server-action-structure.md))。手書きは `runner: manual` の宣言がある操作だけ |
| ユニットテストを書く | [testing/unit.md](docs/rules/process/backend/system/standards/conventions/testing/unit.md)(計画で走る操作のテストは生成物) |
| 統合テスト・RLS テストを書く | [testing/integration.md](docs/rules/process/backend/system/standards/conventions/testing/integration.md)(ローカルの Supabase が要る) |
| リンターや検証に怒られた・ルールの意味を知りたい | [enforcement-matrix.md](docs/rules/process/backend/system/standards/conventions/enforcement/enforcement-matrix.md)(拡張候補の台帳は [extension-candidates.md](legacy/spec-tools/extension-candidates.md)) |
| ログを出す | [logging.md](docs/rules/process/backend/system/standards/conventions/logging.md) |
| どのサービスに何を載せるか | [ARCH-0001](docs/rules/architecture/system/common/ARCH-0001-compute-placement.md) |
| 造語を足す・綴りを改める | [term-ledger-writing.md](docs/rules/process/common/specification/standards/term-ledger-writing.md)(造語は台帳に載せてから使う) |
| ルール文書の追加・変更 | [how-to-create-rules.md](docs/rules/meta/playbooks/how-to-create-rules.md) + [placement_policy.md](docs/rules/meta/standards/placement_policy.md) |
| 検証器・生成器(`legacy/spec-tools`)のコードを書く | [scripts-code-quality.md](docs/rules/process/common/tooling/standards/scripts-code-quality.md) |
| 実行時パッケージ(`framework/runtime`)の位置づけ | [ADR-0013](docs/rules/decisions/common/ADR-0013-framework-runtime-package.md) |
| 書き方の例が欲しい(この記法、実際どう書く?) | 印の文法は [code-examples.md](docs/rules/process/common/tooling/standards/code-examples.md)。実例は `docs/specs/` のデモ製品と、[6 つの題材](legacy/spec-tools/__tests__/fixtures/samples) |

## スキル

手順の索引であり、正典ではない(内容の正は上の表の文書。食い違ったら文書が正)。サブエージェントに投げる場合は、オーケストレーターがこのパスをプロンプトに明示する。

| スキル | 使い時 |
|--------|-------|
| [add-operation](.claude/skills/add-operation/SKILL.md) | ドメイン操作(状態遷移・作成・削除・編集)を 1 つ足す |
| [add-query](.claude/skills/add-query/SKILL.md) | 読み取り経路を 1 本足す |
| [add-screen](.claude/skills/add-screen/SKILL.md) | 画面を 1 枚足す |

## コマンド(木のルートで実行)

- `npm run verify` — 仕様の意味検証と、仕様 ⇔ テストの追跡。`-- --fail-on-unclassified` を付けると、台帳に載らない警告が 1 件でもあれば exit 1。
- `npm run generate` — 仕様から文書(図・表・要約)と実装の部品(zod・遷移表・SQL など)を生成する。
- `npm run generate:check` — 生成物がいまの仕様と一致しているかを見る(自分の製品の根で回す。この木のデモ製品には実装の木が無いので、ここでは回さない)。
- `npm run test:spec-tools` / `typecheck:spec-tools` / `lint:spec-tools` — 検証器・生成器自体のテスト・型・コード規約。
- `npm run typecheck:framework` / `lint:framework` — 実行時パッケージ・adapter・lint 設定の型とコード規約。
- 初回は `npm ci` と `npm --prefix legacy/spec-tools ci`(検証器・生成器は自分の lockfile を持つ)。Node.js 24 以上。

**鉄則**: `verify` が通らない状態で変更を確定させない。生成ブロック(`<!-- AUTO-GENERATED -->`)と、生成器が書き出したファイルを手で編集しない(次の `generate` で消える)。

## 変更の流れ(要約)

仕様を編集 → `verify`(エラー一覧 = 決めることの一覧。黙らせるための雑な定義を書かない)→ `generate` → 要約と表で意味を確かめる → 実装(Server Action などは生成物)→ テスト(`@spec` / `@tc` の注釈が必須)→ すべての検査が緑になってから確定する。
