---
id: DG-FE-0012
doc_type: directory_guide
scope: frontend
norms: [PRIN-0007, PRIN-0008]
---

# process / frontend / specification / standards

フロントエンド仕様書の**書き方・基準・テンプレ**の置き場。仕様(specification)の standards であり、architecture の specification に対応する。コードの規約は [system/standards/conventions/](../../system/standards/conventions/README.md) にあって、ここではない。

## 配下の文書

| 文書 | 何を定めるか |
|------|------------|
| [screen-spec-writing.md](./screen-spec-writing.md) | 画面仕様(`screen_spec`)と共通枠(`chrome_spec`)の YAML スキーマ、検証器が実行する検査 S0〜S10、生成される部品 |
| [ux-lint.md](./ux-lint.md) | UX 経験則の機械検査(U 群 U1〜U5)と UX 原則の台帳(U8)。**経験則の指摘はすべて warning であり、受け入れには理由を書かせる**(画面の `ux:`) |
| [template.md](./template.md) | このディレクトリに新しい基準文書を足すときの型紙 |

U 群を赤にしないのは、経験則が「常に守るべき決まり」ではなく「外れているなら理由が要る箇所」だからである。赤にすれば理由のある逸脱まで止まり、止めないために雑な閾値へ緩めることになる。代わりに、外れた場所は理由つきの一覧として残す(PRIN-0008)。

## 参照するもの

- **仕様書の配置・構成** — [architecture/specification/frontend/](../../../../architecture/specification/frontend/README.md) の ARCH-SP-FE-0001。**未整備である**
- **実装側の規約** — [system/standards/conventions/](../../system/standards/conventions/README.md)(画面テスト・スタイル)
- **テスト注釈(`@spec` / `@tc`)の正** — [action-spec-writing.md](../../../backend/specification/standards/action-spec-writing.md) の test_cases の節。frontend 側には置かない
- **ID の規約** — [meta/standards/id_policy.md](../../../../meta/standards/id_policy.md)
- **テスト戦略の判断背景** — [decisions/frontend/](../../../../decisions/frontend/README.md) の ADR-FE-0001。**未整備である**

### ARCH-SP-FE-0001 を norms に書いていない理由

本文書の `norms:` には ARCH-SP-FE-0001 が**入っていない**。移植時点では入っていたが、実体が無いため外した。フロントエンド仕様の構成は「画面仕様の形式を実物と併走して決める」という宣言(正は製品の `docs/specs/frontend/README.md`)のもとで先送りされていたためである。

**norms には実体があるものだけを書く。** 存在しない id を並べると参照の健全性が崩れ、M3(参照実在)が守っている「id を書いてあれば辿れる」が嘘になる。**ARCH-SP-FE-0001 を作成したら、本文書の `norms:` に戻すこと。**

先送りの条件そのものは既に到来している。画面は 9 枚が実在し、書き方(screen-spec-writing.md)もスタイル(styling.md)も実物と併走して確定した。それでも ARCH-SP-FE-0001 は未整備のままであり、これは残っている宿題である。

### 移植の来歴

移植元にあった `spec-ids.md` と `test-annotations.md` は、**骨格のみ移植して内容は移していない**。代わりの正は次のとおりで、同じことを 2 か所に置かない(PRIN-0007)。

| 元の文書 | いまの正 |
|---------|---------|
| spec-ids.md | [meta/standards/id_policy.md](../../../../meta/standards/id_policy.md) |
| test-annotations.md | [action-spec-writing.md](../../../backend/specification/standards/action-spec-writing.md) の test_cases の節 |

## 整備方針

必要になった文書から追加する。新しい基準文書を足すときは同階層の [template.md](./template.md) に従う。
