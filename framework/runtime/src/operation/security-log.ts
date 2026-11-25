/**
 * **セキュリティログを組んで出す部品**(ASVS V16.3.1〜V16.3.3)。拒否・認証・出どころの確認の行を、閉じた欄だけで作る。
 *
 * 規約: docs/rules/process/backend/system/standards/conventions/logging.md(§セキュリティの事象)
 * 目録: `./security-events.ts`(事象の ID・欄・分類の語彙の正)
 *
 * ## 何を出し、何を出さないか
 *
 * 出すのは**ID と判断の行だけ**である —— 事象の ID・操作・実行者のメンバー ID・拒否の分類・不変条件の ID・認証の結末・要求の ID。
 * 入力値・メールアドレス・トークン・cookie・拒否の理由文(`ActionError.reason` は仕様の文言か、ガードの式の字面を含む)を載せる欄は
 * `LogRecord` に無く、この部品も受け取る口を持たない。**引数の型が閉じている**ので、呼び手が余分な値を混ぜられない。
 *
 * ## 出す場所
 *
 * - Server Action の拒否 … 生成された入口が `recordRefusal` を通る(実行者を**パースより先に**解決して渡す)
 * - 出どころの拒否 … 要求の前段(`gateDocumentRequest`)と Route Handler の関門(`refuseCrossOrigin`)
 * - 認証の事象 … セッションの adapter のサインインの開始とログアウト、製品のサインインの帰り道
 *
 * 出口は `Logger` の 1 つ(`@kaninabe/runtime/ports`)。製品が出力先を選ぶ(標準出力の `Logger` を製品の配線が渡す)。この部品が持つ
 * `stdoutLogger` は、製品が口を渡せない前段(リクエスト前段・Route Handler の関門)の既定で、書式は同じ 1 行 1 JSON である。
 */

import type { ActionError, ActionResult } from '../domain/result';
import type { Logger, LogRecord } from './ports';
import { LOG_FIELDS, SECURITY_EVENTS } from './security-events';
import type { RefusalCode, SecurityEventId } from './security-events';

export { LOG_FIELDS, LOG_FIELD_NAMES, SECURITY_EVENTS } from './security-events';
export type { RefusalCode, SecurityEventId, SecurityEventSource, SecurityEventSpec } from './security-events';

/** 拒否 1 件を記録するときの文脈(何の操作を・誰が・どの要求で)。 */
export interface RefusalLogContext {
  /** 操作の関数名(`settleWidget`。`layer/operation-naming` の名前)。 */
  readonly operation: string;
  /** 実行者のメンバー ID。未ログインは `null`。**パースより先に解決した値を渡す**(logging.md)。 */
  readonly actorId: string | null;
  /** 要求の識別子(`requestIdOf` の結果。無ければ `null`)。 */
  readonly requestId: string | null;
}

/** 拒否の 1 分類 → 事象と分類コード。 */
interface RefusalMapping {
  readonly security_event: SecurityEventId;
  readonly refusal_code: RefusalCode;
}

/**
 * `ActionError` を事象と分類コードに写す(目録の表の読み替え)。
 *
 * @param error - 拒否
 * @returns 事象の ID と分類コード
 */
function mappingOf(error: ActionError): RefusalMapping {
  switch (error.kind) {
    case 'forbidden':
      return error.mfaRequired === true
        ? { security_event: 'mfa_refused', refusal_code: 'mfa_required' }
        : { security_event: 'authz_refused', refusal_code: 'role_forbidden' };
    case 'invalid_input':
      return { security_event: 'input_rejected', refusal_code: 'invalid_input' };
    case 'guard_unsatisfied':
      return {
        security_event: 'rule_refused',
        refusal_code: error.blockedBy === 'state' ? 'state_conflict' : 'guard_unsatisfied',
      };
    case 'invariant_violated':
      return { security_event: 'invariant_refused', refusal_code: 'invariant_violated' };
    case 'temporarily_unavailable':
      return { security_event: 'action_failed', refusal_code: 'action_threw' };
  }
}

/**
 * 拒否 1 件の行を組む。
 *
 * `event` は `ActionError` が運んできた仕様のイベント ID(入力の検証の失敗には付けない —— 入力の話でドメインイベントの発火ではない)、
 * `invariant` は不変条件違反のときだけ、`commit`(`not_committed` / `unknown`)は一時的な失敗のときだけ載る。
 * **理由文(`reason`)・指摘のフィールド名・ロール ID は載せない。**
 *
 * @param context - 操作・実行者・要求
 * @param error - 拒否
 * @returns ログの 1 行
 */
export function refusalRecord(context: RefusalLogContext, error: ActionError): LogRecord {
  const mapping = mappingOf(error);
  return {
    level: 'warn',
    security_event: mapping.security_event,
    operation: context.operation,
    ...('event' in error ? { event: error.event } : {}),
    actor_id: context.actorId,
    error_kind: error.kind,
    refusal_code: mapping.refusal_code,
    ...(error.kind === 'invariant_violated' ? { invariant: error.invariant } : {}),
    // 一時的な失敗は、書けたかどうか(点検 21 回目 B の O21-1)。運用者が「書けたかもしれない失敗」を数えられるように、印の無い失敗は unknown に倒す。
    ...(error.kind === 'temporarily_unavailable' ? { commit: error.commit ?? 'unknown' } : {}),
    request_id: context.requestId,
  };
}

/**
 * 操作の結果が拒否なら 1 行記録する(成功は出さない。成功は利用者に返り、状態の変化は監査ログに残る)。
 *
 * @param logger - 出力口
 * @param context - 操作・実行者・要求
 * @param result - 操作の結果
 */
export function recordRefusal(logger: Logger, context: RefusalLogContext, result: ActionResult<unknown>): void {
  if (result.ok) return;
  logger.write(refusalRecord(context, result.error));
}

/** 認証の事象の ID(目録のうち、サインインとログアウトの分)。 */
export type AuthEventId = Extract<
  SecurityEventId,
  'sign_in_started' | 'sign_in_start_failed' | 'sign_in_callback_succeeded' | 'sign_in_callback_failed' | 'signed_out' | 'sign_out_degraded' | 'sessions_ended'
>;

/** 事象の ID → 重大度(目録から引く。認証の事象は全部目録にある)。 */
const LEVEL_OF = Object.fromEntries(SECURITY_EVENTS.map((entry) => [entry.id, entry.level])) as Readonly<Record<SecurityEventId, 'info' | 'warn'>>;

/** 認証の事象 1 件の入力。 */
export interface AuthEventInput {
  readonly event: AuthEventId;
  /** 実行者のメンバー ID(サインイン前・取れなければ `null`)。 */
  readonly actorId: string | null;
  /** 結末(サインインの帰り道の着地、または固定のコード)。 */
  readonly decision: string;
  /** 要求の識別子。 */
  readonly requestId: string | null;
}

/**
 * 認証の事象 1 件を記録する。重大度は目録が決める(成功は `info`、失敗は `warn`)。
 *
 * @param logger - 出力口
 * @param input - 事象・実行者・結末・要求
 */
export function recordAuthEvent(logger: Logger, input: AuthEventInput): void {
  logger.write({
    level: LEVEL_OF[input.event],
    security_event: input.event,
    actor_id: input.actorId,
    decision: input.decision,
    request_id: input.requestId,
  });
}

/**
 * 出どころを確かめられなかった要求の行を組む。
 *
 * 経路(URL)は載せない —— 招待コードなど、秘密になりうる値が経路に入る口がある。口の特定は `request_id` で配置先の要求ログと突き合わせる。
 *
 * @param requestId - 要求の識別子
 * @returns ログの 1 行
 */
export function originRefusalRecord(requestId: string | null): LogRecord {
  return {
    level: 'warn',
    security_event: 'origin_refused',
    refusal_code: 'cross_origin',
    request_id: requestId,
  };
}

/** 要求の識別子として受け付ける形(配置先が付ける ID の文字だけ。行の偽造と肥大を防ぐ)。 */
const REQUEST_ID_SHAPE = /^[A-Za-z0-9._:-]{1,128}$/u;

/**
 * 要求の識別子を運ぶヘッダ(先に見つかったものを使う)。
 *
 * **配置先が付け直すヘッダを先に読む**。`x-request-id` は利用者がそのまま送れるので、先に読むと攻撃者が自分の拒否の行の ID を選べ、
 * 配置先の要求ログとの突き合わせを断てる(`x-vercel-id` は Vercel の前段が必ず上書きする)。`x-request-id` は配置先が ID を付けない
 * 環境(ローカル・自前のサーバー)のための代わりで、利用者が選べる値として扱う。
 */
const REQUEST_ID_HEADERS = ['x-vercel-id', 'x-request-id'] as const;

/** ヘッダを読む口(`Headers` と Next.js の読み取り専用のヘッダのどちらも当てはまる)。 */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * 要求の識別子を読む(配置先の `x-vercel-id`、無ければ `x-request-id`)。形が合わなければ `null`。
 *
 * @param headers - 要求のヘッダ
 * @returns 識別子。無い・形が合わない場合は `null`
 */
export function requestIdOf(headers: HeaderReader): string | null {
  for (const name of REQUEST_ID_HEADERS) {
    const value = headers.get(name)?.trim();
    if (value !== undefined && REQUEST_ID_SHAPE.test(value)) return value;
  }
  return null;
}

/**
 * 標準出力に 1 行 1 JSON で出す `Logger`。製品が口を渡せない前段の既定で、書式は製品の `consoleLogger` と同じである。
 */
export const stdoutLogger: Logger = {
  write: (record) => {
    console.info(JSON.stringify(record));
  },
};

// `LOG_FIELD_NAMES` と `LogRecord` のキーが 1 対 1 であることを型で確かめる(どちらかに足して片方を忘れると、ここが落ちる)。
type ListedField = (typeof LOG_FIELDS)[number]['name'];
const fieldsComplete: [Exclude<keyof LogRecord, ListedField>, Exclude<ListedField, keyof LogRecord>] extends [never, never] ? true : never = true;
void fieldsComplete;
