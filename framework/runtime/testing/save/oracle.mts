import type { SessionClaims } from '@kaninabe/runtime/bindings';
import type { RoleTables } from '@kaninabe/runtime/template/actor-roles';
import type { RunPlan } from '@kaninabe/runtime/plan';
import type { StepRejection } from '@kaninabe/runtime/step-decision';
import type { DecideContext } from '@kaninabe/runtime/template/evaluate';
import { decidePlanWith, planActorRolesWith } from '@kaninabe/runtime/template/evaluate';
import { REFUSALS } from '@kaninabe/runtime/refusal/refusal-codes';
import type { EqSaveWorld } from './types.mjs';
import type { EqSaveSelection, EqSaveSubject } from './world.mjs';

/**
 * 保存点の一致の証明の**期待**(束 ⑳-5a2)。生成物ではなく、仕組み側に 1 回だけ手で書く。
 *
 * ## 期待は実行器そのものである
 *
 * 単発の操作の証明は engine(`canFire` / `canCreate` …)を直に呼んだ。保存点は**手順の並び**が
 * 判定の単位なので、呼ぶのは実行器が手順ごとに立てる `permit` であり、期待は「手順の順に回して
 * **最初に落ちた手順とその理由**」である。**その回し方も実行器の 1 本**(`decidePlanWith`)で
 * あり、ここには for ループも無い(束 ⑳-5b-b)。第 3 の判定器は置かない ——
 * 確かめたいのが「TS の先読みと DB の執行が同じ判定を下すか」である以上、片方を書き写した
 * 判定器を足してもその写し間違いが新しい穴になるだけである。
 *
 * `p_actor_roles` も実行器と同じ判断(`planActorRolesWith`)が作る —— テストが自分で配列を組むと、期待
 * (文脈からロールを解決する)と DB(配列を見る)が**実行時にありえない組み合わせ**で
 * 比べられることになる。軸になるのは配列ではなく**呼び出し元の文脈**である(設計図の `callers`)。
 *
 * ## 実行器の拒否の枝は 5 つあり、ここが模すのは 1 つである
 *
 * 模していない枝は「模し忘れ」ではない。**どれも複合 RPC を呼び出す前の短絡か、DB に対応物が無い
 * 判定**であり、この証明の問い(「DB 単体が仕様どおり守るか」)には答えない —— 1 行ずつ示す
 * (独立レビュー ⑳-5a2 の記録 6)。
 *
 * 1. **読みが解けない**(`loadFacts` が `null`)→ 計画そのものを操作 ID とする `forbidden`。RPC を呼び出す前に
 *    返るので DB 側に対応物が無く、模すと期待が「何も実行しなかった」になる。DB はその組み合わせでも
 *    手順の述語で拒否するので、ここは**手順の拒否として実行し抜く**(world は読む集約の行を必ず置く)。
 * 2. **編集の手順が変更を 1 つも運ばない**(`emptyChanges`)→ `invalid_input`。立つのは `update` の
 *    手順を持つ保存点だけであり、そのとき任意欄を落とす入力(`minimal`)が「変更なし」になりうる。
 *    これも RPC を呼び出す前の短絡である。
 * 3. **手順の `permit` が立たない**(`decideStep`)→ ここが模す唯一の枝。DB の述語と同じことを見ている。
 * 4. **application 執行の不変条件**(`invariantHooks`)→ `invariant_violated`。engine も DB も予測
 *    しない判定であり、許可された組み合わせで hook だけが落とす形は DB から見れば「書ける」である
 *    (不変条件の執行点は別の保証が見る)。
 * 5. **RPC の結末の写像**(`refusalError`)→ これは期待ではなく**実測**の側であり、
 *    `save/fire.mts` の `outcomeOf` が同じ 1 表(`REFUSALS`)で持つ。
 *
 * **アプリの語彙は 1 語も持たない。**
 */

/**
 * 期待を計算するために製品が渡す宣言。
 *
 * どちらも**製品の生成物**である(`runtime-bindings` の `roleTables` と `session-profile` の欄)。
 * 仕組み側は 1 語も持たない —— ADR-0013 の裏返しであり、`RuntimeBindings` と同じ形である。
 */
export interface SaveOracleDeclarations {
  readonly roleTables: RoleTables;
  readonly sessionFields: readonly string[];
}

/** 期待する結末。 */
export interface EqSaveExpectation {
  /** 実行器が全手順の `permit` を立てられたか。 */
  readonly allowed: boolean;
  /** 落ちた手順の操作 ID(許可なら空文字)。 */
  readonly op: string;
  /** 拒否の分類(`REFUSALS` の `kind`。許可なら空文字)。 */
  readonly kind: string;
  /** その手順の RPC が拒否をどこまで返すか(許可なら `named`)。 */
  readonly enforcement: string;
  /** `p_actor_roles` に渡す配列(実行器と同じ導出)。 */
  readonly actorRoles: readonly string[];
}

/**
 * 表に無い分類が来たときに出す字面(**それ自体が反例**である)。
 *
 * 分類の語の正は `legacy/spec-tools/lib/sql/refusal-codes.ts` の 1 表であり、app 側の写しは
 * `framework/runtime/src/refusal/refusal-codes.ts` 1 か所だけである。
 */
const UNMAPPED_KIND = '?';

/**
 * その組み合わせで実行器が下す判定。
 *
 * @param plan その保存点の実行計画(生成物)
 * @param world その保存点の設計図(手順ごとの enforcement の出どころ)
 * @param selection 実行する組み合わせ
 * @param subject 実行する相手(world の行の id と、置き直したあとの値)
 * @param declarations 製品が渡す宣言(ロール解決の表とセッションの欄)
 * @returns 許可か、落ちた手順とその分類
 */
export function saveOracle(
  plan: RunPlan,
  world: EqSaveWorld,
  selection: EqSaveSelection,
  subject: EqSaveSubject,
  declarations: SaveOracleDeclarations,
): EqSaveExpectation {
  const ctx = contextOf(selection, subject, declarations.sessionFields);
  const actorRoles = planActorRolesWith(declarations.roleTables, plan, ctx);
  const blocked = decidePlanWith(declarations.roleTables, plan, ctx).find((outcome) => !outcome.decision.allowed);
  if (blocked === undefined || blocked.decision.allowed) {
    return { allowed: true, op: '', kind: '', enforcement: 'named', actorRoles };
  }
  return {
    allowed: false,
    op: opOf(blocked.decision.rejection, blocked.step.op),
    kind: kindOf(blocked.decision.rejection),
    enforcement: world.steps[blocked.index]?.enforcement ?? 'named',
    actorRoles,
  };
}

/**
 * 実行器に渡す判断材料。
 *
 * `facts` は実行計画の `reads` が指す行の値である —— 実行器が実 DB から読むところを、テストは
 * 置き直したあとの world から取る(同じ行・同じ列であり、読み方だけが違う)。
 */
function contextOf(
  selection: EqSaveSelection,
  subject: EqSaveSubject,
  sessionFields: readonly string[],
): DecideContext {
  return {
    resolution: {
      facts: subject.facts,
      actorId: subject.actorId,
      session: sessionOf(selection, subject, sessionFields),
      input: subject.input,
      now: new Date().toISOString(),
    },
    system: selection.caller.system,
  };
}

/**
 * セッションが運ぶ実行者のプロフィール。
 *
 * **実行者の集約に行が無い人には無い。** 既定のログインロールの根拠は「認証済みであること」
 * ではなく「実行者の集約にその人の行があること」であり、その写しがこのプロフィールである
 * (`operation/_template/actor.ts` の `globalRole`)。載る欄の閉世界は生成物が持つ。
 */
function sessionOf(
  selection: EqSaveSelection,
  subject: EqSaveSubject,
  sessionFields: readonly string[],
): SessionClaims | null {
  if (!selection.caller.session || selection.actor.row === null) return null;
  const fields: Record<string, unknown> = {};
  for (const field of sessionFields) fields[field] = subject.actorRow[field];
  return fields as SessionClaims;
}

/**
 * その拒否が載せる操作 ID。
 *
 * 実行器はエンジンの拒否を `ActionError` に写すとき、どの分類でも**その手順の操作 ID** を
 * 載せる(`run-plan-decide.ts` の `asStepDecision`)。したがって載せる ID は手順のものであり、
 * ここに分岐は無い。
 */
function opOf(_rejection: StepRejection, fallback: string): string {
  return fallback;
}

/**
 * 拒否 → RPC が返す分類。
 *
 * 写像は `REFUSALS` の 1 表である —— **エンジンが返した理由の語でそのまま引く**。
 * `ActionError` の 3 分類を経由しないのは、そこで `invalid_from` と `unknown_event` が
 * 同じ `blockedBy: 'state'` に畳まれ、引き直すときに分類の判断がもう 1 つ生まれるからである。
 */
function kindOf(rejection: StepRejection): string {
  return reasonKind(rejection.rejected.reason);
}

/** engine の理由 → 拒否の分類(表に無ければ反例の字面)。 */
function reasonKind(reason: string): string {
  return REFUSALS.find((refusal) => (refusal.reasons as readonly string[]).includes(reason))?.kind ?? UNMAPPED_KIND;
}
