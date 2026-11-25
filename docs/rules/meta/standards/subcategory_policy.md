---
doc_type: meta
scope: repository
---

# サブカテゴリポリシー — 層の内部をどう分けるか

[doc_types.md](./doc_types.md) が**層と層の境界**を決めるのに対し、この文書は**層の内部**のサブディレクトリの責務を決める。「この情報はどのサブカテゴリに書くか」で迷わないようにするためのものである。

対象は 2 つの分割である。`process/` の **standards と playbooks**、`system/standards/` の **conventions と layers**。

## standards と playbooks

### standards（ルール・基準）

- **書くこと:** 定義・スキーマ・ルール・基準・制約の列挙。**何が正しいか**の宣言的な記述
- **書かないこと:** 手順(番号を付けて並べる手続き的な記述)、コマンドの使い方、ワークフロー(いずれも playbooks)
- **性質:** 宣言的 / 参照される側 / 変更頻度が低い
- **例:** YAML フロントマターの定義、フィールドの型ルール、命名規則、検証ルールの列挙

### playbooks（手順）

- **書くこと:** 手順・ワークフロー・コマンドの使い方・チェックリスト。**どうやるか**の手続き的な記述
- **書かないこと:** 定義やルールの本体(standards)。説明が要るときは standards への参照リンクで代替する
- **性質:** 手続き的 / standards を参照する側 / ツールやワークフローの変更に追随して更新される
- **例:** 仕様書の作成手順、ツールの実行コマンド、トラブルシューティングの列挙

### どちらに書くかの判断基準

3 つ問えば決まる。

1. **ルールか、手順か。** ルール・定義なら standards、手順・操作なら playbooks
2. **何度も参照されるか。** はいなら standards
3. **ツールが変わっても残るか。** はいなら standards

### 重複を避けるルール

**playbooks は standards を参照する。逆はしない。**

- **playbooks が standards の内容を要約・転記することを禁じる。** 参照リンクだけで代替する
- **standards は playbooks の存在に依存しない。** 単体で定義として完結していること

これは単一情報源(PRIN-0007)のサブカテゴリ版である。手順書に定義がコピーされた瞬間に二重管理が始まり、片方だけが古くなる。手順を読んでいて定義が知りたくなったら、リンクを踏んで standards を読む —— その一手間が、定義を 1 か所に保つ対価である。

### スキルとの関係

`.claude/skills/` に置かれた実行手順(現状 3 本)は、よく回る作業の索引である。**スキルは正典ではない**(内容の正は CLAUDE.md のルーティング表が指すリンク先)。そして **`docs/rules/` 側にスキルの規約を作らない。** スキルは手順の入口であって手順の定義ではなく、playbooks / standards の二分とは別の軸に置く。

## conventions と layers

`system/standards/` の配下の分割である。

### conventions（規約）

- **書くこと:** スコープを横断する規約(ドキュメンテーション、エラーハンドリング、テスト規約など)の列挙。**原則の具体的な適用**
- **書かないこと:** 特定の層に閉じた実装ルール(layers)

現構成の backend の conventions は、単なる規約集より重い。配下の `enforcement/` が機械執行ルールの全件対応表を持っており、**設定ファイルは執行者にすぎず正は文書の側にある**という関係を保っている。規約を足すときは、執行者(リンター・型・テスト)が居るかどうかも合わせて書く。

### layers（層ごとの実装ルール）

- **書くこと:** 特定の層に固有の実装ルールとコード例
- **書かないこと:** 層をまたぐ横断的な規約(conventions)、層の構造と責務の定義(architecture)

backend の層は `domain` / `operation` / `composition` / `infrastructure` / `presentation` の 5 つである。

**三分割を覚えておく。** 層の構造と責務は architecture、層ごとの実装方法とコード例は `process/.../layers/{layer}/`、層をまたぐ規約は `conventions/`。配置の対応表としての正は [placement_policy.md](./placement_policy.md) にある。

## 適用範囲

- **scope を問わず適用される。** common / backend / frontend のどれでも同じ責務定義に従う
- backend と frontend はともに standards / playbooks の分離を採用している。ただし現状は非対称で、frontend の playbooks にはテンプレートだけがあり README も文書も無い。**実物が要るときに README ごと足す**(実物のない規約を先回りで書かない)
- **`layers/` を持つのは backend だけである。** frontend に層構造は無く、規約はすべて conventions に置く

## 関連ドキュメント

- [doc_types.md](./doc_types.md) — 層と層の境界(この文書は層の内部を扱う)
- [placement_policy.md](./placement_policy.md) — doc_type × scope から置き場所を決める対応表。上のサブカテゴリはそこに現れる
- [../playbooks/how-to-create-rules.md](../playbooks/how-to-create-rules.md) — 実際に 1 本作るときの手順
