---
doc_type: meta
scope: repository
norms: [PRIN-0007, PRIN-0008]
---

# ルール文書の作り方

`docs/rules/` に新しいルール文書を 1 本足すときの通し手順である。**判定 → 配置 → 記入 → 整合確認**の順に進み、最後に上位の原則と矛盾していないことを確かめて終わる。

## 目的

- **doc_type と scope の組から配置を一意に決める**
- **ルール文書の種類を判定する**
- **フロントマター・ID・命名規則を適用する**
- **これらを機械的に判断できる形にする** —— 判断に個人差が出ると、同じ内容の文書が別の場所に生える

対象は `docs/rules/` のルール文書の新規作成である。既存の文書を直すときは [rule-update.md](./rule-update.md) へ行く。

## 参照するもの

**必ず参照する standards**(順に使う)

- [placement_policy.md](../standards/placement_policy.md) — 置き場所の対応表
- [doc_types.md](../standards/doc_types.md) — 文書の種類の定義
- [id_policy.md](../standards/id_policy.md) — ID の形式と採番
- [frontmatter_policy.md](../standards/frontmatter_policy.md) — フロントマターの必須条件
- [template_policy.md](../standards/template_policy.md) — テンプレートの解決手順
- [reference_policy.md](../standards/reference_policy.md) — 参照キーの意味と参照の可否

**必要なら参照するもの**

- 各層の README.md(入口は README ひとつ。AI 向けの案内も README 内の節にある)

## 手順1: doc_typeを判定する

**「何を書きたいか」から決める。** 原則なのか、構造の説明なのか、手順なのか、決定の記録なのか。判定に迷ったら [doc_types.md](../standards/doc_types.md) の各節の「書いてはいけないこと」を先に読む —— 書きたい内容がそこに載っていれば、その doc_type ではない。

## 手順2: scopeを決定する

| 値 | 対象 |
|---|---|
| `common` | プロジェクト全体(backend / frontend に共通) |
| `backend` | backend 固有 |
| `frontend` | frontend 固有 |

**原則として、可能な限り `common` に置く。** backend / frontend に固有だと確信できる場合にだけ分ける。先に分けてしまうと、同じ内容が両側に書かれて二重管理になる(PRIN-0007)。

## 手順3: 配置場所を決定する

[placement_policy.md](../standards/placement_policy.md) の表に従う。doc_type と scope が決まっていれば、置き場所は表を引くだけで決まる。表に無い組み合わせが必要になったら、それは表を直す話であって、その場で場所を発明する話ではない。

## 手順4: フロントマターを作成する

[frontmatter_policy.md](../standards/frontmatter_policy.md) に従う。共通必須は `doc_type` と `scope`、それに doc_type ごとの追加必須項目が乗る。

```yaml
---
doc_type: architecture
scope: backend
id: ARCH-BE-0017
norms: [PRIN-0001, PRIN-0005]
---
```

## 手順5: テンプレートを使用する

解決の順序は**同じ階層 → 上の階層**で、各階層では `template.{doc_type}.md` が `template.md` より優先する。詳細は [template_policy.md](../standards/template_policy.md)。

README(directory_guide)を作る場合は `docs/template.directory_guide.md` が解決される(rules と specs に共通の 1 枚。木の根まで遡って見つかる)。**この 1 枚だけは節の語彙が open** で固有の節を足してよいが、**節がひとつも無い README は M5 が警告する。**

## 手順6: IDと命名規則を適用する

[id_policy.md](../standards/id_policy.md) に従う。principle / architecture / decision / directory_guide には `id` が必須である。

**ファイル名は `{ID}-{slug}.md` にする**(`PRIN-BE-0001-xxx.md`)。ID を持たない doc_type は内容を表す名前を付ける。

## 手順7: 参照を追加する

[reference_policy.md](../standards/reference_policy.md) に従い、**関係の種類に応じたキー**に id を並べる。`norms` は守るべきもの、`decisions` はなぜそうしたか、`definitions` はどれが正か。参照してよい向きも同じ文書の表で確認する。

## 手順8: 上位レイヤーとの矛盾がないことを確認する

**この確認は全ての文書の作成時に必須である。**

### 確認すべき上位レイヤー

| 作る文書の doc_type | 確認する対象 |
|---|---|
| `domain_glossary` / `domain_invariant` / `domain_example` | principles の**全 PRIN** |
| `architecture` | 全 PRIN |
| `process` | 全 PRIN + 関連する architecture |
| `decision` | 全 PRIN + 関連する architecture |
| `spec` | 全 PRIN + 関連する architecture / process |

### 手順

1. **該当する上位レイヤーの全文書を読み、矛盾がないことを確認する。** 特に、作ろうとしている doc_type の「書いてはいけないこと」([doc_types.md](../standards/doc_types.md))に違反していないか、原則に反する内容が無いか
2. **確認の結果、従うべき原則・アーキテクチャ・ドメイン定義の ID を `norms` に列挙する。** 参照すべきものが無ければ `norms` を省略してよい。**ただし「確認しないで省略」は不可である**

**原則の適用対象は全文書であり、例外は無い。** 確認は「関係しそうな PRIN を抜粋して見る」ではなく、[principles](../../principles/README.md) の全走査である。常時コンテキストに載せておく必要は無いが、作成時には必ず通す。

参照すべきものが無かった場合は、フロントマターにコメントで `# norms: 確認済み（該当なし）` と残す。空白が「無かった」のか「調べていない」のかを、後から読む人が区別できるようにするためである。

**`architecture` の `norms` は必須**(必ず principles を参照する)、**`process` の `norms` は条件付き必須**である。

なお、この作業をサブエージェントに投げる場合は、**オーケストレーターが読むべき文書のパスをプロンプトに明示する**。サブエージェントは CLAUDE.md を読まないため、「全 PRIN を確認せよ」とだけ書いても対象に辿り着けない。

## チェックリスト

- [ ] doc_type を正しく判定した
- [ ] scope を決定した(`common` を優先した)
- [ ] placement_policy に従って配置を決定した
- [ ] フロントマターを作成した(doc_type ごとの必須フィールドを満たした)
- [ ] ID を採番した(必要な場合)
- [ ] 解決されたテンプレートに従って本文を作成した
- [ ] 参照を追加した(`norms` / `decisions` / `definitions`)
- [ ] `norms` を確認した(architecture は必須、process は条件付き必須)
- [ ] ファイル名が `{ID}-{slug}.md` になっている
- [ ] **`npm run verify` が通る**(M1〜M6 が文書の整合を、M7〜M9 が用語の綴りを見る。M1〜M4・M7 は error、M5・M6・M8・M9 は warning)

**verify が通らない状態でコミットしない。** CI が同じものを再実行する。

## 既存ルールドキュメントを更新する場合

[rule-update.md](./rule-update.md) に従う。影響分析と、廃止するときの作法(削除ではなく廃止フラグ)はそちらにある。

## 例外ケースの対処

**doc_type がどれにも当てはまらない、または placement_policy の表に置き場所が無い場合は、その場で新しい種類や場所を作らない。**

1. 既存の doc_type と配置で書けないかをもう一度確かめる。多くの場合は `spec` か `process` に収まる
2. それでも収まらないなら、経緯を `NOTES.md` に書き、判断が要る論点として `docs/handoff/review-queue.md` に上げる
3. 判断が出たら、**[doc_types.md](../standards/doc_types.md) と [placement_policy.md](../standards/placement_policy.md)(と必要なら [id_policy.md](../standards/id_policy.md))を先に更新してから**、文書を作る

先に文書を作って後から表を追いかけると、表と実体が食い違った状態が残る。**表が先、実体が後**である。

## 関連ドキュメント

- [rule-update.md](./rule-update.md) — 既存のルール文書を直す手順
- [rule-evaluation.md](./rule-evaluation.md) — 書き上がったものを独立の目で評価するチェックリスト
- [rule-generation-workflow.md](./rule-generation-workflow.md) — 作成と評価をループに組む段取り
- [../standards/README.md](../standards/README.md) — 参照する standards の一覧
