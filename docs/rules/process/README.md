---
doc_type: directory_guide
id: DG-0024
norms: []
decisions: [ADR-0005]
scope: repository
---

# process — 手順・プロセスの層

この層は「**何を・いつ・どうやるか**」を定義する。原則(principles)を実際の作業に落とし、仕様と実装の間の順序を決めるのがここの仕事である。

**この README は process 層の唯一の入口である**(ADR-0005)。層の内側で迷ったらここへ戻れば全体の地図が引ける。ただし**日々の作業の第一の入口はリポジトリ直下の `CLAUDE.md` のルーティング表**であり、「やること」から該当の正典へ直接飛ぶ経路がそちらにある。README 群は道案内層——ツリーの意味と分担を説明する層——として使う。

## AI実行時の共通ガイドライン

すべての Skill・playbook の実行時に従う共通の作法は [common/ai_execution_guidelines.md](./common/ai_execution_guidelines.md) が正である。進捗管理とコンテキスト管理をそこで定めている。個別の手順文書はこのガイドラインを前提にしてよく、同じことを書き直さない。

エージェントに作業を渡すときの前提が 2 つある。

- **サブエージェントは CLAUDE.md を読まない。** 必読文書のパスをプロンプトに明示するのはオーケストレーターの責務である。
- **`.claude/skills/{add-operation,add-query,add-screen}/SKILL.md` は手順の索引であって正典ではない。** 内容の正はルーティング表のリンク先(=この層の standards と architecture)にある。食い違ったらリンク先が正であり、**`docs/rules/` 側にスキルの規約は作らない**。

## 何を書くか

この層に入るのは次の 3 種である。

| 種別 | 中身 |
|---|---|
| 仕様執筆手順 | 仕様書の作成・更新の流れ / どこに何を書くか / テンプレートの使い方 |
| 検証手順 | 仕様の検証 / テストと仕様の紐づけ確認 / 網羅性チェック |
| 実装手順 | 仕様に基づく実装の進め方 / レビュー・品質チェックのタイミング |

位置づけは「**原則の適用**」である。principles が「なぜそうするか」を持ち、この層が「ではどう進めるか」を持つ。architecture と `docs/specs/` の仕様文書は、必要な手順としてこの層を参照する側に立つ。

`doc_type: process` の定義そのものは [meta/standards/doc_types.md](../meta/standards/doc_types.md) の process の節が正である。

## 構成

**スコープで 3 つに割る。** `common/`(スコープに閉じないもの)/ `backend/` / `frontend/`。

**backend と frontend は 4 箱で構成する。**

| 箱 | 中身 |
|---|---|
| `specification/standards/` | 仕様の書き方・基準・テンプレート |
| `specification/playbooks/` | 仕様を書く手順 |
| `system/standards/` | 実装・コードのルール・基準 |
| `system/playbooks/` | コードを書く手順 |

- `system/standards/` の配下に `conventions/`(規約)を置く。
- `layers/`(層ごとの実装のきまり)は **backend にのみ置く**。frontend には置かない。
- `common/` は 4 箱に縛られず、必要に応じてサブディレクトリを置く(現状は `specification/` と `tooling/`)。

**テンプレートは各箱に置く。** `standards/` と `playbooks/`、および `conventions/` と `layers/` にそれぞれ `template.md` を置く。新規文書がどのテンプレートに従うかは解決順「**同階層 → 上**」で決まる([template_policy.md](../meta/standards/template_policy.md))。同階層に `template.md` があればそれを、無ければ 1 つ上へ遡る。

**オプションの箱**として `process/{scope}/examples/` を置いてよい。規約に付随しない単体のコード例を 1 例 1 ファイルで置く場所であり、**あってもなくてもよい**。規約の中の例で足りるなら作らない。

**id** は必要に応じて `PROC-xxx` を検討する([id_policy.md](../meta/standards/id_policy.md))。この層の README(`directory_guide`)には `PROC-BE-xxxx` を宣言していたものがあったが、2026-08-23 に `DG-BE-xxxx` へ振り直して統一した。**directory_guide の id は `DG-xxxx` の形だけ**であり、外れると M2(ID 整合)がエラーにする。

## 書かないこと

次の 4 つはこの層の外に正がある。ここに書き写さない。

| 書かないもの | 正の場所 |
|---|---|
| 原則の本文 | [principles/](../principles/README.md) |
| 仕様の内容そのもの | `docs/specs/` |
| 配置・構成の定義 | [architecture/](../architecture/README.md) |
| なぜその手順にしたかの詳細 | [decisions/](../decisions/README.md) |

とりわけ**「どこに何を置くか」の正は architecture/specification である**。この層が持つのは「その配置に従って、いつ・どの順で・誰が何をするか」だけである。配置の定義を process 側に写すと、2 か所に正が生まれる。

## process のサブディレクトリ一覧

この一覧はこの層の目次であり、**維持する義務がある**。ディレクトリを足したらここに行を足す。

| パス | 中身 | 状態 |
|---|---|---|
| [common/](./common/README.md) | スコープに閉じない共通プロセス。`ai_execution_guidelines.md` を持つ | 整備済み |
| [common/specification/](./common/specification/README.md) | スコープに閉じない仕様プロセス | 整備済み |
| [common/specification/standards/](./common/specification/standards/README.md) | 仕様書のスキーマ・文法・基準(`domain-spec-writing.md`) | 整備済み |
| [common/specification/playbooks/](./common/specification/playbooks/README.md) | ドメイン仕様を変える手順(`domain-spec-change.md`) | 整備済み |
| [common/tooling/](./common/tooling/README.md) | 開発ツール関連。`standards` / `playbooks` / `guides` の 3 箱 | 一部整備 |
| [common/tooling/standards/](./common/tooling/standards/README.md) | ツールのコード品質基準(`scripts-code-quality.md`) | 整備済み |
| [common/tooling/playbooks/](./common/tooling/playbooks/README.md) | ツールの拡張手順 | 骨格のみ |
| [common/tooling/guides/](./common/tooling/guides/README.md) | ツールの利用ガイド | 骨格のみ |
| [backend/](./backend/README.md) | バックエンドの 4 箱 | — |
| [backend/specification/standards/](./backend/specification/standards/README.md) | `action-spec-writing.md` / `query-spec-writing.md` | 整備済み |
| [backend/specification/playbooks/](./backend/specification/playbooks/README.md) | 仕様を書く手順 | 骨格のみ |
| [backend/system/standards/](./backend/system/standards/README.md) | 実装・コードのルール・基準 | — |
| [backend/system/standards/conventions/](./backend/system/standards/conventions/README.md) | 実装側の規約(`server-actions.md` / `queries.md` / `route-handlers.md` / `logging.md`) | 整備済み |
| [backend/system/standards/conventions/enforcement/](./backend/system/standards/conventions/enforcement/README.md) | 機械執行ルールの全件一覧とトピック別詳細。`enforcement-matrix.md` が入口 | 整備済み |
| [backend/system/standards/conventions/security/](./backend/system/standards/conventions/security/README.md) | 安全側の規約 | 骨格のみ |
| [backend/system/standards/conventions/testing/](./backend/system/standards/conventions/testing/README.md) | `unit.md` / `integration.md` | 整備済み |
| [backend/system/standards/layers/](./backend/system/standards/layers/README.md) | 層ごとの実装のきまり(層の責務・依存方向の正は ARCH-BE-0001) | 骨格のみ |
| [backend/system/playbooks/](./backend/system/playbooks/README.md) | 実装手順。実運用の手順はスキル 3 本が担っている | 骨格のみ |
| [frontend/](./frontend/README.md) | フロントエンドの 4 箱 | — |
| [frontend/specification/standards/](./frontend/specification/standards/README.md) | `screen-spec-writing.md` / `ux-lint.md` | 整備済み |
| `frontend/specification/playbooks/` | 仕様を書く手順。`template.md` のみで README が無い | 骨格のみ |
| [frontend/system/standards/conventions/](./frontend/system/standards/conventions/README.md) | `screen-test.md` / `styling.md` | 整備済み |
| `frontend/system/playbooks/` | 実装手順。`template.md` のみで README が無い | 骨格のみ |

## 個別のコーディングルールと例

「コメント必須」「エラーハンドリング」「テスト規約」といった**個別のコーディングルールは原則の適用**であり、その置き場所の正は [placement_policy.md](../meta/standards/placement_policy.md) の該当節にある。以下はその適用結果である。

- **backend の規約の置き場は `backend/system/standards/conventions/`** である。playbooks からは「参照する規約」として参照する。手順が規約を抱え込まない。
- **層ごとの説明とコードは process に入れる。** backend では `system/standards/layers/` に層ごとのファイル(`domain`, `operation`, `infrastructure`, `presentation`, `composition`)を置く。対応する architecture の層文書は「責務・構成・何をどこに置くか」に絞り、「どう書くか・実装例」はこちらを参照させる(責務の分離)。
- **規約に付随しない単体のコード例**は、規約文書の中の「例」節に置くか、`{scope}/examples/` に置く。
- **業務上の例**(ドメインの判定・状態の例)は `domain_example` としてドメイン知識層(W。`docs/specs/` の隣)に置く。process には移さない。業務の例は手順ではない。

## 構成のアイデア（specification / system / examples）

この層の分割軸は **architecture の軸(specification / system)に揃えてある**。同じ軸で切っておくと、「この配置ルール(architecture)に対応する手順はどれか(process)」が一対一で対応し、探すときに迷わない。

| 軸 | 役割 | 現状 | 深掘りの例 |
|---|---|---|---|
| `specification/` | 仕様を作る側のルールと手順 | standards が整備済み、playbooks は common 側が担っている | 仕様種別ごとの書き方、仕様変更の影響分析 |
| `system/` | コードを書く側のルールと手順 | conventions が最も厚い。layers と playbooks は骨格 | 層ごとの実装のきまり、レビュー・品質チェックの手順 |
| `examples/` | 規約に付随しないコード例(オプション) | 現状は置いていない | 1 例 1 ファイルの実装例 |

**`layers/` は実装の話**なので `system/standards/layers/` にのみ置く。specification 側には置かない。この 1 本が specification と system の線引きを保っている。

採用済みのツリーは次の形である(`frontend/` は `backend/` の配下ではなく、process 直下の兄弟である)。

```
process/
├── common/
│   ├── ai_execution_guidelines.md
│   ├── specification/{standards,playbooks}/
│   └── tooling/{standards,playbooks,guides}/
├── backend/
│   ├── specification/
│   │   ├── standards/    # 仕様の書き方・基準
│   │   └── playbooks/    # 仕様を書く手順
│   └── system/
│       ├── standards/
│       │   ├── conventions/   # 実装側の規約(enforcement/ security/ testing/)
│       │   └── layers/        # 層ごとの実装のきまり
│       └── playbooks/    # コードを書く手順
└── frontend/
    ├── specification/{standards,playbooks}/
    └── system/{standards,playbooks}/
```
