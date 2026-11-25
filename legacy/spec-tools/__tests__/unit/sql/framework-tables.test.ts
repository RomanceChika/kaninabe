/**
 * 仕組みが自分で持つ表の設計図(`framework-tables.ts`)のユニットテスト。
 *
 * 規約網羅(ARCH-SP-BE-0001 §テーブル仕様 §仕組みが持つ表):
 *   - 値域の判定(`jobs` / `domain_events` だけが設計図を持つ)
 *   - 列・固定 CHECK が設計図から出る(アプリの仕様に列が無くても組み立てられる)
 *   - `domain_events.entity` の値域が**ドメイン仕様の集約の全数**から出る(昇順・エンティティ名)
 *   - 索引は data_table 側の宣言から出る(設計図に持たせると正が割れる)
 *   - 入口 `ddlPlanOf` がドメインの表と仕組みの表を振り分ける
 */

import { describe, expect, it } from 'vitest';
import {
  ddlPlanOf,
  FRAMEWORK_TABLES,
  frameworkTableDdlPlan,
  frameworkActorColumnsOf,
  frameworkTableWords,
  isFrameworkTable,
} from '../../../lib/sql/framework-tables.js';
import { dataTable } from '../../helpers/data-builder.js';
import { aggregate, entitySpec, field, specModel } from '../../helpers/model-builder.js';
import type { SpecModel } from '../../../lib/model/types.js';

/** 題材: 集約名とエンティティ名が食い違う 1 件を含むモデル。 */
const domain: SpecModel = specModel([
  aggregate('booking', { entity: entitySpec('booking', { fields: [field('id', { kind: 'uuid' })] }) }),
  aggregate('program', { entity: entitySpec('program_item', { fields: [field('id', { kind: 'uuid' })] }) }),
]);

/** 監査ログの data_table(索引 1 本つき)。 */
const events = dataTable('domain_events', {
  internal: true,
  framework: 'domain_events',
  ddlMigration: '20260912120201_ddl_domain_events.sql',
  indexes: [{ name: 'domain_events_entity_idx', on: ['entity', 'entity_id', 'id'], unique: false }],
});

/** outbox の data_table。 */
const jobs = dataTable('jobs', {
  internal: true,
  framework: 'jobs',
  ddlMigration: '20260912120202_ddl_jobs.sql',
});

describe('仕組みが自分で持つ表の設計図', () => {
  it('設計図を持つのは 3 表だけである(3 枚目は保存点の再送の要約。点検 21 回目 A21-1)', () => {
    expect([...FRAMEWORK_TABLES]).toEqual(['jobs', 'domain_events', 'resend_digests']);
    expect(isFrameworkTable('jobs')).toBe(true);
    expect(isFrameworkTable('queue')).toBe(false);
  });

  it('outbox の列と CHECK は設計図から出る(アプリの仕様に列が無くても組み立つ)', () => {
    const plan = frameworkTableDdlPlan(jobs, domain, []);
    expect(plan?.entity).toBeNull();
    expect(plan?.primaryKey).toEqual(['id']);
    expect(plan?.columns.map((column) => column.name)).toEqual([
      'id',
      'type',
      'payload',
      'idempotency_key',
      'status',
      'attempts',
      'max_attempts',
      'next_run_at',
      'last_error',
      'locked_at',
      'locked_by',
      'created_at',
      'updated_at',
    ]);
    expect(plan?.derivedChecks.map((check) => check.name)).toEqual([
      'jobs_type_length',
      'jobs_status_enum',
      'jobs_attempts_non_negative',
      'jobs_max_attempts_positive',
    ]);
  });

  it('監査ログの採番列は既定値ではなく identity である', () => {
    const plan = frameworkTableDdlPlan(events, domain, []);
    const id = plan?.columns.find((column) => column.name === 'id');
    expect(id).toEqual({
      name: 'id',
      type: 'bigint',
      notNull: true,
      default: null,
      identity: true,
      comment: expect.any(String) as unknown as string,
    });
  });

  it('entity の値域はドメイン仕様の集約の全数(エンティティ名・昇順)から出る', () => {
    const plan = frameworkTableDdlPlan(events, domain, []);
    const check = plan?.derivedChecks.find((entry) => entry.name === 'domain_events_entity_enum');
    expect(check?.expression).toBe("(entity = ANY (ARRAY['booking'::text, 'program_item'::text]))");
  });

  it('集約を 1 つ足すと値域が追随する(人が migration に 1 語足す作業が消える)', () => {
    const wider = specModel([
      aggregate('booking', { entity: entitySpec('booking', { fields: [field('id', { kind: 'uuid' })] }) }),
      aggregate('program', { entity: entitySpec('program_item', { fields: [field('id', { kind: 'uuid' })] }) }),
      aggregate('venue', { entity: entitySpec('venue', { fields: [field('id', { kind: 'uuid' })] }) }),
    ]);
    const check = frameworkTableDdlPlan(events, wider, [])?.derivedChecks.find(
      (entry) => entry.name === 'domain_events_entity_enum',
    );
    expect(check?.expression).toBe(
      "(entity = ANY (ARRAY['booking'::text, 'program_item'::text, 'venue'::text]))",
    );
  });

  it('索引は data_table の宣言から出る(設計図は索引を持たない)', () => {
    expect(frameworkTableDdlPlan(events, domain, [])?.indexes).toEqual([
      { name: 'domain_events_entity_idx', columns: ['entity', 'entity_id', 'id'], unique: false, where: null },
    ]);
    expect(frameworkTableDdlPlan(jobs, domain, [])?.indexes).toEqual([]);
  });

  it('値域に無い名前を宣言した表には計画が無い(T12 が先に止める)', () => {
    const unknown = dataTable('outbox', { internal: true, framework: 'queue' });
    expect(frameworkTableDdlPlan(unknown, domain, [])).toBeNull();
  });

  it('入口はドメインの表と仕組みの表を振り分ける', () => {
    const bookings = dataTable('bookings', { entity: 'booking', ddlMigration: '20260912120203_ddl_bookings.sql' });
    expect(ddlPlanOf(bookings, domain, [bookings])?.entity).toBe('booking');
    expect(ddlPlanOf(jobs, domain, [jobs])?.entity).toBeNull();
    const notes = dataTable('audit_notes', { internal: true });
    expect(ddlPlanOf(notes, domain, [notes])).toBeNull();
  });

  it('列の説明は文言表から引ける(生成物に説明できない日本語を出さない)', () => {
    const words = frameworkTableWords();
    const plan = frameworkTableDdlPlan(jobs, domain, []);
    for (const column of plan?.columns ?? []) expect(words).toContain(column.comment);
  });
});

describe('消去の本人へ届く実行者の列(点検 21 回目 A21-1)', () => {
  it.each([
    ['resend_digests', ['actor_id']],
    ['domain_events', []], // 監査ログは誰が書いたかを消去の後も残す
    ['jobs', []],
    ['queue', []], // 値域の外
    [undefined, []],
  ] as const)('%s → %j', (name, expected) => {
    expect(frameworkActorColumnsOf(name)).toEqual(expected);
  });

  it('resend_digests の設計図は再送の比べに要る列を持ち、入力の値そのものの列は持たない', () => {
    const plan = ddlPlanOf(dataTable('resend_digests', { internal: true, framework: 'resend_digests', retentionHours: 24 }), domain);
    expect(plan?.columns.map((column) => column.name)).toEqual(['id', 'event_id', 'entity_id', 'actor_id', 'input_digest', 'created_at']);
    expect(plan?.columns.find((column) => column.name === 'actor_id')?.notNull).toBe(false); // 未ログインの押し直しは空
  });
});
