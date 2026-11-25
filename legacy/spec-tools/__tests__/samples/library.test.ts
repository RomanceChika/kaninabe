/**
 * サンプルシステム `library`(図書の貸出)を仕組みに 1 往復通す既知解テスト。
 *
 * 別の製品とは語彙も形も違う題材を、**本物のローダー・検証器・
 * 生成器**に通す。ここが落ちたら、落ちたのは fixture ではなく**仕組みが製品の構造を
 * 暗に前提にしていた**という実測である(束 ⑱)。fixture を通すために `lib/**` へ特別扱いを
 * 足してはならない —— 直すべきは仕組みの一般性か、仕様の書き方のどちらかである。
 *
 * 題材の形(狙って踏んでいるもの):
 *   - 時刻のガード(`now > loan.due_at`)
 *   - 数量の不変条件(同時貸出は 3 冊まで = `cardinality` をトリガで執行)
 *   - `supplied_by: db`(返却期限をトリガが逆算して埋める)+ enum の `labels`
 *   - `claim` のグローバルロール(司書)と 2 つの文脈ロール(借受本人・予約本人)
 *   - **認証の決定表**(`auth.md`)を**この題材の語で**書く —— 主語は状態機械ではなく
 *     `enum` の欄(`kind: field` / `subject: patron.card`)、軸の名前は `card` / `desk`。
 *     束 ⑱ ではここが「`axes` に id: member がありません」で 1 行も書けず、fixture から
 *     auth.md を落としていた(束 ⑲-2a で軸の宣言が開いた)
 *   - 保存点(`defaults.self` の「自分として」/ 予約 → 受取の 2 保存点)
 *   - **保証台帳**(`guarantees.md`)—— Z 群が 4 題材で一度も走っていなかった(束 ㉑ で追加)。
 *     束 ㉑ では `status: planned` を 1 本持たせて Z2 を踏んでいたが、題材に「次の版」の未処理を
 *     置かないことにして外した(束 題材-未分類。Z2 の単体の検証は `__tests__/unit/guarantee/` が持つ)
 *   - **カウンターの画面**(`desk` / `desk_holds`)—— 貸出の表を持つ `desk` と予約の表を持つ `desk_holds` の
 *     2 画面に分け、1 画面の行のボタンの数(U4)を目安に収めた(相互に遷移で行き来できる)。確認が要る操作は
 *     確認の重ね表示に載せ、窓口の流れの操作(受け取り・返却・取り置き・取置の受取)は action_spec の `ux` で
 *     「戻れないことは認めたうえで損害が小さく頻度が高い」を理由に確認なしと決めた(2026-10-06 題材の裁定)
 *   - **履歴の読み取り経路**(`loan_own_history` / `hold_own_history`)—— 終端の状態(返却済み・
 *     受取済み・取消)を `my_library` に見せる(S14)。貸出の履歴の表は生成の表(`kind: table`)で書き、
 *     生成部品の文言が文言表の外の日本語を出さないことも確かめる
 *
 * **warning は消し込まない。** 件数と内訳をここで固定して記録する —— 残る警告は仕組みの宿題
 * (拡張候補)だけで、未分類は 0 件である。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { runSampleSystem } from './harness.js';
import { expectMfaWired } from './mfa-expect.js';
import { expectResultTables } from './results-expect.js';
import type { SampleRun } from './harness.js';

/** 生成物の代表(層ごとに 1 つずつ。ここが欠けたら写像そのものが動いていない)。 */
const REPRESENTATIVE_FILES: readonly string[] = [
  'app/src/domain/generated/loan.transitions.ts', // 遷移表(状態機械)
  'app/src/domain/generated/loan.schema.ts', // zod(entity_spec)
  'app/src/domain/generated/item.labels.ts', // enum の表示名(V16)
  'app/src/domain/generated/rls-expectations.ts', // 期待 RLS(access_spec の reads)
  'app/src/domain/generated/query-windows.ts', // スコープ条件(query_spec の via)
  'app/src/domain/generated/testids.ts', // testid の骨格(screen_spec)
  'app/src/domain/generated/usecase-plans.ts', // 保存点の実行計画(usecase_spec)
  'app/src/domain/generated/rpc-signatures.ts', // 引数名の写し(data_table の params)
  'app/src/domain/generated/tokens.ts', // デザイントークン(design_token_spec)
  'app/src/domain/generated/auth.ts', // サインインの決定表(auth_spec。軸の名前は card / desk)
  'docs/book/auth.html', // ハンドブックの認証の章(導入の文に製品の語が出ない)
  'docs/book/domain/loan.html', // ハンドブックの集約の章
  'supabase/migrations/20260911090000_usecase_borrow_self_borrow.sql', // 複合 RPC
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
  // T16 (e): `INV-LOAN-002`(利用者あたりの貸出上限)の**執行点が一度も実在していない**。
  // 件数の上限は行の CHECK に反映されず、執行点は別の行を数えるトリガになる。条件トリガの本文は
  // 形式定義から生成できるが(2026-09-26。行内比較・一意・排他に写せるものだけ)、件数の上限
  // (cardinality)は写像の外なので本文を作れない(拡張候補 X-trigger-bodies)。実在しない執行点の行は
  // data_table に置かず、`enforced_by` は残してこの警告に報告させる(束 CHECK 生成の裁定。束 ③-4 の実測)。
  T16: 1,
};

/** `app/src/domain/generated/**` の件数(増えたら気づく。rooms / stores と同じ目)。 */
const EXPECTED_DOMAIN_GENERATED = 57;  // 掴みの宣言の期待の表 lock-expectations.ts が 1 本増えた(data_table を持つ製品は常に。宣言が無ければ空の表。点検 19 回目)。 送信の上限の期待の表 send-limit-expectations.ts が 1 本増えた(data_table を持つ製品は常に。宣言が無ければ空の表)。 外部の SDK の置き場の表 sdk-homes.json が 1 本増えた(実装の木を持つ製品は常に。B9-4)。 ブラウザ側の守りで browser-defense.ts が 1 本増えた(アプリの枠の後段の生成器)。 束 C′ で acl-expectations.ts が 1 本増え、束 ①-b で plan-types.ts が外れた(ADR-0013)、手 3 で runtime-bindings.ts が 1 本増えた

/** 生成された RLS の挙動テスト(束 ⑳-4b。表名順)。 */
function rlsBehaviourTests(run: SampleRun): readonly string[] {
  return [...run.generatedFiles.keys()]
    .filter((file) => file.startsWith('app/src/infrastructure/__tests__/generated/rls/'))
    .sort();
}

describe('サンプルシステム library(図書の貸出)を仕組みに通す', () => {
  let run: SampleRun;

  beforeAll(async () => {
    run = await runSampleSystem('library');
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
    // 拡張候補は台帳の候補に当たる警告(T2 = 仕組みの表の索引・T16 = 執行点がトリガで形式定義が写像の外のもの 1)。
    // 未分類は台帳に載っていない警告で、この題材は 0 件(上の内訳は T2・T16 の 2 件だけ)。
    expect(run.buckets).toEqual({ accepted: 0, extension: 2, unclassified: 0 });
  });

  it('generate: 各層の代表的な生成物が書き出される', () => {
    const missing = REPRESENTATIVE_FILES.filter((file) => !run.generatedFiles.has(file));
    expect(missing).toEqual([]);
    expect(run.generatedFiles.size).toBeGreaterThanOrEqual(140);
    // 4 題材で同じ目にする(rooms / stores と同じく **件数を固定**する)—— 下限だけでは、
    // 生成物が 1 種類黙って消えても気づけない(束 ⑲-3 の総点検)。
    const domainGenerated = [...run.generatedFiles.keys()].filter((file) =>
      file.startsWith('app/src/domain/generated/'),
    );
    expect(domainGenerated).toHaveLength(EXPECTED_DOMAIN_GENERATED);
  });

  it('generate: 生成された TS が本物のエンジンの型に合う', () => {
    expect(run.typecheck.diagnostics).toEqual([]);
    expect(run.typecheck.ok).toBe(true);
  });

  it('generate: 多要素認証の要求(司書だけ)が書き込みの入口に通る(Server Action が済ませたかを解決し、束が範囲を運ぶ)', () => {
    expectMfaWired(run, "mfa: { scope: 'roles', roles: ['librarian'] }");
  });

  it('generate: 標識の置き場の問題が 0 件(実 CLI の generate が止まらない。block-check.ts)', () => {
    expect(run.placementProblems.map((problem) => problem.message)).toEqual([]);
  });

  it('generate: 保存点の複合 RPC が 3 本、骨格を満たす SQL として出る', () => {
    expect(run.sql.problems).toEqual([]);
    expect(run.sql.usecaseFiles).toEqual([
      'supabase/migrations/20260911090000_usecase_borrow_self_borrow.sql',
      'supabase/migrations/20260911090100_usecase_hold_and_collect_place.sql',
      'supabase/migrations/20260911090200_usecase_hold_and_collect_collect.sql',
    ]);
  });

  it('generate: RLS のポリシーと補助関数が生成され、字面の骨格を満たす', () => {
    // 束 ⑳-4a。`claim` のグローバルロール(司書)は補助関数に、文脈ロール(借受本人)は
    // 対象の行の列と実行者 id の比較に落ちる。
    expect(run.sql.problems).toEqual([]);
    expect(run.sql.helperFiles).toEqual([
      'supabase/migrations/20260912110001_helper_is_patron.sql',
      'supabase/migrations/20260912110002_helper_is_librarian.sql',
    ]);
    expect(run.sql.policyFiles).toEqual([
      'supabase/migrations/20260912110101_policies_holds.sql',
      'supabase/migrations/20260912110102_policies_items.sql',
      'supabase/migrations/20260912110103_policies_loans.sql',
      'supabase/migrations/20260912110104_policies_patrons.sql',
    ]);
    // 蔵書目録は館外に公開する = 未ログインのロールは `to anon` で、根拠の述語は持たない。
    expect(run.generatedFiles.get('supabase/migrations/20260912110102_policies_items.sql') ?? '').toContain(
      'for select to anon',
    );
    // 自分が借りた貸出だけ = 対象の行の列と実行者 id の比較(EXISTS ではない)。
    expect(run.generatedFiles.get('supabase/migrations/20260912110103_policies_loans.sql') ?? '').toContain(
      'loans.patron_id',
    );
  });

  it('generate: 表の DDL が data_table ごとに 1 本出て、2 度流せる字面である', () => {
    expect(run.sql.problems).toEqual([]);
    expect(run.sql.ddlFiles).toEqual([
      'supabase/migrations/20260912120201_ddl_items.sql',
      'supabase/migrations/20260912120202_ddl_patrons.sql',
      'supabase/migrations/20260912120203_ddl_holds.sql',
      'supabase/migrations/20260912120204_ddl_loans.sql',
      'supabase/migrations/20260912120205_ddl_jobs.sql',
      'supabase/migrations/20260912120206_ddl_domain_events.sql',
      'supabase/migrations/20260912120290_ddl_resend_digests.sql', // 保存点の再送の入力の要約(仕組みの表。点検 21 回目 A21-1)
    ]);
    // 束 ③-1: 仕組みが持つ 2 表(outbox・監査ログ)と api スキーマの土台は、題材が変わっても
    // 同じ 1 組が出る —— 列の正は設計図にあり、entity の値域だけがこの題材の集約から出る。
    const apiBase = run.generatedFiles.get('supabase/migrations/20260911080000_api_base.sql') ?? '';
    expect(apiBase).toContain('create schema if not exists api;');
    expect(apiBase).toContain('create or replace function api.actor_id() returns uuid');
    expect(apiBase).toContain('create or replace function api.is_end_user() returns boolean');
  });

  it('generate: 定型 5 形の RPC 本文が生成され、plpgsql の構文の釣り合いを満たす', () => {
    // 本文が生成物になったのは束 ⑳-2 である。骨格(関数定義の頭・$$ の対応)に加え、
    // begin/end・if/end if・loop/end loop・丸括弧・権限の 3 行まで通し実行が見る。
    expect(run.sql.problems).toEqual([]);
    expect(run.sql.rpcFiles).toEqual([
      'supabase/migrations/20260912100001_rpc_insert_hold.sql',
      'supabase/migrations/20260912100002_rpc_apply_hold_transition.sql',
      'supabase/migrations/20260912100003_rpc_insert_item.sql',
      'supabase/migrations/20260912100004_rpc_apply_item_transition.sql',
      'supabase/migrations/20260912100005_rpc_insert_loan.sql',
      'supabase/migrations/20260912100006_rpc_apply_loan_transition.sql',
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

  it('generate: 生成部品(kind: table)を使う画面があり、置き場の表示名も文言表から出る(束 F-warn-ledger-c)', () => {
    // 生成部品を使う題材は製品だけだった。my_library の履歴の表(kind: table)で、期待木の
    // 「既定のスタイル」「競合の表示の部品」の表示名(structure-expectations.ts)が文言表の語であることを見る。
    const files = [...run.generatedFiles.keys()];
    expect(files.some((file) => file.startsWith('app/src/app/_screens/generated/my_library.'))).toBe(true);
    const expectations = run.generatedFiles.get('app/src/domain/generated/structure-expectations.ts') ?? '';
    expect(expectations).toContain('(既定のスタイル)');
    expect(expectations).toContain('(競合の表示の部品)');
  });

  it('generate: RLS の挙動テストと world の設計図が表ごとに生成される(束 ⑳-4b)', () => {
    // world を作れない表は生成されず、理由が T8 の warning に出る(この題材は 4 表すべて作れる)。
    expect(rlsBehaviourTests(run)).toEqual([
      'app/src/infrastructure/__tests__/generated/rls/holds.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/items.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/loans.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/patrons.rls.test.ts',
    ]);
    const worlds = run.generatedFiles.get('app/src/domain/generated/rls-worlds.ts') ?? '';
    // 実行者は「ポリシーに現れるロールごと + 既定のログイン + 未ログイン」。
    expect(worlds).toContain("role: 'librarian'");
    expect(worlds).toContain("role: 'patron'");
    expect(worlds).toContain("role: 'anonymous'");
    // 束縛は「どの集約のどの列を実行者と比べるか」まで開いて渡す(オラクルは道を辿り直さない)。
    expect(worlds).toContain("      entity: 'loan',\n      column: 'patron_id',\n      many: false,");
    const loans = run.generatedFiles.get('app/src/infrastructure/__tests__/generated/rls/loans.rls.test.ts') ?? '';
    expect(loans).toContain('const WORLD = rlsWorlds.loans;');
    expect(loans).toContain("await expectVisibleRows(WORLD, built, 'loan_owner');");
  });

  it('generate: 結果表(元データと折り畳みの表)が生成される(束 ⑳-5b)', () => {
    expectResultTables(run);
  });
});
