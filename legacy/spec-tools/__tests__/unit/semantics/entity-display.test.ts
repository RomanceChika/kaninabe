/**
 * 集約の表示の宣言(`semantics/entity-display.ts`)のテスト。
 *
 * 引くのは entity_spec の `display_field` の宣言そのもので、集約名でもエンティティ名でも引ける。
 */

import { describe, expect, it } from 'vitest';
import { findDisplayField } from '../../../lib/semantics/entity-display.js';
import { aggregate, entitySpec, field, specModel } from '../../helpers/model-builder-v8plus.js';

/** 集約名(ディレクトリ名)とエンティティ名が食い違う会場と、宣言の無いメンバー。 */
const MODEL = specModel({
  aggregates: [
    aggregate({
      name: 'place',
      entity: { ...entitySpec('venue', [field('id', { kind: 'uuid' }), field('name', { kind: 'string' })]), displayField: 'name' },
    }),
    aggregate({ name: 'member', entity: entitySpec('member', [field('id', { kind: 'uuid' })]) }),
    aggregate({ name: 'ghost' }),
  ],
});

describe('findDisplayField', () => {
  it('宣言があれば、エンティティ名でも集約名でも引ける', () => {
    expect(findDisplayField(MODEL, 'venue')).toBe('name');
    expect(findDisplayField(MODEL, 'place')).toBe('name');
  });

  it('宣言が無い集約・entity_spec が無い集約・無い名前は undefined', () => {
    expect(findDisplayField(MODEL, 'member')).toBeUndefined();
    expect(findDisplayField(MODEL, 'ghost')).toBeUndefined();
    expect(findDisplayField(MODEL, 'nothing')).toBeUndefined();
  });
});
