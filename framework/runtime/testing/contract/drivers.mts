import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { Pool } from 'pg';
import type { InvariantResolver } from '@kaninabe/runtime/bindings';
import type { DbPorts } from '@kaninabe/runtime/ports';
import { createPgPorts } from '../pg/ports.mjs';
import type { PgQueryable, PgSignatures } from '../pg/types.mjs';
import { recordingFetch, recordingQueryable } from './record.mjs';
import { scriptOf, scriptedFetch, scriptedQueryable } from './scripted.mjs';
import type { Channel, ContractDriver, ContractWorld, Scenario, Sent, Situation } from './types.mjs';

/**
 * 契約テストの 2 つのドライバ(PostgREST の adapter と pg の参照 adapter)を、**偽の通信路**にも**実物の通信路**にも
 * 差せる形で組む。試験の束(`groups.mts`)は同じで、ここが差すものだけが違う。
 *
 * | | 偽の通信路(`fake`。手元のユニット) | 実物の通信路(`live`。夜間の統合) |
 * |---|---|---|
 * | PostgREST | 記録する `fetch`(状況が決めた HTTP の応答を返す) | 記録する実物の `fetch`(ローカルの Supabase) |
 * | pg | 記録する偽のクライアント(行か、作ったエラーを返す) | 記録する実物の `Pool`(ローカルの Postgres) |
 * | 接続の失敗 | 作った `fetch` / システムのエラー | 閉じたポート・受けてすぐ切るサーバーへ実際につなぐ |
 *
 * **製品の語彙も、PostgREST の adapter パッケージも、ここは知らない**(runtime は adapter に依存しない)。PostgREST の口の束は
 * 製品の配線(`PostgrestWiring`)が組んで渡し、pg の側は署名の表と不変条件の引き方を製品が渡す。接続先の値(URL・鍵)も
 * 呼び側が渡す —— ここは環境変数を読まない。
 */

/** 実物の通信路の宛先(接続の失敗を起こす場所)。 */
export interface Endpoints {
  /** 何も待ち受けていないポート(接続拒否になる)。 */
  readonly refusedPort: number;
  /** 受けてすぐ切るサーバーのポート(送ったあとの切断になる)。 */
  readonly droppedPort: number;
  /** 待ち受けを閉じる。 */
  close(): Promise<void>;
}

/** 実物の通信路の接続先(呼び側が環境から読んで渡す)。 */
export interface LiveTarget {
  readonly endpoints: Endpoints;
  /** PostgREST の URL。 */
  readonly postgrestUrl: string;
  /** PostgREST に渡す鍵。 */
  readonly postgrestKey: string;
  /** Postgres の接続文字列。 */
  readonly databaseUrl: string;
}

/** 通信路の種類。 */
export type Wire = { readonly kind: 'fake' } | { readonly kind: 'live'; readonly target: LiveTarget };

/** 製品が組む PostgREST の口の束(実クライアントの作り方と適合は製品の接続層の仕事)。 */
export interface PostgrestWiring {
  /**
   * 差し替えた `fetch` で PostgREST の adapter の 3 つの口を組む。
   *
   * @param fetchImpl - クライアントが使う `fetch`
   * @param url - PostgREST の URL
   * @param key - 鍵
   * @returns 口の束
   */
  portsOver(fetchImpl: typeof fetch, url: string, key: string): DbPorts;
}

/** pg の参照 adapter に製品が渡すもの。 */
export interface PgWiring {
  readonly signatures: PgSignatures;
  readonly invariantOfMessage: InvariantResolver;
}

/** 待ち受けを開いて、ポートを得る。 */
function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') reject(new Error('待ち受けのポートを得られません'));
      else resolve(address.port);
    });
  });
}

/** 待ち受けを閉じる。 */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

/**
 * 接続の失敗を起こす宛先を用意する(実物の通信路用)。
 *
 * @returns 接続拒否になるポートと、受けてすぐ切るサーバーのポート
 */
export async function openEndpoints(): Promise<Endpoints> {
  const closed = createServer();
  const refusedPort = await listen(closed);
  await closeServer(closed);
  const dropping = createServer((socket) => {
    socket.destroy();
  });
  const droppedPort = await listen(dropping);
  return { refusedPort, droppedPort, close: () => closeServer(dropping) };
}

/** 状況に応じて差し替える宛先のポート(接続の失敗の状況だけ)。 */
function portFor(situation: Situation, endpoints: Endpoints): number | null {
  if (situation === 'refused') return endpoints.refusedPort;
  return situation === 'dropped' ? endpoints.droppedPort : null;
}

/** 状況に応じた Postgres の接続文字列(値は読み出すだけで、どこにも出さない)。 */
function databaseUrlFor(situation: Situation, target: LiveTarget): string {
  const port = portFor(situation, target.endpoints);
  const url = new URL(target.databaseUrl);
  if (port !== null) {
    url.hostname = '127.0.0.1';
    url.port = String(port);
  }
  return url.toString();
}

/**
 * PostgREST の adapter のドライバ。
 *
 * @param world - 製品が渡す世界(偽の通信路の応答を決めるのに使う)
 * @param wire - 通信路の種類
 * @param wiring - 製品が組む PostgREST の口の束
 * @returns ドライバ
 */
export function postgrestDriver(world: ContractWorld, wire: Wire, wiring: PostgrestWiring): ContractDriver {
  return {
    name: 'postgrest',
    open: (situation: Situation, scenario: Scenario): Promise<Channel> => {
      const sink: Sent[] = [];
      if (wire.kind === 'fake') {
        const inner = scriptedFetch(scriptOf(situation, scenario, world.invariantMessage));
        return Promise.resolve({ ports: wiring.portsOver(recordingFetch(inner, sink), 'http://db.test', 'test-key'), sent: () => sink });
      }
      const port = portFor(situation, wire.target.endpoints);
      const url = port === null ? wire.target.postgrestUrl : `http://127.0.0.1:${String(port)}`;
      return Promise.resolve({ ports: wiring.portsOver(recordingFetch(fetch, sink), url, wire.target.postgrestKey), sent: () => sink });
    },
    close: () => Promise.resolve(),
  };
}

/**
 * pg の参照 adapter のドライバ。
 *
 * @param world - 製品が渡す世界(偽の通信路の応答を決めるのに使う)
 * @param wire - 通信路の種類
 * @param wiring - 署名の表と不変条件の引き方
 * @returns ドライバ
 */
export function pgDriver(world: ContractWorld, wire: Wire, wiring: PgWiring): ContractDriver {
  const pools: Pool[] = [];
  return {
    name: 'pg',
    open: (situation: Situation, scenario: Scenario): Promise<Channel> => {
      const sink: Sent[] = [];
      let inner: PgQueryable;
      if (wire.kind === 'fake') {
        inner = scriptedQueryable(scriptOf(situation, scenario, world.invariantMessage));
      } else {
        const pool = new Pool({ connectionString: databaseUrlFor(situation, wire.target), max: 1 });
        // 使っていない接続が相手に切られても、プロセスを落とさない(切られた通信は問い合わせの失敗として読む)。
        pool.on('error', () => undefined);
        pools.push(pool);
        inner = { query: async (text, values) => ({ rows: (await pool.query<Record<string, unknown>>(text, values)).rows }) };
      }
      const ports = createPgPorts({ client: recordingQueryable(inner, sink), ...wiring });
      return Promise.resolve({ ports, sent: () => sink });
    },
    close: async () => {
      await Promise.all(pools.splice(0).map((pool) => pool.end()));
    },
  };
}
