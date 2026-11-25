---
doc_type: directory_guide
id: DG-BE-0002
norms: []
scope: backend
---

# architecture/specification/backend — バックエンド仕様の構造

この階層が担当するのは、`docs/specs/backend/` の**ディレクトリ構成**と、**配置が一意に定まるルール**と、**テスト仕様との紐づけ方針**である。仕様ファイルを新しく作るとき「どこに置くか」で迷わないことがここの目的である。

実際の仕様ファイルは `docs/specs/backend/` に置く。この階層はその置き方を定めるだけで、仕様そのものは持たない。

---

## 文書一覧

| ID | 文書 | 内容 |
|---|---|---|
| ARCH-SP-BE-0001 | [ARCH-SP-BE-0001-backend-spec-structure.md](./ARCH-SP-BE-0001-backend-spec-structure.md) | バックエンド仕様(`docs/specs/backend/`)の構成。`actions/`(Server Action 仕様 = `action_spec`)と `queries/`(読み取りクエリ仕様 = `query_spec`)を軸にした構成、1 ドメインイベント 1 ファイルの分割、パスとイベント ID の対応、`docs/specs/domain/` を再定義しないという制約 |

`ARCH-SP-BE-xxxx` を足したらこの表に行を足す。

**参照するときは「ARCH-SP-BE-0001 に従う」と書けばよい。** process の手順書もテンプレートも AI へのプロンプトも、個別の配置ルールを再掲しない。再掲した瞬間に、構成を変えたときの直し漏れが生まれる。

### 落としてはいけない制約

- **`docs/specs/domain/` を再定義しない。** 状態・権限・不変条件はドメイン仕様が正であり、backend 仕様はそれを **ID で参照する**。ここで再定義すると、ドメイン仕様を直しても backend 仕様が古い定義を持ち続ける。
- **1 ドメインイベント 1 ファイル。** ファイルとイベント ID が 1 対 1 に対応していることが、検証器が仕様・実装・テストを突き合わせられる前提になっている。

---

## 関連

「どこに置くか」「どう書くか」「どう作るか」は別々の文書が持つ。役割分担は次のとおり。

| 知りたいこと | 見る場所 |
|---|---|
| 構成(どこに置くか) | この階層(ARCH-SP-BE-0001) |
| 書き方の正(操作の仕様をどう書くか) | [action-spec-writing.md](../../../process/backend/specification/standards/action-spec-writing.md) |
| 書き方の正(読み取りの仕様をどう書くか) | [query-spec-writing.md](../../../process/backend/specification/standards/query-spec-writing.md) |
| 参照先のドメイン仕様の構成 | [specification/common/](../common/README.md)(ARCH-SP-0002) |
| 実装側の構造(どう作るか) | [system/backend/](../../system/backend/README.md)(ARCH-BE-0013) |
