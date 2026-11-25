/**
 * refresh 後の編集フォームの入力(`form-refresh.ts`)のテスト。
 *
 * 網羅の基準は「欄ごとの 4 つの扱い(追従 / 競合 / 手元だけ変更 / 判定の外)の全部と、保存の直後・解決・連続 refresh の
 * 順序」。`changedFields` は**本物を import** する(「初期値」の取り方が旧い判定と新しい判定でどう違うかを、契約の側から確かめるため)。
 * jsdom を採らない方針なので、同じ mount に props が差し替わる流れ(refresh)は、純関数の連鎖で再現する。
 */

import { describe, expect, it } from 'vitest';
import { changedFields } from '../form-changes';
import { acceptSaved, conflictsOf, reconcileFormDraft, resolveConflict } from '../form-refresh';
import type { FormDraft } from '../form-refresh';

const FIELDS = ['name', 'seats'] as const;
type Field = (typeof FIELDS)[number];

/** 編集を始めたときの行(`baseline` = `values`)。 */
const BEFORE: Record<Field, string> = { name: '旧会場名', seats: '60' };

/** `baseline` と `values` を同じにした、触っていない入力。 */
function untouched(values: Record<Field, string>): FormDraft<Field> {
  return { baseline: values, values };
}

describe('reconcileFormDraft', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-FORMREFRESH-001
  it('旧い判定は触っていない欄を送り、新しい判定は触った欄だけを送る', () => {
    const incoming = { name: '別の人が直した会場名', seats: '60' };
    const draft: FormDraft<Field> = { baseline: BEFORE, values: { ...BEFORE, seats: '80' } };

    // 旧い判定: 最新の props を「初期値」にして比べる → 触っていない name まで変更に見える
    expect(changedFields(incoming, draft.values, FIELDS)).toEqual(['name', 'seats']);

    // 新しい判定: baseline と比べる。name は最新へ追従し(手元の旧値を再送しない)、変更は seats だけ
    const view = reconcileFormDraft(draft, incoming, FIELDS);
    expect(view.draft.values).toEqual({ name: '別の人が直した会場名', seats: '80' });
    expect(changedFields(view.draft.baseline, view.draft.values, FIELDS)).toEqual(['seats']);
    expect(view.conflicts).toEqual([]);
  });

  it('何も触っていなければ全欄が最新へ追従し、変更は 1 つも無い', () => {
    const incoming = { name: '最新', seats: '100' };
    const view = reconcileFormDraft(untouched(BEFORE), incoming, FIELDS);

    expect(view).toEqual({ draft: { baseline: incoming, values: incoming }, conflicts: [] });
    expect(changedFields(view.draft.baseline, view.draft.values, FIELDS)).toEqual([]);
  });

  it('保存した値と最新が一致した欄は、その値で清潔(変更なし)になる', () => {
    const saved = { ...BEFORE, seats: '80' };
    const view = reconcileFormDraft({ baseline: BEFORE, values: saved }, saved, FIELDS);

    expect(changedFields(view.draft.baseline, view.draft.values, FIELDS)).toEqual([]);
    expect(view.conflicts).toEqual([]);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-FORMREFRESH-002
  it('手元も最新も変えた欄は競合として残り、何度 refresh しても黙って解決しない', () => {
    const draft: FormDraft<Field> = { baseline: BEFORE, values: { ...BEFORE, seats: '80' } };
    const incoming = { ...BEFORE, seats: '90' };

    const first = reconcileFormDraft(draft, incoming, FIELDS);
    expect(first.conflicts).toEqual(['seats']);
    expect(first.draft.values).toEqual(draft.values);
    expect(first.draft.baseline).toEqual(BEFORE);

    // 同じ最新をもう一度受け取っても同じ(冪等)。結果を入力にし直しても変わらない
    expect(reconcileFormDraft(first.draft, incoming, FIELDS)).toEqual(first);
    expect(reconcileFormDraft(draft, incoming, FIELDS)).toEqual(first);
  });

  it('最新が変わっていなければ、触った欄はそのまま残り競合にもならない', () => {
    const draft: FormDraft<Field> = { baseline: BEFORE, values: { ...BEFORE, seats: '80' } };
    const view = reconcileFormDraft(draft, BEFORE, FIELDS);

    expect(view).toEqual({ draft, conflicts: [] });
  });

  it('編集を元に戻してから refresh が届けば、最新へ追従する', () => {
    const incoming = { ...BEFORE, seats: '90' };
    const edited: FormDraft<Field> = { baseline: BEFORE, values: { ...BEFORE, seats: '80' } };
    const reverted: FormDraft<Field> = { baseline: edited.baseline, values: { ...edited.values, seats: '60' } };

    expect(reconcileFormDraft(edited, incoming, FIELDS).conflicts).toEqual(['seats']);
    const view = reconcileFormDraft(reverted, incoming, FIELDS);
    expect(view.draft.values.seats).toBe('90');
    expect(view.draft.baseline.seats).toBe('90');
    expect(view.conflicts).toEqual([]);
  });

  it('同じ呼び出しで入力を書き換えない(凍結した入力でも動く)', () => {
    const baseline = Object.freeze({ ...BEFORE });
    const values = Object.freeze({ ...BEFORE, seats: '80' });
    const incoming = Object.freeze({ name: '最新', seats: '90' });
    const draft = Object.freeze({ baseline, values });

    const view = reconcileFormDraft(draft, incoming, FIELDS);

    expect(view.draft.values).toEqual({ name: '最新', seats: '80' });
    expect(values.seats).toBe('80');
    expect(baseline.name).toBe('旧会場名');
    expect(incoming.seats).toBe('90');
    expect(reconcileFormDraft(draft, incoming, [])).toEqual({ draft: { baseline, values }, conflicts: [] });
  });

  it('最新・baseline・values のどれかに無い欄は判定の外で、undefined を混ぜない', () => {
    const fields = ['name', 'seats', 'note'] as const;
    // note は incoming に無い・seats は baseline に無い・name は values に無い
    const draft = {
      baseline: { name: '旧', note: 'メモ' },
      values: { seats: '80', note: 'メモ' },
    } as unknown as FormDraft<(typeof fields)[number]>;
    const incoming = { name: '最新', seats: '90' };

    const view = reconcileFormDraft(draft, incoming, fields);

    expect(view.draft).toEqual(draft);
    expect(Object.keys(view.draft.values).sort()).toEqual(['note', 'seats']);
    expect(Object.values(view.draft.baseline)).not.toContain(undefined);
    expect(view.conflicts).toEqual([]);
    expect(conflictsOf(draft, incoming, fields)).toEqual([]);
  });

  it('複数の欄が混在しても、欄ごとに独立に扱われる', () => {
    const fields = ['name', 'seats', 'note', 'cost'] as const;
    const baseline = { name: '旧', seats: '60', note: 'a', cost: '100' };
    // name = 触っていない / seats = 手元だけ変更 / note = 手元も最新も変更(競合) / cost = 同じ値に着地
    const values = { name: '旧', seats: '80', note: 'ローカル', cost: '120' };
    const incoming = { name: '最新', seats: '60', note: 'リモート', cost: '120' };

    const view = reconcileFormDraft({ baseline, values }, incoming, fields);

    expect(view.draft.values).toEqual({ name: '最新', seats: '80', note: 'ローカル', cost: '120' });
    expect(view.draft.baseline).toEqual({ name: '最新', seats: '60', note: 'a', cost: '120' });
    expect(view.conflicts).toEqual(['note']);
    expect(changedFields(view.draft.baseline, view.draft.values, fields)).toEqual(['seats', 'note']);
  });

  it('チェックボックスの目盛りと空文字も、ただの文字列として扱われる', () => {
    const fields = ['active', 'memo'] as const;
    const CHECKED = 'on';
    const draft = { baseline: { active: '', memo: '' }, values: { active: CHECKED, memo: '' } };

    // 手元だけチェックを入れた・メモ欄は空のまま。最新はメモだけが入った
    const view = reconcileFormDraft(draft, { active: '', memo: '追記' }, fields);
    expect(view.draft.values).toEqual({ active: CHECKED, memo: '追記' });
    expect(changedFields(view.draft.baseline, view.draft.values, fields)).toEqual(['active']);

    // 最新もチェックが入れば同じ値に着地して変更なし。空文字へ戻された最新は競合にしない(手元が変えていなければ追従)
    const landed = reconcileFormDraft(draft, { active: CHECKED, memo: '' }, fields);
    expect(changedFields(landed.draft.baseline, landed.draft.values, fields)).toEqual([]);
    expect(reconcileFormDraft(untouched({ name: 'x', seats: '1' }), { name: '', seats: '1' }, FIELDS).draft.values.name).toBe('');
  });

  it('refresh が続けて届いても、触っていない欄は最新に追従し続け、触った欄は守られる', () => {
    const draft: FormDraft<Field> = { baseline: BEFORE, values: { ...BEFORE, seats: '80' } };
    const second = reconcileFormDraft(draft, { name: '2 回目', seats: '60' }, FIELDS);
    const third = reconcileFormDraft(second.draft, { name: '3 回目', seats: '60' }, FIELDS);

    expect(third.draft.values).toEqual({ name: '3 回目', seats: '80' });
    expect(changedFields(third.draft.baseline, third.draft.values, FIELDS)).toEqual(['seats']);
    expect(third.conflicts).toEqual([]);

    // 競合した最新が元の値へ戻れば、競合は消える(手元の編集は守られたまま)
    const conflicting = reconcileFormDraft(third.draft, { name: '3 回目', seats: '90' }, FIELDS);
    expect(conflicting.conflicts).toEqual(['seats']);
    expect(reconcileFormDraft(conflicting.draft, { name: '3 回目', seats: '60' }, FIELDS).conflicts).toEqual([]);
  });

  it('導出は、手元と一度だけ一致した最新が変わると競合として見せる(安全側)', () => {
    const draft: FormDraft<Field> = { baseline: BEFORE, values: { ...BEFORE, seats: '80' } };

    // 逐次: 最新が手元と同じ 80 になった時点で取り込めば baseline も 80。そのあと 100 になっても手元(80)は触っていない扱いで追従する
    const landed = reconcileFormDraft(draft, { ...BEFORE, seats: '80' }, FIELDS);
    expect(reconcileFormDraft(landed.draft, { ...BEFORE, seats: '100' }, FIELDS).conflicts).toEqual([]);

    // 導出: 状態に最新を覚えないので、最初の入力に 100 だけを当てる。手元(80)も最新(100)も baseline(60)から変わっている
    expect(reconcileFormDraft(draft, { ...BEFORE, seats: '100' }, FIELDS).conflicts).toEqual(['seats']);
  });

  it('同じ mount に props が差し替わる流れ: 触った欄だけが変更として残る', () => {
    // 1 回目: 行を開く。席数を 80 に直し始める
    const opened = untouched(BEFORE);
    const typing: FormDraft<Field> = { baseline: opened.baseline, values: { ...opened.values, seats: '80' } };
    // 2 回目: 他の人が会場名を直した props が届く(同じ mount)
    const afterRefresh = reconcileFormDraft(typing, { name: '他の人が直した名前', seats: '60' }, FIELDS);
    // 描画は afterRefresh.draft。入力ハンドラはこの draft を土台に積む
    const edited = { baseline: afterRefresh.draft.baseline, values: { ...afterRefresh.draft.values, seats: '85' } };
    // 3 回目: さらに別の props が届く
    const again = reconcileFormDraft(edited, { name: '他の人が直した名前', seats: '60' }, FIELDS);

    expect(changedFields(again.draft.baseline, again.draft.values, FIELDS)).toEqual(['seats']);
    expect(again.draft.values.name).toBe('他の人が直した名前');
  });
});

describe('acceptSaved', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-FORMREFRESH-003
  it('保存 → 追加入力 → refresh が届いても、自分の保存は競合にならず追加入力は残る', () => {
    // 席数を 80 にして送る(送った値 = 80)
    const sending: FormDraft<Field> = { baseline: BEFORE, values: { ...BEFORE, seats: '80' } };
    // 送信中に 100 へ打ち足す(onSuccess の前)
    const typedMore: FormDraft<Field> = { baseline: sending.baseline, values: { ...sending.values, seats: '100' } };
    // 成功: 実行器は onSuccess → refresh の順。baseline が送った値に進む
    const saved = acceptSaved(typedMore, { seats: '80' });
    // refresh で自分の保存(80)が最新として届く
    const view = reconcileFormDraft(saved, { ...BEFORE, seats: '80' }, FIELDS);

    expect(view.conflicts).toEqual([]);
    expect(view.draft.values.seats).toBe('100');
    expect(changedFields(view.draft.baseline, view.draft.values, FIELDS)).toEqual(['seats']);

    // acceptSaved を通さなければ、同じ流れは競合に見える(これが要る理由)
    expect(reconcileFormDraft(typedMore, { ...BEFORE, seats: '80' }, FIELDS).conflicts).toEqual(['seats']);
  });

  it('打ち足していなければ、保存した欄は最新と一致して清潔になる', () => {
    const sending: FormDraft<Field> = { baseline: BEFORE, values: { ...BEFORE, seats: '80' } };
    const saved = acceptSaved(sending, { seats: '80' });

    expect(changedFields(saved.baseline, saved.values, FIELDS)).toEqual([]);
    expect(reconcileFormDraft(saved, { ...BEFORE, seats: '80' }, FIELDS)).toEqual({
      draft: { baseline: { ...BEFORE, seats: '80' }, values: { ...BEFORE, seats: '80' } },
      conflicts: [],
    });
  });

  it('送った欄だけ baseline を進め、values と draft に無い欄は動かさない', () => {
    const draft = Object.freeze({ baseline: Object.freeze({ ...BEFORE }), values: Object.freeze({ ...BEFORE, seats: '80' }) });
    const saved = acceptSaved(draft, { seats: '80', extra: 'x' } as Partial<Record<Field, string>>);

    expect(saved.baseline).toEqual({ name: '旧会場名', seats: '80' });
    expect(saved.values).toBe(draft.values);
    expect(acceptSaved(draft, {}).baseline).toEqual(BEFORE);
  });
});

describe('resolveConflict / conflictsOf', () => {
  const draft: FormDraft<Field> = { baseline: BEFORE, values: { ...BEFORE, seats: '80' } };
  const incoming = { ...BEFORE, seats: '90' };

  it('conflictsOf は reconcileFormDraft の conflicts と同じ欄を返す', () => {
    expect(conflictsOf(draft, incoming, FIELDS)).toEqual(['seats']);
    expect(conflictsOf(draft, incoming, FIELDS)).toEqual(reconcileFormDraft(draft, incoming, FIELDS).conflicts);
    expect(conflictsOf(draft, BEFORE, FIELDS)).toEqual([]);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-FORMREFRESH-004
  it('最新を取ると、手元の編集を捨てて最新になり、変更も競合も残らない', () => {
    const resolved = resolveConflict(draft, incoming, 'seats', 'theirs');

    expect(resolved.values.seats).toBe('90');
    expect(changedFields(resolved.baseline, resolved.values, FIELDS)).toEqual([]);
    expect(conflictsOf(resolved, incoming, FIELDS)).toEqual([]);
  });

  it('自分の値で上書きすると、手元の値は残り、次の保存で送る欄として残る', () => {
    const resolved = resolveConflict(draft, incoming, 'seats', 'mine');

    expect(resolved.values.seats).toBe('80');
    expect(resolved.baseline.seats).toBe('90');
    expect(changedFields(resolved.baseline, resolved.values, FIELDS)).toEqual(['seats']);
    expect(conflictsOf(resolved, incoming, FIELDS)).toEqual([]);
    // その後も refresh を受けて競合に戻らない
    expect(reconcileFormDraft(resolved, incoming, FIELDS).conflicts).toEqual([]);
  });

  it('解くのは指定した欄だけで、入力は書き換えない。最新に無い欄は何もしない', () => {
    const fields = ['name', 'seats'] as const;
    const both = { baseline: BEFORE, values: { name: '手元の名前', seats: '80' } };
    const frozen = Object.freeze({ baseline: Object.freeze({ ...both.baseline }), values: Object.freeze({ ...both.values }) });
    const remote = { name: '最新の名前', seats: '90' };

    const resolved = resolveConflict(frozen, remote, 'seats', 'theirs');
    expect(resolved.values).toEqual({ name: '手元の名前', seats: '90' });
    expect(resolved.baseline).toEqual({ name: '旧会場名', seats: '90' });
    expect(frozen.values.seats).toBe('80');
    expect(conflictsOf(resolved, remote, fields)).toEqual(['name']);

    expect(resolveConflict(frozen, { name: '最新の名前' }, 'seats', 'theirs')).toBe(frozen);
  });
});
