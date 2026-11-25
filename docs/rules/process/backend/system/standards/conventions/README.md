---
id: DG-BE-0023
doc_type: directory_guide
scope: backend
norms: [ARCH-BE-0001, PRIN-0002, PRIN-0003]
---

# process/backend/system/standards/conventions — コードの共通規約

バックエンドのコードを書くときの**共通規約**を置く箱である。ここは 2 つの役割の文書からできている —— **規約**が「してはいけないこと」を列挙し、[enforcement/](./enforcement/README.md) が「そのうち機械が自動で落としてくれるもの」を全件一覧にする。

規約は**要素ごとに 1 文書**に分ける。1 つの規約 = 1 ファイルであり、粒度を混ぜない。

## 配下の文書

| 文書 | 内容 |
|---|---|
| [server-actions.md](./server-actions.md) | Server Action の実装規約。配置・命名、定型の手順、`Result` 型とエラーの分類、読み取り(RSC + クエリ関数)の扱い |
| [queries.md](./queries.md) | クエリ関数(読み取り)の実装規約。配置・命名、定型 3 手順、projection どおりの `select`(`fields_hidden` の唯一の砦)、行の選別をアプリ側に書かないこと |
| [route-handlers.md](./route-handlers.md) | Route Handler(`app/src/app/api/**/route.ts`)の実装規約。人間のセッションを持たない呼び出し元(Cron・Webhook)の受け口。共有秘密による認可と「認可 → 委譲 → 応答」の最小形 |
| [datetime.md](./datetime.md) | 日時とタイムゾーンの規約。保存は `timestamptz`(UTC)・境界はオフセット付き ISO 8601 文字列・壁時計に戻すのは入出力の縁だけ。比較の表記揃えとテストの TZ 固定 |
| [logging.md](./logging.md) | 構造化ログの規約。出してよいフィールドは決まった集合だけとし、値は仕様の ID(ドメインイベント・`INV-*`・副作用 ID)に揃える。経路ごとに何を出すか |
| [migrations.md](./migrations.md) | migration の規約。採番と、適用済み migration を書き換えない不変則 |
| [formal-methods.md](./formal-methods.md) | 仕組み側の約束事のモデル検査(TLA+)。アプリの語を書かず、仕組みの約束事の交錯を 1 回だけ検証する |
| [enforcement/](./enforcement/README.md) | 機械執行ルール。何が自動で保証されているかの全件一覧([enforcement-matrix.md](./enforcement/enforcement-matrix.md))と、トピック別の詳細・正誤コード例。執行者は lint / tsc / DB 制約 / コマンド検査 |
| [testing/](./testing/README.md) | テスト規約(ユニット / 統合)。モック方針と「仕様網羅」の定義 |
| [security/](./security/README.md) | セキュリティ規約の箱。現状は骨格のみで、実運用の規範は他の文書に分散している |

**規約を読んでも書き方が像を結ばないときは、`docs/specs/` の仕様と [題材](../../../../../../../legacy/spec-tools/__tests__/fixtures/samples)(図書館ほか)を先に読む。** 仕様から何が導かれるかが通して読めるので、そこから逆に各規約へ戻るほうが早い。

日常の入口としては、リポジトリ直下の `CLAUDE.md` のルーティング表がこの配下の [server-actions.md](./server-actions.md) / [logging.md](./logging.md) / [testing/](./testing/README.md) / [enforcement-matrix.md](./enforcement/enforcement-matrix.md) を直接指している。この README は、そこに載っていない文書を探すときと、新しい規約を足すときのためのものである。

なお、エラー処理・文書化・コード値と表示文言の対応・テストケースの点検表に相当する規約はまだ無い。移植元にはあったが Go + Echo 前提の内容だったため持ち込まず、書き起こしは未着手である。

## テンプレートと拡張

新しい規約を足すときは、同階層の [template.md](./template.md) に従って `xx.md` を 1 ファイル追加する。既存の文書に節を足して肥らせない —— 1 規約 1 ファイルにしておくことが、後から規約を増やせることの条件である。規約文書の構成は「目的・スコープ / ルール(サブテーマごと) / 注意点・例外 / 関連ドキュメント」で固定する。

**規約と執行の関係**: [enforcement/](./enforcement/README.md) が扱うのは**機械が自動で落としてくれるものだけ**である。それ以外の、レビューで守るしかない規約は同階層の各文書に書く。**ある規約を機械執行に格上げしたときは、[enforcement-matrix.md](./enforcement/enforcement-matrix.md) に行を足す。** 格上げと対応表の更新は同時に行う。対応表に載っていない機械執行は、設定ファイルの中に隠れたルールになってしまう。

**専用テンプレートの例外は 2 つ**である。[enforcement/](./enforcement/README.md) と [testing/](./testing/README.md) は扱う内容が他と違うため、それぞれ同階層に専用の `template.md` を置いている([enforcement/template.md](./enforcement/template.md) / [testing/template.md](./testing/template.md))。これらの配下に文書を足すときは各ディレクトリの `template.md` に従う —— [template_policy](../../../../../meta/standards/template_policy.md) の「同階層 → 上の階層」という解決順により、下位のテンプレートが自動的に優先される。
