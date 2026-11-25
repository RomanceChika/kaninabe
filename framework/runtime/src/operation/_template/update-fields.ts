/**
 * 編集の定型（server-actions.md「**定型 4 手順（編集・単行 form）**」の②〜④）。
 *
 * 仕様: docs/rules/process/backend/system/standards/conventions/server-actions.md
 *       （構造とエラー分類の契約の正は ARCH-BE-0013）
 *
 * バルク形（`./update.ts`）と対になる**1 対象・N フィールド**の形である。②の照会先が
 * `canWrite` になるのは両方に共通で、違うのは「何を数えるか」だけである。
 *   - バルク形 … **対象**が複数（フィールドは 1 つ）。全対象について照会する
 *   - 単行形   … **フィールド**が複数（対象は 1 つ）。**変更される全フィールド**について照会する
 *
 * 単行であることがこの定型に足す制約は 3 つで、いずれもここが持つ。
 *   - ②の読み取りは 1 回（`loadFacts`）。読んだ値が判断の前提であり、そのまま③の条件になる
 *   - ②の照会を**変更される各フィールドに**適用し、1 つでも許されなければ全体を拒否する
 *     （最初に落ちた理由を返す。「許されたフィールドだけ書く」はしない）
 *   - **送られなかったフィールドは照会も更新もしない**（部分更新）。`undefined` は
 *     「変更しない」であって「空にする」ではないので、判断の材料にも書き込みにも現れない
 *   - **変更が 1 つも無い呼び出しは `invalid_input`** としてエラーにする（境界の zod と二段。
 *     何も起きない要求は送った側から見て成功とも失敗とも読めず、DB まで運ぶ意味が無い）
 *
 * 楽観的並行制御は `loadFacts` で読んだ値を条件にする（③は `persist` の実装が RPC に渡す）。
 * 守るのは「判断してから書くまでの隙間」だけであり、画面が編集を始めた時点との差
 * （編集窓の競合）は見ない — それは入力の記法の判断とセットのバックログである。
 */

import { toWriteActionError } from '@kaninabe/runtime/action-error';
import type { GuardEnv, WriteTable } from '@kaninabe/runtime/engine';
import { canWrite } from '@kaninabe/runtime/engine';
import type { ActionResult } from '@kaninabe/runtime/result';
import { err, ok } from '@kaninabe/runtime/result';
import type { ActorCommand, ActorProfile, ActorRoles } from './actor';
import { rejectedRole } from './actor';
import type { FactsLoaded } from './facts';
import type { Conflict, InvariantViolated } from './outcome';

/**
 * 更新する値の集合。
 *
 * **鍵は `entity_spec` のフィールド名**（`writes[].fields` と同じ語彙）である。実装が別名を
 * 発明すると、照会（`canWrite` の `field`）と書き込み（列名）の間に対応表がもう 1 つできる。
 * 値が `undefined` の鍵は「送られていない」を意味し、定型が取り除く。
 */
export type FieldChanges = Readonly<Record<string, unknown>>;

/**
 * 単行編集の適用結果。
 *
 * - `updated` … 判断時の値のまま 1 行書き換わった
 * - `conflict` … 判断時から対象が動いた（0 行更新）。対象が消えていた場合も含む
 * - `invariant_violated` … DB 制約が不変条件違反を検出した（`invariant` は `INV-*` の実在ID）
 * - `guard_refused` … DB が書き込みの前提(回数・間隔の制限など)で断った。`reason` は製品の閉じた表の語、
 *   `retryAt` は次に通る見込みの時刻(ISO 8601。時刻で解けない前提なら `null`)。`guard_unsatisfied` に写す(分類は増やさない)
 *
 * 成功しても値を返さないのは削除（`./delete.ts`）と同じ理由で、後続の表示に要るものは
 * 判断時に読んだ事実の側にあるからである。
 */
export type UpdateFieldsOutcome =
  | { readonly kind: 'updated' }
  | Conflict<'update_fields'>
  | InvariantViolated<'update_fields'>
  | { readonly kind: 'guard_refused'; readonly reason: string; readonly retryAt: string | null };

/**
 * 編集操作（単行・複数フィールド形）の設定。ここに現れるのは**集約ごとに違う部分だけ**である。
 *
 * 操作のID（予約ID `{entity}.update`）は設定に書かない（生成された規則表の `entity` から導く）。
 */
export interface UpdateFieldsSpec<
  TDeps,
  TCommand extends ActorCommand,
  TFacts,
  TChanges extends FieldChanges,
  TResult,
> {
  /** 生成された編集規則の表（`domain/generated/{entity}.writes.ts`）。 */
  readonly rules: WriteTable;
  /**
   * 判断から書き込みまでの間に**書き込みの前提が崩れていた**ときの理由文字列。
   *
   * **何が前提かは集約による**ので、ここが示す（`blockedBy` は `'state'` 固定である。
   * 2 値しか無い語彙を増やすのは別の判断であり、いまはバックログにある）。
   *   - 状態機械を持つ集約 … 前提は「判断時の状態」。例: `conflict: state changed after the decision`
   *   - 状態列を持たない集約 … 前提は「対象がまだ在ること」だけに縮む。
   *     例: `conflict: the target disappeared after the decision`
   *
   * **状態が動いたと書かない**（状態を持たない集約では嘘になる）。0 行が何を意味するかは
   * `persist` が渡す条件そのものであり、この文字列はその写しである。
   */
  readonly conflictReason: string;
  /**
   * 判断に要る事実を読む（②の読み取り）。
   *
   * 答えるのは「読めたか」だけである。`not_visible` は一律に `forbidden` になる
   * （存在の有無自体を漏らさないため。`./facts.ts`）。ここに可否の判断を書いてはならない。
   */
  readonly loadFacts: (deps: TDeps, command: TCommand) => Promise<FactsLoaded<TFacts>>;
  /** 入力から更新する値の集合を取り出す（鍵は `entity_spec` のフィールド名）。 */
  readonly changes: (command: TCommand) => TChanges;
  /**
   * 実行者に解決されたロール（利用側が `resolveActorRolesWith` で解決したもの）。
   *
   * **事実が読めなかった場合（`null`）も答える**（理由は `_template/transition.ts` の同名の
   * 宣言と同じ。拒否の `role` はこの解決結果から作られる）。戻り値の**先頭はグローバルロール**
   * であること。**第 3 引数はセッションが運ぶプロフィール**（`command.actorClaims`）であり、
   * 既定のログインロールの根拠になる（`./actor.ts`）。
   */
  readonly actorRoles: (
    actorId: string | null,
    facts: TFacts | null,
    claims: ActorProfile,
  ) => ActorRoles;
  /**
   * `writes[].when` が参照するパスへの値の割り当て。条件の無い規則は空を返す。
   *
   * **実行者を第 2 引数で受け取る。** ガード式の文法は `actor` を予約語として認めており
   * （domain-spec-writing.md §ガード式の文法）、例: `member.id == actor.id` のような
   * 本人条件は仕様として正当である。実行者を渡す口が無いと、それを評価するために
   * `loadFacts` が「読んだ事実」でないものを facts に載せることになり、
   * 「答えるのは読めたかだけ」という `loadFacts` の契約が崩れる。
   * 実行者を参照しない集約は第 2 引数を無視してよい（既存の設定はそのまま動く）。
   */
  readonly guardEnv: (facts: TFacts, actorId: string | null) => GuardEnv;
  /**
   * 1 行書き換える（③。判断時に読んだ値を条件にする = 楽観的並行制御）。
   *
   * **入力そのもの（`command`）も受け取る。** 更新する値は `changes` が運ぶが、
   * 「その書き込みと同一トランザクションで起こしたいこと」に添える付随情報は列ではないので
   * `changes` に混ぜられない（混ぜると `canWrite` の照会対象になり、許可列の検査も失敗する）。
   * 実物は対外告知の文面で、`announced_at` を書いたのと同じトランザクションで outbox に積まれる。
   * 使わない操作は第 5 引数を無視してよい。
   *
   * **第 6 引数（`effects`）は `writes[].effects` から集めた候補である。** ②の照会
   * （`canWrite`）が許可を返した規則のうち `effects` を宣言していたものだけを、変更された
   * フィールドの並び順で重複無く集めて渡す。**積む・積まないの判定はここではなく RPC が行う**
   * （宣言列の値が実際に変わった行に対してだけ積む。domain-spec-writing.md §access_spec）。
   * 使わない操作（`effects` を宣言していない集約）は第 6 引数を無視してよい。
   */
  readonly persist: (
    deps: TDeps,
    facts: TFacts,
    changes: TChanges,
    actorId: string | null,
    command: TCommand,
    effects: readonly string[],
  ) => Promise<UpdateFieldsOutcome>;
  /** 判断時に読んだ事実から、後続の表示に必要な最小限の成功値を作る。 */
  readonly toResult: (facts: TFacts) => TResult;
}

/**
 * 「変更が 1 つも無い」の指摘に載せる宛先。
 *
 * 個別のフィールドの問題ではなく**変更集合そのもの**の問題なので、境界の zod の `path`
 * （`['changes']`）と同じ名前を使う。呼び出し側から見て、どちらの段で失敗しても指摘の形が同じになる。
 */
const EMPTY_CHANGES_FIELD = 'changes';

/** 同上のコード。zod 由来のコード語彙には無い状況なので、定型が出す 1 語を固定する。 */
const EMPTY_CHANGES_CODE = 'empty';

/**
 * 送られたフィールドだけを残す。
 *
 * 落とすのは値が `undefined` の鍵だけであり、型としては何も変わらない（部分更新の入力は
 * どれも「その鍵が無い」状態を許す形になっている）。TypeScript にはその同一性を示せないので
 * ここだけ写しの型を明示する。
 *
 * @param changes - 入力から取り出した値の集合
 * @returns 値が `undefined` でない鍵だけを持つ同じ形の集合
 */
function definedOnly<TChanges extends FieldChanges>(changes: TChanges): TChanges {
  return Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  ) as TChanges;
}

/**
 * 編集の操作（単行・複数フィールド形）を組み立てる。
 *
 * @param spec - 集約ごとの読み取り・変更集合・ロール解決・env 組み立て・永続化
 * @returns 依存と入力を受け取り、`Result` を返す操作関数
 */
export function updateFieldsOperation<
  TDeps,
  TCommand extends ActorCommand,
  TFacts,
  TChanges extends FieldChanges,
  TResult,
>(
  spec: UpdateFieldsSpec<TDeps, TCommand, TFacts, TChanges, TResult>,
): (deps: TDeps, command: TCommand) => Promise<ActionResult<TResult>> {
  // 予約ID は生成物から導く。操作を文字列で指定できる形にすると、綴りの正が仕様の外に
  // もう 1 つできる（PRIN-0007 / PRIN-0008）。
  const eventId = `${spec.rules.entity}.update`;

  return async (deps, command) => {
    const loaded = await spec.loadFacts(deps, command);
    // 読めたかによらずロールは解決する（`_template/transition.ts` と同じ理由）。
    const facts = loaded.kind === 'not_visible' ? null : loaded.facts;
    const actorRoles = spec.actorRoles(command.actorId, facts, command.actorClaims);
    if (facts === null) {
      return err({ kind: 'forbidden', event: eventId, role: rejectedRole(actorRoles) });
    }
    const changes = definedOnly(spec.changes(command));

    // 変更が 1 つも無い呼び出しは**入力そのものの不正**である（業務上の拒否ではないので
    // 照会もしない）。境界の zod が同じことを見ているが、そこを通らない呼び出し経路が将来
    // 増えても空の更新が DB に届かないよう、定型の側でもエラーにする。
    if (Object.keys(changes).length === 0) {
      return err({ kind: 'invalid_input', issues: [{ field: EMPTY_CHANGES_FIELD, code: EMPTY_CHANGES_CODE }] });
    }

    // ②照会は**変更される各フィールドに**適用する。1 つでも許されなければ最初の理由で全体を
    // 拒否する。ここに「許されたものだけ書く」を入れると、送った側から見て成功とも失敗とも
    // 読めない結果が返る。読んだ事実は 1 回きりなので、判断の前提はフィールド間でずれない。
    const env = spec.guardEnv(facts, command.actorId);
    const effects: string[] = [];
    for (const field of Object.keys(changes)) {
      const decision = canWrite(spec.rules, { field, actorRoles, env });
      if (!decision.allowed) {
        return err(toWriteActionError(decision, eventId, rejectedRole(actorRoles)));
      }
      for (const id of decision.effects ?? []) {
        if (!effects.includes(id)) effects.push(id);
      }
    }

    const outcome = await spec.persist(deps, facts, changes, command.actorId, command, effects);

    switch (outcome.kind) {
      case 'updated':
        return ok(spec.toResult(facts));
      case 'invariant_violated':
        return err({ kind: 'invariant_violated', invariant: outcome.invariant });
      case 'guard_refused':
        // 前提を DB が判定した拒否(先読みの照会には現れない制限)。理由の語と、時刻で解けるなら次に通る見込みの時刻を運ぶ。
        return err({
          kind: 'guard_unsatisfied',
          event: eventId,
          blockedBy: 'guard',
          reason: outcome.reason,
          ...(outcome.retryAt === null ? {} : { retryAt: outcome.retryAt }),
        });
      case 'conflict':
        // `blockedBy` は 2 値（`state` / `guard`）しか無く、「書き込みの前提が崩れた」は
        // どちらでもない。**いまは `state` に寄せ、何が崩れたかは `conflictReason` が示す**
        // （語彙を増やすかは blockedBy の 2 値問題としてバックログにある）。
        return err({
          kind: 'guard_unsatisfied',
          event: eventId,
          blockedBy: 'state',
          reason: spec.conflictReason,
        });
    }
  };
}
