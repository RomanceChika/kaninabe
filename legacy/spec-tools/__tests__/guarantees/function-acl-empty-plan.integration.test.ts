/**
 * 関数の実行権限を閉じる migration(`lib/sql/function-acl-migration.ts`)を、**呼べる側も必須の作成主体も空の計画**から
 * 生成して実 DB に流し、型の解決で止まらないことの統合テスト(実 DB)。
 *
 * 仕様: docs/rules/process/backend/specification/standards/surface-spec-writing.md(`grants_migration` の関数の節)
 *       生成器: legacy/spec-tools/lib/sql/function-acl.ts(計画)/ function-acl-migration.ts(字面)
 *
 * ## なぜ要るのか
 *
 * 公開面を外へ出す能力が無い構成(`surfaceExposure: unsupported`)で、RLS 補助関数も無ければ、呼べる側の宣言は空になる。
 * 宣言の配列を型の無い `array[]` で出すと、Postgres は要素の型を決められず(`cannot determine type of empty array`)、
 * migration は**流す時点で**止まる。字面のテスト(ユニット)は「型の付いた形で出る」までしか言えないので、
 * ここで実 DB の判定を取る。対照として、同じ SQL から型の付与だけを外すと止まることも見る(このテストが空の緑でない印)。
 *
 * 流す SQL は生成器を仕様のリテラルから呼んで組み立てる(手で書いた SQL を確かめても、生成器の正しさは何も言えない)。
 * 全部 1 つのトランザクションの中で流し、必ず rollback する(剥奪も既定の閉鎖も DB に残らない)。
 */

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { functionAclPlan } from '../../lib/sql/function-acl.js';
import { buildGrantsMigration } from '../../lib/sql/grants-migration.js';
import type { PlatformProfile } from '../../lib/model/product/platform-profile.js';
import { specModel } from '../helpers/model-builder-v8plus.js';
import { TEST_PLATFORM } from '../helpers/platform.js';

/** 公開面を外へ出す能力が無く、必須の作成主体も持たない構成(呼べる側も作成主体の並びも空になる)。 */
const EMPTY_PLATFORM: PlatformProfile = {
  ...TEST_PLATFORM,
  surfaceExposure: { kind: 'unsupported', reason: '後段が公開面を外へ出さない構成' },
  functionCreators: [],
};

let client: Client;

beforeAll(async () => {
  const connectionString = process.env['SUPABASE_DB_URL'];
  if (connectionString === undefined || connectionString === '') {
    throw new Error('SUPABASE_DB_URL がありません(統合テストの土台が接続情報を配っていません)');
  }
  client = new Client({ connectionString });
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

/** トランザクションの中で SQL を流し、必ず rollback する(止まったら errcode と文言を返す)。 */
async function runRolledBack(sql: string): Promise<{ code: string; message: string }> {
  let result = { code: '', message: '' };
  await client.query('begin');
  try {
    await client.query(sql);
  } catch (cause) {
    result = {
      code: typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : 'unknown',
      message: cause instanceof Error ? cause.message : String(cause),
    };
  } finally {
    await client.query('rollback');
  }
  return result;
}

describe('関数の実行権限を閉じる migration(空の計画・実 DB)', () => {
  const plan = functionAclPlan({ model: specModel({ aggregates: [] }), tables: [], platform: EMPTY_PLATFORM });
  const sql = buildGrantsMigration([], plan);

  // @spec framework-guarantee-catalog @tc TC-FW-FNACL-001
  it('呼べる側も必須の作成主体も空の計画から生成した SQL は、型の解決で止まらずに流れる(対照: 型の付与を外すと止まる)', async () => {
    expect(plan.callable).toEqual([]);
    expect(plan.requiredCreators).toEqual([]);

    expect(await runRolledBack(sql)).toEqual({ code: '', message: '' });

    // 対照: 宣言の配列から型の付与だけを外すと、要素の型が決まらず止まる(テストが空の配列の形を確かに流している印)。
    const untyped = sql.replaceAll(']::text[]) as declared(identity)', ']) as declared(identity)');
    expect(untyped, '型の付与を外せていません').not.toBe(sql);
    const refused = await runRolledBack(untyped);
    expect(refused.code, `型の無い空の配列で止まっていません: ${refused.message}`).toBe('42P18');
  });
});
