---
doc_type: process
scope: common
norms: [PRIN-0001]
decisions: [ADR-0001]
---

# 例の手順(fixture)

## 目的

リンクとテンプレート解決の走査を実証するための文書。

- 相対リンク: [PRIN-0001](../principles/PRIN-0001-example.md)
- 見出しのアンカー付きリンク: [背景](../principles/PRIN-0001-example.md#背景)
- ディレクトリへのリンク: [原則](../principles/)
- サイトルート相対: [入口](/rules/README.md)
- 外部リンク: [Anthropic](https://www.anthropic.com/)
- ページ内リンク: [目的](#目的)

## 手順

<!-- AUTO-GENERATED:sample -->
生成ブロックの中は手で直せないので、リンク切れ [壊れたリンク](./generated-missing.md) は検査しない。
<!-- /AUTO-GENERATED:sample -->

コードブロックの中も検査しない:

```markdown
[コード内の壊れたリンク](./in-code-missing.md)
## コード内の見出し
```

<!-- コメント内の [壊れたリンク](./in-comment-missing.md) も検査しない -->
