/**
 * `kind: table` / `detail` の部品が出せる欄の導出(`read-shows.ts`)のテスト。
 *
 * S18(実在・ref でないこと)と生成器(列・項目)が同じ導出を見るので、規則はここで固定する:
 * 出せるのは projection の欄と**1 件に決まる併読**の欄。既定は id と ref を除く全欄。
 */

import { describe, expect, it } from 'vitest';
import { defaultShows, includeRoleField, shownFields, showCandidates } from '../../../lib/screen/read-shows.js';
import { aggregate, entitySpec, field, specModel } from '../../helpers/model-builder-v8plus.js';
import { querySpec } from '../../helpers/query-builder.js';

/** 催し(会場への ref を持つ)・会場・枠(催しへの ref を持つ)。 */
const DOMAIN = specModel({
  aggregates: [
    aggregate({
      name: 'workshop',
      entity: entitySpec('workshop', [
        field('id', { kind: 'uuid' }, { auto: true }),
        field('title', { kind: 'string' }, { required: true }),
        field('venue_id', { kind: 'ref', entity: 'venue' }),
      ]),
    }),
    aggregate({
      name: 'venue',
      entity: entitySpec('venue', [field('id', { kind: 'uuid' }, { auto: true }), field('name', { kind: 'string' })]),
    }),
    aggregate({
      name: 'entry',
      entity: entitySpec('entry', [
        field('id', { kind: 'uuid' }, { auto: true }),
        field('workshop_id', { kind: 'ref', entity: 'workshop' }),
        field('note', { kind: 'string' }),
      ]),
    }),
  ],
});

const QUERY = querySpec({
  name: 'workshop_detail',
  source: 'workshop',
  for: ['member'],
  scopeUsed: 'all',
  projection: ['id', 'title', 'venue_id'],
  includes: [
    { entity: 'venue', scopeUsed: 'all', projection: ['id', 'name'] },
    { entity: 'entry', scopeUsed: 'all', projection: ['id', 'note'] },
  ],
});

describe('showCandidates / defaultShows / shownFields', () => {
  it('出せる欄は projection と 1 件に決まる併読(source が参照先への ref を持つ)の欄で、宣言順に並ぶ', () => {
    expect(showCandidates(QUERY, DOMAIN).map((candidate) => candidate.path)).toEqual([
      'id',
      'title',
      'venue_id',
      'venue.id',
      'venue.name',
    ]);
  });

  it('1 行に複数が付く併読(枠 → 催しへの ref は逆向き)の欄は出せない', () => {
    expect(showCandidates(QUERY, DOMAIN).map((candidate) => candidate.path)).not.toContain('entry.note');
  });

  it('省略時の既定は id と ref の欄を除く全欄(併読の id も除く)', () => {
    expect(defaultShows(QUERY, DOMAIN).map((candidate) => candidate.path)).toEqual(['title', 'venue.name']);
  });

  it('shows を書いたらその順に出す(実在しない欄は黙って落とす — 実在は S18 が見る)', () => {
    expect(shownFields(QUERY, DOMAIN, ['venue.name', 'title', 'no_such']).map((candidate) => candidate.path)).toEqual([
      'venue.name',
      'title',
    ]);
    expect(shownFields(QUERY, DOMAIN, undefined).map((candidate) => candidate.path)).toEqual(['title', 'venue.name']);
  });

  it('併読の欄は併読名・欄・エンティティを持つ', () => {
    const [candidate] = shownFields(QUERY, DOMAIN, ['venue.name']);

    expect(candidate).toEqual({ path: 'venue.name', entity: 'venue', field: 'name', include: 'venue' });
  });
});

describe('includeRoleField(併読の欄の見出しに添える役割)', () => {
  /** 問い合わせ(メンバーへの ref が 1 つ)・発行(メンバーへの ref が 2 つ)・メンバー。ref の欄の label がメンバーの label と違うものと同じもの。 */
  const ROLES = specModel({
    aggregates: [
      aggregate({
        name: 'ticket',
        entity: entitySpec('ticket', [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('handled_by', { kind: 'ref', entity: 'person' }, { label: '対応者' }),
        ]),
      }),
      aggregate({
        name: 'badge',
        entity: entitySpec('badge', [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('person_id', { kind: 'ref', entity: 'person' }, { label: 'メンバー' }),
        ]),
      }),
      aggregate({
        name: 'transfer',
        entity: entitySpec('transfer', [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('from_id', { kind: 'ref', entity: 'person' }, { label: '譲る人' }),
          field('to_id', { kind: 'ref', entity: 'person' }, { label: '譲られる人' }),
        ]),
      }),
      aggregate({
        name: 'memo',
        entity: entitySpec('memo', [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('writer_id', { kind: 'ref', entity: 'person' }),
        ]),
      }),
      aggregate({
        name: 'person',
        entity: { ...entitySpec('person', [field('id', { kind: 'uuid' }, { auto: true })]), label: 'メンバー' },
      }),
    ],
  });

  it('併読先を指す ref の欄が 1 つで、その label が併読先の label と違うときは、その欄が役割になる', () => {
    expect(includeRoleField(ROLES, 'ticket', 'person')).toBe('handled_by');
  });

  it('label が併読先と同じなら付けない(会場 → 会場名が「会場の会場名」になるだけ)', () => {
    expect(includeRoleField(ROLES, 'badge', 'person')).toBeUndefined();
  });

  it('指す欄が複数あれば付けない(誰のことか決まらない)', () => {
    expect(includeRoleField(ROLES, 'transfer', 'person')).toBeUndefined();
  });

  it('ref の欄に label が無い・併読先を指す欄が無い(併読先が実在しない)ときも付けない', () => {
    expect(includeRoleField(ROLES, 'memo', 'person')).toBeUndefined();
    expect(includeRoleField(ROLES, 'person', 'person')).toBeUndefined();
    expect(includeRoleField(ROLES, 'ticket', 'nobody')).toBeUndefined();
  });
});
