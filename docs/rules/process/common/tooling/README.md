---
doc_type: directory_guide
id: DG-0028
norms: []
scope: common
---

# tooling — 開発ツールそのもののルール・手順・使い方

検証器・生成器・静的解析といった、**開発を支える側のツール**についての品質基準・拡張手順・利用ガイドを置く箱である。仕様のルール(specification)でもプロダクトコードのルール(system)でもない、第三の対象を扱う。

このリポジトリで実際に対象になるのは `legacy/spec-tools/` 配下のツール群である。仕様を読んで意味を検証する検査器(V 群・A 群・Q 群・T 群・N 群・J 群・K 群・S 群・M 群・G 群・U 群)と、仕様から文書と実装部品を作る生成器がここに入る。使う側の入口はルートで叩く `npm run verify` / `npm run generate` / `npm run generate:check` であり、コマンドの一覧は CLAUDE.md の「コマンド」節にある。

## サブディレクトリ

| パス | 内容 | 現況 |
|---|---|---|
| [standards/](./standards/README.md) | ツールコードの品質基準・規約 | [scripts-code-quality.md](./standards/scripts-code-quality.md) 1本 + [template.md](./standards/template.md) |
| [playbooks/](./playbooks/README.md) | ツールの拡張・変更手順(検査器を1本足す、など) | （未整備） [template.md](./playbooks/template.md) のみ |
| [guides/](./guides/README.md) | ツールの使い方・機能一覧 | （未整備） [template.md](./guides/template.md) のみ |

3箱そろってテンプレートを持つ枝はここだけである。空の箱でも README とテンプレートを残してあるのは、書き始めるときに型を探さなくて済むようにするためで、中身が無いことは各箱の README が明示している。

## 配置の判断基準

分ける軸は**品質 / 拡張 / 使い方**の3つである。ツールについて何かを書きたくなったら、次の分岐で置き場を決める。

| 書きたいこと | 置き場 |
|---|---|
| ツールコードの**品質をどう保つか** | `standards/` |
| ツールを**どう拡張・変更するか** | `playbooks/` |
| ツールを**どう使うか** | `guides/` |
| 仕様書をどう書くか | [specification/](../specification/README.md) の範囲(ここではない) |
| プロダクトコードをどう書くか | [system/](../../backend/system/README.md) の範囲(ここではない) |

下2行が効く場面は多い。検査器の実装の話とプロダクトコードの実装の話は語り口が似ているので、対象が `legacy/spec-tools/` なのか `app/` なのかで機械的に振り分ける。ツールの設計そのもの(どんなツールを持つか)は [architecture/tooling](../../../architecture/tooling/README.md) の範囲である。

## スコープ

**ディレクトリは共通、スコープは各文書のフロントマターで区別する。** ツールが backend 向けのものであっても frontend 向けのものであっても、ディレクトリは分けない。`scope: common` / `scope: backend` / `scope: frontend` を文書側で宣言する。

これは backend / frontend でディレクトリを割る他の枝とは**逆の方針**である。理由は、ツールが対象にするのは仕様と文書とコードの全部で、1本のツールが複数スコープにまたがるのが普通だからである。たとえば `npm run verify` はドメイン仕様(common)も action_spec(backend)も screen_spec(frontend)も同時に見る。これをディレクトリで割ると、ツール1本の話が3か所に散る。
