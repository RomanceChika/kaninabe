/**
 * サンプルシステム `stores`(複数店舗の在庫と入金通知)を仕組みに 1 往復通す既知解テスト。
 *
 * 別の製品に無い形だけを狙って集めた題材である。ここが落ちたら、
 * 落ちたのは fixture ではなく**仕組みが製品の構造を暗に前提にしていた**という実測である
 * (束 ⑱)。fixture を通すために `lib/**` へ特別扱いを足してはならない —— 直すべきは仕組みの
 * 一般性か、仕様の書き方のどちらかである。
 *
 * 題材の形(business-system-forms.md の行番号。狙って踏んでいるもの):
 *   - ⑤ テナント(会社が複数。全集約が `company_id` を持ち、**可視性が会社を跨がない**)
 *   - ⑥ 階層(店舗 → 売場 → 棚 の木。棚から店舗へは `context` を 2 段辿る = 畳んだ列を持たない)
 *   - ⑦ 台帳(移動と残高。合計の一致・伝票番号による冪等)
 *   - ⑨ 外から届くイベント(入金通知。`by: [system]` の遷移と受信の記録)
 *   - ⑰ 個人データ(従業員の連絡先・注文者名と `personal_placeholder`)
 *
 * **warning は消し込まない。** 件数と内訳をここで固定して記録する —— 消すために仕様を
 * ゆがめると「面倒だった事実」が記録から消えるためである。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { tenantCanaryTestName } from '../../lib/messages/messages-rls.js';
import { runSampleSystem } from './harness.js';
import { expectMfaWired } from './mfa-expect.js';
import { expectAllProved, expectNoProofNoted, expectResultTables } from './results-expect.js';
import type { SampleRun } from './harness.js';

/** 生成物の代表(層ごとに 1 つずつ。ここが欠けたら写像そのものが動いていない)。 */
const REPRESENTATIVE_FILES: readonly string[] = [
  'app/src/domain/generated/stock_move.transitions.ts', // 遷移表(状態機械)
  'app/src/domain/generated/stock_move.labels.ts', // enum の表示名(V16)
  'app/src/domain/generated/stock_balance.schema.ts', // zod(台帳の残高)
  'app/src/domain/generated/rls-expectations.ts', // 期待 RLS(access_spec の reads)
  'app/src/domain/generated/personal-expectations.ts', // 個人データの消去の期待(personal)
  'app/src/domain/generated/index-expectations.ts', // query_spec から導いた索引(T2)
  'app/src/domain/generated/query-windows.ts', // スコープ条件(query_spec の via = store_manager)
  'app/src/domain/generated/operation-plans.ts', // 単発の操作の実行計画(A15)
  'app/src/domain/generated/usecase-plans.ts', // 保存点の実行計画(usecase_spec)
  'app/src/domain/generated/testids.ts', // testid の骨格(screen_spec)
  'app/src/app/_actions/usecase/stock_receipt/record_moves.ts', // 保存点の Server Action
  'app/src/domain/generated/auth.ts', // サインインの決定表(auth_spec。主語は enum の欄)
  'app/src/composition/inbound/payment_notice_webhook.ts', // Webhook の口の配線(external_spec の inbound)
  'app/src/app/api/inbound/payment_notice_webhook/route.ts', // Webhook の口(Route Handler)
  'docs/book/domain/stock_balance.html', // ハンドブックの集約の章
  'supabase/migrations/20260911000001_usecase_stock_receipt_record_moves.sql', // 複合 RPC
];

/**
 * 記録している warning の内訳(検証器 ID → 件数)。
 *
 * **0 件である**(仕様だけのツリーであること自体は M0 の警告にならない。束 ⑲-1 #7)。
 */
const EXPECTED_WARNINGS: Readonly<Record<string, number>> = {
  // T2: 仕組みの表 jobs の取り出しの索引(jobs_due_idx)は、この題材の query_spec・関数の lookup から導けない。
  // 引くのは claim_due_jobs だが、その本文は製品の手書き migration にしか無く、題材の DB は生成
  // migration と仕組みの表の DDL だけで組まれる。**関数の宣言を題材に写すと、構造の突合
  // (data-table-parity)が「宣言した関数が DB に無い」で赤くなる**ので写さない。仕組みの表の関数の本文は
  // 仕組み側が配るべきで、題材に手書き migration は置かない(1 か所に寄せる話は BACKLOG)。
  // 監査ログの時系列の索引は、引く者が居ないので題材から外した(束 F-index-b)。
  T2: 1,
  // T8: RLS の挙動テストの world を作れない表(束 ⑳-4b)。この題材は写しの列をトリガが埋める設計で
  // あり(`sync_*_company` が company_id を供給する)、行の置き場が宣言から決まらない表が多い。
  //
  // **写しであることが不変条件で宣言されている列は止めない**(⑳-4b-b ④。`INV-SHELF-002` =
  // `shelf.company_id == section.company_id` の形)—— 値の出どころが world の中にあるので、列を
  // 置かずに挿入すればトリガが祖先から埋める。これで 25 件 → 15 件になった。
  // さらに `INV-STORE-002` と `INV-STOCK-MOVE-004` に `formal.type: check` を書いて 15 → 6 に
  // なった(前者は `store` の `context` に `staff_member: store.manager_id` を 1 行足して相手に
  // 届くようにした。`check` は行の中だけに閉じておらず、`context` で辿れる範囲まで見る)。
  // 残るのは**跨行の集計・含意**(`INV-STOCK-MOVE-002`)だけであり、`check` の表現力の外である。
  // `stock_receipts` の 2 件が消えたのは `INV-STOCK-RECEIPT-001` の `formal` が
  // **店舗の写しまで**言い切るようになったからである(束 ③-3 の C-1)。4 件 → 1 件になったのは
  // 束 ③-4 で (a) `sync_sales_order_company` に写しの不変条件(`INV-SALES-ORDER-003`)を
  // 宣言させ、(b) 執行点が実在しないトリガの宣言を外した(`INV-STOCK-BALANCE-001` /
  // `INV-STORE-002` 等)ためである —— **宣言を正直にしたら world が 2 つ増えた**。
  T8: 1,
  // T11: 一致の証明の world を作れない**集約**(束 ⑳-5a)と**保存点**(束 ⑳-5a2)。
  // 判定は T8 とまったく同じ(`rowProblems`)であり、数が違うのは数える単位が違うからである
  // —— T8 は**表**ごと、T11 は集約ごと(その集約を動かす操作の数を添える)と保存点ごとに
  // 報告する。`store` の行が置けるようになったので、**保存点 2 件は消えた**(`order_intake.place_order`
  // / `stock_receipt.record_moves` はどちらも `store` の行を要求していた)。束 ③-4 で
  // さらに 2 件消え、残る 1 件は T8 と同じ理由(跨行の集計)である。
  T11: 1,
  // T16 (e): **執行点が一度も実在していない**トリガ 3 本(`check_paid_order_has_notice` /
  // `check_company_admin_quota` / `apply_stock_move_to_balance`)。うち件数の上限 1・形式定義なし 2 は
  // 条件が形式定義の写像の外で、条件トリガの本文(2026-09-26。行内比較・一意・排他に写せるものだけ生成)を作れない
  // (拡張候補 X-trigger-bodies)。実在しない執行点の行は data_table に置かず、`enforced_by` は残してこの警告に報告させる
  // (束 CHECK 生成の裁定。束 ③-4 の実測)。
  // **別の集約の列との等式(INV-STORE-002 / INV-STOCK-MOVE-005)はここに居ない**(2026-10-22): 両端の表に 1 本ずつの
  // コミット時評価の制約トリガ(stores / staff_members と stock_moves / products)が実在し、本文が formal から生成される
  // (拡張候補 X-cross-aggregate-equality は done)。5 → 3 件になった。
  T16: 3,
};

/** 生成される `app/src/domain/generated/**` の件数(仕組みが生成物を増減させたら動く)。 */
const EXPECTED_DOMAIN_GENERATED = 80;  // 掴みの宣言の期待の表 lock-expectations.ts が 1 本増えた(data_table を持つ製品は常に。宣言が無ければ空の表。点検 19 回目)。 送信の上限の期待の表 send-limit-expectations.ts が 1 本増えた(data_table を持つ製品は常に。宣言が無ければ空の表)。 外部の SDK の置き場の表 sdk-homes.json が 1 本増えた(実装の木を持つ製品は常に。B9-4)。 外部連携の有料の口の定数表 paid-entries.ts が 1 本増えた(外部連携カタログを採る題材だけ)。  ブラウザ側の守りで browser-defense.ts が 1 本増えた(アプリの枠の後段の生成器)。 入力の状態-e で設定カタログを採るようになり config の生成物が 1 本増えた、束 C′ で acl-expectations.ts が 1 本増え、束 ①-b で plan-types.ts が外れた(ADR-0013)、手 3 で runtime-bindings.ts が 1 本増えた、束 画面 3a で FieldLabels が全 entity に出るようになり {entity}.labels.ts が増えた

/** 受信 Webhook の RPC(1 トランザクションで記録と遷移を起こす生成物)。 */
function inboundFiles(run: SampleRun): readonly string[] {
  return run.sql.files.filter((file) => file.includes('_inbound_'));
}

/** 生成された RLS の挙動テスト(束 ⑳-4b。表名順)。 */
function rlsBehaviourTests(run: SampleRun): readonly string[] {
  return [...run.generatedFiles.keys()]
    .filter((file) => file.startsWith('app/src/infrastructure/__tests__/generated/rls/'))
    .sort();
}

describe('サンプルシステム stores(複数店舗の在庫と入金通知)を仕組みに通す', () => {
  let run: SampleRun;

  beforeAll(async () => {
    run = await runSampleSystem('stores');
  });

  it('verify: エラーが 0 件である', () => {
    expect(run.errors.map((finding) => `${finding.verifier} ${finding.message}`)).toEqual([]);
  });

  it('verify: warning の件数と内訳が記録どおりである', () => {
    const actual: Record<string, number> = {};
    for (const finding of run.warnings) {
      actual[finding.verifier] = (actual[finding.verifier] ?? 0) + 1;
    }
    expect(actual).toEqual(EXPECTED_WARNINGS);
  });

  it('verify: warning の区分(拡張候補 / 未分類)が記録どおりである', () => {
    // 拡張候補は台帳の候補に当たる警告(T2 = 仕組みの表の索引 1・T8 / T11 = 証明の world 各 1・T16 = 執行点がトリガで形式定義が写像の外のもの 3: 件数の上限 1・形式定義なし 2)。
    // 未分類は 0(束 F-warn-ledger-c で、INV-STORE-002 を理由つきで台帳に載せた)。
    expect(run.buckets).toEqual({ accepted: 0, extension: 6, unclassified: 0 });
  });

  it('generate: 各層の代表的な生成物が書き出される', () => {
    const missing = REPRESENTATIVE_FILES.filter((file) => !run.generatedFiles.has(file));
    expect(missing).toEqual([]);
    const domainGenerated = [...run.generatedFiles.keys()].filter((file) =>
      file.startsWith('app/src/domain/generated/'),
    );
    expect(domainGenerated).toHaveLength(EXPECTED_DOMAIN_GENERATED);
  });

  it('generate: 生成された TS が本物のエンジンの型に合う', () => {
    expect(run.typecheck.diagnostics).toEqual([]);
    expect(run.typecheck.ok).toBe(true);
  });

  it('generate: 多要素認証の要求(従業員の全員)が書き込みの入口に通る(Server Action が済ませたかを解決し、束が範囲を運ぶ)', () => {
    expectMfaWired(run, "mfa: { scope: 'all' }");
  });

  it('generate: 標識の置き場の問題が 0 件(実 CLI の generate が止まらない。block-check.ts)', () => {
    expect(run.placementProblems.map((problem) => problem.message)).toEqual([]);
  });

  it('generate: 1 トランザクションの RPC が 3 本、骨格を満たす SQL として出る', () => {
    expect(run.sql.problems).toEqual([]);
    expect([...run.sql.usecaseFiles, ...inboundFiles(run)]).toEqual([
      'supabase/migrations/20260911000001_usecase_stock_receipt_record_moves.sql',
      'supabase/migrations/20260911000002_usecase_order_intake_place_order.sql',
      // 受信も同じ形である —— 記録と遷移は 1 トランザクションでなければならない(束 ⑲-2b-b)。
      'supabase/migrations/20260912000002_inbound_payment_notice_webhook.sql',
    ]);
  });

  it('generate: RLS のポリシーと補助関数が全表ぶん生成される(境界は実行者の行を読む補助関数の述語になる)', () => {
    // 束 ⑳-4a。名前だけでなく **USING 句**が生成物になった題材である。テナントの境界
    // (reads[].filters)の右辺は**実行者自身の行**から読む —— トークンの写し(JWT の属性)は
    // 所属を付け替えたあとも最長でトークンの寿命だけ古い値を持つので、DB の判定に使わない。
    expect(run.sql.problems).toEqual([]);
    expect(run.sql.helperFiles).toEqual([
      'supabase/migrations/20260912110001_helper_is_staff_member.sql',
      'supabase/migrations/20260912110002_helper_is_company_admin.sql',
      'supabase/migrations/20260912110003_helper_actor_company_id.sql',
    ]);
    expect(run.sql.policyFiles).toHaveLength(11);
    const helper = run.generatedFiles.get('supabase/migrations/20260912110003_helper_actor_company_id.sql') ?? '';
    expect(helper).toContain('create or replace function public.actor_company_id() returns uuid');
    expect(helper).toContain('select a.company_id from public.staff_members a');
    const shelves = run.generatedFiles.get('supabase/migrations/20260912110106_policies_shelves.sql') ?? '';
    // 従業員は「自社の棚だけ」= 補助関数 + 実行者の行の会社との比較。
    expect(shelves).toContain('create policy shelves_select_staff_member_all_within_company_id');
    expect(shelves).toContain('shelves.company_id = (select public.actor_company_id())');
    expect(shelves).not.toContain('auth.jwt()');
    // 店舗責任者は「自分が責任者の店舗の棚」= 2 段の参照を辿る EXISTS。
    expect(shelves).toContain('create policy shelves_select_store_manager_context');
    expect(shelves).toContain('from public.stores b');
  });

  it('generate: 表の DDL が data_table ごとに 1 本出て、2 度流せる字面である', () => {
    expect(run.sql.problems).toEqual([]);
    expect(run.sql.ddlFiles).toHaveLength(14);  // 束 ③-1 で仕組みが持つ 2 表が加わった。点検 21 回目 A21-1 で保存点の再送の要約の表 resend_digests が加わった
    // 束 ③-1: 仕組みが持つ 2 表(outbox・監査ログ)と api スキーマの土台は、題材が変わっても
    // 同じ 1 組が出る —— 列の正は設計図にあり、entity の値域だけがこの題材の集約から出る。
    const apiBase = run.generatedFiles.get('supabase/migrations/20260911000000_api_base.sql') ?? '';
    expect(apiBase).toContain('create schema if not exists api;');
    expect(apiBase).toContain('create or replace function api.actor_id() returns uuid');
    expect(apiBase).toContain('create or replace function api.is_end_user() returns boolean');
    // 規則を仕様が持つ CHECK(`checks[].rule`)も生成 DDL に載る。
    const moves = run.generatedFiles.get('supabase/migrations/20260912120211_ddl_stock_moves.sql') ?? '';
    // `rule` の式は計画の段で丸括弧に包まれる(`check (…)` の字面にする)。宣言の字面は
    // `pg_get_constraintdef` の**正準表記**で書く(突合は文字列一致であり、Postgres は
    // 書いたままではなく畳んだ形を印字する。束 ③-4 の実測)。
    expect(moves).toContain(
      "add constraint stock_moves_kind_sign_check check (((kind = 'receipt'::text) AND (quantity > 0))",
    );
  });

  it('generate: 定型 5 形の RPC 本文が生成され、plpgsql の構文の釣り合いを満たす', () => {
    // 本文が生成物になったのは束 ⑳-2 である。骨格(関数定義の頭・$$ の対応)に加え、
    // begin/end・if/end if・loop/end loop・丸括弧・権限の 3 行まで通し実行が見る。
    expect(run.sql.problems).toEqual([]);
    expect(run.sql.rpcFiles).toEqual([
      'supabase/migrations/20260912100001_rpc_insert_payment_notice.sql',
      'supabase/migrations/20260912100002_rpc_insert_product.sql',
      'supabase/migrations/20260912100003_rpc_update_product.sql',
      'supabase/migrations/20260912100004_rpc_insert_sales_order.sql',
      'supabase/migrations/20260912100005_rpc_apply_sales_order_transition.sql',
      'supabase/migrations/20260912100006_rpc_insert_section.sql',
      'supabase/migrations/20260912100007_rpc_delete_section.sql',
      'supabase/migrations/20260912100008_rpc_insert_shelf.sql',
      'supabase/migrations/20260912100009_rpc_update_shelf.sql',
      'supabase/migrations/20260912100010_rpc_insert_stock_move.sql',
      'supabase/migrations/20260912100011_rpc_apply_stock_move_transition.sql',
      'supabase/migrations/20260912100012_rpc_insert_stock_receipt.sql',
      'supabase/migrations/20260912100013_rpc_insert_store.sql',
      'supabase/migrations/20260912100014_rpc_update_store.sql',
    ]);
  });

  /**
   * **予約 action_spec を持たない集約でも作成 RPC が欄を受け取ること**(束 ⑳-2b の止め 8-A)。
   *
   * 入金通知は受信 Webhook からしか作られないので `payment_notice.create` の action_spec が
   * 無い。`p_values` が運ぶ欄の母集合を action_spec の `input` から取っていた頃は、ここが
   * 空集合になり `insert into payment_notices (id) values (p_id)` という**動かない本文**が
   * 黙って生成された(NOT NULL 違反で受信経路が常に落ち、冪等の鍵である外部イベント ID の
   * 一意制約に当たりようが無いので `duplicate` の枝が死んでいた)。母集合は entity_spec で
   * あることをここで固定する。
   */
  it('generate: 予約 action_spec の無い集約の作成 RPC が必須の欄を p_values から受ける', () => {
    const sql = run.generatedFiles.get('supabase/migrations/20260912100001_rpc_insert_payment_notice.sql') ?? '';
    expect(sql).toContain('insert into public.payment_notices (\n        id, company_id, order_id, external_event_id, amount\n    )');
    for (const column of ['company_id', 'order_id', 'external_event_id', 'amount']) {
      expect(sql, `${column} を p_values から取り出していません`).toContain(`p_values ->> '${column}'`);
    }
  });

  /**
   * **記録と遷移が同じトランザクションに入っていること**(束 ⑲-2b-b の止め)。
   *
   * 記録だけが成功して遷移が落ちると、相手が再送しても記録済みの外部イベント ID が
   * 「反映済み」と判定されて no-op になり、その通知は永久に失われる。生成された 1 本の
   * 関数の中に両方が並んでいること・遷移の 0 行が例外で全体を戻すことをここで固定する。
   */
  it('generate: 受信の RPC が記録と遷移を 1 つの関数本体で起こす(再送で遷移が失われない)', () => {
    const sql = run.generatedFiles.get('supabase/migrations/20260912000002_inbound_payment_notice_webhook.sql') ?? '';
    const record = sql.indexOf('api.insert_payment_notice(');
    const transition = sql.indexOf('api.apply_sales_order_transition(');

    expect(record).toBeGreaterThan(0);
    expect(transition).toBeGreaterThan(record);
    // 途中で閉じるトランザクションは無い($$ は 1 対だけ)。
    expect(sql.match(/\$\$/g)).toHaveLength(2);
    // 同じ外部イベント ID の再送は遷移を起こさずに duplicate、状態が合わなければ全体が戻る。
    expect(sql).toContain('when unique_violation then');
    expect(sql).toContain("raise exception using errcode = 'UC409'");
  });

  /**
   * **テナント境界が宣言から生成物まで通っていること**(束 ⑲-2a)。
   *
   * 束 ⑱ ではここが最大の穴だった —— `scope` に会社の境界を表す語が無く、全集約が
   * `scope: all` のまま「テナントを越える読み取り」が verify 緑で通っていた。いまは
   * `reads[].filters: { company_id: actor.company_id }` が宣言であり、
   *   - 右辺の欄が `session: true` でなければ V2 がエラーにする(→ v2-reference-integrity.test.ts)
   *   - 期待 RLS のポリシー名に `_within_{列}` が出る(= その列を見ないポリシーを DB に
   *     置いたら pg_policies との突合が落ちる)
   * の 2 段で塞がっている。**名前に境界が出ていること**をここで固定する —— 出なくなったら、
   * 宣言はあるのに DB 側で何も絞っていない状態が再び通るようになる。
   */
  it('generate: テナント境界が期待 RLS のポリシー名に出る(会社を跨がない)', () => {
    const rls = run.generatedFiles.get('app/src/domain/generated/rls-expectations.ts') ?? '';
    // 会社に属する集約は、従業員の可視性が company_id で狭められている。
    for (const table of ['stores', 'sections', 'shelves', 'products', 'sales_orders', 'stock_moves']) {
      expect(rls).toContain(`${table}_select_staff_member_all_within_company_id`);
    }
    // 会社そのものは自分の会社の 1 行だけ(境界の列は主キー)。
    expect(rls).toContain('companies_select_staff_member_all_within_id');
    // 境界を持たない「全件読める」ポリシーは 1 つも残っていない(system は RLS の対象外)。
    expect(rls).not.toMatch(/_select_staff_member_all'/);
  });

  /**
   * **木の 1 段ぶんの写しの列が要らなくなったこと**(束 ⑲-2a)。
   *
   * 棚(`shelf`)は店舗の責任者を判定するために `store_id` の写しを持ち、それを埋めるトリガと
   * 一致を守る不変条件(INV-SHELF-003)を抱えていた。`context` の連鎖が 2 段辿れるので、
   * `shelf → section → store` で同じ判定ができる。
   *
   * **`company_id` は残る** —— あちらは可視性の境界そのもの(`reads[].filters`)であり、
   * RLS が 1 つの列で絞れることに意味がある(役割が違う)。深さ 3 の木の**最下段**
   * (`stock_move` → 店舗)は段の予算 2 を超えるので、そちらの写しはまだ要る。
   */
  it('generate: 棚は店舗の写しの列を持たない(段を 2 つ辿る)', () => {
    const schema = run.generatedFiles.get('app/src/domain/generated/shelf.schema.ts') ?? '';
    expect(schema).not.toContain('store_id');
    // 会社の境界は列として残る(可視性の filters が見る列)。
    expect(schema).toContain('company_id');
  });

  /**
   * **2 段辿れるのは binding だけではなく可視性の `scope: context(X)` もである**(束 ⑲-3 の回帰)。
   *
   * 束 ⑱ では入金通知から店舗へ 1 段で届かず(`payment_notice → sales_order → store`)、
   * 店舗責任者の可視性を `none` に落とすしかなかった —— 仕組みが表現できないことを、業務の
   * 線引きに見せかけて仕様へ押し戻していた形である。いまは同じ宣言が期待 RLS に出る。
   */
  it('generate: 入金通知の可視性が 2 段先の店舗で解決される(束 ⑱ の回避を外した)', () => {
    const rls = run.generatedFiles.get('app/src/domain/generated/rls-expectations.ts') ?? '';
    expect(rls).toContain('payment_notices_select_store_manager_context');
  });

  it('generate: 生成物にホスト(製品)の語が 1 つも出ない', () => {
    // W1 は仕組み側コードの文字列リテラルを見るが、生成器の散文・既定文言・生成器が自分の位置から
    // 読んだ実ファイルに埋まった語は捕まらない(束 ⑱ が 9 件実測)。**出力の側**から見る目である。
    expect(run.vocabularyLeaks.map((leak) => `${leak.file}: ${leak.word}`)).toEqual([]);
  });

  it('generate: 生成コードに文言表の外の日本語が出ない', () => {
    // 生成物の日本語の出どころは「この題材の仕様」と「文言表(lib/messages/messages.ts)」の
    // 2 つだけである。どちらでも説明できない文は、生成器に直接書かれた文言である(束 ㉑)。
    expect(run.unexplainedWording.map((entry) => `${entry.file}: ${entry.text}`)).toEqual([]);
  });
  it('generate: RLS の挙動テストは world を作れた表だけに出て、境界の見張りテストの名前が T4 と一致する', () => {
    // 束 ⑳-4b。この題材は写しの列をトリガが埋める(`sync_*_company`)ので、行の置き場が宣言から
    // 決まらない表が残る —— 実行できるのは 10 表で、残りは T8 が理由を報告する(EXPECTED_WARNINGS)。
    // 3 表 → 8 表になったのは `INV-STORE-002` / `INV-STOCK-MOVE-004` / `INV-STOCK-RECEIPT-001`
    // に `formal` を書いたからであり、**写しの値の出どころが world の中にあることを宣言で示せば
    // world が組める**の実例である。8 表 → 10 表は束 ③-4 —— `sync_sales_order_company` に
    // 写しの不変条件(`INV-SALES-ORDER-003`)を宣言させ、**執行点が実在しないトリガの宣言を
    // 外した**(`check_paid_order_has_notice`)結果である。
    expect(rlsBehaviourTests(run)).toEqual([
      'app/src/infrastructure/__tests__/generated/rls/companies.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/payment_notices.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/products.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/sales_orders.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/sections.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/shelves.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/staff_members.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/stock_balances.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/stock_receipts.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/stores.rls.test.ts',
    ]);
    const products = run.generatedFiles.get('app/src/infrastructure/__tests__/generated/rls/products.rls.test.ts') ?? '';
    // **T4 が要求するテスト名そのもの**が生成される(生成物が境界の見張りテストの宣言を満たす)。
    expect(products).toContain(`it('${tenantCanaryTestName('products', 'company_id')}', async () => {`);
    expect(products).toContain("await expectTenantBoundary(WORLD, built, 'company_id');");
    // 境界を宣言した表には「別の境界を持つもう 1 人」が足される —— 実行者が 1 人しかいない world には
    // 他テナントの行が無く、境界の条件を落としたポリシーでも検査が通ってしまう。
    expect(products).toContain("await expectVisibleRows(WORLD, built, 'staff_member_other');");
    const worlds = run.generatedFiles.get('app/src/domain/generated/rls-worlds.ts') ?? '';
    expect(worlds).toContain("key: 'staff_member_other'");
  });

  it('generate: 結果表(元データと折り畳みの表)が生成される(束 ⑳-5b)', () => {
    expectResultTables(run);
  });

  it('generate: world を作れない集約は結果表の代わりに理由を報告し、作れた保存点は表を出す(束 ⑳-5b)', () => {
    // T11 が warning で報告するのと同じ事実を、人が読む章にも出す(黙って表を消さない)。
    expectNoProofNoted(run, 'docs/book/actions.html');
    // 保存点の側は `store` の行が置けるようになったので**どれも表が出る**(T11 の保存点 2 件が
    // 消えた)。表があることだけでなく、**理由の行が 1 本も残っていない**ことまで主張する ——
    // 片方だけ実行できて片方が理由に落ちている状態を「表が出た」で通さないためである。
    expectAllProved(run, 'docs/book/usecases.html');
  });
});
