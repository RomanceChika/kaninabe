---
doc_type: directory_guide
id: DG-0029
norms: []
scope: common
---

# architecture/tooling — ツールコードの構造

この階層が担当するのは、仕様書の検証・生成・静的解析といった**開発を支えるツール群**の、コードレベルの設計方針である。

**tooling は system でも specification でもない第 3 の分類である。** プロダクトコードの構造(system)でもなく、仕様書の構成(specification)でもない。ツールは仕様書を入力に取りプロダクトの部品を出力する位置にいて、どちらの依存グラフにも属さない。この分類が消えると、検証器と生成器の設計がプロダクトコードの規約に紛れ込む。

3 分類全体の位置づけは [architecture/README.md](../README.md) を参照。

---

## サブディレクトリ

| パス | 内容 |
|---|---|
| [common/](./common/README.md) | スコープ横断のツール設計(`legacy/spec-tools` など) |

tooling はスコープ(backend / frontend)に展開しない。ツールはスコープをまたいで 1 組しか無いためである。
