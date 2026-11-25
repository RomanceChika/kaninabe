/**
 * 生成された **Server Action と組み立ての根に、多要素認証の要求を通す行**(auth-spec-writing.md §mfa)。
 *
 * 執行そのものは実行時パッケージの実行器が持つ(`RunPlanCommand.actorMfa` と束の `mfa`)。ここが書くのは、
 * 要求を宣言した製品で **セッションが多要素認証を済ませたかを Server Action が解決して渡す**配線だけである。
 * 単発の操作(`code-operation-app.ts`)と保存点(`code-usecase-app.ts`)の 2 つの生成器が同じ行を引く —— 形が 2 つに
 * 割れると、片方の入口だけ要求が黙って外れる。
 *
 * **要求を宣言しない製品(外す宣言・認証フロー仕様を持たない)では 1 行も変えない。** 渡さなくても実行器は束に
 * 要求が無ければ見ないが、生成物の字面を変えないことで「外した製品は何も変わらない」を差分の無さで示せる。
 *
 * 解決する関数(`resolveSessionMfa`)は製品の認証の組み立ての根(配置の `auth-composition`)が持つ手書きの接続点で、
 * 実行者の解決(`resolveActorId` / `resolveSessionProfile`)と同じ場所に住む。無ければ生成された Server Action の
 * 型検査が落ちる(要求するのに解決が無い状態で出荷できない)。
 */

import { MFA_RESOLVER, enforcedMfaScope } from '../../model/auth/mfa.js';
import type { AuthMfaDecl, MfaScope } from '../../model/auth/mfa.js';
import { REFUSAL_LOG_EXPORTS } from '../../model/auth/refusal-log.js';
import { guardedLines } from './refusal-log-entry.js';

/**
 * 書き込みの入口で多要素認証を執行する製品か(要求の宣言があるか)。
 *
 * @param mfa 認証フロー仕様の `mfa`(読めなければ undefined)
 * @returns 要求の宣言があれば true
 */
export function mfaEnforced(mfa: AuthMfaDecl | undefined): boolean {
  return enforcedMfaScope(mfa) !== null;
}

/**
 * Server Action が認証の組み立ての根から import する名前(並びは名前順。拒否の記録の接続点 `REFUSAL_LOG_EXPORTS` を含む)。
 *
 * @param scope 執行する要求の範囲(無ければ null)
 * @returns import する名前の並び
 */
export function authImportNames(scope: MfaScope | null): string {
  return [
    ...REFUSAL_LOG_EXPORTS,
    'resolveActorId',
    'resolveRequestId',
    ...(scope === null ? [] : [MFA_RESOLVER]),
    'resolveSessionProfile',
  ]
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort()
    .join(', ');
}

/**
 * Server Action の本文で、実行者の解決のあとに足す行(要求が無ければ空)。
 *
 * @param scope 執行する要求の範囲(無ければ null)
 * @returns 本文の行
 */
export function actionMfaLines(scope: MfaScope | null): readonly string[] {
  if (scope === null) return [];
  return [
    // 多要素認証の要求(auth_spec の mfa)。執行は実行器が判断と書き込みの前に 1 回だけ行う —— 要求するロールの
    // 実行者のセッションが済ませていなければ forbidden(印 mfaRequired)で返る。解決が投げたら記録して投げ直す(点検 20 回目 B20-3)。
    ...guardedLines('actorMfa', `${MFA_RESOLVER}()`),
  ];
}

/**
 * Server Action が組み立ての根を呼ぶ引数の末尾(要求が無ければ空)。
 *
 * @param scope 執行する要求の範囲(無ければ null)
 * @returns `, actorMfa` か空文字
 */
export function actionMfaArg(scope: MfaScope | null): string {
  return scope === null ? '' : ', actorMfa';
}

/**
 * 生成テストの場面が実行器に渡す命令の行(要求する製品で、サインインした実行者のときだけ `actorMfa: true`)。
 *
 * 場面が確かめるのは仕様の `permit` の意味クラスであり、多要素認証の要求はその手前の直交する関門である
 * (実行器のユニットテストが固定する)。要求する製品の場面は**済ませたセッション**で実行する —— そうしないと
 * サインインした実行者の場面が全部要求に掛かり、意味クラスを 1 つも確かめられない。
 *
 * @param verified 多要素認証を要求する製品か
 * @param actorId 場面の実行者(未ログインは null)
 * @returns 命令の行
 */
export function scenarioMfaLines(verified: boolean, actorId: string | null): readonly string[] {
  return verified && actorId !== null ? ['      actorMfa: true,'] : [];
}

/**
 * 組み立ての根が返す関数の引数の行(要求があれば `actorMfa`、末尾に送信の意図の冪等キー)。
 *
 * @param scope 執行する要求の範囲(無ければ null)
 * @returns 引数の宣言の行
 */
export function compositionMfaParam(scope: MfaScope | null): readonly string[] {
  // 送信の意図の冪等キー(点検 20 回目 B20-1)は最後の任意の引数(意図を持たない呼び手は渡さない)。
  return [...(scope === null ? [] : ['  actorMfa: boolean,']), '  idempotencyKey?: string,'];
}

/**
 * 組み立ての根の本文の末尾の 1 行(実行器への命令。要求があれば `actorMfa` を載せる)。
 *
 * @param scope 執行する要求の範囲(無ければ null)
 * @returns `return (…) => run(deps, { … });` の行
 */
export function compositionRunLine(scope: MfaScope | null): string {
  return scope === null
    ? '  return (actorId, actorClaims, input, idempotencyKey) => run(deps, { actorId, actorClaims, input, idempotencyKey });'
    : '  return (actorId, actorClaims, input, actorMfa, idempotencyKey) => run(deps, { actorId, actorClaims, actorMfa, input, idempotencyKey });';
}
