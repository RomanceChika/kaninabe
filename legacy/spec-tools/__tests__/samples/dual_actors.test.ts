/**
 * サンプルシステム `dual_actors`(実行者の集約が 2 つある題材)—— **実測を記録する fixture**。
 *
 * ほかの 4 題材(expenses / stores / library / rooms)は「仕組みを 1 往復通る」ことを確かめる
 * 既知解テストだが、この fixture だけは**通らないことを記録する**。検査の漏れ探し(2026-09-12 §6)が
 * 「実行者(actor)の集約はちょうど 1 つ」「実行者の集約が状態機械を持つ形が 4 題材のどれにも
 * 無い」という前提を**未検証**として挙げたので、その形を最小の仕様で作り、**どこで止まるか**を
 * 1 か所に固定した。
 *
 * **直さない。** ここに並ぶのは「この体系がいま受け付けない形」であり、直すかどうかは
 * DSL 拡張の判断(dsl-extension-triage.md)である。固定しておけば、将来その軸を開けたときに
 * このテストが落ちて「開いた」ことが機械で分かる。
 *
 * 題材の形(狙って踏んでいるもの):
 *   - **実行者になりうる集約が 2 つ**(顧客 `customer` / 従業員 `employee`)。どちらも
 *     `session: true` の欄と `{集約}.account_id == actor.id` の文脈ロールを持つ
 *   - **実行者の集約が状態機械を持つ**(顧客: 仮登録 → 本登録 → 停止)。題材の製品の `membership`
 *     と同じ形で、4 題材のどれにも無かった
 *   - 一方の実行者(従業員)が**もう一方の集約(顧客)を操作する**
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { runSampleSystem } from './harness.js';
import type { SampleRun } from './harness.js';

/**
 * いま止まる場所(検証器 ID → 件数)。**これは合格基準ではなく実測の記録**である。
 *
 *   - `V11` … 文脈依存ロールは「対象の集約から `context` で辿れる集約」の欄にしか接地できない。
 *     実行者が 2 種いると、片方の実行者ロール(`employee_self`)はもう片方の集約(`customer`)の
 *     `by` / `reads` に書けない —— **2 人目の実行者は 1 人目の集約を操作できない**。
 *     現実の逃げ道はグローバルロール(`kind: authenticated_default` の下に置く staff 的な役)に
 *     することだが、それは「従業員の行と結びついた本人性」を捨てる別の設計である。
 *   - `V13` … `session: true` は 1 集約にしか置けない(セッションが運ぶ欄の出どころを 1 つに
 *     保つための宣言)。実行者が 2 種いると、2 人目のセッション属性を宣言する場所が無い。
 */
const EXPECTED_ERRORS: Readonly<Record<string, number>> = {
  V11: 3,
  V13: 1,
};

/**
 * 生成側でも止まる —— セッション属性の型(`session-profile.ts`)が**同じ欄名を 2 度**宣言する。
 *
 * V13 を warning に緩めても生成物が型エラーになるので、「実行者の集約 2 つ」を開けるには
 * セッション属性の**出どころを集約ごとに分ける**形(名前空間)が要る、という実測である。
 */
const EXPECTED_TYPE_ERROR = "Duplicate identifier 'display_name'";

describe('サンプルシステム dual_actors(実行者の集約が 2 つ)— 止まる場所の記録', () => {
  let run: SampleRun;

  beforeAll(async () => {
    run = await runSampleSystem('dual_actors');
  });

  // **標識の置き場の問題の期待(0 件)をこの題材は持たない。** 実 CLI の `generate` は検証の error で
  // 生成の前に止まる(`generationBlockingErrors`)ので、この題材は置き場の検査に**届かない** —— 0 件を期待しても
  // 常に真で何も確かめない。「届かない」ことそのものは下の期待(error が V11 / V13 ちょうどで、1 件でも欠けたら落ちる)が持つ。
  // ここのハーネスが生成を実行するのは「止まるのは型の側」を実測する記録のためである。
  it('verify: 止まる場所が記録どおりである(実行者が 2 種いると通らない)', () => {
    const actual: Record<string, number> = {};
    for (const finding of run.errors) {
      actual[finding.verifier] = (actual[finding.verifier] ?? 0) + 1;
    }

    expect(actual).toEqual(EXPECTED_ERRORS);
  });

  it('verify: warning は 1 件も出ない(止まっているのは error の 2 軸だけ)', () => {
    expect(run.warnings.map((finding) => `${finding.verifier} ${finding.message}`)).toEqual([]);
  });

  it('verify: warning の区分は拡張候補 0・未分類 0(警告が 1 件も無い)', () => {
    expect(run.buckets).toEqual({ accepted: 0, extension: 0, unclassified: 0 });
  });

  it('generate: 仕様が止まっていても生成そのものは走る(止まるのは型の側)', () => {
    expect(run.generatedFiles.size).toBeGreaterThan(0);
  });

  it('generate: セッション属性の型が同じ欄名を 2 度宣言して落ちる', () => {
    expect(run.typecheck.ok).toBe(false);
    expect(run.typecheck.diagnostics.some((line) => line.includes(EXPECTED_TYPE_ERROR))).toBe(true);
  });

  it('generate: 生成物にホスト(製品)の語が 1 つも出ない', () => {
    expect(run.vocabularyLeaks.map((leak) => `${leak.file}: ${leak.word}`)).toEqual([]);
  });

  it('generate: 生成コードに文言表の外の日本語が出ない', () => {
    expect(run.unexplainedWording.map((entry) => `${entry.file}: ${entry.text}`)).toEqual([]);
  });
});
