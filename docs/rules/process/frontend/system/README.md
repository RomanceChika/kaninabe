---
doc_type: directory_guide
id: DG-FE-0010
norms: []
scope: frontend
---

# process / frontend / system

フロントエンドの**コードを書くため**のルールと手順の入口。置くのは 2 種で、コードを書くうえでの決まりを定める **standards**(ルール・基準)と、その決まりに沿って作業を進める段取りを書く **playbooks**(手順)である。architecture の system に対応する。

仕様書そのもののルール——画面仕様の構造・命名・配置・テスト追跡——はここではなく [specification/](../specification/README.md) にある。**system はコードの話、specification は仕様書の話**という分業を崩さない。

## 配下の構成

| パス | 内容 |
|------|------|
| [standards/](./standards/README.md) | コードを書くうえでのルール・基準。実体は [conventions/](./standards/conventions/README.md) の 1 箱 |
| [standards/conventions/](./standards/conventions/README.md) | テスト・スタイル・命名等のコード規約。現在は [screen-test.md](./standards/conventions/screen-test.md)(画面テスト)と [styling.md](./standards/conventions/styling.md)(デザイントークンと部品のスタイル) |
| playbooks/ | 実装手順・レビュー・品質チェックの手順書の置き場。現在は[型紙](./playbooks/template.md)のみで、実文書はまだ無い |

手順に相当するものの実運用は `.claude/skills/add-screen/SKILL.md`(画面を 1 枚足す)に置いてある。**スキルは手順の索引であって正典ではなく**、内容の正は上の standards 側にある。両者が食い違ったら standards が正である。

## 参照するもの

- **構成** — [architecture/system/frontend/](../../../architecture/system/frontend/README.md)。現在は README のみで、フロントエンドの構成を定める ARCH は未整備である
- **仕様書のルール** — [process/frontend/specification/](../specification/README.md)(仕様書の構造・命名・配置・トレーサビリティ)
- **画面仕様の書き方** — [screen-spec-writing.md](../specification/standards/screen-spec-writing.md)。コードが実装するのはここで宣言された構造と配線である
