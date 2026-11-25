/**
 * **セッションの接続層から、やり直しの口を素通りする道を書こうとする探り**(呼ばない。型検査だけが読む。fix27 項目 C。
 * もとは製品の接続層の試験(rpc-port.unit.test.ts)の枠の側の分 —— 差分点検 fix26 14 回目 E14-1 で枠の側へ移した)。
 *
 * 各 `@ts-expect-error` の理由の頭の番号は、その行が**その番号の誤りだけ**で落ちることを `public-surface.test.ts` が照らす。
 * 印の無い行(下の正しい道)は誤りを持たない。
 */

import { retryRollbacks } from '@kaninabe/adapter-postgrest';
// @ts-expect-error TS2307 PostgREST の adapter の入口の外のファイルは、exports の名指しが開かない(生の口の型を深い住所で引けない)。
import type { RawRpc } from '@kaninabe/adapter-postgrest/dist/rpc/rollback-retry';
import { createSessionAdmin } from '../index';
import type { SessionClient } from '../index';

/** 型の口を呼ぶ DB の型(表を 1 枚持つ。表の名前の誤りで通らないように、実在する表で書き込みを試す)。 */
type Db = {
  readonly api: {
    readonly Tables: { readonly widgets: { readonly Row: { readonly id: string }; readonly Insert: { readonly id?: string }; readonly Update: { readonly id?: string }; readonly Relationships: [] } };
    readonly Views: Record<never, never>;
    readonly Functions: Record<never, never>;
  };
};

/**
 * セッションの接続層と、型の印の無い生の口から、素通りの道を書こうとする。
 *
 * @param client - セッションの接続層
 * @param bare - 型の印の無い構造の口
 */
export function bypassAttempts(client: SessionClient<Db, 'api'>, bare: { rpc(name: string, args: Readonly<Record<string, unknown>>): Promise<{ data: unknown; error: null }> }): void {
  // @ts-expect-error TS2339 セッションの接続層は rpc を出さない(RPC はやり直しの口からだけ)。
  void client.rpc;
  // @ts-expect-error TS2339 セッションの接続層は schema を出さない(schema が返す接続層は rpc と書き込みを持つ)。
  void client.schema;
  // @ts-expect-error TS2339 セッションの接続層の from は読み取りだけ(書き込みはやり直しの口からだけ)。
  void client.from('widgets').insert;
  // @ts-expect-error TS2339 update も同じ。
  void client.from('widgets').update;
  // @ts-expect-error TS2345 セッションの管理は、型の印の無い構造の口(やり直しを通っていない生の口)を受け取らない。
  createSessionAdmin(bare);
  // 正しい道: 読み取り・認証・やり直しの口を通した口は書ける。
  void client.from('widgets').select('id');
  void client.auth.getUser();
  void createSessionAdmin(retryRollbacks(client)).list;
}

/** 読まれない名前を残さない(型の import を使う)。 */
export type Unused = RawRpc;
