---
doc_type: meta
scope: repository
norms: [PRIN-0008]
---

# ID ポリシー — 文書の識別子の形・単位・寿命

文書の ID は、**参照・履歴・自動処理を安定させる**ためにある。参照はパスではなく ID で書き、文書が移動しても参照が切れないようにする(PRIN-0008)。形が揺れたり使い回されたりすると、この前提が静かに崩れる。

ID はフロントマターの `id` に書く。principle / architecture / decision / directory_guide では必須である(必須条件の正は [frontmatter_policy](./frontmatter_policy.md))。

**執行者は `npm run verify` の M2 である。** M2 は `docs/rules/` と `docs/specs/` を **1 つの台帳**として走査し、①同じ id を 2 つ以上の文書が宣言していないか、②doc_type ごとの形式に合っているか、の 2 つを見る。ツリーをまたいだ重複も違反である —— 参照した側から見れば行き先が 1 つに決まらないからである。

## ID の形式

`docs/rules/` 側の形式は次のとおり。`{slug}` は内容を表す小文字ハイフン区切りの語で、付けるかどうかは任意である。

| doc_type | 形式 | 例 |
|---|---|---|
| `principle` | `PRIN-NNNN[-{slug}]` / `PRIN-BE-NNNN` / `PRIN-FE-NNNN` | `PRIN-0001-spec-as-truth` |
| `architecture`(system) | `ARCH-NNNN[-{slug}]` / `ARCH-BE-NNNN` / `ARCH-FE-NNNN` | `ARCH-BE-0013-server-action-structure` |
| `architecture`(specification) | `ARCH-SP-NNNN[-{slug}]` / `ARCH-SP-BE-NNNN` / `ARCH-SP-FE-NNNN` | `ARCH-SP-BE-0001-backend-spec-structure` |
| `decision` | `ADR-NNNN[-{slug}]` / `ADR-BE-NNNN` / `ADR-FE-NNNN` | `ADR-0005-single-entry-point` |
| `directory_guide` | `DG-NNNN` / `DG-BE-NNNN` / `DG-FE-NNNN`(**スラッグを付けない**) | `DG-0013` |
| `process` | 任意。付けるなら `PROC-NNNN[-{slug}]` / `PROC-BE-NNNN` / `PROC-FE-NNNN` | 実運用ではファイル名で管理している |
| `domain_glossary` | `TERM-{対象}` | `TERM-product` |
| `domain_invariant` | `INVARIANT-{対象}` | `INVARIANT-product-composition` |
| `domain_example` | `EXAMPLE-{対象}` | `EXAMPLE-product-creation` |
| `domain_design_context` | `DC-{対象・概念}` | `DC-product-ingredient-snapshot` |
| `domain_precedent` | `PRECEDENT-{対象}` | `PRECEDENT-public-visibility-snapshot` |
| `spec` | リソース名・ファイル名で管理(下記) | — |

- 接頭辞の無い形(`PRIN-0001`)が common と repository、`BE-` が backend、`FE-` が frontend である
- **`architecture` は system と specification で採番を共通にしない。** どちらも common / backend / frontend ごとに `0001` から振る。両者は別の関心事(コードの構造 / 仕様書の構造)であり、番号を共有すると片方の増加がもう片方の番号を飛ばす
- **directory_guide にも ID が要る。** 案内文書であっても参照グラフに参加させるためであり、これは全 directory_guide に共通の要件である
- domain 系の 4 種(`TERM-` / `INVARIANT-` / `EXAMPLE-` / `DC-`)の実体はドメイン知識層 `docs/knowledge/` にある(2026-08-26 開設。配置は [placement_policy](./placement_policy.md))

**旧採番の廃番。** 参考資料から持ち込まれた `PROC-BE-NNNN` を宣言していた README(directory_guide)12 本は、2026-08-23 に `DG-BE-0022`〜`DG-BE-0033` へ振り直した(旧→新の対応は `NOTES.md`)。旧番号は**廃番**であり、process の id にも再利用しない。M2 に置いていた「既知の逸脱は警告に落とす」例外は同時に削除したので、**形式違反はすべてエラー**である。

## docs/specs の仕様文書の ID

仕様の ID は**連番ではなく、対象の名前から機械的に導く**。

理由は 2 つある。第一に、仕様の一意性の根拠は「どの集約の、どの操作の仕様か」であって採番の順序ではない。第二に、番号を介さずに参照できる —— `loan-submit-action` と書けば、どの仕様かが読んだだけで分かる。この方式では**対象が消えれば ID も消える**。連番(廃番を残す方式)とは性質が違い、rules 側と specs 側で ID の意味が二層になっている。

| doc_type | 形式 | 例 |
|---|---|---|
| `role_spec` | `{ドメイン}-roles` | `domain-roles` |
| `entity_spec` | `{集約}-entity` | `item-entity` |
| `state_spec` | `{集約}-states` | `item-states` |
| `access_spec` | `{集約}-access` | `item-access` |
| `invariant_spec` | `{集約}-invariants` | `item-invariants` |
| `action_spec` | `{集約}-{イベント}-action`(`handles` から導く) | `loan-create-action` / `loan-report_overdue-action` |
| `query_spec` | `query-{クエリ名}`(`name` から導く) | `query-item-list` |
| `data_table` | `table-{テーブル名}`(`table` から導く) | `table-loans` / `table-domain_events` |
| `notification_spec` | `notification-catalog`(固定。1 プロジェクト 1 カタログ) | `notification-catalog` |
| `job_spec` | `job-catalog`(固定。1 プロジェクト 1 カタログ) | `job-catalog` |
| `config_spec` | `config-catalog`(固定。1 プロジェクト 1 カタログ) | `config-catalog` |
| `auth_spec` | `auth-flow`(固定。1 プロジェクト 1 フロー) | `auth-flow` |
| `guarantee_spec` | `guarantee-catalog`(固定。1 プロジェクト 1 カタログ) | `guarantee-catalog` |
| `surface_spec` | `surface`(固定。1 プロジェクト 1 ファイル) | `surface` |
| `external_spec` | `external-catalog`(固定。1 プロジェクト 1 カタログ) | `external-catalog` |
| `screen_spec` | `screen-{画面名}`(`name` から導く) | `screen-item-detail` |
| `chrome_spec` | `chrome-{クローム名}`(`name` から導く) | `chrome-library` |
| `design_token_spec` | `design-tokens` **固定** | 1 プロジェクト 1 ファイルなので導出元が無い |
| `ux_principles_spec` | `ux-principles` **固定** | 1 プロジェクト 1 ファイルなので導出元が無い(M2 が形式を見る。U8 も同じことを見る) |
| `term_ledger` | `term-ledger` **固定** | 1 プロジェクト 1 ファイルなので導出元が無い(M2 が形式を見る。M11 も同じことを見る) |
| `usecase_spec` | `usecase-{ユースケース名}`(`name` から導く) | `usecase-borrow-self` |

**綴りの規則。** 集約名とイベント名はスネークケース(`hold` / `report_overdue`)、クエリ名と画面名の区切りだけハイフン(`query-loan-own-list` / `screen-item-detail`)である。

**形式の執行者は 2 つに分かれる。** 分岐の基準は「導出元との一致まで見られるかどうか」である。

- `action_spec` / `query_spec` / `screen_spec` / `chrome_spec` / `data_table` / `notification_spec` / `job_spec` / `config_spec` / `usecase_spec` — **仕様検証側(A0 / Q0 / S0 / T0 / N0 / J0 / K0 / Y0)**が、id が `handles` や `name` / `table` から導いた形と**一致すること**まで見る。M2 はここに形だけの検査を重ねない(同じ違反に弱い検査が並ぶだけになる)
- ドメイン 5 種と `design_token_spec` / `ux_principles_spec` — **M2** が形式を見る。V 群は文書の `id` を読まない(集約名はディレクトリから、状態やイベントの id は本文の YAML から取る)ため、M2 が唯一の検査経路になる

## 採番単位

- **common / backend / frontend ごとに別の連番**である。`PRIN-BE-0001` と `PRIN-FE-0001` は別系列であり、衝突しない
- common を接頭辞なし(`PRIN-0001`)にするか `PRIN-CM-0001` にするかはプロジェクトで統一する。このリポジトリは接頭辞なしを採る
- **採番はスコープ単位であり、ディレクトリ階層とは無関係である。** 同じスコープなら、別の階層に置く文書にも同じ連番空間を振ってよい(`architecture/system/backend/` と その配下の `layers/` は同じ `ARCH-BE-` の空間を共有する)

### 階層が違っても同じ連番でよい根拠

1. **一意性はスコープ内で担保すれば足りる。** 参照と検索で使うのは ID であってパスではない
2. **参照側はパスに依存しない。** `norms` / `decisions` / `definitions` には ID だけを書くので、文書を `layers/` へ移しても参照は不変である
3. **連番は「採番の順序」であって「階層の深さ」ではない。** `0006` が `layers/` にあっても「`0001` の子」という意味にはならない。階層は配置の都合、ID の名前空間はスコープで切る、と分けて考える

## 永続性

- **再利用しない。** 一度使った ID を別の文書に付け直すことを禁じる。過去の参照・議論・コミットが別の文書を指すようになるためである
- **廃番は残す。** 文書を廃止しても ID は残し、「廃止・superseded by 〇〇」と記す。履歴を追えることが目的であり、番号を詰めることに価値は無い

**この 2 つに機械の執行者は無い。** 現状は書き手の注意に依存しており、欠番を機械で管理する仕組み(廃番を宣言する欄の導入)は BACKLOG.md の項目として残っている。それまでは、新しい番号を振る前に既存の最大値ではなく**履歴を確認する**。

## 運用メモ

- 新しい ID を振るのは新規作成のときだけである
- 既存文書を分割・統合するときは、id_policy と [reference_policy](./reference_policy.md) の両方を満たすように採番し直す。分割で生まれた側に新しい番号を振り、元の ID を残すか廃番にするかを決める
- 新しい doc_type を増やすときは、この一覧と [placement_policy](./placement_policy.md) を同時に更新する
