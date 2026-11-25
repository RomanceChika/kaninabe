---
doc_type: design_token_spec
scope: frontend
id: design-tokens

theme: reading_room

palette:
  paper: '#fbf9f4'
  ink: '#1f1b16'
  oak: '#7a5230'
  moss: '#3f6b4a'
  clay: '#a33b2a'

groups:
  - group: color
    purpose: 地と文字と、貸出の状態を示す 3 色
    tokens:
      - name: color-surface
        ref: paper
        note: 画面の地
      - name: color-text
        ref: ink
        note: 本文
      - name: color-accent
        ref: oak
        note: 見出し・リンク
      - name: color-ok
        ref: moss
        note: 在架・返却済み
      - name: color-alert
        ref: clay
        note: 延滞・紛失
  - group: space
    purpose: 余白の刻み
    tokens:
      - name: space-row
        value: 8px
      - name: space-block
        value: 24px
  - group: radius
    purpose: 角の丸み
    tokens:
      - name: radius-card
        value: 6px

contrast:
  - fg: color-text
    bg: color-surface
    min: 4.5
  - fg: color-accent
    bg: color-surface
    min: 4.5
  - fg: color-ok
    bg: color-surface
    min: 4.5
  - fg: color-alert
    bg: color-surface
    min: 4.5

brand:
  icon: app/src/app/icon.png          # アプリのアイコン(Next の Metadata Files 規約)
---

# デザイントークン（reading_room）

閲覧室の紙と木の色で組む。状態の色は在架/延滞の 2 つだけに絞る。

## トーン

| 要素 | 決めたこと | なぜ |
|------|-----------|------|
| アクセント | 樫色 | 書架の木の色。紙の地から浮かず、リンクだと分かる |
| 地 | 生成り | 白すぎる地は長時間の閲覧で疲れる |
| 文字 | 墨 | 純黒より紙になじむ |

<!-- AUTO-GENERATED:token-tables -->
### トークン一覧

| トークン | グループ | 値（ref の解決後） | ref（palette） | 用途 |
| --- | --- | --- | --- | --- |
| `--color-surface` | color | #fbf9f4 | paper | 画面の地 |
| `--color-text` | color | #1f1b16 | ink | 本文 |
| `--color-accent` | color | #7a5230 | oak | 見出し・リンク |
| `--color-ok` | color | #3f6b4a | moss | 在架・返却済み |
| `--color-alert` | color | #a33b2a | clay | 延滞・紛失 |
| `--space-row` | space | 8px | — | — |
| `--space-block` | space | 24px | — | — |
| `--radius-card` | radius | 6px | — | — |

### コントラスト検査（contrast）

| 前景（fg） | 背景（bg） | 要求比 | 実比 |
| --- | --- | --- | --- |
| color-text | color-surface | 4.5:1 | 16.27:1 |
| color-accent | color-surface | 4.5:1 | 6.49:1 |
| color-ok | color-surface | 4.5:1 | 5.85:1 |
| color-alert | color-surface | 4.5:1 | 6.21:1 |
<!-- /AUTO-GENERATED:token-tables -->
