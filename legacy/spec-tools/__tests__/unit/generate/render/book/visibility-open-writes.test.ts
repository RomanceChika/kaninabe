/**
 * ハンドブック「未ログインに開いた書き込み」(`visibility-open-writes.ts`)のユニットテスト。
 *
 * 固定するもの: 未ログイン(と含意されるロール)に開いた形だけが行になる / 作成は天井の値と出どころ(生成されるトリガ名・
 * 出せない理由)を出す / 更新・削除・遷移は `public` の理由を出す / 閉じた規則は載らない。
 */

import { describe, expect, it } from 'vitest';
import { openWriteRows } from '../../../../../lib/generate/render/book/visibility-open-writes.js';
import type { GenerateContext } from '../../../../../lib/gen-kit/generator.js';
import type { AbuseDecl, CreateRule, SpecModel } from '../../../../../lib/model/types.js';
import { accessSpec, aggregate, create, del, entitySpec, event, field, machine, role, roleSpec, specModel, write } from '../../../../helpers/model-builder.js';
import { dataTable, dataTableModel } from '../../../../helpers/data-builder.js';

const ABUSE: AbuseDecl = {
  globalCeiling: { max: 30, per: '1 hour' },
  perKey: { column: 'sender_email', max: 5, per: '1 hour' },
  location: { file: 'docs/specs/domain/inquiry/access.md' },
};

const FIELDS = [
  field('id', { kind: 'uuid' }, { auto: true }),
  field('sender_email', { kind: 'string' }, { required: true }),
  field('created_at', { kind: 'datetime' }, { auto: true }),
  field('note', { kind: 'string' }),
];

/** 未ログインに作成・更新・削除・遷移を開いた集約(と、member だけの集約)。 */
function model(over: { readonly creates?: readonly CreateRule[] } = {}): SpecModel {
  return specModel([
    aggregate('inquiry', {
      entity: entitySpec('inquiry', { fields: FIELDS }),
      stateMachines: [
        machine('inquiry', {
          states: ['new', 'closed'],
          initial: 'new',
          events: [{ ...event('withdraw', { from: ['new'], to: 'closed', by: ['anonymous'] }), public: '送り主の取り下げ' }, event('close', { from: ['new'], to: 'closed', by: ['member'] })],
        }),
      ],
      access: accessSpec('inquiry', {
        creates: over.creates ?? [{ ...create('anonymous'), abuse: ABUSE }, create('member')],
        writes: [{ ...write('anonymous', ['note']), public: '直後の直し' }, write('member', ['note'])],
        deletes: [{ ...del('anonymous'), public: '取り下げ' }, del('member')],
      }),
    }),
  ]);
}

const ctxWith = (tables: ReturnType<typeof dataTableModel> | undefined): GenerateContext => ({ ...(tables === undefined ? {} : { dataTables: tables }) }) as unknown as GenerateContext;
const READY = dataTableModel([dataTable('inquiries', { entity: 'inquiry', ddlMigration: '20261020000613_ddl_inquiries.sql' })]);

describe('未ログインに開いた書き込みの行', () => {
  it('作成・更新・削除・遷移の順に、未ログインに開いた形だけが並ぶ(member だけの規則は載らない)', () => {
    const rows = openWriteRows(model(), ctxWith(READY));

    expect(rows.map((row) => row.slice(0, 3))).toEqual([
      ['inquiry', '作成', 'anonymous'],
      ['inquiry', '更新(note)', 'anonymous'],
      ['inquiry', '削除', 'anonymous'],
      ['inquiry', '遷移 `withdraw`', 'anonymous'],
    ]);
  });

  it('作成の行は天井の値と、生成されるトリガの名前を出す', () => {
    const [row] = openWriteRows(model(), ctxWith(READY));

    expect(row?.[3]).toBe('全体 30 件 / 1 hour、同じ `sender_email` 5 件 / 1 hour');
    expect(row?.[4]).toBe('生成トリガ `check_inquiry_rate_limit`');
  });

  it('更新・削除・遷移の行は public の理由を出す', () => {
    const rows = openWriteRows(model(), ctxWith(READY));

    expect(rows.slice(1).map((row) => row[3])).toEqual(['直後の直し', '取り下げ', '送り主の取り下げ']);
  });

  it('生成できない宣言は、出どころに理由を出す(表の DDL が生成物でない)', () => {
    const [row] = openWriteRows(model(), ctxWith(dataTableModel([dataTable('inquiries', { entity: 'inquiry' })])));

    expect(row?.[4]).toContain('生成できない: 表 inquiries の DDL が生成物ではありません');
  });

  it('data_table が読めていないときは、トリガの名前は未確認と出す', () => {
    const [row] = openWriteRows(model(), ctxWith(undefined));

    expect(row?.[4]).toContain('名前は未確認');
  });

  it('理由が空の public は「理由が空」と出す(R5-5 が止める形をそのまま見せる)', () => {
    const empty = specModel([
      aggregate('inquiry', { entity: entitySpec('inquiry', { fields: FIELDS }), access: accessSpec('inquiry', { deletes: [{ ...del('anonymous'), public: '  ' }] }) }),
    ]);

    expect(openWriteRows(empty, ctxWith(READY))[0]?.[3]).toBe('(理由が空)');
  });

  it('未ログインのロールが無い仕様・開いた形が無い仕様は行を持たない', () => {
    const closed = specModel([aggregate('inquiry', { access: accessSpec('inquiry', { creates: [create('member')], deletes: [del('member')] }) })]);
    const noAnonymous = specModel([aggregate('inquiry', { access: accessSpec('inquiry', { creates: [create('member')] }) })], roleSpec([role('member'), role('system')]));

    expect(openWriteRows(closed, ctxWith(READY))).toEqual([]);
    expect(openWriteRows(noAnonymous, ctxWith(READY))).toEqual([]);
  });

  it('含意で開いたロール(未ログインが含意するロール)の規則も載る', () => {
    const roles = roleSpec([role('anonymous', undefined, ['member']), role('member'), role('system')]);
    const implied = specModel([aggregate('inquiry', { access: accessSpec('inquiry', { deletes: [{ ...del('member'), public: '含意で開く' }] }) })], roles);

    expect(openWriteRows(implied, ctxWith(READY)).map((row) => row[2])).toEqual(['member']);
  });
});
