---
doc_type: process
scope: backend
# norms: [ARCH-BE-xxxx]  ← 従う規範（architecture の id）を列挙。frontmatter_policy に従う。
# decisions: []          ← 基づく意思決定（ADR の id）があれば列挙。
# sources: []            ← 正とする出典の id があれば列挙。
---

<!--
layers 配下に層のルール文書を新規作成するときの雛形。

H2 は 8 節・通し番号付きで固定する。層によって中身が変わっても見出しは動かさない。
層を横断して同じ順路で読めることが、この固定の目的である。

7. Testing Rules の番号は conventions/testing/template.md の「7. Testing Rules」と
対応させてある。番号を動かすと相互参照が壊れる。

-->

# {Layer名}層（{責務名}）

## 1. Overview

{この文書が規約（Standards）であること、適用範囲を 1〜3 行で書く。責務と構成の詳細は architecture を参照させる。}

## 2. Scope

{この層（または責務）が含む要素と含まない要素を箇条書きで書く。概念の説明はここでしない。曖昧なものは architecture へリンクする。}

## 3. Directory Structure

{どこに何を書くか。ディレクトリの配置ルールを断定で書く。}

## 4. Public API & Naming

{公開する型・関数・インターフェースの命名とファイル名の規約。カテゴリが複数ある場合はサブセクションで分けてよい。}

## 5. Constraints

{禁止事項、依存方向、やってはいけないこと。}

## 6. Interaction Rules

{他の層との接点のルール。入力と出力、DTO の変換、エラーの境界、呼び出し方。層によって中身は変わるが、見出しは固定する。}

## 7. Testing Rules

{この層のテスト責務、テストの粒度、モック方針（コード生成の方針を含む）。断定だけを書く。手順は playbooks に書き、詳細な例は省略するかリンクにする。}

## 8. Minimal Example

{代表となる短い例を 1 つだけ置く。説明は付けない。パターンが複数あるときは 1 つに絞り、残りは別の文書へリンクする。}
