---
doc_type: process
scope: backend
norms: [PRIN-0001, PRIN-0007, PRIN-0009, PRIN-0010, ARCH-BE-0001, ARCH-BE-0013, ARCH-BE-0015]
---

# DB 側の防衛線

**コードにバグがあっても守られる層**。`supabase/migrations/` の GRANT・RLS・制約・トリガーを「執行者」として扱い、何が保証されているかを書く。対応表の **D1〜D17** の詳細。

## 目的・スコープ

- **目的:** アプリ（第一防衛線）を迂回されても、仕様外のことが起きないことを DB で保証する（PRIN-0009）。
- **スコープ:** `supabase/migrations/` 配下の DDL のうち、**制約として機能するもの**（GRANT / RLS ポリシー / CHECK / ユニークインデックス / トリガー / 関数の実行権限）。テーブルの列定義そのものは仕様（`docs/specs/domain/{aggregate}/entity.md`）が正であり、**その DDL は生成物である**（data_table の `ddl_migration`。列・型・NOT NULL・主キー・導出 CHECK・既定値・`comment on` を `npm run generate` が書き出し、統合テスト `ddl-parity` が実 DB と**両方向**で突き合わせる）。したがって本文書が扱うのは「何を執行者として置くか」であって、列定義の字面ではない。**仕組みが自分で持つ 2 表**（`jobs` / `domain_events`）も同じく生成物であり、そちらの列の正は entity_spec ではなく仕組みの設計図（`legacy/spec-tools/lib/sql/framework-tables.ts`）にある（`framework:` が名指す。`domain_events.entity` の値域だけがドメイン仕様の集約の全数から出る）。
- **正の所在:** `docs/specs/domain/{patron,item,loan}/access.md`（reads / writes）、`docs/specs/domain/roles.md`（ロール束縛）、`docs/specs/domain/{aggregate}/invariants.md`（不変条件）。**DDL はその執行者であって定義ではない。**

## 前提となる考え方

### 二段の防衛線

| | 第一防衛線 | 第二防衛線（本文書） |
|---|---|---|
| どこ | `src/operation`（ロール解決 + `domain/engine` への遷移可否の照会） | DB（GRANT / RLS / 制約 / トリガー） |
| 何を守る | 仕様どおりの操作だけが起きること。**理由の説明**（`ActionError` の 3 分類） | 仕様外の状態が**保存されない**こと |
| 破れる条件 | 実装のバグ、経路の追加漏れ、アプリの迂回 | （DDL 自体が仕様とズレていないかぎり破れない） |
| 表現力 | 高い（列ごとの条件差・遷移の理由を扱える） | 低い（値域・関係・一意性・件数まで。**「誰が書いてよいか」は扱わない**） |

**第二防衛線はエラーメッセージを返す場所ではない。** ユーザーに理由を返すのは第一防衛線の仕事（ARCH-BE-0013 の `ActionError`）であり、DB が拒否した時点でそれはアプリのバグである。

## ルール

### 権限は「全部落としてから付け直す」。付け直すのは読み取りだけ（D1 / D2）

- **すべきこと:** テーブルを作ったら、まず `revoke all ... from anon, authenticated` で既定権限を落とす。そのうえで **`access_spec` の `reads` に対応する `select` だけ**を `grant` する。
- **なぜ:** Supabase の既定では `public` スキーマの新規テーブルに `anon` / `authenticated` への全権限が付く。**既定に頼ると、テーブルを 1 つ増やすたびに穴が開く**（PRIN-0009 / PRIN-0010）。
- **してはいけないこと:** `insert` / `update` / `delete` を `anon` / `authenticated` に与える（**列単位の `grant update (col, …)` も含む**）。**書き込みのユーザー直接経路は存在しない**というのが体系の断言であり、全書き込みは `security definer` の RPC（`service_role`）を通る。
- **なぜ書き込みを DB に写さないのか（Phase C-6 第 3 波の決定。`20260819000016_revoke_direct_update.sql`）:** かつては `writes` を「列 GRANT + 状態条件つき UPDATE ポリシー」として第二防衛線に写していた。それは実際にはアプリを通らない書き込み口（PostgREST 直叩き）を開いており、次の 2 つが成り立っていなかった。
  1. **全書き込みが監査ログに残る** — `domain_events` への追記は RPC の中にしかない。
  2. **`writes` の意味どおりに書ける列が決まる** — 列 GRANT はポリシー単位に分けられないため「`requested` のときは `note` だけ」を表現できず、許可列の**和集合**が開く（提出済みの貸出の予約を直接書き換えられる状態だった）。
- **したがって RLS に残る役割は「読み取りの上界」である**（ARCH-BE-0016）。`writes` の可否そのものは第一防衛線（`canWrite`）だけが判断する（D5 / D6 は**執行しない**）。

### RLS は有効化とポリシー不在の両方を使う（D3 / D4）

- **すべきこと:** 対象テーブルすべてで `enable row level security` する。
- **`scope: none` は「ポリシーを書かない」で表現する。** `loans` に patron / anonymous 向けのポリシーを作らないこと、`jobs` にポリシーを 1 つも作らないことが、そのまま「全件不可視」を意味する。
- **注意:** RLS を有効化していないテーブルではポリシーを書いても効かない。有効化そのものが執行対象である。

### 更新ポリシーは書かない（D5 / D6 — 執行しない）

- **すべきこと:** 「誰が・いつ・どの列を更新してよいか」は DB に写さない。判断点はエンジンの照会（`canWrite` / `canFire`）1 つだけである。
- **してはいけないこと:** `for update` のポリシーを新設する。GRANT が無ければ効かないため、書けば**「効いているように読める死んだ規則」**が増える（次に読む人が「ここが守っている」と誤読する）。
- **判断と書き込みの間の競合**は、ポリシーではなく RPC の条件（`where ... and state = p_expected_state`）が受け持つ（D14 / D18）。
- **履歴:** Phase C-6 第 3 波（`20260819000016_revoke_direct_update.sql`）まで、`loans` / `items` / `patrons` / `holds` には状態条件つきの UPDATE ポリシー 5 本があった。上の D1 / D2 の理由で GRANT ごと撤去し、ポリシーも drop してある。**「`using` と `with check` の両方に条件を書く」という当時の規則は、UPDATE ポリシーが存在しない現在は適用対象を持たない。**

### 不変条件は宣言的制約を第一候補にする（D10〜D12）

| 不変条件 | DB での表現 | なぜその手段か |
|---|---|---|
| INV-ITEM-101（冊数 `copies` は 1 以上） | CHECK 制約 `items_copies_positive` | 単一行で閉じるため CHECK で書ける |
| INV-LOAN-001（アクティブ重複禁止） | 部分ユニークインデックス `loans_active_unique` | 重複は同時実行で生まれる。アプリの事前確認では原理的に防げない |
| INV-ITEM-102（貸出中の数が `copies` を超えない） | トリガー `check_loan_capacity` | **件数制約は宣言的制約で書けない**ため。蔵書行を `for update` でロックしてから数え、同時実行を直列化する |

- **すべきこと:** 制約・インデックス・関数には `comment on` で不変条件 ID（`INV-LOAN-001` 等）を残す。仕様との対応が DDL 単体で辿れるようにする（PRIN-0008）。**生成 DDL の範囲ではこれは自動である** —— `checks[].invariant` / `exclusions[].invariant` を宣言した制約には `comment on constraint` が、列には entity_spec の `description` を写した `comment on column` が出る。**`invariant` だけを宣言する CHECK（条件式の正が invariant_spec にあり、制約そのものは手書きの migration が作る）にも付く** —— その場合は生成 DDL が制約の存在を確かめてからコメントだけを付ける。実 DB との一致は `ddl-parity` が突き合わせる（宣言に `invariant` があるのにコメントが無い制約は赤になる。2026-09 時点で手書きの執行点に 2 件あった）。トリガー・関数のコメントは引き続き手で残す。
- **してはいけないこと:** アプリ側で数えて足りているように見えたからトリガーを省く。並行実行下では成立しない。

### `security definer` 関数は実行主体を絞る（D16 / D17）

- **すべきこと:** `security definer` の関数は `revoke all on function ... from public` してから、必要なロールにだけ `grant execute` する。`set search_path` を固定する。
- **なぜ:** `security definer` は RLS を越える。呼べる主体を絞らないと、RLS を書いた意味がなくなる（PRIN-0010）。

## コード例

### この例が示すルール: 既定権限を落とし、読み取りだけを付け直す（D1 / D2）

✅ 正しい

```sql
revoke all on public.loans from anon, authenticated;

alter table public.loans enable row level security;

-- access_spec の reads に対応する select だけ。書き込みは 1 つも付けない
grant select on public.loans to authenticated;
grant select, insert, update, delete on public.loans to service_role;

create policy loans_select_patron_own on public.loans
    for select to authenticated
    using (patron_id = (select auth.uid()));
```

❌ 間違い（その 1）— `revoke` が無い

```sql
alter table public.loans enable row level security;

create policy loans_select_patron_own on public.loans
    for select to authenticated
    using (patron_id = (select auth.uid()));
```

Supabase の既定権限（全列への `update`、`insert`、`delete`）が残る。ポリシーは「どの行か」しか縛らないので、**`state` 列を直接書き換える UPDATE が通る**。これは lint では検出されず、統合テスト（`npm run test:integration`）の RLS テストでのみ検出できる。

❌ 間違い（その 2）— `writes` を DB に写そうとする

```sql
-- access_spec の writes をここに写してはならない
grant update (title, note) on public.loans to authenticated;

create policy loans_update_patron_requested on public.loans
    for update to authenticated
    using (patron_id = (select auth.uid()) and state = 'requested')
    with check (patron_id = (select auth.uid()) and state = 'requested');
```

**これは Phase C-6 第 3 波より前の形であり、現在は禁止である**（`20260819000016_revoke_direct_update.sql` で GRANT ごと撤去した）。第二防衛線のつもりでも、実際にはアプリを通らない書き込み口を開いている。列 GRANT はポリシー単位に分けられないため、`writes` の状態差（「`requested` のときは `note` だけ」）は表現できず**許可列の和集合**が開く。そして何より、この経路を通った書き込みは `domain_events` に 1 行も残らない。

**ポイント:** RLS ポリシーを書いたことと、権限を絞ったことは別である。そして**書き込みについては「絞る」ではなく「与えない」**が答えである。

### この例が示すルール: 件数制約はロックしてから数える（D12）

✅ 正しい

```sql
-- 数える前に蔵書行をロックして、同一蔵書への同時貸出を直列化する
select copies into v_copies
from public.items
where id = new.item_id
for update;

select count(*) into v_active_count
from public.loans
where item_id = new.item_id
  and state in ('requested', 'checked_out')
  and id <> new.id;

if v_active_count + 1 > v_copies then
    raise exception '…' using errcode = 'check_violation', constraint = 'check_loan_capacity';
end if;
```

❌ 間違い

```sql
-- ロックを取らずに数えている
select count(*) into v_active_count from public.loans where item_id = new.item_id and state in ('requested', 'checked_out');
if v_active_count >= (select copies from public.items where id = new.item_id) then
    raise exception '…';
end if;
```

`for update` が無いと、2 つのトランザクションが同時に「あと 1 冊ある」と読んで両方が通る。**テストでは再現しにくく、本番で貸出可能冊数を超える。**

### この例が示すルール: 判断と書き込みの間の競合を検出可能にする（D14）

✅ 正しい

```sql
update public.loans
set state = p_next_state
where id = p_loan_id
  and state = p_expected_state   -- 判断時の状態を条件に含める
returning * into v_loan;

if not found then
    return;  -- 0 行 = 競合。呼び出し側に伝える
end if;
```

❌ 間違い

```sql
update public.loans set state = p_next_state where id = p_loan_id;
```

`expected_state` を条件に含めないと、TS 側で遷移可否を判断してから書き込むまでの間に他者が状態を動かしていても、**静かに上書きする**。仕様上ありえない遷移（`accepted` → `submitted` 等）が成立してしまう。

## 執行できていないこと（既知の限界）

**リンターと違い、DB 側には「表現できないから第一防衛線に委ねている」ものがある。** 迂回された場合に守られない範囲を明示しておく。

| 仕様 | DB での状態 | 委ねている先 |
|---|---|---|
| `writes` の可否そのもの（誰が・いつ・どの列を） | **執行しない**（設計）。かつては列 GRANT + 状態条件つき UPDATE ポリシーとして写していたが、①その経路では監査ログが残らず、②列 GRANT はポリシー単位に分けられないため「`requested` のときは `note` だけ」を表現できず**許可列の和集合**が開いていた。Phase C-6 第 3 波で**ユーザーの UPDATE 権限ごと撤去**した（`20260819000016`） | 第一防衛線（`src/operation` → `canWrite`）。DB 側は「誰も直接書けない」だけを言う |
| 遷移可否そのもの（ガード式・ロール判定） | **執行している**（束 ⑳-3）。定型 5 形の RPC の本文が `by` とガードと期待状態を述語として持ち、`UC403` / `UC412` / `UC409` で理由を返す。0 行の理由を分類する順は engine と同じ **状態 → ロール → ガード**で、**順の正は engine（`canFire` / `canCreate`）であり SQL はその写し**である（ADR-0012 ⑤。server-actions.md §RPC が `by` とガードを守る） | `src/domain/engine` の照会は**先読み**（人に読める理由を先に返す役。権威は DB 側）。`handwritten` / `composite` と宣言された RPC はこの執行の範囲外で、そこは先読みだけが守る（範囲は保証 `rpc_enforces_spec` の summary が示す） |
| `insert` / `update` / `delete` の権限 | `anon` / `authenticated` には 1 つも付けていない。**書き込みのユーザー直接経路は存在しない**（全書き込みが `service_role` の RPC = 監査ログ付きの経路を通る） | — |
| 書き込み RPC が触る列と `writes` の一致 | 編集 RPC は宣言外の列を**例外**にする（D18）。ただし「宣言された列を RPC が書き忘れていないか」は見ていない | レビュー・統合テスト |

## 注意点・例外

- **`service_role` は RLS をバイパスする。** Server Action / ワーカーはこのロールで動くため、**権限判定はアプリ側の責務**である。DDL では「どのテーブルに触れてよいか」だけを明示的に宣言している（既定に頼らない）。
- **`is_patron()` が `security definer` なのは再帰回避のため。** `patrons` の SELECT ポリシー内から `patrons` を引くと無限再帰する。所有者（postgres）は自テーブルの RLS を適用されないため、関数に逃がしている。`set search_path = public` の固定は必須。
- **`jobs` はドメイン仕様に現れない内部テーブル。** `access_spec` の対象外であり、`service_role` 専用として扱う。ポリシーを 1 つも作らないことで `anon` / `authenticated` から不可視になる。列と CHECK の正は仕組みの設計図にあり、`ddl_migration` が生成 DDL を出す（RLS の有効化もそこに含まれる）。
- **DB 側の保証は統合テストでのみ検証できる。** `npm run test:integration`（`app/`）がローカル Supabase の実 DB に対して実行される。ユニットテストからは触れない（[testing/integration.md](../testing/integration.md)）。
- **マイグレーションを変える変更は、対応する仕様（`entity.md` / `access.md` / `invariants.md`）とこの文書の改訂を伴う。** DDL だけを直して仕様を放置してはならない（PRIN-0001 / PRIN-0007）。

## 関連ドキュメント

- [enforcement-matrix.md](./enforcement-matrix.md)（全ルール対応表）
- [server-client-separation.md](./server-client-separation.md)（アプリ側の防衛線）
- [testing/integration.md](../testing/integration.md)（DB 側の保証を検証する場所）
- [ARCH-BE-0001](../../../../../../architecture/system/backend/ARCH-BE-0001-app-layer-structure.md)（RLS を第二防衛線と位置づける根拠）
- [ARCH-BE-0013 — Server Action の構造](../../../../../../architecture/system/backend/ARCH-BE-0013-server-action-structure.md)（第一防衛線の契約）
- [ARCH-BE-0015 — 非同期ジョブ実行基盤](../../../../../../architecture/system/backend/ARCH-BE-0015-async-job-execution.md)（outbox・冪等キー）
