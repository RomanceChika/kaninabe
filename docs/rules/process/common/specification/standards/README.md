---
doc_type: directory_guide
id: DG-0037
norms: [PRIN-0001, PRIN-0006, PRIN-0007]
scope: common
---

# specification/standards — 仕様書のスキーマ・文法・基準

スコープ非依存の「仕様書はこう書けば正しい」を宣言的に定める箱である。ここに置くのは**基準**であって手順ではない。手順は [../playbooks/](../playbooks/README.md) にある。

## 配下の文書

| 文書 | 内容 |
|---|---|
| [domain-spec-writing.md](./domain-spec-writing.md) | ドメイン仕様(`docs/specs/domain/`)の書き方。5つの doc_type(`role_spec` / `entity_spec` / `state_spec` / `access_spec` / `invariant_spec`)の YAML スキーマ、ガード式の文法(EBNF 記法)、検証チェック V1〜V12 の範囲、DSL の外に置く情報の線引き |
| [term-ledger-writing.md](./term-ledger-writing.md) | 用語の台帳(`docs/specs/terms.md`。`term_ledger`)の書き方。1 語 1 行の宣言と、使わない綴り(`avoid`)を禁じる検査(M7〜M9 / M11) |
| [template.md](./template.md) | この階層で新規文書を作るときの見出し構成。4節すべてが必須 |

`domain-spec-writing.md` は CLAUDE.md のルーティング表から「ドメイン仕様の追加・変更」の書き方の正として直接名指しされる。この枝は文書3本の小さな箱だが、通行量は多い。

**V1〜V12 は検査の全部ではない。** これはドメイン仕様を見る V 群の範囲であり、`npm run verify` はこのほかに A 群(action_spec と実装・テストのトレース)・Q 群(query_spec)・T 群(data_table)・N 群(notification_spec)・J 群(job_spec)・K 群(config_spec)・S 群(screen_spec)・M 群(文書構造)・G 群(視覚層)・U 群(UX リント)を同時に回している。domain-spec-writing.md が引き受けているのは、そのうち V 群が見る範囲だと理解して読む。

## 参照するもの

| 知りたいこと | 正 |
|---|---|
| 仕様書をどこに・どういう構成で置くか | [architecture/specification](../../../../architecture/specification/README.md)。ドメイン仕様の構成は [ARCH-SP-0002](../../../../architecture/specification/common/ARCH-SP-0002-domain-spec-structure.md) |
| ドメイン仕様を実際に変更する手順 | [../playbooks/domain-spec-change.md](../playbooks/domain-spec-change.md) |
| backend 固有の基準(action_spec / query_spec の書き方) | [process/backend/specification/standards](../../../backend/specification/standards/README.md) |
| frontend 固有の基準(screen_spec の書き方・UX リント) | [process/frontend/specification/standards](../../../frontend/specification/standards/README.md) |

**役割分担: 「どこに置くか」= architecture/specification、「どう書くか」= ここ。** 両者を重複させない(PRIN-0007)。配置の話が必要なら書き写さずにリンクする。書き写した瞬間に、構成が変わったとき2か所を直さなければならなくなる。

## 整備方針

- **置くもの** = 仕様書のスキーマ・文法・基準。宣言的に「何が正しいか」を書く。
- **置かないもの** = 手順。作業の順序や実行コマンドは [../playbooks/](../playbooks/README.md) へ。
- **スコープ固有の基準はここに置かない。** backend / frontend の `specification/standards/` へ振る。
- 基準は**準拠を判定できる形**で書く(PRIN-0006)。「読みやすく書く」ではなく、どの検査 ID が何を弾くかまで書けるところまで具体化する。
- 新規文書は同階層の [template.md](./template.md) に従う。
