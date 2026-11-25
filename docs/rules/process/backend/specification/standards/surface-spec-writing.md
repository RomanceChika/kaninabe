---
doc_type: process
scope: backend
id: PROC-BE-0018-surface-spec-writing
# 語 surface: 外から届く面、つまり SQL の公開面(外に出すスキーマのビューと関数)が作る公開範囲。<!-- term: surface -->
norms: [ARCH-BE-0016, ARCH-SP-BE-0001]
decisions: [ADR-0006, ADR-0012]
---

# surface_spec の書き方 — SQL の公開面 `surface` のうち、導けないものだけを宣言する

`surface` は、**Postgres の SQL の公開面** —— 外に出すスキーマ・そこに置く生成ビューと土台の関数・DB ロールへの grants —— が作る公開範囲、外から届く入口の全体のことである。

## 目的

外の口が読むのは `public` のテーブルではなく、**外に出すスキーマ**(`PlatformProfile.exposedSchema`。いまの後段は `api`)である。
ここに出ているものが「外から触れるもの」の全部であり、宣言していない表・列には外から届かない。

**`surface` の形はほとんど既存の宣言から決まりきっている。** だからこの仕様書が持つのは、決まって
いないもの —— 導出の元がどこにも無いもの —— だけである。

### この仕様書の責務は SQL の境界だけ

`surface_spec` が仕様にするのは **SQL の境界**(外に出すスキーマ・ビュー・土台の関数・DB ロールへの grants)だけである。
**API 層がその公開面をどう外に出すか**(認証主体の解決・API 側の権限)は仕様の外で、platform の後段の能力
(`PlatformProfile.surfaceExposure`)が受け持つ。後段が SQL の公開面を API として外へ出す能力を持たない構成では、
`surface` に依る検査・生成を**未対応**と報告する(黙って緑にしない。入力が阻害のときと同じ出し方で、理由は後段の宣言)。

## 参照するもの

- [surface_spec の実物](../../../../../specs/backend/surface.md) / [テンプレート](../../../../../specs/backend/template.surface_spec.md)
- [ARCH-BE-0016 読み取り経路](../../../../architecture/system/backend/ARCH-BE-0016-read-path.md)
- [ARCH-SP-BE-0001 §テーブル仕様](../../../../architecture/specification/backend/ARCH-SP-BE-0001-backend-spec-structure.md)(`surface_migration`)
- [migrations.md §生成 migration](../../system/standards/conventions/migrations.md)
- 導出の根拠: 下の「マスクの述語」の理由(設計の経緯は非公開の開発記録)

## ルール・基準

### 何がどこから決まるのか

| `surface` の要素 | 正 | 生成物か |
|---|---|---|
| どの表が `surface` に出るか | entity_spec と access_spec の両方を持つ集約 | 生成 |
| ビューの列と**並び** | entity_spec の `fields` の宣言順 | 生成 |
| 隠す列 | access_spec の `fields_hidden[].field` | 生成 |
| 隠し列を解く条件(`{公開スキーマ}.can_see_{表}_{列}`) | `fields_hidden[].from` の**外側**にいて、その行を読めるロール(`reads`)の述語の論理和 | 生成 |
| `security_invoker = true` / 権限 | 方式が決める(決める余地が無い) | 生成 |
| ビューの書き出し先 | **data_table の `surface_migration`** | 宣言 |
| 土台の書き出し先 | **surface_spec の `surface_base_migration`** | 宣言 |
| **表の権限**の書き出し先 | **surface_spec の `grants_migration`** | 宣言 |
| 生成物にできないビュー | **surface_spec の `hand_written_views`** | 宣言 |

**なぜ表の権限がここにあるのか。** `surface` の話ではない —— `public` の表の ACL である。ここに置いて
あるのは、`surface_base_migration` と**同じ種類の宣言**だからである: どちらも「アプリの表に属さない、
**系に 1 枚**の生成 migration の書き出し先」であり、中身に決める余地はファイル名しかない。
表ごとの data_table に置くと、どの表でも同じ 1 組を表の数だけ複製することになる
(設計の経緯は非公開の開発記録)。

マスクの述語が「**刈り込む前の**」select ポリシーの写しである理由: 行の select ポリシーは、同じ表を `scope: all` で読めるロールがいるとき、それに包含される `own` / `context` のポリシーを刈り込む(行の可視性としては正しい)が、**列のマスクはその刈り込みを使えない**。`fields_hidden.from: [member]` は「`member` として読んでいる人には見せない」であって、`member: scope: all` に包含されていた別ロールの根拠こそがマスクを解く鍵だからである。`reads[].filters`(テナント境界)も述語に入る —— 入れないと、別の根拠で行が見えている実行者に隣のテナントの隠し列が出る。

### `surface` の仕様(1 プロジェクト 1 枚)

```yaml
---
doc_type: surface_spec
scope: backend
id: surface                          # 固定(1 プロジェクト 1 枚)
surface_base_migration: 20260911000000_api_base.sql   # 任意
grants_migration: 20260912130200_grants.sql           # 表が 1 枚でもあれば必須
hand_written_views:
  - table: tutorial_docs
    reason: 内部テーブルで、entity_spec も仕組みの設計図も持たない（列の正がどこにも無い）
---
```

- **MUST**: `id` は `surface` 固定である(1 プロジェクト 1 枚なので導出元が無い)。置き場は `docs/specs/backend/surface.md`。
- **MUST**: `surface_base_migration` を**宣言する場合は**、名前が `{14 桁}_{公開スキーマ}_base.sql` で、連番が
  **公開スキーマに関数・ビューを作るどの生成 migration よりも前**であること(T12)。空の DB に順に
  当てるとき、スキーマがまだ無ければ `create or replace function {公開スキーマ}.…` はその場で落ちる。
  公開スキーマの名前は後段の設定(`exposedSchema`)から導く(いまの後段なら `api`)。
- **MUST**: 表を 1 枚でも持つ系では `grants_migration` を宣言する(**必須**。T12)。名前は
  `{14 桁}_grants.sql` で、**連番はどこでもよい**(表の DDL との前後関係を持たない。2026-09-26)
  —— `grant … on public.{表}` は表が在ってはじめて通るが、それは表ごとの**存在ガード**が持つ
  (番号で保証していたあいだ、表の DDL の再発行ごとにバイト同一の migration が 1 本増えた)。
  土台と違って「**宣言しない構成」は無い**: 後ろの番号は歴史のある DB でも
  必ず取れるので、宣言せずに済ませる道を開ければそれは免除リストである。宣言が無ければ誰も
  `revoke` / `grant` を出さず、**後段の既定権限(`truncate` を含む)のまま全部緑で成立する**。
- **MUST NOT**: `grants_migration` に「どの表を載せるか」を書かない。載るのは **data_table の
  全数**である —— 形の正が無い内部テーブルにも権限の正はある(仕組みの 1 組)ので、一覧から
  外せるようにすると、その表だけが ACL の閉世界から静かに落ちる。
- **MUST NOT**: ビューの一覧・列・隠し列を書かない。正は entity_spec と access_spec であり、
  書き写すと正が 2 つになる(一覧は `surface-views` マーカーに生成される)。
- **MUST**: `hand_written_views` に宣言できるのは `internal: true` の data_table だけである。
  **これは免除リストではない** —— ドメイン仕様に現れる表のビューは entity_spec から導けるので、
  逃がす理由が存在しない(T12 が error で止める)。
- **MUST NOT**: 同じ表が `hand_written_views` と `surface_migration` の**両方を宣言しない**。
  生成物にしたら宣言を外す —— 両方あると「手書きで残す」と「生成する」のどちらが正か
  読めない(T12 が error で止める)。
- **SHOULD**: `reason` には**いま生成物になっていない根拠**を書く。根拠は 1 つしかない ——
  **列の正がどこにも無い**(entity_spec も仕組みの設計図も持たない表)。**設計図を持つ内部
  テーブル**(`framework:` を宣言する表)は列が導けるので、`surface` に出すなら `surface_migration` を
  宣言して生成物にする(2026-09-23 に `api.jobs` がそうなった)。
- **MUST NOT**: 旧い綴り(種類名・`id`・土台の欄名・`product.md` の `uses` の値・置き場のファイル名に `api` を冠した形)を使わない。
  二重には受けず、読み込みが error で新しい綴りを名指す(書き直し先は上の `surface` の仕様の例のとおり)。

### 表の側(`surface_migration`)

`surface` に出る表は data_table で書き出し先を宣言する。

```yaml
surface_migration: 20260923000338_api_view_items.sql
```

- **MUST**: 名前は `{14 桁}_{公開スキーマ}_view_{テーブル名}.sql`(公開スキーマは `exposedSchema`)。全 migration 名を通して一意。
- **適用済みの migration は歴史的な識別子である(C23)。** 名前の規則は、置き場にあるかどうかに依らず**いつも**効く(適用済みかどうかを機械は推測しない —
  先に generate したファイルが「適用済み」扱いで規則を素通りするのを防ぐため)。食い違ったときは T12 が 2 つの場合を名指す: **新しい migration なら名前を直す** /
  **適用済みの migration で公開スキーマ(`exposedSchema`)を改名したのなら、適用済みの名前の付け替えの規則は無い(未対応)**。後者は実例が無いので規則を作っていない ——
  改名した製品が黙って緑にならないための線である。
- **MUST**: **ビューの SQL が変わる仕様変更では名前を新しくする**(列を足す / `fields_hidden` を
  動かす / `reads` を動かす)。適用済みの migration は書き換えない。生成 SQL は
  `drop view if exists` → `create view` なので、新しいファイルが同じ名前のビューを置き換える。
- **MUST**: 宣言できるのは**列の正がある表**だけである —— ①entity_spec と access_spec の両方を
  持つ表(列の正はドメイン仕様。この場合は**必須**)、②**`framework:` の設計図を持つ表**
  (列の正は `lib/sql/framework-tables.ts`。`api.jobs` がこれである)。②は**必須ではない** ——
  その表を `surface` に出すかどうかは仕様に現れない実装事情であり、「**出すなら生成物にする**」が線である。
  - **MUST NOT**: どちらでもない表(`tutorial_docs` のように entity_spec も設計図も持たない表)が
    宣言してはいけない —— 列を導く手がかりが無い。そこは surface_spec の `hand_written_views` で
    表と理由を宣言する(T12 が error で止める)。
  - ②のビューは**`surface` のロール(anon / authenticated)に何も与えない** —— `grant select` を 1 行も
    出さず、外の口からは完全に消える(生成器が `internal: true` の 1 ビットで分岐する。
    宛先の正は `lib/sql/api-acl.ts` が SQL と期待表の両方へ配る)。
- **MUST**: **隠し列を持つ表**では、連番を **RLS 補助関数(`{14 桁}_helper_…`)のどれよりも
  後**にする。`surface` のビューの migration は隠し列 1 つにつき述語関数
  `{公開スキーマ}.can_see_{表}_{列}` を作り、その `language sql` の本文は `public.is_{ロール}()` を呼ぶ ——
  **本文は作成時に解析される**ので、補助関数がまだ無い DB に当てるとその場で落ちる
  (T7 の「補助関数は全ポリシーより前」と同型の、番号でしか表せない前後関係である)。
  - **基表の `ddl_migration` とは比べなくてよい。** 表の DDL の連番は「SQL が変わったら
    採番し直す」規則で動くので、**表がいつ作られたかを表していない**(ポリシーの連番も現に
    全表の `ddl_migration` より小さい)。表の実在を保証しているのは歴史であって番号ではない。
  - **`policies_migration` とも比べなくてよい。** `surface` のビューはポリシーを 1 つも参照しない
    (`security_invoker = true` が効くのは実行時である)。要らない順序は規則にしない。

### いまの後段(Supabase / PostgREST)では

- 外に出すスキーマは `api`(`exposedSchema`)で、ロール(`anon` / `authenticated` / `service_role`)への GRANT がそのまま API の権限になる ——
  **SQL の公開面 = API の公開面**(`surfaceExposure: sql-is-api`)。外の口は PostgREST で、`public` のテーブルではなく `api` スキーマを読む。
- 土台の関数(`api.actor_id()` / `api.is_end_user()`)は、Supabase の認証関数(`auth.uid()` ほか)を呼び出し主体の解決に使う。
  綴りの正は後段の設定(`lib/targets/supabase/platform-profile.ts`)で、SQL の生成器は設定を引数で受ける。
- 後段が SQL の公開面を API として外へ出す能力を持たない構成(`surfaceExposure: unsupported`。権限が SQL の外 —— メタデータ等 —— にある API 層など)は
  まだ実装が無い。その構成を選ぶ日は、T12 の公開面の判定・土台 / ビューの migration の生成を**未対応**と報告する経路があるので、
  黙って緑にはならない。**表の権限の migration(`grants_migration`。表の剥奪・特権ロールへの付与・関数の実行権限の閉世界)は
  公開面の能力に依らず必須で、生成もする** —— 公開面を外へ出さない構成でも、DB に接続できる一般利用者のロールがある限り
  Postgres の既定(関数の実行権限は `PUBLIC` に開く・表の既定権限に `truncate` が入る)を閉じなければならない。
  能力が無い構成で外れるのは、公開面に依る関数(土台・隠し列の述語)を「呼べる側」に載せることだけである。

- **外へ出すスキーマの全数は `exposedSchema` の 1 つだけである(閉世界)。** 公開スキーマ以外のスキーマ(GraphQL の口など、使っていないもの)を
  データ API の公開に入れたままにすると、公開面の列の隠し・権限の閉世界を迂回する経路になりうる。ローカルの設定ファイルがその 1 つ以外を外へ出していれば
  **H5**(認証フロー仕様の群。サインインの方式の突合と同じ検査)が止める。**surface_spec にスキーマ名を書く欄は無い**(正は後段の設定の `exposedSchema` だけで、
  宣言が 2 つに割れない)。本番側の公開スキーマの設定は、ローカルの設定と運用で揃える([auth-spec-writing.md §`providers`](./auth-spec-writing.md))。

### 検査

| 検査 | 何を見るか |
|---|---|
| **T12** | 上の MUST の全部(名前の形・必須・一意・順序・手書きの宣言の範囲) |
| **H5** | ローカルの設定が外へ出すスキーマが `exposedSchema` だけであること(サインインの方式の突合と同じ検査。詳細は [auth-spec-writing.md](./auth-spec-writing.md)) |
| `generate:check` | 宣言から出ない生成ファイルが残っていないか(**余分エラー**)、宣言した名前のファイルが古くないか(**鮮度エラー**) |
| `api-parity`(統合テスト) | 実 DB の公開スキーマと生成物の**両方向**の突合 —— ビューの閉世界・列の閉世界・`security_invoker`・述語の実在・関数の閉世界・権限 |
| 列の見張りテスト(`hidden-columns-masked`) | マスクが**実際に効いている**こと(実際のロールで読んで確かめる) |

### よくある間違い

| 書きたくなる形 | なぜだめか | 代わりに |
|---|---|---|
| `hand_written_views` にドメインの表を足して急場をしのぐ | 免除リストである。列の正は entity_spec にあるので導ける | `surface_migration` を宣言して `generate` |
| 列を足したのに `surface_migration` の名前を据え置く | 適用済みの migration の書き換えになる(C23 が止める) | 連番を新しくする |
| ビューの一覧を仕様書に手で書く | 正が 2 つになる | `surface-views` マーカーに生成させる |
| 歴史のある DB で `surface_base_migration` を宣言する | 土台より前の連番がもう取れない | 宣言しない(土台は手書きの migration が持つ) |
| `exposedSchema` を改名する | 適用済みの migration の名前は動かせず、付け替えの規則も無い(T12 が未対応と赤にする) | 改名しない。要る日はその規則を先に設計する |

## 関連ドキュメント

- [domain-spec-writing.md §access_spec](../../../common/specification/standards/domain-spec-writing.md)(`fields_hidden` / `reads` の書き方)
- [guarantee-spec-writing.md](./guarantee-spec-writing.md)(列のマスクの見張りテストを持つ保証台帳)
- [migrations.md](../../system/standards/conventions/migrations.md)(生成 migration の採番の規約)
