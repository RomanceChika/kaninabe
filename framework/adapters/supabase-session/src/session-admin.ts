/**
 * **セッションの管理**(一覧・1 本終える・自分以外を終える・メンバーの全部を終える・全員を終える)のサーバー側の部品。
 *
 * 設計: 設計メモ「サーバーだけがセッションを持つ形」 §9(自分のセッションの一覧と、全端末からのログアウト)/
 * ASVS V7.5.2(自分の有効なセッションを見て終える)・V7.4.5(管理者が利用者ごと・全員のセッションを終える)・V10.4.9(更新トークンの取り消し)
 *
 * 認証基盤のセッションの表(Supabase なら `auth.sessions`。更新トークンは連鎖で消える)の綴りは、**呼び先の特権 RPC の本文に閉じる**
 * (製品の migration)。この部品は RPC を名前で呼ぶだけで、サービスロールのクライアントを `rpc` の口の形で受け取る
 * (サービスロールの鍵はサーバー専用の配線が持ち、この部品はそれを import しない。ブラウザに出る経路がない)。
 *
 * **返すものを絞る**: 一覧が返すのは id・作成時刻・最後に使った時刻・端末の識別(User-Agent)・IP だけで、RPC がそれ以外の列を
 * 返しても通さない(アクセストークン・更新トークン・鍵の素材が画面やログに出る経路を、ここで閉じる)。
 *
 * **「本人の」を保証するのは呼ぶ側** — メンバー ID は本人のセッションから導いたものを渡す(クライアントから渡された ID を信用しない。
 * PRIN-0009)。この部品はメンバー ID の形(UUID)を確かめ、本人用の操作は渡されたメンバーの行にしか触れない RPC を呼ぶ。
 *
 * **RPC の口は型の印つきの `RpcSource` だけ**(`@kaninabe/adapter-postgrest` の `retryRollbacks` が返すもの。差分点検 fix26 13 回目 D26m-1)。
 * 構造の型の口を受け取ると、やり直しの口を通らない生の `rpc` を渡せてしまう(RPC を呼ぶ道は 1 つ。保証 `rpc_enforces_spec`)。
 */

import type { RpcSource } from '@kaninabe/adapter-postgrest';


/** 呼ぶ RPC の名前(製品の migration が作る関数。既定は仕組みの雛形の名前)。 */
export interface SessionRpcNames {
  readonly list: string;
  readonly end: string;
  readonly endOthers: string;
  readonly endAllOf: string;
  readonly endEvery: string;
}

/** 既定の RPC 名(雛形の migration が作る関数)。 */
export const SESSION_RPC_NAMES: SessionRpcNames = {
  list: 'list_auth_sessions',
  end: 'end_auth_session',
  endOthers: 'end_other_auth_sessions',
  endAllOf: 'revoke_auth_sessions',
  endEvery: 'end_every_auth_session',
};

/** 画面に出せるセッション 1 本の要約(トークンは持たない)。 */
export interface SessionSummary {
  readonly id: string;
  /** サインインした時刻(ISO 8601)。 */
  readonly createdAt: string;
  /** 最後にセッションを更新した時刻(ISO 8601)。 */
  readonly lastActiveAt: string;
  /** 端末の識別(User-Agent)。保存されていなければ null。 */
  readonly userAgent: string | null;
  /** IP アドレス。保存されていなければ null。 */
  readonly ip: string | null;
  /** いま操作している端末のセッションか(「ここ」と表示し、うっかり自分を終えないための印)。 */
  readonly current: boolean;
}

/** セッションの管理の失敗(理由は呼び出しの種類だけ。認証基盤の応答の中身は載せない)。 */
export class SessionAdminError extends Error {
  /** 失敗した操作。 */
  readonly operation: string;

  constructor(operation: string, reason: string, options?: { readonly cause?: unknown }) {
    super(`セッションの管理に失敗しました(${operation}: ${reason})`, options);
    this.name = 'SessionAdminError';
    this.operation = operation;
  }
}

/** セッションの管理の操作。 */
export interface SessionAdmin {
  /** メンバーの有効なセッションの一覧(新しい順)。`currentSessionId` と同じ id に `current` の印を付ける。 */
  list(memberId: string, currentSessionId: string | null): Promise<readonly SessionSummary[]>;
  /** メンバーのセッションを 1 本終える。別のメンバーのセッション ID なら何も終えず false。 */
  end(memberId: string, sessionId: string): Promise<boolean>;
  /** メンバーの、指定した 1 本以外のセッションを全部終える(終えた本数)。 */
  endOthers(memberId: string, keepSessionId: string): Promise<number>;
  /** メンバーのセッションを全部終える(終えた本数)。 */
  endAll(memberId: string): Promise<number>;
  /** 全メンバーのセッションを終える(除外するメンバーは 1 人まで。null なら全員。終えた本数)。 */
  endEvery(exceptMemberId: string | null): Promise<number>;
}

/** UUID の形(大文字小文字を問わない)。 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ID が UUID の形でなければ、RPC を呼ぶ前に落とす。 */
function assertUuid(operation: string, label: string, value: string): void {
  if (!UUID.test(value)) throw new SessionAdminError(operation, `${label} が UUID の形ではありません`);
}

/** RPC の戻り値(終えた本数)を読む。数でなければ失敗。 */
function countOf(operation: string, data: unknown): number {
  if (typeof data !== 'number' || !Number.isInteger(data) || data < 0) throw new SessionAdminError(operation, '戻り値が件数ではありません');
  return data;
}

/** 文字列か null か(それ以外は形の崩れ)。 */
function textOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

/** 一覧の 1 行を要約に絞る(必要な欄だけを名指しで取る。形が崩れていれば undefined)。 */
function summaryOf(row: unknown, currentSessionId: string | null): SessionSummary | undefined {
  if (typeof row !== 'object' || row === null) return undefined;
  const record = row as Readonly<Record<string, unknown>>;
  const { id, created_at: createdAt, last_active_at: lastActiveAt } = record;
  const userAgent = textOrNull(record['user_agent']);
  const ip = textOrNull(record['ip']);
  if (typeof id !== 'string' || typeof createdAt !== 'string' || typeof lastActiveAt !== 'string') return undefined;
  if (userAgent === undefined || ip === undefined) return undefined;
  return { id, createdAt, lastActiveAt, userAgent, ip, current: currentSessionId !== null && id.toLowerCase() === currentSessionId.toLowerCase() };
}

/**
 * セッションの管理の操作を作る。
 *
 * @param client - サービスロールのクライアントから作ったやり直しの口(`retryRollbacks`)。サーバー専用の配線が渡す
 * @param names - 呼ぶ RPC の名前(省略は雛形の名前)
 * @returns 操作の束
 */
export function createSessionAdmin(client: RpcSource, names: SessionRpcNames = SESSION_RPC_NAMES): SessionAdmin {
  /** RPC を呼び、失敗(エラー・例外)を `SessionAdminError` に揃える。 */
  async function call(operation: string, fn: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      const { data, error } = await client.rpc(fn, args);
      if (error !== null) throw new SessionAdminError(operation, '認証基盤が失敗を返しました', { cause: error });
      return data;
    } catch (cause) {
      if (cause instanceof SessionAdminError) throw cause;
      throw new SessionAdminError(operation, '認証基盤に届きませんでした', { cause });
    }
  }

  return {
    async list(memberId, currentSessionId) {
      assertUuid('list', 'memberId', memberId);
      const data = await call('list', names.list, { p_member_id: memberId });
      if (!Array.isArray(data)) throw new SessionAdminError('list', '戻り値が配列ではありません');
      const summaries = data.map((row: unknown) => summaryOf(row, currentSessionId));
      if (summaries.some((summary) => summary === undefined)) throw new SessionAdminError('list', '行の形が想定と違います');
      return summaries as SessionSummary[];
    },
    async end(memberId, sessionId) {
      assertUuid('end', 'memberId', memberId);
      assertUuid('end', 'sessionId', sessionId);
      return countOf('end', await call('end', names.end, { p_member_id: memberId, p_session_id: sessionId })) > 0;
    },
    async endOthers(memberId, keepSessionId) {
      assertUuid('endOthers', 'memberId', memberId);
      assertUuid('endOthers', 'keepSessionId', keepSessionId);
      return countOf('endOthers', await call('endOthers', names.endOthers, { p_member_id: memberId, p_keep_session_id: keepSessionId }));
    },
    async endAll(memberId) {
      assertUuid('endAll', 'memberId', memberId);
      return countOf('endAll', await call('endAll', names.endAllOf, { p_member_id: memberId }));
    },
    async endEvery(exceptMemberId) {
      if (exceptMemberId !== null) assertUuid('endEvery', 'exceptMemberId', exceptMemberId);
      return countOf('endEvery', await call('endEvery', names.endEvery, { p_except_member_id: exceptMemberId }));
    },
  };
}

/** 署名を確かめたクレームのうち、セッションの ID(`session_id`)を読む口(Supabase のクライアントの `auth.getClaims` の形)。 */
export interface SessionIdReader {
  readonly auth: { getClaims(): Promise<{ readonly data: { readonly claims: { readonly session_id?: unknown } } | null; readonly error: unknown }> };
}

/**
 * いま操作している端末のセッションの ID を、署名を確かめたクレームから読む(一覧の「ここ」の印と「ほかの端末を終える」の残す 1 本に使う)。
 *
 * @param client - リクエストのセッションを載せたクライアント
 * @returns セッション ID。未ログイン・読めない・例外のときは null(呼ぶ側は「ここ」を決められないので、自分以外を終える操作を拒む)
 */
export async function currentSessionIdOf(client: SessionIdReader): Promise<string | null> {
  try {
    const { data, error } = await client.auth.getClaims();
    const id = data?.claims.session_id;
    return error === null && typeof id === 'string' && UUID.test(id) ? id : null;
  } catch {
    return null;
  }
}
