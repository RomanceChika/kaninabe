/**
 * refresh 後の編集フォームの入力(`form-refresh.ts`)の**全列挙**テスト。
 *
 * 欄ごとの判定は `baseline` / `values` / `incoming` の 3 つの値の組で決まるので、2 欄 × 3 つの値(空文字・旧・新)の
 * 全部の状態を数え上げ、「性質」を全件に当てる(個別の例は `form-refresh.test.ts`・`form-refresh-held.test.ts`)。
 * 性質は実装の写しにならないよう、**定義**(触っていない欄・競合の集合)から書く。
 */

import { describe, expect, it } from 'vitest';
import { acceptSaved, reconcileFormDraft } from '../form-refresh';
import type { FormDraft } from '../form-refresh';

const FIELDS = ['name', 'seats'] as const;
type Field = (typeof FIELDS)[number];

/** 欄の値 3 つ(空文字は「空欄」。旧と新は区別のための文字列)。 */
const VALUES = ['', 'old', 'new'] as const;

/** 2 欄の値の組の全部(3 × 3 = 9 通り)。 */
const STATES: readonly Record<Field, string>[] = VALUES.flatMap((name) => VALUES.map((seats) => ({ name, seats })));

/** `held` の候補(欄ごとに 無し + 3 値 = 4 通り。2 欄で 16 通り)。 */
const HELD_STATES: readonly Partial<Record<Field, string>>[] = [undefined, ...VALUES].flatMap((name) =>
  [undefined, ...VALUES].map((seats) => ({
    ...(name === undefined ? {} : { name }),
    ...(seats === undefined ? {} : { seats }),
  })),
);

/** 値のコピー(入力が書き換えられていないことを確かめるための控え)。 */
function copy<T extends object>(value: T): T {
  return structuredClone(value);
}

describe('reconcileFormDraft の全列挙(held 無し)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-FORMREFRESH-006
  it('729 通りの 2 欄の状態で、触っていない欄は dirty にならず、競合の集合は定義どおりで、冪等で、入力を書き換えない', () => {
    let cases = 0;
    for (const baseline of STATES) {
      for (const values of STATES) {
        for (const incoming of STATES) {
          const before = copy({ baseline, values });
          const result = reconcileFormDraft(before, incoming, FIELDS);
          const out = result.draft;
          const touched = FIELDS.filter((field) => baseline[field] !== values[field]);

          // 触っていない欄(baseline と同じ)は、結果でも dirty にならない
          for (const field of FIELDS) {
            if (!touched.includes(field)) expect(out.baseline[field]).toBe(out.values[field]);
          }
          // 触っていない欄は最新へ追従し、触った欄は手元の値を守る
          for (const field of FIELDS) {
            expect(out.values[field]).toBe(touched.includes(field) ? values[field] : incoming[field]);
          }
          // 触った欄の baseline は、最新と同じ値に着地したときだけ最新へ進み、それ以外は動かない
          for (const field of touched) {
            expect(out.baseline[field]).toBe(values[field] === incoming[field] ? incoming[field] : baseline[field]);
          }
          // 競合 = 手元も最新も baseline から変わり、しかも互いに違う欄(`fields` の順)
          expect(result.conflicts).toEqual(
            FIELDS.filter(
              (field) =>
                values[field] !== baseline[field] && incoming[field] !== baseline[field] && incoming[field] !== values[field],
            ),
          );
          // held の鍵は持たない(held 無しの入力から held は生えない)
          expect('held' in out).toBe(false);
          // 冪等: 結果をもう一度渡しても変わらない
          expect(reconcileFormDraft(out, incoming, FIELDS)).toEqual(result);
          // 入力は書き換えない
          expect(before).toEqual({ baseline, values });
          cases += 1;
        }
      }
    }
    expect(cases).toBe(729);
  });
});

describe('reconcileFormDraft の全列挙(held 付き)', () => {
  it('3 値 × held の有無(各欄 4 通り)の 11664 通りで、held と同じ最新の欄だけ動かず、他は held 無しと同じで、held は保たれる', () => {
    let cases = 0;
    for (const baseline of STATES) {
      for (const values of STATES) {
        for (const incoming of STATES) {
          for (const held of HELD_STATES) {
            const before: FormDraft<Field> = copy({ baseline, values, held });
            const result = reconcileFormDraft(before, incoming, FIELDS);
            const plain = reconcileFormDraft({ baseline, values }, incoming, FIELDS);
            const out = result.draft;

            for (const field of FIELDS) {
              const stale = held[field] !== undefined && held[field] === incoming[field];
              // held と同じ最新(まだ旧い最新)は、手元も baseline も動かさない。それ以外は held 無しと同じ判定
              expect(out.values[field]).toBe(stale ? values[field] : plain.draft.values[field]);
              expect(out.baseline[field]).toBe(stale ? baseline[field] : plain.draft.baseline[field]);
              // 旧い最新は競合にしない
              if (stale) expect(result.conflicts).not.toContain(field);
              else expect(result.conflicts.includes(field)).toBe(plain.conflicts.includes(field));
            }
            // held は結果に保たれる(空なら鍵ごと無い)
            if (Object.keys(held).length === 0) expect('held' in out).toBe(false);
            else expect(out.held).toEqual(held);
            // 冪等・入力の不変
            expect(reconcileFormDraft(out, incoming, FIELDS)).toEqual(result);
            expect(before).toEqual({ baseline, values, held });
            cases += 1;
          }
        }
      }
    }
    expect(cases).toBe(729 * 16);
  });
});

describe('acceptSaved の全列挙(held の持ち越し)', () => {
  it('前の held(16 通り)× 送った値(各欄 無し + 3 値)× 保存前の最新(各欄 無し + 3 値)で、送った欄は作り直し、送らなかった欄は持ち越す', () => {
    let cases = 0;
    for (const held of HELD_STATES) {
      for (const sent of HELD_STATES) {
        for (const stale of HELD_STATES) {
          const before: FormDraft<Field> = copy({ baseline: { name: 'base', seats: 'base' }, values: { name: 'mine', seats: 'mine' }, held });
          const out = acceptSaved(before, sent, stale);
          const expected: Partial<Record<Field, string>> = {};
          for (const field of FIELDS) {
            const value = sent[field];
            if (value === undefined) {
              // 送らなかった欄: baseline も held も持ち越す
              expect(out.baseline[field]).toBe('base');
              if (held[field] !== undefined) expected[field] = held[field];
            } else {
              // 送った欄: baseline は送った値。held は「保存前の最新が送った値と違うとき」だけ作り直す(前の held は使わない)
              expect(out.baseline[field]).toBe(value);
              const old = stale[field];
              if (old !== undefined && old !== value) expected[field] = old;
            }
            // values は動かさない
            expect(out.values[field]).toBe('mine');
          }
          if (Object.keys(expected).length === 0) expect('held' in out).toBe(false);
          else expect(out.held).toEqual(expected);
          // 入力は書き換えない
          expect(before).toEqual({ baseline: { name: 'base', seats: 'base' }, values: { name: 'mine', seats: 'mine' }, held });
          cases += 1;
        }
      }
    }
    expect(cases).toBe(16 * 16 * 16);
  });
});
