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
**`surface` に出るビュー**(entity_spec と access_spec の両方を持つ表)。`surface` のロール(`anon` / `authenticated`)が `select` で読み、隠し列は述語が解けたときだけ値を返す。

| 表(= ビュー名) | 集約 | 列数 | 隠し列 | 書き出し先 |
| --- | --- | --- | --- | --- |
| `holds` | hold | 5 | note | `20260912130101_api_view_holds.sql` |
| `items` | item | 6 | — | `20260912130102_api_view_items.sql` |
| `loans` | loan | 5 | — | `20260912130103_api_view_loans.sql` |
| `patrons` | patron | 5 | card_number | `20260912130104_api_view_patrons.sql` |
<!-- /AUTO-GENERATED:surface-views -->
