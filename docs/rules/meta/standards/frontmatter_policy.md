---
doc_type: meta
scope: repository
norms: [PRIN-0007, PRIN-0008]
decisions: [ADR-0005, ADR-0009]
---

# フロントマターポリシー — 項目の意味と、doc_type ごとの必須条件

**全ての文書に YAML フロントマターを付ける。** 目的は 3 つで、参照できること・依存関係を機械可読にすること・状態を管理できることである。本文だけで済ませると、文書同士の関係が散文の中に埋まり、機械からも人からも辿れなくなる(PRIN-0008)。

**執行者は `npm run verify` の M1 である。** M1 は共通必須(`doc_type` / `scope`)と、doc_type ごとの追加必須項目を見る。フロントマターが `---` で閉じていない文書も M1 としてエラーになる。**この文書の「doc_type ごとの必須フロントマター対応表」が検証器の実装の出典であり、表を変えるときは検証器と一緒に直す。**

## フロントマター全項目一覧

### 1. 基本分類系（全文書共通）

| キー | 必須 | 意味 |
|---|---|---|
| `doc_type` | 必須 | 文書の種類。配置・参照・必須項目の判定の基点になる。値域は [doc_types.md](./doc_types.md) |
| `scope` | 必須 | 適用範囲。値域は `common` / `backend` / `frontend` / `repository` / `feature` |
| `id` | doc_type 依存 | 文書の一意識別子。形式は [id_policy.md](./id_policy.md) |

### 2. 参照・依存関係系（doc_type 依存）

**概念レベル**

| キー | 意味 |
|---|---|
| `norms` | この文書が従う規範・ルール。**違反したら問題**であるものの id を列挙する。参照が存在する場合に限り書く(directory_guide だけは例外。下記) |
| `decisions` | 内容が基づく意思決定(ADR)の id。任意だが推奨 |
| `definitions` | この文書が正とする定義の出典。定義が衝突したときに「どれが正か」を決める id |
| `targets` | その判断が影響する対象。**decision のみ**で必須 |

**実装レベル**

| キー | 意味 |
|---|---|
| `dependencies` | 実装が依存するリソース(データテーブル・サービス)。形式は [dependency_policy.md](./dependency_policy.md) |

- **本文で他の文書を参照したら、関係の種類に応じたキーの下に id を列挙する。** どのキーを選ぶかの基準は [reference_policy.md](./reference_policy.md) にある
- **`applies` / `derived_from` のような動詞的なキーを使わない。** 意味が曖昧になり、機械処理で破綻する
- README やまとまりの入口となる process 文書も、**まとまり全体に共通でかかる規範があれば `norms` を書く**

### 3. 状態・履歴管理系（主に decision）

| キー | 意味 |
|---|---|
| `status` | `proposed` / `accepted` / `superseded`。decision で必須 |
| `supersedes` | 置き換えた過去の ADR の id。decision の任意 |
| `deprecated` | 非推奨であることの宣言。全 doc_type の任意。非推奨でも参照は可能である |

### 4. 運用補助系（任意）

| キー | 意味 |
|---|---|
| `stability` | `high` / `medium` / `low`。値の意味は [../playbooks/rule-update.md](../playbooks/rule-update.md) |

**`audience`（`ai` / `human` の書き分け）は廃止した。** 検証器（M1）が一度も読まない死語彙だったため（[ADR-0009](../../decisions/common/ADR-0009-retire-audience-key.md)）。AI 向けの文書かどうかは配置とファイル名・本文の宣言で示し、フロントマターのキーは持たない。新規に書かない。

### 5. domain_glossary 専用

| キー | 必須 | 意味 |
|---|---|---|
| `term_id` | 必須 | 用語の識別子。英語スネークケース(`product` / `business_relationship`) |
| `aliases` | 推奨 | 別名の一覧(日本語表記・英語表記・表記ゆれ)。検索と参照の精度を上げるためのもので、**別名が明確な場合にのみ**書く |

## meta ドキュメント専用ルール

- **meta が使う項目:** `doc_type`(必須)/ `scope`(必須)/ `stability` / `norms` / `decisions` / `definitions` / `dependencies`(いずれも任意)
- **meta で禁止する項目: `targets`。** 理由は、meta が判断の対象にならないためである。`targets` は「その決定が何に影響するか」を書く欄であり、文書の書き方を定める meta には対応するものが無い
- **meta は principle を参照してよい。** meta は「ルール文書の形式・構造」を定めるメタレベルにあるが、**meta 自身も文書である以上、原則には従う**。meta が単一情報源(PRIN-0007)や追跡可能性(PRIN-0008)に従わなければ、ルールの書き方そのものが整合を失い、文書全体の品質を保証できなくなる。だから meta も `norms` で従う原則を明示する。参照の向きの議論は [reference_policy.md](./reference_policy.md) にまとめてある

## doc_type ごとの必須フロントマター対応表

共通必須(`doc_type` / `scope`)に**加えて**必要な項目である。

| doc_type | 追加の必須項目 | 備考 |
|---|---|---|
| `directory_guide` | `id` / `norms` | **`norms` は参照が無くても空配列 `[]` を書く** |
| `meta` | (なし) | |
| `principle` | `id` | |
| `architecture` | `id` / `norms` | `norms` は必須。architecture は必ず原則を参照する |
| `process` | (なし) | `norms` は条件付き(下記) |
| `decision` | `id` / `targets` / `status` | |
| `spec` | `id` | `decisions` は推奨 |
| `domain_glossary` | `id` / `term_id` | `aliases` は推奨 |
| `domain_invariant` | `id` | |
| `domain_example` | `id` | |
| `domain_design_context` | `id` | |
| `domain_precedent` | `id` | |

**`norms` の空配列は「無い」ではなく「参照が無いことを明示した」である。** 「参照がある場合に限り書く」という一般則と、directory_guide だけが空配列を強制されることは矛盾しない —— 入口の文書は参照グラフに参加していること自体を示す必要があるためで、この非対称は意図されたものである。

### docs/specs の仕様文書

`role_spec` / `entity_spec` / `state_spec` / `access_spec` / `invariant_spec` / `action_spec` / `query_spec` / `data_table` / `notification_spec` / `job_spec` / `config_spec` / `auth_spec` / `guarantee_spec` / `external_spec` / `surface_spec` / `screen_spec` / `chrome_spec` / `design_token_spec` / `usecase_spec` / `ux_principles_spec` / `term_ledger` は、`doc_type` / `scope` に加えて [doc_types.md](./doc_types.md) が指定する必須フィールドを持つ。

**充足を検査するのは仕様検証側(V1 / A0 / Q0 / T0 / N0 / S0 / G0)である。** 文書整合検証(M1)がここで見るのは 3 つだけに絞ってある。

1. フロントマターが `---` で閉じて YAML として読めること
2. `doc_type` と `scope` があること(全文書共通の要求であり、仕様検証側はどちらも見ていない)
3. **ドメイン 5 種(role / entity / state / access / invariant)と `design_token_spec` / `ux_principles_spec` の `id`**

3 番目だけが例外的に M1 の担当なのは、**そこが唯一の検査経路だから**である。V 群は文書の `id` を読まず、`design_token_spec` の `id` は導出元を持たないため G0 も見ていない。M1 が見なければ、`id` を書き忘れた仕様が M2 の台帳から静かに落ち、重複も形式も無検査になる。これらの `id` は `spec_ids: [item-access]` のように A 群・Q 群の参照先として実際に使われるので、欠落は検出しなければならない。逆に `action_spec` / `query_spec` / `screen_spec` / `chrome_spec` の `id` は A0 / Q0 / S0 が導出元との一致まで見ているので、M1 では重ねない。

### process の `norms` は条件付き必須

process(standards / playbooks)を書くときは、**principles と関連する architecture を確認し、従うべき原則・アーキテクチャを特定する。** 確認の結果、参照すべきものが無ければ `norms` を省略してよい。

**ただし「確認しないで省略」は不可である。** ここに機械の執行者は無く、確認したかどうかは外から見えない。それでも規則として残すのは、`norms` の空白が「無かった」と「調べていない」のどちらなのかで、後から読む人の判断が変わるからである。確認した結果として空なら、フロントマターにコメントで `# norms: 確認済み（該当なし）` と残す。
