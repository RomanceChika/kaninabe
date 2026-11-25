---
doc_type: directory_guide
id: DG-BE-0006
norms: []
scope: backend
---

# process/backend/specification — バックエンド仕様のルールと手順

バックエンドの仕様書(`action_spec` / `query_spec`)を**作る・更新する・保つ**ためのルール(standards)と手順(playbooks)の入口。

## 目的

この箱が達成することは 4 つある。

1. **仕様書の書き方と基準を標準化する**(standards)。同じ種類の仕様が同じ順路で読める状態を保つ。
2. **作成・更新の手順を提供する**(playbooks)。どの順で何を触れば整合が崩れないかを決める。
3. **仕様とテストの追跡可能性(Traceability)を実現する**。仕様のどの節がどのテストで守られているかが機械で辿れること(PRIN-0008)。
4. **Single Source of Truth を維持する**。同じ事実が 2 か所に書かれない状態を保つ(PRIN-0007)。

## 構成

| 箱 | 役割 | 中身 |
|---|---|---|
| [standards/](./standards/README.md) | 仕様書の構造・命名規則・テストとの対応の付け方を定義する | `action-spec-writing.md` / `query-spec-writing.md` |
| [playbooks/](./playbooks/README.md) | 仕様書の作成・更新の手順と道具の使い方を提供する | 骨格のみ |

**standards が「何が正しい形か」、playbooks が「どの順でやるか」**である。混ぜない。

## 参照するもの

| 文書 | ここで前提にしている内容 |
|---|---|
| [ARCH-SP-BE-0001](../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md) | どこに何を置くか(`actions/` と `queries/`。他の種別は必要になったときに追加する)。配置が一意に定まるルール(ファイルパス ⇔ ドメインイベント ID の対応)。テンプレートの配置(`docs/specs/backend/actions/template.action_spec.md` / `queries/template.query_spec.md`) |
| [ARCH-SP-0002](../../../architecture/specification/common/ARCH-SP-0002-domain-spec-structure.md) | 参照先であるドメイン仕様の構成。**backend 側ではドメイン仕様を再定義しない** |
| [PRIN-0007](../../../principles/common/PRIN-0007-single-source-of-truth.md) | YAML フロントマターが唯一の正である。Markdown の表は生成物であり、`<!-- AUTO-GENERATED -->` ブロックを手で編集しない |
| [PRIN-0008](../../../principles/common/PRIN-0008-traceability.md) | 仕様とテストを相互に追跡可能にする。対応付けはテスト側の `@spec` / `@tc` アノテーションで行う |

ARCH-SP-0002 との関係は特に重要である。backend の仕様が薄くいられるのは、状態・不変条件・権限をドメイン仕様が持っているからであって、**backend 側でそれを書き直した瞬間に正が 2 つになる**。

道具は 2 つで、どちらもルートで実行する(ルートの scripts が `legacy/spec-tools` へ取り次ぐ)。

| コマンド | 何をするか |
|---|---|
| `npm run verify` | 仕様の意味検証と、仕様⇔実装⇔テストのトレース(V 群 / A 群 / Q 群 / T 群 / N 群 / J 群 / K 群 / M 群)をまとめて実行する |
| `npm run generate` | YAML から Markdown の表・図・要約と、実装部品(zod スキーマ・遷移表)を生成する |

生成物の鮮度は `npm run generate:check`(C1)が見る。CI が同じものを再実行する。

## 実装の層（domain, operation等）との関係

**仕様書はこの `specification/` 配下で管理し、実装の層のルールは [system/standards/](../system/standards/README.md) で管理する。**

- `system/standards/layers/` … 各層(`domain` / `operation` / `composition` / `infrastructure` / `presentation`)の実装のきまり
- `system/standards/conventions/` … コーディング規約

仕様書が実装の層に言及するのは構わない。しかし**実装の層のルールそのものはここに置かない**。仕様は参照する側であって、実装のきまりを持つ側ではない。

## クイックスタート

**新しい仕様を書くとき**

1. 何を足すのかで入口を選ぶ。ドメインの状態・権限を変えるなら [domain-spec-change.md](../../common/specification/playbooks/domain-spec-change.md)、Server Action を足すなら [action-spec-writing.md](./standards/action-spec-writing.md)、読み取り経路を足すなら [query-spec-writing.md](./standards/query-spec-writing.md)。
2. 置き場所を ARCH-SP-BE-0001 で確かめる。パスがドメインイベント ID と一対一で対応する。
3. テンプレート(`docs/specs/backend/actions/template.action_spec.md` / `queries/template.query_spec.md`)を写して YAML フロントマターを書く。
4. `npm run verify` を通す。**エラー一覧は決定の TODO リストである。**黙らせるための雑な定義を書かない。
5. `npm run generate` で表と実装部品を作り直す。
6. テストを書く。`@spec` / `@tc` の注釈を付ける(付いていないとトレースが切れて A 群が落ちる)。
7. もう一度 `npm run verify` で仕様とテストの対応まで通す。

**既存の仕様を直すとき**

1. YAML フロントマターを直す(生成ブロックは触らない)。
2. `npm run verify` → 崩れた整合が列挙される。
3. `npm run generate` で生成物を作り直す。
4. テストを追加・修正して注釈を合わせる。
5. `npm run verify` を再実行して緑にする。

## Skillからの利用

実運用では `.claude/skills/add-operation/SKILL.md`(操作を 1 つ足す)と `.claude/skills/add-query/SKILL.md`(読み取り経路を 1 本足す)がこの箱を読む。スキルはユーザーと対話しながら仕様を置く場所を決め、standards とテンプレートに従って書き、検証まで回す。

ただし**スキルは手順の索引であって正典ではない**。中身の正はこの `specification/` 配下と architecture にあり、両者が食い違ったらこちらが正である。`docs/rules/` 側にスキルの規約は作らない。
