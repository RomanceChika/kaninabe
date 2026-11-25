/**
 * サンプルシステム `expenses`(経費精算)の既知解テスト。
 *
 * 製品とは語彙も形も違う題材を、**本物のローダー・検証器・生成器**に 1 往復通す
 * (通し実行: `./harness.ts`)。仕組みが製品の構造に寄りかかっていれば、ここが赤くなる。
 *
 * この題材が狙って踏む形:
 *   - 多段の状態機械(draft → submitted → approved → paid / rejected)で、**段ごとに `by` が違う**
 *   - **`claim:` のロール**(`accountant` = 実行者自身の行の `session: true` な boolean が根拠)
 *   - **`computes`**(提出の遷移が純関数で確定させる合計額。**材料が行の集合**なので A19 の warning(拡張候補)が 1 件残る)と **`runner: manual`**(外部連携を挟む支払い)
 *   - 保存点(`repeat` の明細)つきのユースケース
 *
 * **warning は消さずに数を固定する。** 題材の性質として残るもの(行の集合を材料にする計算)であり、
 * 0 にすることが目的ではない(fixture に `docs/rules` が無いことによる M0 は束 ⑲-1 で出なくなった)。
 * 確認が要る操作(申請の削除・明細の削除・支払い)は、確認の重ね表示を置いて U1 を 0 にした(束 題材-未分類)。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { runSampleSystem } from './harness.js';
import { expectMfaAbsent } from './mfa-expect.js';
import { expectResultTables } from './results-expect.js';
import type { SampleRun } from './harness.js';

/** 生成物の代表(この題材で「仕組みが別ドメインに通った」ことを示す 1 本ずつ)。 */
const REPRESENTATIVE_FILES: readonly string[] = [
  'app/src/domain/generated/claim.transitions.ts', // 多段の遷移表
  'app/src/domain/generated/claim.schema.ts', // entity_spec → zod
  'app/src/domain/generated/line.labels.ts', // enum の表示名(V16)
  'app/src/domain/generated/roles.ts', // グローバルロールの 3 スロット
  'app/src/domain/generated/rls-expectations.ts', // reads → 期待ポリシー
  'app/src/domain/generated/operation-plans.ts', // 単発の操作の実行計画
  'app/src/domain/generated/usecase-plans.ts', // 保存点の実行計画
  'app/src/domain/generated/testids.ts', // 画面の骨格
  'supabase/migrations/20260911000001_usecase_claim_with_lines_register.sql', // 複合 RPC
  'docs/book/domain/claim.html', // ハンドブックの章
];

/** warning の内訳(検証器 ID → 件数)。増減したらここを直し、理由を報告に残す。 */
const EXPECTED_WARNINGS: Readonly<Record<string, number>> = {
  // T2: 仕組みの表 jobs の取り出しの索引(jobs_due_idx)は、この題材の query_spec・関数の lookup から導けない。
  // 引くのは claim_due_jobs だが、その本文は製品の手書き migration にしか無く、題材の DB は生成
  // migration と仕組みの表の DDL だけで組まれる。**関数の宣言を題材に写すと、構造の突合
  // (data-table-parity)が「宣言した関数が DB に無い」で赤くなる**ので写さない。仕組みの表の関数の本文は
  // 仕組み側が配るべきで、題材に手書き migration は置かない(1 か所に寄せる話は BACKLOG)。
  // 監査ログの時系列の索引は、引く者が居ないので題材から外した(束 F-index-b)。
  T2: 1,
  // A19: `claim.total_amount`(明細の総和)の材料は**行の集合**で、`reads: [line.amount]` と宣言している。
  // 計画の読み取りは 1 集約 1 行なので材料は届かない(実測は docs/design/triage-computes-reads.md)。
  // 子の集合を材料にする形に限り、A19 は理由 `child_set_read` つきの warning にする(拡張候補
  // X-child-set-reads)。穴の所在を warning として持ち続ける —— 黙って通っていた状態には戻さない。
  A19: 1,
  // U1 は 0 件: 確認が要る操作 3 本(claim.delete / line.delete / claim.pay)は、それぞれ確認の重ね表示
  // (claim_delete_confirm / line_delete_confirm / pay_confirm)に載せた(束 題材-未分類)。
};

/** `app/src/domain/generated/**` の件数(増えたら気づく。rooms / stores と同じ目)。 */
const EXPECTED_DOMAIN_GENERATED = 55;  // 掴みの宣言の期待の表 lock-expectations.ts が 1 本増えた(data_table を持つ製品は常に。宣言が無ければ空の表。点検 19 回目)。 送信の上限の期待の表 send-limit-expectations.ts が 1 本増えた(data_table を持つ製品は常に。宣言が無ければ空の表)。 外部の SDK の置き場の表 sdk-homes.json が 1 本増えた(実装の木を持つ製品は常に。B9-4)。 外部連携の有料の口の定数表 paid-entries.ts が 1 本増えた(外部連携カタログを採る題材だけ)。  ブラウザ側の守りで browser-defense.ts が 1 本増えた(アプリの枠の後段の生成器)。 ジョブカタログを採って jobs.ts が 1 本増えた(ドメインの副作用はジョブカタログを要する。P2)。束 C′ で acl-expectations.ts が 1 本増え、束 ①-b で plan-types.ts が外れた(ADR-0013)、手 3 で runtime-bindings.ts が 1 本増えた、束 画面 3a で FieldLabels が全 entity に出るようになり {entity}.labels.ts が増えた

/** 生成された RLS の挙動テスト(束 ⑳-4b。表名順)。 */
function rlsBehaviourTests(run: SampleRun): readonly string[] {
  return [...run.generatedFiles.keys()]
    .filter((file) => file.startsWith('app/src/infrastructure/__tests__/generated/rls/'))
    .sort();
}

describe('サンプルシステム expenses(経費精算)が本物の仕組みを 1 往復通る', () => {
  let run: SampleRun;

  beforeAll(async () => {
    run = await runSampleSystem('expenses');
  });

  it('verify: エラーが 0 件である', () => {
    expect(run.errors.map((finding) => `[${finding.verifier}] ${finding.message}`)).toEqual([]);
  });

  it('verify: warning は題材の性質として固定した内訳どおりである', () => {
    const counts: Record<string, number> = {};
    for (const warning of run.warnings) {
      counts[warning.verifier] = (counts[warning.verifier] ?? 0) + 1;
    }
    expect(counts).toEqual(EXPECTED_WARNINGS);
  });

  it('verify: warning の区分(拡張候補 / 未分類)が記録どおりである', () => {
    // 拡張候補は台帳の候補に当たる警告(T2 = 仕組みの表の索引・A19 = 行の集合を材料にする計算)。未分類は 0。
    expect(run.buckets).toEqual({ accepted: 0, extension: 2, unclassified: 0 });
  });

  it('generate: 代表的な生成物が書き出されている', () => {
    const missing = REPRESENTATIVE_FILES.filter((file) => !run.generatedFiles.has(file));
    expect(missing).toEqual([]);
  });

  it('generate: 生成物の件数が落ち込んでいない', () => {
    expect(run.generatedFiles.size).toBeGreaterThanOrEqual(60);
    // 4 題材で同じ目にする(rooms / stores と同じく **件数を固定**する)—— 「落ち込んでいない」
    // だけでは、生成物が 1 種類黙って消えても気づけない(束 ⑲-3 の総点検)。
    const domainGenerated = [...run.generatedFiles.keys()].filter((file) =>
      file.startsWith('app/src/domain/generated/'),
    );
    expect(domainGenerated).toHaveLength(EXPECTED_DOMAIN_GENERATED);
  });

  it('typecheck: 生成された TS が本物のエンジンの型に合う', () => {
    expect(run.typecheck.diagnostics).toEqual([]);
    expect(run.typecheck.ok).toBe(true);
  });

  it('generate: 認証フロー仕様を持たないので、多要素認証の執行の配線は 1 か所も現れない', () => {
    expectMfaAbsent(run);
  });

  it('generate: 標識の置き場の問題が 0 件(実 CLI の generate が止まらない。block-check.ts)', () => {
    expect(run.placementProblems.map((problem) => problem.message)).toEqual([]);
  });

  it('sql: 保存点の複合 RPC が骨格を満たす', () => {
    expect(run.sql.problems).toEqual([]);
    expect(run.sql.usecaseFiles).toEqual([
      'supabase/migrations/20260911000001_usecase_claim_with_lines_register.sql',
    ]);
  });

  it('generate: RLS のポリシーと補助関数が生成され、字面の骨格を満たす', () => {
    // 束 ⑳-4a。明細の可視性は `context(claim)` であり、申請を辿る EXISTS になる。
    expect(run.sql.problems).toEqual([]);
    expect(run.sql.helperFiles).toEqual([
      'supabase/migrations/20260912110001_helper_is_employee.sql',
      'supabase/migrations/20260912110002_helper_is_accountant.sql',
    ]);
    expect(run.sql.policyFiles).toEqual([
      'supabase/migrations/20260912110101_policies_claims.sql',
      'supabase/migrations/20260912110102_policies_employees.sql',
      'supabase/migrations/20260912110103_policies_lines.sql',
    ]);
    const lines = run.generatedFiles.get('supabase/migrations/20260912110103_policies_lines.sql') ?? '';
    expect(lines).toContain('create policy lines_select_claim_owner_context');
    expect(lines).toContain('from public.claims b');
  });

  it('generate: 表の DDL が data_table ごとに 1 本出て、2 度流せる字面である', () => {
    expect(run.sql.problems).toEqual([]);
    expect(run.sql.ddlFiles).toEqual([
      'supabase/migrations/20260912120201_ddl_employees.sql',
      'supabase/migrations/20260912120202_ddl_claims.sql',
      'supabase/migrations/20260912120203_ddl_lines.sql',
      'supabase/migrations/20260912120204_ddl_jobs.sql',
      'supabase/migrations/20260912120205_ddl_domain_events.sql',
      'supabase/migrations/20260912120290_ddl_resend_digests.sql', // 保存点の再送の入力の要約(仕組みの表。点検 21 回目 A21-1)
    ]);
    // 束 ③-1: 仕組みが持つ 2 表(outbox・監査ログ)と api スキーマの土台は、題材が変わっても
    // 同じ 1 組が出る —— 列の正は設計図にあり、entity の値域だけがこの題材の集約から出る。
    const apiBase = run.generatedFiles.get('supabase/migrations/20260911000000_api_base.sql') ?? '';
    expect(apiBase).toContain('create schema if not exists api;');
    expect(apiBase).toContain('create or replace function api.actor_id() returns uuid');
    expect(apiBase).toContain('create or replace function api.is_end_user() returns boolean');
  });

  it('generate: 定型 5 形の RPC 本文が生成され、plpgsql の構文の釣り合いを満たす', () => {
    // 本文が生成物になったのは束 ⑳-2 である。骨格(関数定義の頭・$$ の対応)に加え、
    // begin/end・if/end if・loop/end loop・丸括弧・権限の 3 行まで通し実行が見る。
    expect(run.sql.problems).toEqual([]);
    expect(run.sql.rpcFiles).toEqual([
      'supabase/migrations/20260912100001_rpc_insert_claim.sql',
      'supabase/migrations/20260912100002_rpc_apply_claim_transition.sql',
      'supabase/migrations/20260912100003_rpc_update_claim.sql',
      'supabase/migrations/20260912100004_rpc_delete_claim.sql',
      'supabase/migrations/20260912100005_rpc_insert_line.sql',
      'supabase/migrations/20260912100006_rpc_update_line.sql',
      'supabase/migrations/20260912100007_rpc_delete_line.sql',
    ]);
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
  it('generate: RLS の挙動テストと world の設計図が表ごとに生成される(束 ⑳-4b)', () => {
    expect(rlsBehaviourTests(run)).toEqual([
      'app/src/infrastructure/__tests__/generated/rls/claims.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/employees.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/lines.rls.test.ts',
    ]);
    const worlds = run.generatedFiles.get('app/src/domain/generated/rls-worlds.ts') ?? '';
    // **同じ相手を指す参照が 2 本ある集約(claim は employee_id と approver_id)は別人を指す。**
    // 1 行に畳むと 2 つの束縛(claim_owner / approver)が必ず同時に立ち、述語の列を隣に
    // 取り違えても検査が緑のままになる(独立レビュー ⑳-4b ②)。
    expect(worlds).toContain("employee_id: 'claim_owner:employee'");
    expect(worlds).toContain("approver_id: 'claim_owner:employee#claim.approver_id'");
    // 承認者の系統では逆になる(自分の束縛の列だけが実行者自身を指す)。
    expect(worlds).toContain("approver_id: 'approver:employee'");
    expect(worlds).toContain("employee_id: 'approver:employee#claim.employee_id'");
    // 分けた行は実行者ではない(claim の欄も真にならない)。
    expect(worlds).toContain("key: 'claim_owner:employee#claim.approver_id'");
    const lines = run.generatedFiles.get('app/src/infrastructure/__tests__/generated/rls/lines.rls.test.ts') ?? '';
    expect(lines).toContain('const WORLD = rlsWorlds.lines;');
    // ログインしているが実行者の集約に行が無い人が world に必ずいる(補助関数の判定を実行する)。
    expect(lines).toContain("await expectVisibleRows(WORLD, built, 'employee_without_row');");
  });

  it('generate: 結果表(元データと折り畳みの表)が生成される(束 ⑳-5b)', () => {
    expectResultTables(run);
  });
});
