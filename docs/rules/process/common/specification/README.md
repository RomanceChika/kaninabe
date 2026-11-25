---
doc_type: directory_guide
id: DG-0036
norms: [PRIN-0001, PRIN-0006, PRIN-0007]
scope: common
---

# specification — スコープ非依存の「仕様の書き方」

backend / frontend に閉じない仕様の書き方・基準・手順を置く枝である。仕様が正(PRIN-0001)である以上、**仕様そのものの書き方が最初の品質の関門**になる。この枝は architecture の **specification** に対応する process 側の相手方であり、あちらが「どこに置くか」を決め、こちらが「どう書くか・どう手を動かすか」を決める。

## 構成

2箱に分ける。分担の正は [meta/standards/subcategory_policy.md](../../../meta/standards/subcategory_policy.md) の「standards は宣言 / playbooks は手順」である。

| パス | 責務 | 配下 |
|---|---|---|
| [standards/](./standards/README.md) | 仕様書のスキーマ・文法・基準を**宣言的に**定義する。「何が正しいか」を書く | [domain-spec-writing.md](./standards/domain-spec-writing.md) / [template.md](./standards/template.md) |
| [playbooks/](./playbooks/README.md) | 仕様を書く**手順**。「どの順で手を動かすか」を書く | [domain-spec-change.md](./playbooks/domain-spec-change.md) |

- **[standards/domain-spec-writing.md](./standards/domain-spec-writing.md)** — ドメイン仕様(`docs/specs/domain/`)の書き方。収録は4点で、5つの doc_type ぶんの YAML スキーマ、ガード式の文法、検証チェック V1〜V12 の範囲、そして DSL の外に置く情報との線引きである。
- **[playbooks/domain-spec-change.md](./playbooks/domain-spec-change.md)** — ドメイン仕様の追加・変更の標準手順。編集 → verify ループ → generate → 意味レビュー → 判断の記録 → コミット。人間が手で回すときの手順書であり、同時に **Skill が実行する台本**でもある(`.claude/skills/add-operation/SKILL.md` はこの手順を踏む)。

なお、`playbooks/` には `template.md` が無い。新規の playbook は上位の [process/template.md](../../template.md) で解決される。

## 参照するもの

| 知りたいこと | 正 |
|---|---|
| 仕様書をどこに・どういう構成で置くか | [architecture/specification/common](../../../architecture/specification/README.md)(ARCH-SP-xxxx。ドメイン仕様の構成は [ARCH-SP-0002](../../../architecture/specification/common/ARCH-SP-0002-domain-spec-structure.md)) |
| backend 固有の仕様(action_spec / query_spec)の書き方 | [process/backend/specification](../../backend/specification/README.md) |
| frontend 固有の仕様(screen_spec / chrome_spec)の書き方 | [process/frontend/specification](../../frontend/specification/README.md) |

「どこに置くか」と「どう書くか」を両方に書かない(PRIN-0007)。この枝から配置の話をするときは、上の表のリンク先へ送るだけにする。

## 整備方針

- **スタック横断で効く基準はここ、スコープ固有は backend / frontend へ振る。** 判断に迷ったら「Next.js でなくなっても同じことを言うか」を基準にする。言うならここ、言わないなら向こうである。
- 手順は**完了を判定できる形**で書く(PRIN-0006)。「レビューする」ではなく「`npm run verify` が通る」と書けるところまで具体化する。
- 文書を足すときは、それが宣言なのか手順なのかを先に決める。両方に見えるものは、宣言を standards に置き、手順側からそこへリンクする。
