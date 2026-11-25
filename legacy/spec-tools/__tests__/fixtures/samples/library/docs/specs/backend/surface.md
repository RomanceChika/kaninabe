---
doc_type: surface_spec
scope: backend
id: surface

# 公開スキーマの土台(スキーマ・呼び出し主体を解決する関数 2 本とセッションの生死の関数 1 本・権限)。中身はどのアプリでも同じ。
# 連番は公開スキーマに関数・ビューを作るどの生成 migration よりも前(空の DB に順に当てて通る番号。T12)
surface_base_migration: 20260911080000_api_base.sql

# 表の権限(特権ロールの 1 組と、ポリシーを持たない表の `surface` のロールの剥奪)。系に 1 本。
# 連番と表の DDL の前後関係は無い(表ごとの権限は to_regclass の存在ガードの中に出る)
grants_migration: 20260912130200_grants.sql
---

# SQL の公開面 `surface`

外の口が読むのは `public` の表ではなく公開スキーマ(`api`)である。ビューの列は entity_spec、
隠し列は access_spec の `fields_hidden` が正であり、ここには**導けないものだけ**を書く。

## `surface` に出るビュー

<!-- AUTO-GENERATED:surface-views -->
<!-- /AUTO-GENERATED:surface-views -->
