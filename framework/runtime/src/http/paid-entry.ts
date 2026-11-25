/**
 * **有料の口の共通の入口**(ASVS V2.4.1 大量呼び出しの抑制・V15.2.2 重い機能の守り)。
 *
 * 規約: docs/rules/process/backend/system/standards/conventions/route-handlers.md(§有料の口)
 * 宣言: external_spec の `spend: paid` の行(`abuse.max_body_bytes` / `authz` / `meter`)。値は生成物(`PAID_ENTRIES`)から口に渡る。
 *
 * ブラウザから叩かれ、サーバーの側でお金を使う連携(AI など)を呼ぶ Route Handler は、本文を読む・認可する・枠を消費する・
 * 有料の処理を呼ぶ、の順序そのものが守りである。順序を口ごとに手で書くと、逆にした口(課金してから枠を数える・本文を読み切ってから
 * 上限を見る)が静かに混ざる。この部品が順序を 1 か所で持つ ——
 *
 *   1. **認可**(`authorize`)… 未ログインは 401、宣言した役を持たない人は 403。本文は 1 バイトも読まない
 *   1b. **多要素認証**(`bindings.mfa`)… 要求する製品で、多要素認証を済ませていないセッションは 403。本文は読まず、枠も消費せず、有料の処理も呼ばない
 *      (画面の関門と Server Action の執行だけでは、cookie で認証するこの口が素通しになる。判定は実行器・手書きの Server Action と同じ `mfaRefusal`)
 *   2. **本文の上限**(`maxBodyBytes`)… `Content-Length` が上限を超えていれば読まずに 413。無い・偽っていても、読みながら数えて
 *      超えた時点で打ち切る(読むのは上限までと、超えた最初のひと塊だけ。ひと塊は溜めずに捨てる)
 *   3. **形の検査**(`parse`)… 壊れた JSON・形の不正は 400(枠は消費しない)
 *   4. **枠の消費**(`consume`)… 使い切っていれば 429、役を持たない実行者を DB が拒めば 403。**有料の処理(`handler`)の前に**呼ぶ
 *   5. **有料の処理**(`handler`)… ここまで来たときだけ呼ぶ
 *
 * 拒否はすべてセキュリティログに 1 行残る(事象は既存の目録の `authz_refused` / `mfa_refused` / `input_rejected` / `invariant_refused`。入力の値・経路は載せない)。
 * 出力口(`logger`)は必須で、口は製品の転送つきの口(`securityLogger()`)を渡す —— 拒否の行はホストの外へも送られる(鍵があるとき)。
 * 応答の本文は固定の語だけで、入力の中身を返さない。出どころの確認(`refuseCrossOrigin`)はこの部品の前に口の最初の文で行う(J2)。
 *
 * **これを使っているか**(口が `runPaidEntry` を実際の import で呼び、有料の処理が `handler` の中だけにあり、上限・役が生成物から来ているか)は
 * 検査 X8 が構文木で見る。
 */

import type { RuntimeBindings } from '../domain/bindings.js';
import { mfaRefusal } from '../operation/_template/mfa-requirement.js';
import type { Logger, LogRecord } from '../operation/ports.js';
import { requestIdOf } from '../operation/security-log.js';
import { jsonResponse } from './response.js';

/** 認可の結果。 */
export type AuthorizeOutcome =
  /** 宣言した役を持つ実行者(`actorId` は実行者の識別子。枠の数えとログの鍵になる)。 */
  | { readonly kind: 'ok'; readonly actorId: string }
  /** 未ログイン。 */
  | { readonly kind: 'unauthenticated' }
  /** ログインしているが、宣言した役を持たない(`actorId` はログに載せる実行者の識別子)。 */
  | { readonly kind: 'forbidden'; readonly actorId?: string };

/** 形の検査の結果。 */
export type ParseOutcome<Value> = { readonly kind: 'ok'; readonly value: Value } | { readonly kind: 'invalid' };

/** 枠の消費の結果。`exhausted` = 使い切っている / `forbidden` = DB が役を持たない実行者を拒んだ。 */
export type ConsumeOutcome = 'used' | 'exhausted' | 'forbidden';

/** `runPaidEntry` の引数。 */
export interface PaidEntryOptions<Value> {
  /** ログに載せる操作の名前(固定の語。入力の値・経路は載せない)。 */
  readonly operation: string;
  /** 本文の最大バイト数(1 以上の整数。宣言 `abuse.max_body_bytes` から来た生成物の値を渡す)。 */
  readonly maxBodyBytes: number;
  /** 実行者の解決と役の確認(セッションから。役は宣言 `authz` の役)。 */
  readonly authorize: (request: Request) => Promise<AuthorizeOutcome>;
  /**
   * **多要素認証の段に要る宣言の束**(生成物 `runtimeBindings`。必須)。認証フロー仕様が要求を宣言した製品では `mfa` が載っていて、
   * 多要素認証を済ませていないセッションをここで止める。要求しない製品では `mfa` が無く、段は何もしない。値は生成物だけが作る
   * (手で書き換えて外せない)。口が生成物を渡していることは X8 が構文木で見る。
   */
  readonly bindings: Pick<RuntimeBindings, 'mfa' | 'roleTables'>;
  /** 口の役(宣言 `authz.role`。生成物 `PAID_ENTRIES[…].role`)。要求の範囲が `roles` のとき、この役が立つ(含意の先を含む)かの判定に使う。 */
  readonly role: string;
  /**
   * セッションが多要素認証を済ませているかの解決(認証の組み立ての根の `resolveSessionMfa`)。**要求する製品は渡す**。
   * 渡さなければ「済ませていない」として扱う(安全側。要求する製品がこれを忘れると全員が止まるので、気づく)。
   */
  readonly resolveMfa?: () => Promise<boolean>;
  /** JSON として読んだ本文の形の検査。 */
  readonly parse: (body: unknown) => ParseOutcome<Value>;
  /** 枠を 1 つ消費する(宣言 `meter` の RPC を呼ぶ)。 */
  readonly consume: (actorId: string) => Promise<ConsumeOutcome>;
  /** 有料の処理。枠を消費できたときだけ呼ばれる。 */
  readonly handler: (input: { readonly actorId: string; readonly value: Value }) => Promise<Response>;
  /** 枠の拒否のログに載せる不変条件の ID(任意)。 */
  readonly invariant?: string;
  /**
   * ログの出力口(**必須**)。製品の認証の組み立ての根の `securityLogger()`(標準出力に出し、鍵があればホストの外へも送る口)を渡す。
   * 有料の口は乱用(枠の総当たり・多要素認証を済ませないセッションの試み)が最初に出る場所なので、拒否の行を標準出力だけに残さない
   * (logging.md §ホストの外への転送。口が渡していることは X8 が構文木で見る)。
   */
  readonly logger: Logger;
}

/** 本文を上限つきで読んだ結果。 */
export type LimitedBody =
  | { readonly kind: 'ok'; readonly bytes: Uint8Array }
  | { readonly kind: 'too_large' }
  | { readonly kind: 'missing' };

/** `Content-Length` が宣言する大きさ(読めない・無い値は null)。 */
function declaredLength(request: Request): number | null {
  const header = request.headers.get('content-length');
  if (header === null || !/^\d+$/u.test(header.trim())) return null;
  return Number(header.trim());
}

/** 溜めた塊を 1 本のバイト列にする。 */
function concatenate(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * 本文を上限つきで読む。`Content-Length` が上限を超えていれば 1 バイトも読まない。無い・偽っているときは読みながら数え、
 * 超えた最初のひと塊を溜めずに捨てて読みを打ち切る(上限を超えるバイトは保持しない)。
 *
 * @param request 要求
 * @param maxBytes 本文の最大バイト数
 * @returns バイト列、上限超え、本文なし
 */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<LimitedBody> {
  const declared = declaredLength(request);
  if (declared !== null && declared > maxBytes) return { kind: 'too_large' };
  const stream = request.body;
  if (stream === null) return { kind: 'missing' };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return { kind: 'too_large' };
    }
    chunks.push(value);
  }
  return { kind: 'ok', bytes: concatenate(chunks, received) };
}

/** バイト列を JSON として読む(壊れていれば `undefined` ではなく失敗の印)。 */
function parseJson(bytes: Uint8Array): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown };
  } catch {
    return { ok: false };
  }
}

/** 拒否 1 件のログの行(経路・入力・理由文は載せない)。 */
function refusal(
  options: { readonly operation: string; readonly invariant?: string },
  request: Request,
  actorId: string | null,
  kind: 'authz' | 'mfa' | 'input' | 'quota',
  message?: string,
): LogRecord {
  const shape = {
    authz: { security_event: 'authz_refused', refusal_code: 'role_forbidden', error_kind: 'forbidden' },
    mfa: { security_event: 'mfa_refused', refusal_code: 'mfa_required', error_kind: 'forbidden' },
    input: { security_event: 'input_rejected', refusal_code: 'invalid_input', error_kind: 'invalid_input' },
    quota: { security_event: 'invariant_refused', refusal_code: 'invariant_violated', error_kind: 'invariant_violated' },
  } as const;
  return {
    level: 'warn',
    ...shape[kind],
    operation: options.operation,
    actor_id: actorId,
    ...(kind === 'quota' && options.invariant !== undefined ? { invariant: options.invariant } : {}),
    request_id: requestIdOf(request.headers),
    ...(message === undefined ? {} : { message }),
  };
}

/** 固定の語だけの拒否の応答。 */
function refuse(status: number, error: string): Response {
  return jsonResponse({ error }, { status });
}

/**
 * 口の役に立つロール(`implies` で閉じる。先頭が口の役)。要求の範囲が `roles` のとき、要求するロールが入っていれば止める
 * (実行器と同じく、含意で立つロールも数える狭い側に倒す)。
 */
function standingRoles(bindings: Pick<RuntimeBindings, 'roleTables'>, role: string): readonly [string, ...string[]] {
  const closed = new Set<string>([role, ...(bindings.roleTables.implications[role] ?? [])]);
  return [role, ...[...closed].filter((other) => other !== role)];
}

/**
 * 多要素認証の段。要求に掛かる実行者だけ解決を引き、済ませていなければ拒否の応答を返す(掛からない・済ませていれば `null`)。
 * 解決が無い・投げたときは「済ませていない」(安全側)。
 */
async function mfaGate(options: Pick<PaidEntryOptions<never>, 'bindings' | 'role' | 'operation' | 'resolveMfa'>, actorId: string): Promise<boolean> {
  const roles = standingRoles(options.bindings, options.role);
  const subject = { actorId, system: false } as const;
  // 要求に掛からないなら、解決(セッションの再検証)を引かない。
  if (mfaRefusal(options.bindings.mfa, { ...subject, actorMfa: false }, roles, options.role, options.operation) === null) return true;
  let verified = false;
  try {
    verified = (await options.resolveMfa?.()) === true;
  } catch {
    verified = false;
  }
  return mfaRefusal(options.bindings.mfa, { ...subject, actorMfa: verified }, roles, options.role, options.operation) === null;
}

/**
 * 有料の口の入口。順序は認可 → 多要素認証 → 本文の上限 → 形 → 枠の消費 → 有料の処理(ファイル冒頭)。
 *
 * @param request 要求(`POST` など。出どころの確認は呼び手が済ませている)
 * @param options 宣言から来た上限と、認可・形・枠・処理
 * @returns 拒否の応答(401 / 403(役が無い・多要素認証が未了) / 413 / 400 / 429)か、`handler` の応答
 * @throws {TypeError} `maxBodyBytes` が 1 以上の整数でないとき(上限を持たない口を作らない)・`logger` が無いとき
 */
export async function runPaidEntry<Value>(request: Request, options: PaidEntryOptions<Value>): Promise<Response> {
  if (!Number.isSafeInteger(options.maxBodyBytes) || options.maxBodyBytes < 1) {
    throw new TypeError('runPaidEntry: maxBodyBytes は 1 以上の整数で渡します(有料の口は本文の上限を必ず持つ)');
  }
  // 型の外から呼ばれても、拒否の行の出力口を黙って標準出力だけにしない(転送の口を渡し忘れた口を作らない)。
  if (typeof (options.logger as Partial<Logger> | undefined)?.write !== 'function') {
    throw new TypeError('runPaidEntry: logger を渡します(拒否の行をホストの外へも送る製品の口。認証の組み立ての根の securityLogger())');
  }
  const { logger } = options;
  const authorized = await options.authorize(request);
  if (authorized.kind === 'unauthenticated') {
    logger.write(refusal(options, request, null, 'authz'));
    return refuse(401, 'unauthorized');
  }
  if (authorized.kind === 'forbidden') {
    logger.write(refusal(options, request, authorized.actorId ?? null, 'authz'));
    return refuse(403, 'forbidden');
  }
  const { actorId } = authorized;
  if (!(await mfaGate(options, actorId))) {
    logger.write(refusal(options, request, actorId, 'mfa'));
    return refuse(403, 'mfa_required');
  }

  const read = await readBodyLimited(request, options.maxBodyBytes);
  if (read.kind === 'too_large') {
    logger.write(refusal(options, request, actorId, 'input', 'payload_too_large'));
    return refuse(413, 'payload_too_large');
  }
  const json = read.kind === 'ok' ? parseJson(read.bytes) : { ok: false as const };
  const parsed = json.ok ? options.parse(json.value) : ({ kind: 'invalid' } as const);
  if (parsed.kind === 'invalid') {
    logger.write(refusal(options, request, actorId, 'input'));
    return refuse(400, 'invalid_input');
  }

  const consumed = await options.consume(actorId);
  if (consumed === 'forbidden') {
    logger.write(refusal(options, request, actorId, 'authz'));
    return refuse(403, 'forbidden');
  }
  if (consumed === 'exhausted') {
    logger.write(refusal(options, request, actorId, 'quota', 'quota_exhausted'));
    return refuse(429, 'quota_exhausted');
  }
  return options.handler({ actorId, value: parsed.value });
}
