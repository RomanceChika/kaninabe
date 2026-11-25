/**
 * 一致の証明の置き直しの参照の受け皿 `anyRowOf`(実行時パッケージ `framework/runtime/testing/equivalence/place-columns.mts`。
 * 点検 20 回目 B20-1 の残り 3)の単体テスト。
 *
 * `anyRowOf` は「world のその集約の最初の行(設計図の挿入順)」の id を返す。書き留める参照の欄(対応者など)を、実行者の行も
 * 系統の祖先も持たない組み合わせで埋める受け皿であり、置き直し(`columnsToPlace` → `recordedValue`)と雛形の復元(`place.mts`)が
 * 同じ 1 本を使う。固定するのは: 挿入順の最初・別の集約の行は拾わない・行が無い/作られていなければ null・`recordedValue` の
 * 引き当ての順(実行者の行 → 受け皿)。集約名・行の名前は仮の語である。
 */

import { describe, expect, it } from 'vitest';
import { anyRowOf, recordedValue } from '../../../../../framework/runtime/testing/equivalence/place-columns.mjs';
import type { EqWorld, EqWorldRow } from '../../../../../framework/runtime/testing/equivalence/types.mjs';
import type { BuiltEqWorld, EqSelection } from '../../../../../framework/runtime/testing/equivalence/world.mjs';

function row(key: string, entity: string): EqWorldRow {
  return { key, table: `${entity}s`, entity, values: {}, refs: {}, actor: null, ancestry: { [entity]: key } };
}

/** 挿入順: 人 2 行(先が p1)→ 文書 1 行。 */
const WORLD = {
  aggregate: 'doc',
  table: 'docs',
  actorTable: 'persons',
  actors: [],
  rows: [row('p1', 'person'), row('p2', 'person'), row('d1', 'doc')],
  records: [],
  operations: [],
} as unknown as EqWorld;

function built(ids: Readonly<Record<string, string>>): BuiltEqWorld {
  return {
    rows: new Map(Object.entries(ids).map(([key, id]) => [key, { key, table: '', entity: '', id, values: {} }])),
    actorIds: new Map(),
  } as unknown as BuiltEqWorld;
}

const BUILT = built({ p1: 'id-p1', p2: 'id-p2', d1: 'id-d1' });

describe('anyRowOf', () => {
  it('その集約の、設計図の挿入順で最初の行の id を返す', () => {
    expect(anyRowOf(WORLD, BUILT, 'person')).toBe('id-p1');
    expect(anyRowOf(WORLD, BUILT, 'doc')).toBe('id-d1');
  });

  it('別の集約の行は拾わない(集約に行が無ければ null)', () => {
    expect(anyRowOf(WORLD, BUILT, 'venue')).toBeNull();
  });

  it('設計図にあっても実 DB に作られていなければ null(2 行目へ逃げない)', () => {
    expect(anyRowOf(WORLD, built({ p2: 'id-p2', d1: 'id-d1' }), 'person')).toBeNull();
  });
});

describe('recordedValue の引き当て(実行者の行 → 受け皿)', () => {
  const recorded = { column: 'handled_by', entity: 'person', value: null } as const;
  const selection = (actorRow: string | null): EqSelection => ({ actor: { row: actorRow } }) as unknown as EqSelection;
  const resolve = (entity: string): string | null => anyRowOf(WORLD, BUILT, entity);

  it('実行者の行があればその id(受け皿は引かない)', () => {
    expect(recordedValue(recorded, BUILT, selection('p2'), resolve)).toBe('id-p2');
  });

  it('実行者の集約に行が無い人は受け皿(world のその集約の最初の行)', () => {
    expect(recordedValue(recorded, BUILT, selection(null), resolve)).toBe('id-p1');
  });

  it('参照でない欄は宣言の値そのまま', () => {
    expect(recordedValue({ column: 'note', entity: null, value: 'x' } as never, BUILT, selection(null), resolve)).toBe('x');
  });
});
