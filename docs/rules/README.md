---
doc_type: directory_guide
id: DG-0026
norms: []
decisions: [ADR-0005]
scope: repository
---

# docs/rules — ルールの体系

原則・アーキテクチャ・プロセス・意思決定を置くツリー。ここが `docs/rules` 全体の最上位の入口である。

**各ディレクトリの入口は `README.md` ひとつである。AI 用と人間用にファイルを分けない。** AI 向けのナビゲーション(その層の責務・他の層との関係・次に読む場所)は、別ファイルにせず README の中の「AI向けナビゲーション」節に置く。入口を一本化した判断の背景は [ADR-0005](./decisions/common/ADR-0005-single-entry-point.md) にある。

**ただし、日々の作業の第一の入口はここではない。** リポジトリ直下の `CLAUDE.md` のルーティング表が「やること」から必読の正典へ直接案内しており、実運用の導線はそちらを通る。この README を含む各層の README は、**その地図に載っていない場所を探すときの道案内層**として使う。参照をどう辿るかの詳細の正は [ai_reference_guide.md](./meta/standards/ai_reference_guide.md) が持つ。

## 階層

| カテゴリ | 内容 |
|---|---|
| [meta](./meta/README.md) | メタ情報。rules の構成・命名ルール・使い方(doc_type / 配置 / ID / 参照 / 変更) |
| [principles](./principles/README.md) | 原則(`PRIN-xxxx`)。憲法レベルの大原則 |
| [architecture](./architecture/README.md) | アーキテクチャ。`system`(実装の構造。`ARCH-xxxx`)/ `specification`(仕様の構造。`ARCH-SP-xxxx`)/ `tooling`(検証器・生成器)の 3 軸に分かれる |
| [process](./process/README.md) | プロセス。仕様執筆・検証・実装手順に加えて、ツール(tooling)と AI 実行の共通ガイドラインを持つ |
| [decisions](./decisions/README.md) | 意思決定・ADR |

この表は各層の**索引**であり、内容の正はそれぞれの README にある(同じ説明をここに書き写さない。[PRIN-0007](./principles/common/PRIN-0007-single-source-of-truth.md) の例外に乗る形である)。

**スコープ別(`common/` `backend/` `frontend/`)に管理する**のがこのツリーの方針である。ただし**スコープと機能軸のどちらを外側にするかはカテゴリごとに違う**ので、階層の形が一様だと思って探さないこと。

| カテゴリ | 実際の形 |
|---|---|
| principles / decisions | 直下に `common/` `backend/` `frontend/` |
| architecture | `system/` `specification/` `tooling/` の下にスコープ |
| process | スコープの下に `specification/` `system/` `tooling/` |
| meta | `standards/` `playbooks/`(スコープで割らない) |

整備は common を先に進めてきたが、**現在は backend と frontend が並走している**(frontend は画面仕様・デザイントークン仕様とそれらの検査まで整っている)。

**ドメイン知識層(W)はこのツリーに無い。** 業務知識(用語・不変条件の意味・業務例・設計文脈)はプロジェクトが所有するものであり、住所は `docs/specs/` の隣である(`BACKLOG.md` の「ドメイン知識層の住所決め」)。`docs/rules` は規範だけを持つ。

## AI向けナビゲーション

**CLAUDE.md のルーティング表に載っていない場所を探すときに使う**(第一の入口は CLAUDE.md であり、ここはその地図の外を探すときの道案内層。上の「ただし、日々の作業の第一の入口はここではない」を参照)。目的から入る。

1. **ルールの書き方(doc_type / 配置 / ID / 参照 / テンプレート)を知りたい** → [meta](./meta/README.md)(README 内の「AI向けナビゲーション」節)
2. **大原則(`PRIN-xxxx`)を確認・引用したい** → [principles](./principles/README.md)
3. **実装の構造・仕様の構造・検証器/生成器のルールを探したい** → [architecture](./architecture/README.md)(README 内の「AI向けナビゲーション」節)
4. **仕様の書き方・検証手順・実装規約を探したい** → [process](./process/README.md)
5. **過去の決定(ADR)の経緯を遡りたい** → [decisions](./decisions/README.md)(README 内の「AI向けナビゲーション」節)

各層の README がさらに一段深いナビゲーションを持つので、ここで見つからなければ次はそちらへ辿る。
