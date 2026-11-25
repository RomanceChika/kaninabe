---
doc_type: directory_guide
id: DG-0008
norms: []
scope: common
---

# process/common — スコープに閉じないプロセスの入口

backend にも frontend にも属さないプロセス文書の置き場である。**仕様をどう書くか**(specification)と**開発を支えるツールをどう扱うか**(tooling)の2本立てで、そこに全 Skill・playbook が共通で踏む実行ガイドラインが加わる。

## サブディレクトリ

| パス | 内容 |
|---|---|
| [ai_execution_guidelines.md](./ai_execution_guidelines.md) | 全 Skill・playbook 実行時の共通ガイドライン。個別の手順書に先立って読む |
| [specification/](./specification/README.md) | スコープに閉じない仕様の standards(基準)と playbooks(手順)。ドメイン仕様(`docs/specs/domain/`)の書き方の置き場 |
| [tooling/](./tooling/README.md) | 開発ツール(検証器・生成器・静的解析)の品質基準・拡張手順・利用ガイドの置き場。内訳は standards / playbooks / guides の3箱 |

### この枝でいちばん使われる2本

この README は経路の索引であって、実務の入口は CLAUDE.md のルーティング表である。そこから名指しされる正典のうち、この枝にあるのは次の2本になる。

- [specification/playbooks/domain-spec-change.md](./specification/playbooks/domain-spec-change.md) — 「ドメイン仕様の追加・変更」の必読正典。ルーティング表の第一エントリであり、Skill `add-operation` が実際に踏む台本でもある。
- [specification/standards/domain-spec-writing.md](./specification/standards/domain-spec-writing.md) — その書き方の正。スキーマ・ガード式の文法・検証の範囲を宣言している。

`legacy/spec-tools/` のコードを書くときは [tooling/standards/scripts-code-quality.md](./tooling/standards/scripts-code-quality.md) が正である。

### ここに置かないもの

- **配置ルール(どこに何を置くか)はここではない。** その正は [architecture/specification](../../architecture/specification/README.md) にある。ここに書くのは、決まった置き場に対して**どう書くか・どう手を動かすか**だけである。同じことを2か所に書くと、片方が古びたときにどちらが正か分からなくなる。
- **スコープ固有のプロセスもここではない。** backend に閉じるものは [process/backend](../backend/README.md)、frontend に閉じるものは [process/frontend](../frontend/README.md) へ振る。ここに置いてよいのは、スタックが変わっても意味が変わらない決まりに限る。

### 整備方針

**必要になった文書から追加してよい。** 全部を先に埋めない。使われる当てのない箱を先に並べると、空であること自体が「まだ決まっていない」のか「決める必要がなかった」のかを見分けられなくなる。文書を足すときのテンプレートは各サブディレクトリの `template.md`(無い階層では上位の [process/template.md](../template.md))に従う。
