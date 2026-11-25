import type { GuardEnv, GuardValue } from '@kaninabe/runtime/engine';
import { arrayActorRoles, decideShape } from '@kaninabe/runtime/step-decision';
import type { RunFactSource, RunPlan, RunStepPlan } from '@kaninabe/runtime/plan';
import { refusalCodeOfReason } from '@kaninabe/runtime/refusal/refusal-codes';
import type { EqSelection, EqSubject } from './world.mjs';

/**
 * engine ⇔ RPC の一致の証明の**期待**(束 ⑳-5a)。生成物ではなく、仕組み側に 1 回だけ手で書く。
 *
 * ## 期待は engine そのものである
 *
 * ⑳-4b の RLS のオラクルは「宣言から可視集合を計算し直す別の写像」だった。ここは違う ——
 * **engine を呼ぶ**。確かめたいのが「TS の先読みと DB の執行が同じ判定を下すか」である以上、
 * 片方を書き写した第 3 の判定器を置いても意味が無い(その写し間違いが新しい穴になるだけである)。
 *
 * ここがするのは engine に渡す 3 つを world から組み立てることだけである。**形ごとの照会
 * (4 形の分岐)もロールの数え方も `domain/step-decision.ts` の 1 本を呼ぶ** —— 同じ分岐を
 * 実行器とここで別々に書くと、その 2 本がずれたときに誰も気づかない(束 ⑳-5b-b)。
 *
 * | engine が要るもの | world のどこから |
 * |---|---|
 * | 対象の状態 | 組み合わせが置いた状態 |
 * | 実行者のロール | ロール配列 + 実行者自身の行の欄(`claim`)+ 対象の行の列(`binding`) |
 * | ガード式の変数 | 置き直したあとの行の値・現在時刻・入力 |
 *
 * **`implies` の閉包はここで取らない。** DB は配列の中身をそのまま見るので、閉じていない配列を
 * 渡した実行者に対しても両者は同じ判定を下さなければならない(⑳-3 の手書きの差分テストと
 * 同じ構え)。行から立つロールも同じで、立つものだけを足す。
 *
 * **アプリの語彙は 1 語も持たない。**
 */

/** 期待する結末(成功なら空文字、拒否なら errcode)。 */
export interface EqExpectation {
  /** engine が許可したか。 */
  readonly allowed: boolean;
  /** engine の拒否理由(許可なら空文字)。 */
  readonly reason: string;
  /** 対応する errcode(許可なら空文字)。 */
  readonly code: string;
}

/**
 * 表に無い理由が来たときに出す字面(**それ自体が反例**である)。
 *
 * engine の理由 → errcode の写像はここに持たない —— 語の正は
 * `legacy/spec-tools/lib/sql/refusal-codes.ts` の 1 表であり、app 側の写しは
 * `framework/runtime/src/refusal/refusal-codes.ts` 1 か所だけである(一致は `legacy/spec-tools/__tests__/guarantees/refusal-codes-parity.test.ts` が見る)。
 * ここが 2 つ目の表を持っていた束 ⑳-5a では `invalid_from → UC409` がどの 1 表にも無く、
 * doc が約束していた突合も存在しなかった(独立レビュー 1-d)。
 */
const UNMAPPED_CODE = '?';

/**
 * その組み合わせで engine が下す判定。
 *
 * @param plan その操作の実行計画(生成物。engine が読む表もここが運ぶ)
 * @param selection 実行する組み合わせ
 * @param subject 実行する相手(行の id と、置き直したあとの値)
 * @returns 許可か、理由と errcode
 */
export function oracleDecision(plan: RunPlan, selection: EqSelection, subject: EqSubject): EqExpectation {
  const step = plan.steps[0];
  if (step === undefined) return { allowed: true, reason: '', code: '' };
  const roles = rolesOf(step, selection, subject);
  const env = envOf(step, selection, subject);
  const decision = decideShape(step, {
    roles,
    env,
    state: selection.state ?? '',
    field: selection.field,
  });
  if (decision.allowed) return { allowed: true, reason: '', code: '' };
  const reason: string = decision.rejection.rejected.reason;
  return { allowed: false, reason, code: refusalCodeOfReason(reason) ?? UNMAPPED_CODE };
}

/**
 * その組み合わせで実行者に立つロール。
 *
 * ロール配列(`p_actor_roles`)に、**行から立つもの**を足す —— `claim` は実行者自身の行の欄、
 * `binding` は対象の行の列である。DB の本文も同じ 3 か所を見る(`roles-to-sql.ts`)。
 */
function rolesOf(step: RunStepPlan, selection: EqSelection, subject: EqSubject): readonly string[] {
  return arrayActorRoles(step, selection.array.roles, subject.actorId, subject.actorRow, (source) =>
    factValue(source, selection, subject),
  );
}

/** その手順のガード式が参照する変数の割り当て。 */
function envOf(step: RunStepPlan, selection: EqSelection, subject: EqSubject): GuardEnv {
  const env: Record<string, GuardValue> = {};
  for (const fact of step.guardFacts) {
    env[fact.variable] = asGuardValue(factValue(fact.source, selection, subject));
  }
  return env;
}

/** 事実 1 つの値(供給元の値域ごとに 1 行)。 */
function factValue(source: RunFactSource, selection: EqSelection, subject: EqSubject): unknown {
  switch (source.kind) {
    case 'external':
      return externalValue(source.ref, selection, subject);
    case 'predicted':
      return source.value;
    case 'input':
      return subject.input[source.field] ?? null;
    case 'actor':
      return subject.actorId;
    case 'session':
      return subject.actorRow[source.field] ?? null;
    default:
      // `now` は実行する瞬間の時刻である(DB 側も `now()` を読む)。
      return new Date().toISOString();
  }
}

/**
 * `{集約}.{列}` の値。
 *
 * **作成だけは行ではなく入力から取る** —— まだ行が無いので、DB の本文も「insert に書く式」を
 * 見る(`rpc-authz-build.ts` の `ownColumn`)。自集約以外は親の行そのものである。
 */
function externalValue(ref: string, selection: EqSelection, subject: EqSubject): unknown {
  const dot = ref.indexOf('.');
  if (dot < 0) return null;
  const entity = ref.slice(0, dot);
  const column = ref.slice(dot + 1);
  if (selection.operation.kind === 'create' && entity === selection.operation.aggregate) {
    return column === 'id' ? subject.targetId : (subject.input[column] ?? null);
  }
  return subject.values.get(entity)?.[column] ?? null;
}

/**
 * ガード式が読める値だけを渡す(読めない形は `null` = 不明)。
 *
 * 不明を偽に潰さないのは実行器と同じ規約である —— engine は `null` を「評価できなかった」
 * として `guard_unknown` を返し、SQL の側も原子ごとに `coalesce(…, false)` で不成立に畳む
 * (domain-spec-writing.md §ガード式の文法)。
 */
function asGuardValue(value: unknown): GuardValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}
