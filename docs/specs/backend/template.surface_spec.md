---
doc_type: surface_spec
scope: backend
id: surface # 固定(1 プロジェクト 1 枚)

# 公開スキーマの土台(スキーマ・呼び出し主体を解決する関数 2 本・権限)の書き出し先。
# 任意。宣言しなければ土台は手書きの migration が持つ(歴史のあるリポジトリ)。
# 宣言する場合は連番を「公開スキーマに関数・ビューを作るどの生成 migration よりも前」にする(T12)。
# 名前の公開スキーマは後段の設定(exposedSchema)から導く(Supabase なら api)。
surface_base_migration: 20260911000000_api_base.sql

# 生成物にできず手書きのまま残すビュー。宣言できるのは internal: true の data_table だけである
# (列の正が仕様のどこにも無い表)。ドメイン仕様に現れる表はここへ逃がせない(T12)。
hand_written_views:
  - table: jobs
    reason: 内部テーブルで列の正が仕様に無い(面に出すのは特権の接続が直に読む経路のためだけ)
---

# SQL の公開面 `surface`(テンプレート)

<!-- このファイルは surface_spec のテンプレート。新しいアプリを起こすときに docs/specs/backend/surface.md
     へ写して埋める。verify / generate の対象からは template.* として外れる。 -->

## 書くもの・書かないもの

| ここに書く | ここに書かない(正は別にある) |
|---|---|
| 土台の書き出し先(`surface_base_migration`) | ビューの一覧・列・並び(entity_spec の `fields`) |
| 生成物にできないビュー(`hand_written_views`) | 隠し列とその条件(access_spec の `fields_hidden` / `reads`) |
| | ビューの書き出し先(表ごとの data_table の `surface_migration`) |

## `surface` に出るビュー

<!-- AUTO-GENERATED:surface-views -->
<!-- /AUTO-GENERATED:surface-views -->
