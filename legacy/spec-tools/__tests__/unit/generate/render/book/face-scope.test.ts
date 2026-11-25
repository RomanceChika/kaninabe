/**
 * 人向けの表示の章の範囲(重さ・従属・写した公理・範囲の操作とテスト)の導出のテスト。
 */

import { describe, expect, it } from 'vitest';
import {
  aggregateWeights,
  carriedInvariants,
  bookLayout,
  hasFace,
  scopeActions,
  scopeTables,
  scopeUsecases,
  subordinates,
} from '../../../../../lib/generate/render/book/face-scope.js';
import { faceCtx, faceModel } from '../../../../helpers/face-fixture.js';

const model = faceModel();
const ctx = faceCtx();
const workshop = model.aggregates.get('workshop');

describe('aggregateWeights(重さ = 入次数 + 公理の数 + 操作の数)', () => {
  it('入次数は ref で指す別の集約の数、操作は状態機械とエンティティに結ばれた操作仕様の数', () => {
    const weights = aggregateWeights(model, ctx);
    const parent = weights.find((weight) => weight.name === 'workshop');

    // 参照するのは 部・枠・当日のチェック の 3 つ。公理 3 本。操作は publish / cancel / show(別機械)の 3 本。
    expect(parent).toEqual({ name: 'workshop', inDegree: 3, invariants: 3, operations: 3, total: 9 });
  });

  it('重い順に並ぶ(同点は仕様の並び順)', () => {
    const names = aggregateWeights(model, ctx).map((weight) => weight.name);

    expect(names[0]).toBe('workshop');
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('bookLayout(章の立て方)', () => {
  it('全章に展開しているときだけ、従属する集約は自分の章を持たない(親の章へ畳む)', () => {
    const nested = bookLayout(model, faceCtx(0));
    const all = bookLayout(model, { ...ctx, humanFaceChapters: 'all' });

    expect(nested.nested).toBe(false);
    expect(nested.roots).toEqual(nested.weights.map((weight) => weight.name));
    expect(all.nested).toBe(true);
    expect(all.roots).not.toContain('workshop_part');
    expect(all.roots).not.toContain('workshop_check');
    expect(all.chapterOf('workshop_part')).toBe('workshop');
    expect(all.chapterOf('entry')).toBe('entry');
  });

  it('集約に結ばれた表のファイルは、章を畳むときだけ集約へ寄る', () => {
    const all = bookLayout(model, { ...ctx, humanFaceChapters: 'all' });

    expect(all.tableAggregateOf('docs/specs/backend/data/tables/workshop_parts.md')).toBe('workshop_part');
    expect(all.tableAggregateOf('docs/specs/backend/data/tables/unknown.md')).toBeUndefined();
    expect(bookLayout(model, faceCtx(0)).tableAggregateOf('docs/specs/backend/data/tables/workshop_parts.md')).toBeUndefined();
  });
});

describe('hasFace(文脈が宣言した、重さの上位 N 章だけ)', () => {
  it('N が 0 か未宣言ならどの章も従来の形', () => {
    const { humanFaceChapters: _declared, ...undeclared } = ctx;

    expect(hasFace(model, faceCtx(0), 'workshop')).toBe(false);
    expect(hasFace(model, undeclared, 'workshop')).toBe(false);
  });

  it('N = 1 なら重さ 1 位だけ', () => {
    expect(hasFace(model, ctx, 'workshop')).toBe(true);
    expect(hasFace(model, ctx, 'entry')).toBe(false);
  });
});

describe('subordinates(従属 = 親を cascade で参照し、作る・消すロールがすべて親の行を動かす人)', () => {
  it('cascade でつながる集約が候補で、作るロールが親の外にいるもの(メンバーが作る枠)は畳まない', () => {
    const basis = subordinates(model, ctx, workshop!);

    // 候補は名前順。畳むのは重い順(同点は入次数 → 公理 → 操作 → 名前)。
    expect(basis.cascading.map((specs) => specs.name)).toEqual(['entry', 'workshop_check', 'workshop_part']);
    expect(basis.folded.map((specs) => specs.name)).toEqual(['workshop_part', 'workshop_check']);
  });

  it('表の仕様が無い環境では、候補も畳むものも無い', () => {
    const { dataTables: _tables, ...without } = ctx;

    expect(subordinates(model, without, workshop!)).toEqual({ cascading: [], folded: [] });
  });
});

describe('carriedInvariants(写した公理)', () => {
  it('範囲の外の集約の公理のうち、親のエンティティを entities に含むものだけ', () => {
    const basis = subordinates(model, ctx, workshop!);
    const carried = carriedInvariants(model, workshop!, [workshop!, ...basis.folded]);

    expect(carried.map((entry) => entry.invariant.id)).toEqual(['INV-ENTRY-001']);
    expect(carried[0]?.owner.name).toBe('entry');
  });

  it('範囲の中の集約の公理は写さない(畳んだ従属は範囲の中)', () => {
    const carried = carriedInvariants(model, workshop!, [workshop!, model.aggregates.get('entry')!]);

    // 枠は範囲の中なので写さない。範囲の外になった部の公理(親を含む 1 本)だけが写る。
    expect(carried.map((entry) => entry.invariant.id)).toEqual(['INV-PART-001']);
  });
});

describe('範囲の操作・表・タスク', () => {
  const scope = [workshop!, model.aggregates.get('workshop_part')!];

  it('操作仕様は状態機械の所有者とエンティティの所有者から範囲に入る', () => {
    expect(scopeActions(model, ctx, scope).map((action) => action.handles.raw)).toEqual([
      'workshop.publish',
      'workshop.cancel',
      'workshop_publication.show',
      'workshop_part.create',
    ]);
  });

  it('テーブル仕様はエンティティが範囲の集約のもの', () => {
    expect(scopeTables(ctx, scope).map((table) => table.table)).toEqual(['workshops', 'workshop_parts']);
  });

  it('タスクは保存点の手順がすべて範囲の集約の操作であるもの', () => {
    expect(scopeUsecases(model, ctx, scope).map((usecase) => usecase.name)).toEqual(['workshop_publish']);
  });
});
