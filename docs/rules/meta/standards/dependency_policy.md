---
doc_type: meta
scope: repository
norms: [PRIN-0007, PRIN-0008]
---

# 依存ポリシー — `dependencies` キーの意味と書き方

フロントマターの `dependencies` は、**実装レベルの依存**を機械可読に表すキーである。概念レベルの参照(`norms` / `decisions` / `definitions`)とは軸が違い、「何に従うか」ではなく**「何を使って実装するか」**を書く。

**現構成でこのキーを使っている文書は無い。** この文書は、使うことになったときの形式を定めるものである。読み取り経路の依存は現在 `query_spec` の `source` と `scope_used` が、書き込みの依存は `action_spec` が、実装との対応は仕様⇔テストのトレース(A 群)と生成物の鮮度チェック(C1)が担っており、`dependencies` を書かなくても依存は追える状態にある。

## dependencies（実装依存関係）

- **意味:** この文書の**実装**が依存するリソース(データテーブル・サービス・外部 API)
- **判断基準:** 「この機能を実装するために、何を読み書き・使用するか?」

概念レベルの参照との違いはここである。`norms` は違反したら問題になるもの、`dependencies` は無いと動かないものを指す。

## 記載形式

**1 つの依存を 1 つのオブジェクトとして、配列で書く。** 文字列の羅列にしないのは、依存先の種類と関係の向きを機械が読めるようにするためである。

| フィールド | 要否 | 内容 |
|---|---|---|
| `id` | 必須 | 依存先の ID |
| `type` | 必須 | 依存先の種類(下記の値域) |
| `relationship` | 必須 | 関係性(下記の値域) |
| `description` | 推奨 | 依存先の説明 |
| `path` | 任意 | 依存先の文書への相対パス |

**`path` は任意である。正は `id` の側にある。** [id_policy](./id_policy.md) が「参照側はパスに依存しない。ID だけを書く」と定めているためで、パスを必須にすると文書を移動しただけで `dependencies` が壊れる。`path` は読み手の便宜として添えるものであり、`id` と食い違ったら `id` を信じる。

## type（依存先の種類）

値域である。ここに無い種類が要るなら、先にこの表を増やす。

| 値 | 依存先 |
|---|---|
| `data_table` | データベースのテーブル |
| `domain_service` | ドメインサービス |
| `usecase_service` | ユースケースサービス |
| `api_endpoint` | API エンドポイント |
| `external_api` | 外部 API |

**`usecase_service` は参考にした体系の語彙であり、`app/src/operation/` 層とは無関係である。** 名前が似ているだけで指すものが違う。改名の対象でもない —— 改名すると、かえって「operation 層のことだ」と読まれる。

**これらの依存先が使う ID の空間(`DATA-TABLE-*` など)は [id_policy](./id_policy.md) に定義が無い。** 実際に使い始めるときは、id_policy に形式を足してから使う。

## relationship（関係性）

値域である。

| 値 | 意味 |
|---|---|
| `reads` | 読み取り専用 |
| `writes` | 書き込みを伴う |
| `uses` | サービス・ロジックの使用 |
| `calls` | API エンドポイントの呼び出し |

`reads` と `writes` を分けているのは、影響範囲の見積もりが変わるためである。テーブルの構造を変えるとき、読むだけの文書と書く文書とでは確認の重さが違う。

## 使用例

形式の例である。**この ID 空間に実体はまだ無い。**

```yaml
dependencies:
  - id: DATA-TABLE-ITEMS
    type: data_table
    relationship: writes
    description: 蔵書の状態を更新する
  - id: EXTERNAL-API-NOTIFY
    type: external_api
    relationship: calls
    description: 返却期限の通知を送る
```

## 参照との使い分け

4 つのキーは 2 つのレベルに分かれる。同じ文書が両方を持って構わない。

| レベル | キー | 何を表すか |
|---|---|---|
| 概念 | `norms` | 守らなければならないもの |
| 概念 | `decisions` | なぜそうしたか |
| 概念 | `definitions` | どれが正か |
| 実装 | `dependencies` | 何を使うか |

概念レベルの 3 キーの詳細は [reference_policy.md](./reference_policy.md) にある。

## CLIツールでの活用

**`dependencies` を辿る専用のツールは無い。** 逆引きが必要なときは `grep -rn "DATA-TABLE-ITEMS" docs/` のように ID で全文検索する。ID を一意にしてあるのは、まさにこの検索が成立するためである(PRIN-0008)。

道具を作るなら、満たすべきことは 3 つである。①ある ID に依存している文書を逆引きできること、②ある文書の依存先を一覧できること、③変更したときの影響範囲(依存の連鎖)を辿れること。**ただし作る前に、`dependencies` を実際に使う文書が現れているかを確認する** —— 使われていないキーのための道具は、道具のほうが先に腐る。

## 関連ドキュメント

- [reference_policy.md](./reference_policy.md) — 概念レベルの参照キーの定義と、参照してよい向き
- [frontmatter_policy.md](./frontmatter_policy.md) — フロントマターの全項目と必須条件
- [id_policy.md](./id_policy.md) — ID の形式。`dependencies` の参照先も ID で書く
