/**
 * 保証 fw_bearer_value の実測(実 DB): `bearer` の欄の列の既定値の式が、実際に 43 字の base64url を重複なく作り、
 * 宣言の綴り(`BEARER_DEFAULT_SQL`)と `pg_get_expr` が返す綴りが一致する。
 * 後者は data_table の `defaults` の突合(data-table-parity)が文字列一致で行うので、式を変えたときにここが先に鳴る。
 */

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BEARER_BYTES, BEARER_DEFAULT_SQL, BEARER_LENGTH, isBearerDefault } from '../../lib/kernel/bearer.js';

let client: Client;

beforeAll(async () => {
  const connectionString = process.env['SUPABASE_DB_URL'];
  if (connectionString === undefined) {
    throw new Error('環境変数 SUPABASE_DB_URL が設定されていません(@kaninabe/runtime/testing/local/local-supabase.mts)。');
  }
  client = new Client({ connectionString });
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

describe('bearer の列の既定値(実 DB)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-BEARER-002
  it('実 DB で式を 1,000 回評価すると、43 字の base64url で重複せず、宣言の綴りと pg_get_expr の綴りが一致する', async () => {
    const count = 1000;
    const values = await client.query<{ value: string }>(`select ${BEARER_DEFAULT_SQL} as value from generate_series(1, ${String(count)})`);
    const seen = new Set(values.rows.map((row) => row.value));
    expect(seen.size).toBe(count);
    for (const value of seen) {
      expect(value).toHaveLength(BEARER_LENGTH);
      expect(value).toMatch(/^[A-Za-z0-9_-]+$/u);
      // 復号すると 32 バイト(256 ビット)に戻る(base64url の余りのビットを落とした 43 字)。
      expect(Buffer.from(value, 'base64url')).toHaveLength(BEARER_BYTES);
    }

    // pg_get_expr の綴り(列の既定値として保存されたときの正準形)が宣言の綴りと一致する。
    await client.query('begin');
    try {
      await client.query(`create temp table bearer_probe (v text not null default ${BEARER_DEFAULT_SQL})`);
      const stored = await client.query<{ expr: string }>(
        `select pg_get_expr(d.adbin, d.adrelid) as expr from pg_attrdef d where d.adrelid = 'bearer_probe'::regclass`,
      );
      expect(stored.rows[0]?.expr).toBeDefined();
      expect(isBearerDefault(stored.rows[0]?.expr ?? '')).toBe(true);
    } finally {
      await client.query('rollback');
    }
  });
});
