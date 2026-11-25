/**
 * 保存の直後に旧い値を見せない仕組み(`form-refresh.ts` の `held`)のテスト。
 *
 * 保存に成功してから最新が届くまでの 1 回の再描画は、まだ**保存前の props のまま**である。そこで毎レンダー導出すると、
 * 触っていない扱いの欄が旧い最新へ追従して入力欄が一瞬旧い値に戻る。`held`(保存した時点でまだ旧かった最新)は、その間だけ
 * 欄を動かさない。ここは「保存直後の列」と `held` の書き方・消費・許容する穴を固定する(全列挙は `form-refresh-exhaustive.test.ts`)。
 * jsdom を採らないので、同じ mount に props が差し替わる流れは純関数の連鎖で再現する。
 */

import { describe, expect, it } from 'vitest';
import { changedFields } from '../form-changes';
import { acceptSaved, conflictsOf, editField, reconcileFormDraft, resolveConflict } from '../form-refresh';
import type { FormDraft } from '../form-refresh';

const FIELDS = ['name', 'seats'] as const;
type Field = (typeof FIELDS)[number];

/** 保存前の最新(= 編集を始めたときの行)。 */
const BEFORE: Record<Field, string> = { name: '旧会場名', seats: '60' };

/** 席数を 80 に直して保存した直後(`acceptSaved` は保存前の最新を `held` に覚える)。 */
function savedSeats80(): FormDraft<Field> {
  const sending: FormDraft<Field> = { baseline: BEFORE, values: { ...BEFORE, seats: '80' } };
  return acceptSaved(sending, { seats: '80' }, BEFORE);
}

describe('保存の直後の再描画(旧い props のまま)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-FORMREFRESH-005
  it('保存 → 旧 props のまま再描画しても値は旧値に戻らず、refresh のあとは通常の判定になる', () => {
    const saved = savedSeats80();

    // 保存直後: refresh はまだ届かず、props は保存前のまま。入力欄は送った値(80)のままで、変更も競合も無い
    const meantime = reconcileFormDraft(saved, BEFORE, FIELDS);
    expect(meantime.draft.values.seats).toBe('80');
    expect(meantime.draft.baseline.seats).toBe('80');
    expect(changedFields(meantime.draft.baseline, meantime.draft.values, FIELDS)).toEqual([]);
    expect(meantime.conflicts).toEqual([]);
    expect(conflictsOf(saved, BEFORE, FIELDS)).toEqual([]);
    // held を持たなければ、同じ間に値が旧値(60)に戻る(これが要る理由)
    const { held: dropped, ...bare } = saved;
    expect(dropped).toEqual({ seats: '60' });
    expect(reconcileFormDraft(bare, BEFORE, FIELDS).draft.values.seats).toBe('60');

    // refresh: 自分の保存(80)が届く。通常の判定に戻って追従し、清潔なまま
    const landed = reconcileFormDraft(meantime.draft, { ...BEFORE, seats: '80' }, FIELDS);
    expect(landed.draft.values).toEqual({ ...BEFORE, seats: '80' });
    expect(changedFields(landed.draft.baseline, landed.draft.values, FIELDS)).toEqual([]);
    expect(landed.conflicts).toEqual([]);

    // 他の人がさらに席数を変えた最新(90)が届けば、held と違うので追従する(旧値に釘付けにならない)
    const later = reconcileFormDraft(meantime.draft, { ...BEFORE, seats: '90' }, FIELDS);
    expect(later.draft.values.seats).toBe('90');
    expect(later.conflicts).toEqual([]);
  });

  it('その間に別の欄を打っても、保存した欄は旧値に戻らない(held は欄ごとに残る)', () => {
    const view = reconcileFormDraft(savedSeats80(), BEFORE, FIELDS);
    const typed = editField(view.draft, 'name', '打ち足した名前');

    const again = reconcileFormDraft(typed, BEFORE, FIELDS);
    expect(again.draft.values).toEqual({ name: '打ち足した名前', seats: '80' });
    expect(changedFields(again.draft.baseline, again.draft.values, FIELDS)).toEqual(['name']);
    expect(again.conflicts).toEqual([]);
  });

  it('その間に同じ欄を打っても、refresh が届けば偽の競合にならず、打った値が残る', () => {
    const view = reconcileFormDraft(savedSeats80(), BEFORE, FIELDS);
    const typed = editField(view.draft, 'seats', '100');

    // baseline は送った値(80)のまま(旧値 60 に巻き戻さない)。refresh で自分の保存(80)が届いても競合にならない
    expect(typed.baseline.seats).toBe('80');
    const landed = reconcileFormDraft(typed, { ...BEFORE, seats: '80' }, FIELDS);
    expect(landed.conflicts).toEqual([]);
    expect(landed.draft.values.seats).toBe('100');
    expect(changedFields(landed.draft.baseline, landed.draft.values, FIELDS)).toEqual(['seats']);
  });
});

describe('許容する穴(doc の 1 行)', () => {
  it('最新が届いたあと他の人が元の値へ戻し、何も触っていなければ追従し損ねるが、送る欄には出ない', () => {
    const saved = savedSeats80();
    const landed = reconcileFormDraft(saved, { ...BEFORE, seats: '80' }, FIELDS);

    // 他の人が席数を保存前の値(60 = held)へ戻した最新。手元は動かない(追従し損ねる)
    const reverted = reconcileFormDraft(landed.draft, BEFORE, FIELDS);
    expect(reverted.draft.values.seats).toBe('80');
    // 上書きは起きない: baseline も送信値なので、触っていない欄は送る欄に出ない
    expect(changedFields(reverted.draft.baseline, reverted.draft.values, FIELDS)).toEqual([]);

    // その欄を触れば held は消費され、通常の判定(競合)で人に見せる
    const touched = editField(reverted.draft, 'seats', '95');
    expect(touched.held).toBeUndefined();
    expect(reconcileFormDraft(touched, BEFORE, FIELDS).conflicts).toEqual(['seats']);
  });
});

describe('held の書き方と消費', () => {
  it('送った欄の保存前の最新だけを覚える(送っていない欄・送った値と同じ旧値は覚えない)', () => {
    const draft: FormDraft<Field> = { baseline: BEFORE, values: { name: '新', seats: '80' } };

    expect(acceptSaved(draft, { name: '新', seats: '80' }, BEFORE).held).toEqual({ name: '旧会場名', seats: '60' });
    expect(acceptSaved(draft, { seats: '80' }, BEFORE).held).toEqual({ seats: '60' });
    // 送った値が保存前の最新と同じなら、旧値に見える心配が無いので覚えない
    expect(acceptSaved(draft, { seats: '60' }, BEFORE).held).toBeUndefined();
    // 保存前の最新に無い欄は覚えない
    expect(acceptSaved(draft, { seats: '80' }, { name: '旧会場名' }).held).toBeUndefined();
  });

  it('3 引数目が無い呼び方は従来どおり(held を作らない)', () => {
    const draft: FormDraft<Field> = { baseline: BEFORE, values: { ...BEFORE, seats: '80' } };
    const saved = acceptSaved(draft, { seats: '80' });

    expect(saved).toEqual({ baseline: { ...BEFORE, seats: '80' }, values: draft.values });
    expect('held' in saved).toBe(false);
  });

  it('次の保存は、送った欄の held を作り直し、送らなかった欄の held は持ち越す', () => {
    const first = savedSeats80();
    const second = acceptSaved({ ...first, values: { ...first.values, name: '新' } }, { name: '新' }, { ...BEFORE, seats: '80' });

    // 席数(前の保存の欄)の held は残り、名前(今回送った欄)の held が加わる
    expect(second.held).toEqual({ name: '旧会場名', seats: '60' });
    // refresh が届く前(props は保存前のまま)でも、どちらの欄も旧値に戻らない
    const meantime = reconcileFormDraft(second, BEFORE, FIELDS);
    expect(meantime.draft.values).toEqual({ name: '新', seats: '80' });
    expect(meantime.conflicts).toEqual([]);

    // 同じ欄をもう一度送ると、その欄の held は作り直される(旧い held は消費される)
    const again = acceptSaved(first, { seats: '85' }, { ...BEFORE, seats: '80' });
    expect(again.held).toEqual({ seats: '80' });
    // 送った値が最新と同じなら、その欄の held は消える(覚える意味が無い)
    expect(acceptSaved(first, { seats: '60' }, BEFORE).held).toBeUndefined();
  });

  it('editField はその欄の held だけを落とし、他の欄の held は残す。入力は書き換えない', () => {
    const base = Object.freeze({
      baseline: Object.freeze({ ...BEFORE }),
      values: Object.freeze({ ...BEFORE }),
      held: Object.freeze({ name: '旧会場名', seats: '60' }),
    });

    const nameEdited = editField(base, 'name', '別の名前');
    expect(nameEdited.values).toEqual({ name: '別の名前', seats: '60' });
    expect(nameEdited.baseline).toBe(base.baseline);
    expect(nameEdited.held).toEqual({ seats: '60' });
    expect(base.held).toEqual({ name: '旧会場名', seats: '60' });
    expect(base.values.name).toBe('旧会場名');

    // 最後の held を落とすと held の鍵ごと無くなる。held の無い入力にも使える
    expect('held' in editField(nameEdited, 'seats', '70')).toBe(false);
    expect(editField({ baseline: BEFORE, values: BEFORE }, 'seats', '70').values.seats).toBe('70');
  });

  it('競合を解くと、その欄の held を消費する(他の欄の held は残る)', () => {
    const held = { name: '旧会場名', seats: '60' };
    const draft: FormDraft<Field> = { baseline: BEFORE, values: { ...BEFORE, seats: '80' }, held };
    const incoming = { ...BEFORE, seats: '90' };

    // seats の最新は held(60)ではない(90)ので競合 → 解くと seats の held が消え、name の held は残る
    const resolved = resolveConflict(draft, incoming, 'seats', 'mine');
    expect(resolved.held).toEqual({ name: '旧会場名' });
    expect(resolveConflict(draft, { ...BEFORE }, 'name', 'theirs').held).toEqual({ seats: '60' });
    // incoming に無い欄は何もしない(held も動かさない)
    expect(resolveConflict(draft, { name: '最新' }, 'seats', 'theirs')).toBe(draft);
  });

  it('held を持つ入力に reconcile をかけても held は保たれ、結果を渡し直しても変わらない(冪等)', () => {
    const saved = savedSeats80();
    const once = reconcileFormDraft(saved, { name: '最新の名前', seats: '60' }, FIELDS);

    expect(once.draft.held).toEqual({ seats: '60' });
    expect(once.draft.values).toEqual({ name: '最新の名前', seats: '80' });
    expect(reconcileFormDraft(once.draft, { name: '最新の名前', seats: '60' }, FIELDS)).toEqual(once);
  });
});
