import type { RunPlan } from '@kaninabe/runtime/plan';
import type { InvariantResolver } from '@kaninabe/runtime/bindings';
import { classifyDbFailure, sqlstateOrNull } from '@kaninabe/runtime/refusal';
import { REFUSALS } from '@kaninabe/runtime/refusal/refusal-codes';
import type { HarnessPorts } from '../harness/ports.mjs';
import { eqPg } from '../equivalence/world.mjs';
import type { EqSaveWorld } from './types.mjs';
import type { BuiltEqWorld, EqSaveSelection, EqSaveSubject } from './world.mjs';
import { placeSaveCase } from './place.mjs';
import type { EqSaveExpectation } from './oracle.mjs';

/**
 * 保存点の一致の証明の**実測**(束 ⑳-5a2)。生成物ではなく、仕組み側に 1 回だけ手で書く。
 *
 * `save/expect.mts` が「並べて表明する」のに対し、こちらは「実行して読む」。
 *
 * 複合 RPC の引数は保存点はどれも 5 本固定(`p_id` / `p_actor_id` / `p_actor_roles` /
 * `p_expected` / `p_input`)であり、その規約は adapter の `usecase/usecase.repository.ts`
 * (`framework/adapters/postgrest/src/usecase/`)に書いてある。結末の読み方(0 行を競合と読まない = `emptyIsConflict: false`)も同じである ——
 * 複合 RPC は jsonb を 1 つ返すので、空の配列が「0 行」を意味しない。
 *
 * **アプリの語彙は 1 語も持たない。**
 */

/**
 * 実行するために製品が渡すもの。
 *
 * `invariantOfMessage` は**製品の生成物**(`constraint-invariants`)であり、`RuntimeBindings` と
 * 同じ形の裏返しである —— 制約の名前と不変条件 ID の対応はその製品の事情である。
 */
export interface FireHarness {
  readonly ports: HarnessPorts;
  readonly invariantOfMessage: InvariantResolver;
}

/** 不変条件の執行点(制約違反)の SQLSTATE クラス。 */
const INTEGRITY_CLASS = '23';

/** 書けたことの合図。 */
const SAVED = 'saved';

/** 許可されたうえで別の執行点(不変条件)が働いた合図。 */
const INTEGRITY = 'integrity';

/** 表にも制約の目録にも無い失敗(**それ自体が反例**である)。 */
const UNEXPECTED = 'unexpected';

/** 実行した 1 回の結末。 */
export interface EqSaveOutcome {
  /** 拒否の分類 / 書けた / 制約違反 / 想定外。 */
  readonly kind: string;
  /** 落ちた手順の操作 ID(本文の接頭辞の後ろ。読めなければ空)。 */
  readonly op: string;
  /** 報告に出す字面(errcode と本文)。 */
  readonly detail: string;
  /** 複合 RPC が返した jsonb(書けていないときは `null`)。 */
  readonly data: unknown;
}

/**
 * その組み合わせを実行する(同じ `p_id` で `resend` 回)。
 *
 * 実行する前に world を設計図の姿に戻す。**作られた行を消すのは呼び側である** —— 結末の行の状態を
 * 見るのは実行したあとであり、ここで消すと「書けたのに行が無い」と読めてしまう。
 *
 * @param world その保存点の設計図
 * @param plan その保存点の実行計画(関数名の出どころ)
 * @param built 実 DB に作った world
 * @param selection 実行する組み合わせ
 * @param subject 実行する相手
 * @param actorRoles `p_actor_roles`(実行器と同じ導出)
 * @param harness 製品が渡す口と、不整合のメッセージから不変条件 ID を引く手
 * @returns 実行した回数ぶんの結末(宣言順)
 */
export async function fireSave(
  world: EqSaveWorld,
  plan: RunPlan,
  built: BuiltEqWorld,
  selection: EqSaveSelection,
  subject: EqSaveSubject,
  actorRoles: readonly string[],
  harness: FireHarness,
): Promise<readonly EqSaveOutcome[]> {
  const source = harness.ports.rpcSource();
  const args = {
    p_id: selection.id,
    p_actor_id: subject.actorId,
    p_actor_roles: [...actorRoles],
    p_expected: subject.expected,
    p_input: subject.input,
  };
  await placeSaveCase(world, built, selection, subject, harness.ports);
  const outcomes: EqSaveOutcome[] = [];
  for (let attempt = 0; attempt < selection.resend; attempt += 1) {
    const { data, error } = await source.rpc(plan.rpc, args);
    outcomes.push(outcomeOf(data, error, harness.invariantOfMessage));
  }
  return outcomes;
}

/**
 * 複合 RPC の結末を読む(分類と、落ちた手順の操作 ID)。
 *
 * **実行器の口と同じ分類**(`classifyDbFailure`。adapter も同じ 1 本を通す)で読む —— 検査器だけが別の分類表を持たない。
 * 違いは「許可されたうえで別の執行点(不変条件)が働いた」を `integrity` として別に数えることだけで、
 * 制約名が不変条件に引けなかった 23xxx も同じ扱いである(実行器では想定外の失敗になる)。
 */
function outcomeOf(
  data: unknown,
  error: { readonly code: string; readonly message: string } | null | undefined,
  invariantOfMessage: InvariantResolver,
): EqSaveOutcome {
  if (error === null || error === undefined) {
    // 複合 RPC は jsonb を 1 つ返す(配列は行の列・それ以外は文書 1 つ)。0 行を競合と読まない。
    return { kind: SAVED, op: '', detail: '', data: Array.isArray(data) ? data : (data ?? null) };
  }
  const detail = `${error.code} ${error.message}`;
  const classified = classifyDbFailure(
    { sqlstate: error.code, message: error.message, detail: null, hint: null },
    invariantOfMessage,
  );
  if (classified === undefined) {
    // 分類できない失敗(通信の失敗・想定外の失敗)。制約違反のクラス(23)だけは不変条件の執行点とみなす。
    const integrity = sqlstateOrNull(error.code)?.startsWith(INTEGRITY_CLASS) === true;
    return { kind: integrity ? INTEGRITY : UNEXPECTED, op: '', detail, data: null };
  }
  if (classified.kind === 'invariant_violated') return { kind: INTEGRITY, op: '', detail, data: null };
  return { kind: classified.kind, op: classified.op, detail, data: null };
}

/**
 * 期待と実測が一致しているか(一致しないなら理由の字面)。
 *
 * 許可の側はどの宣言でも同じ —— 書けたほか、不変条件の執行点で落ちた結末も「許可の判定は
 * 一致した」である(実行器は不変条件を予測しない。`ActionError` が `invariant_violated` を
 * 別の分類として持つのはそのためである)。**拒否の側だけが手順の宣言で変わる。**
 *
 * | その手順の宣言 | 拒否に求めるもの |
 * |---|---|
 * | `named`(本文が生成物) | 分類も**落ちた手順の操作 ID** も一致する |
 * | `unnamed`(`handwritten:`) | その手順の RPC は 0 行で返るので、複合 RPC がその手順の競合として返す |
 * | `none`(`shape: composite`) | その手順の RPC は判定しない —— 何も求めない(守っているのは実行器だけ) |
 *
 * これは免除リストではない。どれも data_table の宣言そのものであり、宣言を外せば `named` に
 * 戻って理由まで見られる。
 *
 * @param expected 実行器が下した判定
 * @param actual 実行した結末
 * @returns 一致しない理由。一致していれば `null`
 */
export function saveDisagreement(expected: EqSaveExpectation, actual: EqSaveOutcome): string | null {
  if (expected.allowed) {
    if (actual.kind === SAVED || actual.kind === INTEGRITY) return null;
    return `decide=許可 / DB=${actual.kind} ${actual.op} ${actual.detail}`;
  }
  if (expected.enforcement === 'none') return null;
  const wantedKind = expected.enforcement === 'unnamed' ? conflictKind() : expected.kind;
  if (actual.kind === wantedKind && actual.op === expected.op) return null;
  return (
    `decide=${expected.kind} ${expected.op}(${expected.enforcement}) / ` +
    `DB=${actual.kind} ${actual.op} ${actual.detail}`
  );
}

/** 「判断時の前提が崩れた」の分類(`handwritten:` の手順は理由を返さないのでここに落ちる)。 */
function conflictKind(): string {
  return REFUSALS.find((refusal) => (refusal.reasons as readonly string[]).includes('invalid_from'))?.kind ?? '';
}

/**
 * 書けた結末が**宣言どおりの行**になっているか(一致しないなら理由の並び)。
 *
 * 見るのは 2 つである —— 手順ごとの結果が全部あること(繰り返す手順は渡した件数ぶん)と、
 * 結末の状態が仕様の予測どおりであること。行そのものは複合 RPC が返した jsonb から読む
 * (同じトランザクションで書いた行の写しである)。
 *
 * @param world その保存点の設計図
 * @param selection 実行する組み合わせ
 * @param subject 実行する相手
 * @param data 複合 RPC が返した jsonb
 * @param ports 製品が渡す口
 * @returns 宣言と違う点の並び(空なら宣言どおり)
 */
export async function saveWriteProblems(
  world: EqSaveWorld,
  selection: EqSaveSelection,
  subject: EqSaveSubject,
  data: unknown,
  ports: HarnessPorts,
): Promise<readonly string[]> {
  if (typeof data !== 'object' || data === null) return ['複合 RPC が形のある結果を返していない'];
  const result = data as Record<string, unknown>;
  const problems: string[] = [];
  for (const step of world.steps) {
    const value = result[step.alias];
    if (!step.repeat) {
      if (typeof value !== 'object' || value === null) problems.push(`${step.alias}: 手順の結果が無い`);
      continue;
    }
    if (!Array.isArray(value)) problems.push(`${step.alias}: 繰り返しの手順の結果が配列でない`);
    else if (value.length !== selection.repeat) {
      problems.push(`${step.alias}: 作られた行が ${value.length} 件(渡したのは ${selection.repeat} 件)`);
    }
  }
  return [...problems, ...(await stateProblems(world, selection, subject, ports))];
}

/** 結末の状態が仕様の予測どおりか。 */
async function stateProblems(
  world: EqSaveWorld,
  selection: EqSaveSelection,
  subject: EqSaveSubject,
  ports: HarnessPorts,
): Promise<readonly string[]> {
  const column = world.resultStateColumn;
  if (column === null || world.resultState === null) return [];
  const pg = await eqPg(ports);
  const id = resultIdOf(world, selection, subject);
  const row = (
    await pg.query<Record<string, unknown>>(
      `select ${column} from public.${world.resultTable} where id = $1`,
      [id],
    )
  ).rows[0];
  if (row === undefined) return [`結末の行(${world.resultTable})が無い`];
  if (row[column] === world.resultState) return [];
  return [`結末の状態が ${String(row[column])}(宣言は ${world.resultState})`];
}

/** 結末の行の id(冪等キーか、入力の欄)。 */
function resultIdOf(world: EqSaveWorld, selection: EqSaveSelection, subject: EqSaveSubject): string {
  const from = world.resultIdFrom;
  if (from === null) return selection.id;
  const step = world.steps[from.step];
  const row = step === undefined ? undefined : subject.input[step.alias];
  if (typeof row !== 'object' || row === null) return selection.id;
  const value = (row as Record<string, unknown>)[from.field];
  return typeof value === 'string' ? value : selection.id;
}

/** 結末の jsonb に現れる行の id(昇順・重複なし)。再送で行が増えていないことの見方である。 */
export function rowIdsOf(data: unknown): readonly string[] {
  if (typeof data !== 'object' || data === null) return [];
  const found = new Set<string>();
  for (const value of Object.values(data as Record<string, unknown>)) {
    for (const row of Array.isArray(value) ? value : [value]) {
      if (typeof row !== 'object' || row === null) continue;
      const id = (row as Record<string, unknown>).id;
      if (typeof id === 'string') found.add(id);
    }
  }
  return [...found].sort();
}
