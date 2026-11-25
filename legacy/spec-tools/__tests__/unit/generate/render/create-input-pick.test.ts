/**
 * 作成の入力欄の振り分け(`create-input-pick.ts`。fix25s)のユニットテスト。
 *
 * `supplied_by: db` の欄は作成入力の部品(`{entity}InputSchema`)に無いので、作成の入力に現れる(V17 が `insert_at` の末尾の番号に限る)
 * なら行のスキーマから `.partial()` で借りる。ほかの欄は作成入力の部品から借りる。`id` はどちらにも入れない。
 */

import { describe, expect, it } from 'vitest';
import { createPickSpreads, splitCreateKeys } from '../../../../lib/generate/render/create-input-pick.js';
import type { FieldDef } from '../../../../lib/model/types.js';
import { field } from '../../../helpers/model-builder.js';

/** 題材の欄: 題名(人が入れる)・番号(DB が決めるが位置を入れてよい)・採番の ID。 */
const FIELDS: readonly FieldDef[] = [
  field('id', { kind: 'uuid' }, { auto: true }),
  field('title', { kind: 'string' }, { required: true }),
  { ...field('position', { kind: 'integer' }, { required: true }), suppliedBy: 'db' },
];

describe('作成の入力欄の振り分け', () => {
  it.each([
    ['人が入れる欄だけ', ['title'], { given: ['title'], positional: [] }, ['...slotInputSchema.pick({ title: true }).shape']],
    [
      '位置の欄を含む',
      ['title', 'position'],
      { given: ['title'], positional: ['position'] },
      ['...slotInputSchema.pick({ title: true }).shape', '...slotRowSchema.pick({ position: true }).partial().shape'],
    ],
    ['位置の欄だけ', ['position'], { given: [], positional: ['position'] }, ['...slotRowSchema.pick({ position: true }).partial().shape']],
    ['id は入れない', ['id', 'title'], { given: ['title'], positional: [] }, ['...slotInputSchema.pick({ title: true }).shape']],
    ['欄が無い', [], { given: [], positional: [] }, []],
  ] as const)('%s', (_title, keys, split, spreads) => {
    const picked = splitCreateKeys(keys, FIELDS);
    expect(picked).toEqual(split);
    expect(createPickSpreads('slot', picked)).toEqual(spreads);
  });
});
