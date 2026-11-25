/**
 * サンプルシステム `rooms`(会議室の予約)を仕組みに 1 往復通す既知解テスト。
 *
 * 別の製品とは語彙も形も違う題材を、**本物のローダー・検証器・
 * 生成器**に通す。ここが落ちたら、落ちたのは fixture ではなく**仕組みが製品の構造を
 * 暗に前提にしていた**という実測である(束 ⑱)。fixture を通すために `lib/**` へ特別扱いを
 * 足してはならない —— 直すべきは仕組みの一般性か、仕様の書き方のどちらかである。
 *
 * 題材の形(狙って踏んでいるもの):
 *   - 一意制約の不変条件(同じ部屋の重なる時間帯は 1 つだけ = INV-BOOKING-001)
 *   - 文脈ロールが**別集約経由**で立つ(`department_admin` = 部屋を持つ部門の管理者)
 *   - `supplied_by: db`(予約番号を列の既定値が採番)+ enum の `labels`(利用目的)
 *   - 保存点 1 つのユースケース(仮押さえ → 確定を 1 回の保存で実行する複合 RPC)
 *
 * **warning は消し込まない。** 件数と内訳をここで固定して記録する —— 消すために仕様を
 * ゆがめると「面倒だった事実」が記録から消えるためである。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { runSampleSystem } from './harness.js';
import { expectMfaAbsent } from './mfa-expect.js';
import { expectResultTables } from './results-expect.js';
import type { SampleRun } from './harness.js';

/** 生成物の代表(層ごとに 1 つずつ。ここが欠けたら写像そのものが動いていない)。 */
const REPRESENTATIVE_FILES: readonly string[] = [
  'app/src/domain/generated/booking.transitions.ts', // 遷移表(状態機械)
  'app/src/domain/generated/booking.schema.ts', // zod(entity_spec)
  'app/src/domain/generated/booking.labels.ts', // enum の表示名(V16)
  'app/src/domain/generated/rls-expectations.ts', // 期待 RLS(access_spec の reads)
  'app/src/domain/generated/index-expectations.ts', // query_spec から導いた索引(T2)
  'app/src/domain/generated/query-windows.ts', // スコープ条件(query_spec の via)
  'app/src/domain/generated/operation-plans.ts', // 単発の操作の実行計画(A15)
  'app/src/domain/generated/usecase-plans.ts', // 保存点の実行計画(usecase_spec)
  'app/src/domain/generated/testids.ts', // testid の骨格(screen_spec)
  'app/src/app/_actions/usecase/book_room/reserve.ts', // 保存点の Server Action
  'docs/book/domain/booking.html', // ハンドブックの集約の章
  'supabase/migrations/20260911000001_usecase_book_room_reserve.sql', // 複合 RPC
];

/**
 * 記録している warning の内訳(検証器 ID → 件数)。
 *
 * **0 件である。** 仕様だけのツリー(docs/rules を持たない)であることは M0 の警告に
 * ならない —— ディレクトリごと無い構成は正当な形であり、M0 が見るのは「ディレクトリはあるのに
 * 0 件」だけである(束 ⑲-1 #7)。
 */
const EXPECTED_WARNINGS: Readonly<Record<string, number>> = {
  // T2: 仕組みの表 jobs の取り出しの索引(jobs_due_idx)は、この題材の query_spec・関数の lookup から導けない。
  // 引くのは claim_due_jobs だが、その本文は製品の手書き migration にしか無く、題材の DB は生成
  // migration と仕組みの表の DDL だけで組まれる。**関数の宣言を題材に写すと、構造の突合
  // (data-table-parity)が「宣言した関数が DB に無い」で赤くなる**ので写さない。仕組みの表の関数の本文は
  // 仕組み側が配るべきで、題材に手書き migration は置かない(1 か所に寄せる話は BACKLOG)。
  // 監査ログの時系列の索引は、引く者が居ないので題材から外した(束 F-index-b)。
  T2: 1,
  // T16 (e): `INV-BOOKING-003`(部屋あたりの件数の上限)の**執行点が一度も実在していない**。
  // 条件トリガの本文は形式定義から生成できるが(2026-09-26。行内比較・一意・排他に写せるものだけ)、
  // 件数の上限(cardinality)は写像の外なので本文を作れない(拡張候補 X-trigger-bodies)。
  // 実在しない執行点の行は data_table に置かず、`enforced_by` は残してこの警告に
  // 「誰も守っていない」を報告させる(束 CHECK 生成の裁定。束 ③-4 の実測)。
  T16: 1,
  // T8 / T11 は出ない: 検査の足場の集約 feedback の未ログインの作成の天井(`creates[].abuse`)の生成トリガは、天井が world の行と
  // 実行中の作成を収める(2 以上)ので world を妨げない(rls-world-vacuous.ts。点検 20 回目 B20-1 の残り 3)。以前はここで T8 / T11 が
  // 1 件ずつ出て、feedback の RLS の挙動テストと一致の証明は生成されなかった。
};

/** 生成される `app/src/domain/generated/**` の件数(仕組みが生成物を増減させたら動く)。 */
const EXPECTED_DOMAIN_GENERATED = 57;  // 掴みの宣言の期待の表 lock-expectations.ts が 1 本増えた(data_table を持つ製品は常に。宣言が無ければ空の表。点検 19 回目)。 送信の上限の期待の表 send-limit-expectations.ts が 1 本増えた(data_table を持つ製品は常に。宣言が無ければ空の表)。 外部の SDK の置き場の表 sdk-homes.json が 1 本増えた(実装の木を持つ製品は常に。B9-4)。 検査の足場の集約 feedback が {entity} ごとの生成物を 4 本足した。 ブラウザ側の守りで browser-defense.ts が 1 本増えた(アプリの枠の後段の生成器)。 束 C′ で acl-expectations.ts が 1 本増え、束 ①-b で plan-types.ts が外れた(ADR-0013)、手 3 で runtime-bindings.ts が 1 本増えた、束 画面 3a で FieldLabels が全 entity に出るようになり {entity}.labels.ts が増えた

/** 生成された RLS の挙動テスト(束 ⑳-4b。表名順)。 */
function rlsBehaviourTests(run: SampleRun): readonly string[] {
  return [...run.generatedFiles.keys()]
    .filter((file) => file.startsWith('app/src/infrastructure/__tests__/generated/rls/'))
    .sort();
}

describe('サンプルシステム rooms(会議室の予約)を仕組みに通す', () => {
  let run: SampleRun;

  beforeAll(async () => {
    run = await runSampleSystem('rooms');
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
    // 拡張候補は台帳の候補に当たる警告(T2 = 仕組みの表の索引・T16 = 執行点がトリガで形式定義が写像の外のもの 1)。未分類は台帳に載っていない警告で、この題材は 0。
    // 未分類をどう扱うか(台帳に候補を足す・検査ごとの受け入れの形を作る)は review-queue の判断で、ここでは数だけ固定する。
    expect(run.buckets).toEqual({ accepted: 0, extension: 2, unclassified: 0 });
  });

  it('generate: 再送で既存の行を返さない表(resend.returns_existing: false)には「1 回目の行を返す」でなく「既に保存されている」の送り直しの性質が生える', () => {
    // feedbacks / rooms は返さない宣言(2 回目は約束どおり UC409)。前者を当てると約束を赤と読んでいた(samples:db で実測。fix20 の 5 回目)。
    for (const aggregate of ['feedback', 'room']) {
      const eq = [...run.generatedFiles.entries()].find(([file]) => file.endsWith(`/${aggregate}.eq.test.ts`))?.[1] ?? '';
      expect(eq, aggregate).toContain(`${aggregate}.create の全`);
      expect(eq, aggregate).not.toContain('expectResendReturnsSameRow(');
      expect(eq, aggregate).toContain(`expectResendAlreadySaved(WORLD, built, '${aggregate}.create')`);
    }
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

  it('generate: 認証フロー仕様を持たないので、多要素認証の執行の配線は 1 か所も現れない', () => {
    expectMfaAbsent(run);
  });

  it('generate: 標識の置き場の問題が 0 件(実 CLI の generate が止まらない。block-check.ts)', () => {
    expect(run.placementProblems.map((problem) => problem.message)).toEqual([]);
  });

  it('generate: 保存点の複合 RPC が 1 本、骨格を満たす SQL として出る', () => {
    expect(run.sql.problems).toEqual([]);
    expect(run.sql.usecaseFiles).toEqual([
      'supabase/migrations/20260911000001_usecase_book_room_reserve.sql',
    ]);
  });

  it('generate: RLS のポリシーと補助関数が生成され、字面の骨格を満たす', () => {
    // 束 ⑳-4a。部門管理者の可視性は `context(department)` であり、予約 → 部屋 → 部門と
    // 参照を 2 段辿る EXISTS になる。
    expect(run.sql.problems).toEqual([]);
    expect(run.sql.helperFiles).toEqual(['supabase/migrations/20260912110001_helper_is_user.sql']);
    expect(run.sql.policyFiles).toEqual([
      'supabase/migrations/20260912110101_policies_bookings.sql',
      'supabase/migrations/20260912110102_policies_departments.sql',
      'supabase/migrations/20260912110103_policies_rooms.sql',
      'supabase/migrations/20260912110104_policies_users.sql',
      'supabase/migrations/20260912110105_policies_feedbacks.sql',
    ]);
    const bookings = run.generatedFiles.get('supabase/migrations/20260912110101_policies_bookings.sql') ?? '';
    expect(bookings).toContain('create policy bookings_select_department_admin_context');
    expect(bookings).toContain('from public.departments b');
  });

  it('generate: 表の DDL が data_table ごとに 1 本出て、2 度流せる字面である', () => {
    // 束「DDL 生成」。排他制約を持つ bookings は btree_gist の拡張と `exclude using gist` を持つ。
    expect(run.sql.problems).toEqual([]);
    expect(run.sql.ddlFiles).toEqual([
      'supabase/migrations/20260912120201_ddl_users.sql',
      'supabase/migrations/20260912120202_ddl_departments.sql',
      'supabase/migrations/20260912120203_ddl_rooms.sql',
      'supabase/migrations/20260912120204_ddl_bookings.sql',
      'supabase/migrations/20260912120205_ddl_jobs.sql',
      'supabase/migrations/20260912120206_ddl_domain_events.sql',
      'supabase/migrations/20260912120207_ddl_feedbacks.sql',
      'supabase/migrations/20260912120290_ddl_resend_digests.sql', // 保存点の再送の入力の要約(仕組みの表。点検 21 回目 A21-1)
    ]);
    // 束 ③-1: 仕組みが持つ 2 表(outbox・監査ログ)と api スキーマの土台は、題材が変わっても
    // 同じ 1 組が出る —— 列の正は設計図にあり、entity の値域だけがこの題材の集約から出る。
    const apiBase = run.generatedFiles.get('supabase/migrations/20260911000000_api_base.sql') ?? '';
    expect(apiBase).toContain('create schema if not exists api;');
    expect(apiBase).toContain('create or replace function api.actor_id() returns uuid');
    expect(apiBase).toContain('create or replace function api.is_end_user() returns boolean');
    const bookings = run.generatedFiles.get('supabase/migrations/20260912120204_ddl_bookings.sql') ?? '';
    expect(bookings).toContain('create extension if not exists btree_gist with schema extensions;');
    expect(bookings).toContain('exclude using gist (');
    expect(bookings).toContain("tstzrange(starts_at, ends_at, '[)') with &&");
  });

  it('generate: 定型 5 形の RPC 本文が生成され、plpgsql の構文の釣り合いを満たす', () => {
    // 本文が生成物になったのは束 ⑳-2 である。骨格(関数定義の頭・$$ の対応)に加え、
    // begin/end・if/end if・loop/end loop・丸括弧・権限の 3 行まで通し実行が見る。
    expect(run.sql.problems).toEqual([]);
    expect(run.sql.rpcFiles).toEqual([
      'supabase/migrations/20260912100001_rpc_apply_booking_transition.sql',
      'supabase/migrations/20260912100002_rpc_insert_booking.sql',
      'supabase/migrations/20260912100003_rpc_update_booking.sql',
      'supabase/migrations/20260912100004_rpc_delete_booking.sql',
      'supabase/migrations/20260912100005_rpc_update_department.sql',
      'supabase/migrations/20260912100006_rpc_insert_room.sql',
      'supabase/migrations/20260912100007_rpc_update_room.sql',
      'supabase/migrations/20260912100008_rpc_delete_room.sql',
      'supabase/migrations/20260912100009_rpc_insert_feedback.sql',
      'supabase/migrations/20260912100010_rpc_delete_feedback.sql',
    ]);
  });

  it('fixture の散文が仕様と食い違っていない(所属部門は input で受けず、DB が写す)', () => {
    // この散文は生成物(action body・ハンドブック)にそのまま載る経路なので、仕様を直したら
    // 散文も直る必要がある(束 ⑲-1: 回避を外したのに「input で受けている」が残っていた)。
    const spec = readFileSync(
      fileURLToPath(new URL('../fixtures/samples/rooms/docs/specs/backend/actions/booking/create.md', import.meta.url)),
      'utf8',
    );

    expect(spec).not.toContain('booking.department_id');
    expect(spec).not.toContain('input で受けている');
    expect(spec).toContain('supplied_by: db');
  });

  /**
   * **2 段先の束縛がスコープ条件に落ちること**(束 ⑲-2a)。
   *
   * 束 ⑱ では `booking → room → department` が 1 段で届かず、`booking` に `department_id` の
   * 写しの列を持たせ、それを埋めるトリガ(`sync_booking_department`)と一致を守る不変条件
   * (INV-BOOKING-004)を足していた。いまは `context` の連鎖を 2 段辿るので、
   *   - 予約の表に部門の列は無い
   *   - スコープ条件は埋め込みを重ねた列パス(`rooms.departments.admin_id`)になる
   * の 2 つで同じ可視性が成立する。**スコープ条件が空でないこと**をここで固定する —— 空になると
   * 「宣言より広い集合が返る」という最も気づきにくい形に戻る。
   */
  it('generate: 2 段先の束縛がスコープ条件の列パスに落ちる(写しの列を持たない)', () => {
    const windows = run.generatedFiles.get('app/src/domain/generated/query-windows.ts') ?? '';
    expect(windows).toContain("'rooms.departments.admin_id'");
    // 予約の表に部門の写しの列は無い(段を辿るので要らない)。
    const schema = run.generatedFiles.get('app/src/domain/generated/booking.schema.ts') ?? '';
    expect(schema).not.toContain('department_id');
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
      'app/src/infrastructure/__tests__/generated/rls/bookings.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/departments.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/feedbacks.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/rooms.rls.test.ts',
      'app/src/infrastructure/__tests__/generated/rls/users.rls.test.ts',
    ]);
    const worlds = run.generatedFiles.get('app/src/domain/generated/rls-worlds.ts') ?? '';
    // 実行者の集約(session: true を宣言した 1 つ)の表は設計図が示す。
    expect(worlds).toContain("actorTable: 'users'");
    const bookings = run.generatedFiles.get('app/src/infrastructure/__tests__/generated/rls/bookings.rls.test.ts') ?? '';
    expect(bookings).toContain('const WORLD = rlsWorlds.bookings;');
    expect(bookings).toContain('await createRlsWorld(WORLD);');
  });

  it('generate: 結果表(元データと折り畳みの表)が生成される(束 ⑳-5b)', () => {
    expectResultTables(run);
  });
});
