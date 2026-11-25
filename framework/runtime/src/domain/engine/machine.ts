/**
 * 遷移テーブルの解釈（可否判定）。
 *
 * 状態 × イベント × ロール × ガードの判定は**すべてここに集約**され、Server Action にも
 * operation にも `if` として書かれない（ARCH-BE-0013）。エンジンは表を持たず、生成された
 * `MachineTable` を読むだけの純粋関数である（ADR-0004）。
 */

import { evaluateGuard, unresolvedPaths } from './guard';
import type { FireContext, FireRejected, MachineTable, TransitionDef } from './types';

/**
 * 許可の証明に押す封印。
 *
 * **このモジュールの外から参照できない** unique symbol であり、`export` もしていない。
 * 値としての symbol をエンジン外から得る手段が無いため、`FireAllowed` の形をした
 * オブジェクトリテラルは外部では作れず、`as FireAllowed` も「重なりが無い」として
 * 型エラーになる（この性質は `__tests__/engine/fire-allowed.test.ts` が @ts-expect-error で固定する）。
 *
 * 効いている理由は「遷移の中身（from / to / effects）をこの封印の下に隠している」ことである。
 * 中身を公開プロパティとして持つと、同じ形の値を作ってキャストすれば通ってしまう。
 */
const ALLOWED_TRANSITION: unique symbol = Symbol('engine.allowedTransition');

/** 許可された遷移の中身。`transitionOf` を通してのみ取り出せる。 */
export interface AllowedTransition {
  /**
   * 発火が許可されたドメインイベントID（`{machine}.{event}`。例: `entry.submit`）。
   *
   * 監査ログ（`domain_events.event_id`）に刻まれるラベルであり、**許可の中に封じてある**のが
   * 要点である。呼び出し側がイベントIDを別引数で指定できる形にすると、実際に起きた遷移とは
   * 違うラベルを監査ログに残せてしまう。ここから取り出す限り、ラベルと遷移は必ず一致する。
   */
  readonly event: string;
  /** 判断時に読んだ現在状態。書き込みの楽観的並行制御の条件になる。 */
  readonly from: string;
  /** 遷移先の状態。 */
  readonly to: string;
  /** `state_spec` の `effects[].do`。outbox に積むジョブの `type` になる。 */
  readonly effects: readonly string[];
}

/**
 * 遷移が許可されたことの証明。
 *
 * **`canFire` だけが作れる**（封印がこのモジュールの外に出ていないため）。
 * 永続化のポート（`operation/{集約}/ports.ts`）はこの型でしか遷移を受け取らないので、
 * 「判定を通さずに書き込む」経路が型として存在しない。中身は `transitionOf` で取り出す。
 */
export interface FireAllowed {
  readonly allowed: true;
  readonly [ALLOWED_TRANSITION]: AllowedTransition;
}

/** `canFire` の結果。許可（証明つき）か、分類付きの拒否か。 */
export type FireDecision = FireAllowed | FireRejected;

/**
 * ドメインイベントID（`{machine}.{event}`）を組み立てる。
 *
 * `action_spec` の `handles` と同じ綴りであり、監査ログに刻むラベルの正はここ 1 箇所である。
 */
function domainEventId(table: MachineTable, transition: TransitionDef): string {
  return `${table.machine}.${transition.event}`;
}

/** 許可の証明を作る。エンジン内部専用（このモジュールの外へは export しない）。 */
function allow(table: MachineTable, transition: TransitionDef, current: FireContext): FireAllowed {
  return {
    allowed: true,
    [ALLOWED_TRANSITION]: {
      event: domainEventId(table, transition),
      from: current.state,
      to: transition.to,
      effects: transition.effects,
    },
  };
}

/**
 * 許可の証明から遷移の中身を取り出す。
 *
 * 永続化を行う層（infrastructure）はこれを使って `event` / `from` / `to` / `effects` を読む。
 *
 * @param allowed - `canFire` が返した許可
 * @returns ドメインイベントID・判断時の状態・遷移先・副作用
 * @throws エンジンが作ったものではない値を渡した場合（`as unknown as` で型検査を迂回したとき）
 */
export function transitionOf(allowed: FireAllowed): AllowedTransition {
  const transition: AllowedTransition | undefined = allowed[ALLOWED_TRANSITION];
  if (transition === undefined) {
    throw new Error('エンジンが発行していない許可が渡されました。遷移は canFire の戻り値だけを渡してください');
  }
  return transition;
}

/**
 * 状態機械が知っているイベントIDを列挙する（表の出現順・重複なし）。
 *
 * @param table - 遷移テーブル
 * @returns イベントIDの配列
 */
export function knownEvents(table: MachineTable): readonly string[] {
  const events: string[] = [];
  for (const transition of table.transitions) {
    if (!events.includes(transition.event)) events.push(transition.event);
  }
  return events;
}

/**
 * ある状態が終端（final）かどうかを返す。
 *
 * final 状態からは遷移が出ていないことが仕様側で検証済み（V7）であるため、
 * 呼び出し側は「この集約はもう動かない」の判断にこれを使える。
 *
 * @param table - 遷移テーブル
 * @param state - 判定したい状態ID
 * @returns final なら true
 */
export function isFinal(table: MachineTable, state: string): boolean {
  return table.final.includes(state);
}

/** イベントIDで遷移を絞り込む。 */
function transitionsOf(table: MachineTable, event: string): readonly TransitionDef[] {
  return table.transitions.filter((transition) => transition.event === event);
}

/** `from` に現在状態を含む遷移だけを残す。 */
function firableFrom(transitions: readonly TransitionDef[], state: string): readonly TransitionDef[] {
  return transitions.filter((transition) => transition.from.includes(state));
}

/**
 * `otherwise_forbidden` の理由文を取り出す。
 *
 * 仕様ではイベントごとに1つの包括的な理由を書くため、同じイベントの遷移が複数行あっても
 * 理由は同じものになる。最初に見つかったものを返し、仕様に書かれていなければ undefined。
 */
function otherwiseForbiddenOf(candidates: readonly TransitionDef[]): string | undefined {
  return candidates.find((candidate) => candidate.otherwiseForbidden !== undefined)?.otherwiseForbidden;
}

/** 実行者のロールと `by` の積が非空か（バインディング解決済みのロールを前提とする）。 */
function hasAllowedRole(transition: TransitionDef, actorRoles: readonly string[]): boolean {
  return transition.by.some((role) => actorRoles.includes(role));
}

/** ガードを評価して許可／拒否を決める。ガード省略は「常に真」。 */
function decideByGuard(
  table: MachineTable,
  transition: TransitionDef,
  context: FireContext,
  event: string,
): FireDecision {
  const guard = transition.guard;
  if (guard === undefined) return allow(table, transition, context);

  const result = evaluateGuard(guard, context.env);
  if (result === true) return allow(table, transition, context);
  if (result === false) {
    return {
      allowed: false,
      event,
      state: context.state,
      reason: 'guard_unsatisfied',
      guardSource: transition.guardSource,
    };
  }
  return {
    allowed: false,
    event,
    state: context.state,
    reason: 'guard_unknown',
    guardSource: transition.guardSource,
    unresolvedPaths: unresolvedPaths(guard, context.env),
  };
}

/**
 * 現在状態・実行者のロール・ガード評価の文脈のもとで、イベントを発火してよいかを判定する。
 *
 * 判定は次の順に短絡する。先に落ちた理由だけが返る（診断を1つに絞るため）。
 *
 * 1. `unknown_event` — その名前のイベントが表に無い
 * 2. `invalid_from` — イベントはあるが、現在状態がどの `from` にも含まれない（otherwise_forbidden）
 * 3. `role_forbidden` — 実行者のロールと `by` の積が空
 * 4. `guard_unsatisfied` — ガードが偽
 * 5. `guard_unknown` — ガードを評価できなかった（envの値が無い・型が食い違う）
 *
 * **`'unknown'` は拒否として扱う**（安全側に倒す）。ただし `guard_unsatisfied` とは別の理由コードで
 * 返し、「仕様上の正常な拒否」と「呼び出し側がenvを組み立て損ねた事故」を呼び出し側が区別できるようにする。
 *
 * **ロールのバインディング解決（誰がその行に対する文脈ロールを持つか）はoperation側の責務**であり、
 * エンジンは `context.actorRoles` に渡された結果を照合するだけで、解決には関与しない。
 *
 * 同一イベント・同一 `from` の遷移が複数ある表は非決定的であり、ここでは最初に一致した1本を使う。
 * その状態は表の不備であり `assertValidTable` が検出する（仕様側では V8 が検証する）。
 *
 * @param table - 遷移テーブル（生成物、またはテスト用の手書き表）
 * @param current - 現在状態・実行者のロール・ガード評価に使う値
 * @param event - 発火しようとしているドメインイベントID
 * @returns 許可なら遷移の証明（`transitionOf` で中身を取り出す）、拒否なら分類と診断情報
 */
export function canFire(table: MachineTable, current: FireContext, event: string): FireDecision {
  const candidates = transitionsOf(table, event);
  if (candidates.length === 0) {
    return {
      allowed: false,
      event,
      state: current.state,
      reason: 'unknown_event',
      knownEvents: knownEvents(table),
    };
  }

  const matched = firableFrom(candidates, current.state);
  const transition = matched[0];
  if (transition === undefined) {
    return {
      allowed: false,
      event,
      state: current.state,
      reason: 'invalid_from',
      expectedFrom: [...new Set(candidates.flatMap((candidate) => candidate.from))],
      otherwiseForbidden: otherwiseForbiddenOf(candidates),
    };
  }

  if (!hasAllowedRole(transition, current.actorRoles)) {
    return {
      allowed: false,
      event,
      state: current.state,
      reason: 'role_forbidden',
      allowedRoles: transition.by,
      actorRoles: current.actorRoles,
    };
  }

  return decideByGuard(table, transition, current, event);
}
