/**
 * `format: url` の文法の **TS ⇔ Postgres** 差分テスト(実 DB)。
 *
 * 表の CHECK は `~ '正規表現'` で、入力スキーマ(zod の `.regex()`)・実行時の `matchesUrl` は JS の `RegExp` である。
 * 同じ綴りを 2 つの正規表現エンジンへ置くので、「両者が同じ判定をする」は書いた人の気持ちではなく実測でなければならない
 * (ARE と JS の違いで、`$` の改行・括弧の中のエスケープ・大文字小文字・`{n,m}` の扱いが揺れうる)。
 * 正解表(`helpers/url-cases.ts`)の全行を、生成される CHECK の式そのもの(`ddl-checks` の導出)で DB に聞く。
 */

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { derivedChecks } from '../../lib/sql/ddl-checks.js';
import { URL_MAX_LENGTH, urlRegexSource } from '../../lib/kernel/url-format.js';
import { matchesUrl as runtimeMatchesUrl } from '@kaninabe/runtime/url';
import { URL_CASES } from '../helpers/url-cases.js';
import type { FieldDef } from '../../lib/model/types.js';

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

/** `format: url` の欄 1 つから導出される CHECK の式(列は `v` に置き換えて 1 値を聞く)。 */
function checkSqlFor(): string {
  const field = {
    name: 'v',
    type: { kind: 'string' },
    format: 'url',
    maxLength: URL_MAX_LENGTH,
    personal: false,
    session: false,
    auto: false,
    required: false,
    location: { file: 'x', pointer: '/' },
  } as unknown as FieldDef;
  const checks = derivedChecks(field, 't', new Map());
  const pattern = checks.find((check) => check.name === 't_v_pattern');
  if (pattern === undefined) throw new Error('format: url から pattern の CHECK が導出されていません');
  if (pattern.expression === null) throw new Error('pattern の CHECK に式がありません');
  return pattern.expression;
}

/**
 * 生成される CHECK の式(正規表現の部分 + 長さの天井)が値を通すかを、実 DB に聞く。
 *
 * @param value 検査する文字列
 * @returns DB が通すなら true
 */
async function dbAccepts(value: string): Promise<boolean> {
  const column = /\bv\b/g;
  const result = await client.query<{ ok: boolean }>('select (' + checkSqlFor().replace(column, '$1::text') + ') as ok', [value]);
  return result.rows[0]?.ok === true && value.length <= URL_MAX_LENGTH;
}

describe('format: url — 生成される CHECK の式 ⇔ TS の判定', () => {
  it('導出される CHECK は URL の綴りを使う', () => {
    expect(checkSqlFor()).toContain(urlRegexSource('http_https').replaceAll("'", "''"));
  });

  // @spec framework-guarantee-catalog @tc TC-FW-URL-002
  it('正解表の全行で、生成される CHECK の判定(DB)と実行時の判定(TS)が一致する', async () => {
    expect(URL_CASES.length).toBeGreaterThan(40);
    const results = await Promise.all(URL_CASES.map(async (c) => ({ c, db: await dbAccepts(c.value), ts: runtimeMatchesUrl(c.value) })));
    expect(results.filter((r) => r.db !== r.c.httpHttps).map((r) => 'DB: ' + r.c.name)).toEqual([]);
    expect(results.filter((r) => r.ts !== r.c.httpHttps).map((r) => 'TS: ' + r.c.name)).toEqual([]);
  });

  it('https だけの綴りも DB と TS で一致する(設定カタログの文法)', async () => {
    const rows = await Promise.all(
      URL_CASES.map(async (c) => {
        const result = await client.query<{ ok: boolean }>('select ($1::text ~ $2::text) as ok', [c.value, urlRegexSource('https')]);
        return { c, db: result.rows[0]?.ok === true && c.value.length <= URL_MAX_LENGTH };
      }),
    );
    expect(rows.filter((r) => r.db !== r.c.httpsOnly).map((r) => r.c.name)).toEqual([]);
  });
});
