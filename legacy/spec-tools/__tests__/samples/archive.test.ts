/**
 * サンプルシステム `archive`(社内文書の保管庫)を仕組みに 1 往復通す既知解テスト。
 *
 * 狙いは [business-system-forms.md](../../../design/business-system-forms.md) の **11 行目
 * (論理削除・保管)** である。「見えないが残る行」を扱う系では、可視性の宣言
 * (`access_spec` の `reads`)に行の状態も「空かどうか」も書けない —— P-7(空かどうかを
 * 状態にする)を当てても**可視性には届かない**。この題材はその残差を測るために作った
 * (測定の正は `docs/design/triage-null-literal-3.md`、題材の設計は
 * `docs/design/sample-archive.md`)。
 *
 * **束 ㉒ で「空かどうか」(`is null` / `is not null`)を買ったので、この既知解は書き換わった。**
 * 状態と列の同値(INV-DOCUMENT-002)が `formal` に書けるようになり、`documents` の world が
 * 宣言から作れるようになった —— T8 / T11 の warning が消え、RLS の挙動テスト 1 表と
 * 単発操作の一致の証明 6 本、そして部署の境界の見張りテスト(T4)が**生成物として生えた**
 * (設計: `docs/design/null-literal-purchase.md`)。**可視性の残差(型 (d))はそのまま残る** ——
 * `is null` では閉じない別の買い物だからである。
 *
 * 題材の形(狙って踏んでいるもの):
 *   - **論理削除・保管**(起案中 → 供覧中 → 保管 → 復元 / 保存年限が切れたら物理削除)
 *   - **空になりうる欄を 3 本持つ**(`archived_at` / `archived_by` / `summary`)。
 *     fixture 4 題材は空になりうる `ref` / `datetime` の欄を **1 本も持っていなかった**
 *     (triage-null-literal-2.md §0 の実測)ので、ここが「2 例目」の測り場になる
 *   - **状態と列の同値**(INV-DOCUMENT-002)を `formal: check` で書く。**この表を塞いで
 *     いた理由はちょうど 1 件だった**ので、買った分がそのまま生成物になる(題材の製品の 2 表は
 *     別の理由も重なっていたので、同じ買い物でも生成テストは 1 本も増えない)
 *   - `records_actor` / `clears` が**書く側**、`is null` が**読む側**を受け持つ実物
 *   - 部署の境界(`reads[].filters`)と、その境界の **T4 の見張りテスト(生成物)**
 *   - `deletes[].when` の時刻の比較(`now > document.disposable_after`)
 *
 * **warning は消し込まない。** 件数と内訳をここで固定して記録する —— 残っている T2 の 1 件は
 * 仕組みの表 jobs の取り出しの索引であり、題材の性質そのものである。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { runSampleSystem } from './harness.js';
import { expectMfaAbsent } from './mfa-expect.js';
import type { SampleRun } from './harness.js';

/** 生成物の代表(層ごとに 1 つずつ。ここが欠けたら写像そのものが動いていない)。 */
const REPRESENTATIVE_FILES: readonly string[] = [
  'app/src/domain/generated/document.transitions.ts', // 遷移表(状態機械)
  'app/src/domain/generated/document.schema.ts', // zod(entity_spec)
  'app/src/domain/generated/document.deletes.ts', // 物理削除の許可(access_spec の deletes)
  'app/src/domain/generated/transition-writes.ts', // 遷移が自分の列に何をするか(records_actor / clears)
  'app/src/domain/generated/rls-expectations.ts', // 期待 RLS(access_spec の reads + filters)
  'app/src/domain/generated/query-fragments.ts', // 読み取り経路(query_spec)
  'app/src/domain/generated/testids.ts', // testid の骨格(screen_spec)
  'app/src/domain/generated/usecase-plans.ts', // 保存点の実行計画(usecase_spec)
  'app/src/domain/generated/rpc-signatures.ts', // 引数名の写し(data_table の params)
  'docs/book/domain/document.html', // ハンドブックの集約の章
  'docs/book/visibility.html', // ハンドブックの可視性の章
  'supabase/migrations/20260922090000_usecase_file_document_file.sql', // 複合 RPC
];

/** 記録している warning の内訳(検証器 ID → 件数)。 */
const EXPECTED_WARNINGS: Readonly<Record<string, number>> = {
  // T2: 仕組みの表 jobs の取り出しの索引(jobs_due_idx)は、この題材の query_spec・関数の lookup から導けない。
  // 引くのは claim_due_jobs だが、その本文は製品の手書き migration にしか無く、題材の DB は生成
  // migration と仕組みの表の DDL だけで組まれる。**関数の宣言を題材に写すと、構造の突合
  // (data-table-parity)が「宣言した関数が DB に無い」で赤くなる**ので写さない。仕組みの表の関数の本文は
  // 仕組み側が配るべきで、題材に手書き migration は置かない(1 か所に寄せる話は BACKLOG)。
  // 監査ログの時系列の索引は、引く者が居ないので題材から外した(束 F-index-b)。
  T2: 1,
  // **束 ㉒ の前はここに T8: 1 / T11: 1 が居た。** INV-DOCUMENT-002(保管の 2 欄と状態の
  // 同値)が `formal` に書けず、documents の world を宣言から作れなかったためである。
  // `is null` を買って `formal` が書けるようになり、2 件とも消えた(下の 2 つの it が
  // 「代わりに何が生えたか」を固定する)。
  //
  // **束 ㉓ の時点ではここに T16: 1 が居た**(INV-DOCUMENT-002 の執行点が実在しない)。
  // `formal` は行の CHECK に写せるのに、「この遷移が `archived_at` を書く」を宣言できず、
  // 置くと `document.archive` そのものが失敗していた。`records_time`(review-queue §16 の
  // 1-A)を買って保管の遷移が 1 文で 3 列とも動かすようになり、**複数の手順で満たす
  // 不変条件ではなくなった** —— 行の CHECK が生えて 1 件とも消えた
  // (設計: docs/design/triage-transition-writes-2.md / check-generation.md §4-b)。
};

/** `app/src/domain/generated/**` の件数(増えたら気づく。4 題材と同じ目)。 */
const EXPECTED_DOMAIN_GENERATED = 49;  // 掴みの宣言の期待の表 lock-expectations.ts が 1 本増えた(data_table を持つ製品は常に。宣言が無ければ空の表。点検 19 回目)。 送信の上限の期待の表 send-limit-expectations.ts が 1 本増えた(data_table を持つ製品は常に。宣言が無ければ空の表)。 外部の SDK の置き場の表 sdk-homes.json が 1 本増えた(実装の木を持つ製品は常に。B9-4)。 ブラウザ側の守りで browser-defense.ts が 1 本増えた(アプリの枠の後段の生成器)。 束 ①-b で plan-types.ts が生成物から外れた(ADR-0013)、手 3 で runtime-bindings.ts が 1 本増えた、束 画面 3a で FieldLabels が全 entity に出るようになり {entity}.labels.ts が増えた

describe('サンプルシステム archive(社内文書の保管庫)を仕組みに通す', () => {
  let run: SampleRun;

  beforeAll(async () => {
    run = await runSampleSystem('archive');
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
    // 拡張候補は台帳の候補に当たる警告(T2 = 仕組みの表の索引)。未分類は台帳に載っていない警告で、題材の性質として残るもの(この題材は 0)。
    // 未分類をどう扱うか(台帳に候補を足す・検査ごとの受け入れの形を作る)は review-queue の判断で、ここでは数だけ固定する。
    expect(run.buckets).toEqual({ accepted: 0, extension: 1, unclassified: 0 });
  });

  it('verify: world を作れない表が 1 つも無い(`is null` を買った分の見返り)', () => {
    // 束 ㉒ の前はここが「理由がちょうど 1 件」の固定だった。買ったことで理由が 0 件になり、
    // documents の world が宣言から組めるようになった —— 戻ったらここが赤くなる。
    expect(run.warnings.filter((finding) => finding.verifier === 'T8')).toEqual([]);
    expect(run.warnings.filter((finding) => finding.verifier === 'T11')).toEqual([]);
  });

  it('generate: 各層の代表的な生成物が書き出される', () => {
    const missing = REPRESENTATIVE_FILES.filter((file) => !run.generatedFiles.has(file));
    expect(missing).toEqual([]);
    expect(run.generatedFiles.size).toBeGreaterThanOrEqual(120);
    const domainGenerated = [...run.generatedFiles.keys()].filter((file) =>
      file.startsWith('app/src/domain/generated/'),
    );
    expect(domainGenerated).toHaveLength(EXPECTED_DOMAIN_GENERATED);
  });

  it('generate: 生成された TS が本物のエンジンの型に合う', () => {
    expect(run.typecheck.diagnostics).toEqual([]);
    expect(run.typecheck.ok).toBe(true);
  });

  it('generate: 認証フロー仕様を持たないので、多要素認証の執行の配線は 1 か所も現れない', () => {
    expectMfaAbsent(run);
  });

  it('generate: 標識の置き場の問題が 0 件(実 CLI の generate が止まらない。block-check.ts)', () => {
    expect(run.placementProblems.map((problem) => problem.message)).toEqual([]);
  });

  it('generate: 表の DDL・補助関数・ポリシー・定型 RPC・複合 RPC が骨格を満たす SQL として出る', () => {
    expect(run.sql.problems).toEqual([]);
    expect(run.sql.ddlFiles).toEqual([
      'supabase/migrations/20260922120201_ddl_departments.sql',
      'supabase/migrations/20260922120202_ddl_staffs.sql',
      'supabase/migrations/20260922120203_ddl_documents.sql',
      'supabase/migrations/20260922120204_ddl_jobs.sql',
      'supabase/migrations/20260922120205_ddl_domain_events.sql',
      'supabase/migrations/20260922120290_ddl_resend_digests.sql', // 保存点の再送の入力の要約(仕組みの表。点検 21 回目 A21-1)
    ]);
    expect(run.sql.helperFiles).toEqual([
      'supabase/migrations/20260922110001_helper_is_staff.sql',
      'supabase/migrations/20260922110002_helper_is_curator.sql',
      // 部署の境界(actor.department_id)の値は実行者自身の行から読む(トークンの写しを信じない)。
      'supabase/migrations/20260922110003_helper_actor_department_id.sql',
    ]);
    expect(run.sql.policyFiles).toEqual([
      'supabase/migrations/20260922110101_policies_departments.sql',
      'supabase/migrations/20260922110102_policies_staffs.sql',
      'supabase/migrations/20260922110103_policies_documents.sql',
    ]);
    expect(run.sql.rpcFiles).toEqual([
      'supabase/migrations/20260922100001_rpc_insert_document.sql',
      'supabase/migrations/20260922100002_rpc_update_document.sql',
      'supabase/migrations/20260922100003_rpc_apply_document_transition.sql',
      'supabase/migrations/20260922100004_rpc_delete_document.sql',
    ]);
    expect(run.sql.usecaseFiles).toEqual([
      'supabase/migrations/20260922090000_usecase_file_document_file.sql',
    ]);
  });

  it('generate: 部署の境界と「保管は一般の社員に見せない」が RLS の USING 句に出る(束 §14)', () => {
    // `reads[].filters` は「実行者の属性で一律に狭める」宣言、`reads[].when` は「行の状態で
    // 見え方を絞る」宣言であり、**両方がこの 1 つの句になる**。束 §14 の前は後者を書く場所が
    // 無く、保管した文書を隠していたのは読み取り経路 1 本の `filters` だけだった(だから
    // 1 件引きの経路からは一般の社員に返っていた)。
    const documents = run.generatedFiles.get('supabase/migrations/20260922110103_policies_documents.sql') ?? '';
    const staff = documents.slice(
      documents.indexOf('create policy documents_select_staff_all_within_department_id'),
      documents.indexOf('-- ロール curator'),
    );
    expect(staff).toContain('documents.department_id = (select public.actor_department_id())');
    expect(staff).toContain("(documents.state) <> 'archived'");
    // **文書管理者の側には条件が無い**(書庫の棚卸しが役目である)。同じ表の 2 本のポリシーが
    // 違うことを言っている、というのがこの宣言の要点である。
    const curator = documents.slice(documents.indexOf('-- ロール curator'));
    expect(curator).toContain('documents.department_id =');
    expect(curator).not.toContain('archived');
  });

  it('generate: 「見えない行」が world に置かれる(条件を落としたら挙動テストが落ちる)', () => {
    // world の行は状態の列に値を置かない = どの的も初期状態(起案中)である。それだけでは
    // `state != archived` を落としても緑になるので、**系統ごとに保管の行をもう 1 つ**置く。
    // 保管の行は INV-DOCUMENT-002 の CHECK に当たるので、保管の 2 欄も一緒に埋まる。
    const worlds = run.generatedFiles.get('app/src/domain/generated/rls-worlds.ts') ?? '';
    expect(worlds).toContain('#when-state-archived');
    expect(worlds).toContain("state: 'archived'");
    expect(worlds).toContain('archived_by');
  });

  it('generate: documents の RLS の挙動テストと、部署の境界の見張りテスト(T4)が生える', () => {
    const rls = [...run.generatedFiles.keys()]
      .filter((file) => file.startsWith('app/src/infrastructure/__tests__/generated/rls/'))
      .sort();
    expect(rls).toEqual([
      'app/src/infrastructure/__tests__/generated/rls/departments.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/documents.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/staffs.rls.test.ts',
    ]);
    // 境界の見張りテストは、world を作れなかったあいだ**手書きの統合テスト**が受け持っていた。
    // いまは同じ名前の it が生成物として出る(テストケースの宣言の宛先が生成物に変わった)。
    const documents = run.generatedFiles.get(
      'app/src/infrastructure/__tests__/generated/rls/documents.rls.test.ts',
    ) ?? '';
    expect(documents).toContain('documents は実行者の department_id 以外の行を返さない');
  });

  it('generate: 単発操作の一致の証明が 6 操作ぶん生える', () => {
    const eq = run.generatedFiles.get(
      'app/src/infrastructure/__tests__/generated/equivalence/document.eq.test.ts',
    ) ?? '';
    const operations = [...eq.matchAll(/it\('(document\.[a-z_]+) の全/gu)].map((found) => found[1]);
    expect(operations.sort()).toEqual([
      'document.archive',
      'document.circulate',
      'document.create',
      'document.delete',
      'document.restore',
      'document.update',
    ]);
    // 再送で既存の行を返す表(documents の resend.returns_existing: true)は、作成の送り直しの性質を持つ(点検 20 回目 B20-1)。
    expect(eq).toContain("expectResendReturnsSameRow(WORLD, built, 'document.create')");
    // 保存点の一致の証明は別の経路(eq-save-*)なので、買う前から生成されている。
    expect(
      run.generatedFiles.has('app/src/composition/__tests__/generated/equivalence/file_document.uc.eq.test.ts'),
    ).toBe(true);
  });

  it('generate: 遷移が自分の列に何をするかが生成物に出る(records_actor / records_time / clears)', () => {
    const writes = run.generatedFiles.get('app/src/domain/generated/transition-writes.ts') ?? '';
    expect(writes).toContain('archived_by');
    expect(writes).toContain('archived_at');
  });

  it('generate: 引数を持たない列も遷移 RPC の UPDATE で動く(clears = 空 / records_time = now)', () => {
    // `restore` の `clears` は 2 列だが、値の口(引数)を持つのは `archived_by` だけである。
    // 引数の並びだけを回っていた頃は `archived_at` が UPDATE 文に一度も現れず、**宣言が
    // あるのに何も起こらなかった**(空振り。束 ㉔)。空にするのに渡すものは無いので、
    // 引数の無い列は本文が直に `null` を書く。
    //
    // `records_time`(束 ㉖)も同じ形である —— 書く値は SQL の `v_now`(ロック後の時刻)なので**引数は
    // 増えない**。同じ列に 2 つの宣言(保管が書き、復元が空に戻す)が同居するので、
    // 1 つの `case` が `p_event_id` で 2 通りに分岐する。
    const rpc = run.generatedFiles.get(
      'supabase/migrations/20260922100003_rpc_apply_document_transition.sql',
    ) ?? '';
    expect(rpc).toContain(
      "archived_at = case when p_event_id in ('document.archive') then v_now" +
        " when p_event_id in ('document.restore') then null else t.archived_at end",
    );
    expect(rpc).toContain(
      "archived_by = case when p_event_id in ('document.restore') then p_archived_by else coalesce(p_archived_by, t.archived_by) end",
    );
  });

  it('generate: 保存点の供覧の手順は、そのイベントが書かない記録の列(archived_by)を入力から受けない(A6-1)', () => {
    // 以前は保存点だけ「決まらない欄は入力から読む」に落ち、供覧の手順の入力スキーマ・フォーム・複合 RPC に
    // 「保管した職員」の欄が出ていた(行の CHECK documents_archive_sync が偶然落としていただけ)。
    // 単発の document.circulate と同じく、遷移が自分で決めない列は空(null)を渡す。
    const inputs = run.generatedFiles.get('app/src/domain/generated/usecase-inputs.ts') ?? '';
    expect(inputs).toContain("'document.create'");
    expect(inputs).not.toContain('archived_by');
    const plans = run.generatedFiles.get('app/src/domain/generated/usecase-plans.ts') ?? '';
    expect(plans).not.toContain('archived_by');
    const forms = [...run.generatedFiles.entries()].filter(([file]) => file.endsWith('file_document.file-form.tsx'));
    expect(forms).toHaveLength(1);
    for (const [, form] of forms) expect(form).not.toContain('archived_by');
    const composite = run.generatedFiles.get('supabase/migrations/20260922090000_usecase_file_document_file.sql') ?? '';
    expect(composite).toContain('p_archived_by => null');
    expect(composite).not.toContain("->> 'archived_by'");
  });

  it('generate: INV-DOCUMENT-002 の執行点(行の CHECK)が DDL に反映される(束 ㉖)', () => {
    // 束 ㉓ では「写せるのに生やせない 1 本」だった —— 生やすと `document.archive` が失敗した。
    // `records_time` を買ったので、式は `formal` からそのまま反映される(`rule` は書かない)。
    const ddl = run.generatedFiles.get('supabase/migrations/20260922120203_ddl_documents.sql') ?? '';
    expect(ddl).toContain(
      "add constraint documents_archive_sync check (COALESCE((((state = 'archived'::text)" +
        " AND (archived_at IS NOT NULL) AND (archived_by IS NOT NULL)) OR ((state <> 'archived'::text)" +
        ' AND (archived_at IS NULL) AND (archived_by IS NULL))), false))',
    );
    expect(ddl).toContain("comment on constraint documents_archive_sync on public.documents is 'INV-DOCUMENT-002'");
  });

  it('generate: 生成物にホスト(製品)の語が 1 つも出ない', () => {
    expect(run.vocabularyLeaks.map((leak) => `${leak.file}: ${leak.word}`)).toEqual([]);
  });

  it('generate: 生成コードに文言表の外の日本語が出ない', () => {
    expect(run.unexplainedWording.map((entry) => `${entry.file}: ${entry.text}`)).toEqual([]);
  });

  it('generate: ハンドブックの操作の章に結果表が出る(理由つきの欠落ではなくなった)', () => {
    // 束 ㉒ の前は「一致の証明が無い」と理由つきで報告していた(world を作れない表の操作
    // だったため)。買ったことで 4 題材と同じく結果表が出る。
    const page = run.generatedFiles.get('docs/book/actions.html') ?? '';
    expect(page).toContain('の結果表(全');
    expect(page).not.toContain('一致の証明が無い');
  });
});
