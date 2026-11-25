/**
 * 発火の宣言(`triggers[].fires`)の読み取りのテスト。
 *
 * 入力は**このリポジトリの仕様に実際に書かれている 6 形**である —— 単純な `after insert`、
 * 列を名指す `before insert or update of …`、表名まで書く形、コミット時評価の但し書きを
 * 括弧で添えた形、設計図が持つ `before update or delete`、そして読めない形。
 * 「読めなかったら黙って突合の外へ落ちる」を作らないことをここで固定する。
 */

import { describe, expect, it } from 'vitest';
import { firesClause, parseFires, splitCondition, triggerFires, updatedColumnsOf } from '../../../lib/model/trigger-fires.js';
import { triggerStatements } from '../../../lib/sql/ddl-guards.js';

describe('発火の宣言の読み取り', () => {
  it('単純な形(いつ・何で)を割る', () => {
    expect(parseFires('after insert')).toEqual({
      declared: 'after insert',
      timing: 'after',
      events: ['insert'],
      level: 'row',
      condition: null,
    });
  });

  it('列を名指す形では列の並びを読み飛ばす(突合するのは いつ・何で・何ごとに の 3 つ)', () => {
    const plan = parseFires('before insert or update of student_rate, workshop_id');

    expect(plan.timing).toBe('before');
    expect(plan.events).toEqual(['insert', 'update']);
  });

  it('**語順に依らない** —— 列の後ろにイベントを書いても取り落とさない', () => {
    // `of` より後ろを丸ごと捨てる形では `insert` が消え、偽の赤になった
    // (独立レビュー 2026-09-23)。列の並びは `of` から次の `or` までである。
    const plan = parseFires('before update of checked or insert');

    expect(plan.timing).toBe('before');
    expect(plan.events).toEqual(['insert', 'update']);
  });

  it('列の名前がイベントの語と紛れない(列の並びの中では語を読み飛ばす)', () => {
    // `updated_at` / `on_hold` のような列名を語として拾わない。
    expect(parseFires('after update of updated_at, on_hold').events).toEqual(['update']);
  });

  it('表名まで書いた形でも割れる(生成器が落とす `on {表}` は読み取りでも落ちる)', () => {
    const plan = parseFires('before insert or update of checked on workshop_checks');

    expect(plan.timing).toBe('before');
    expect(plan.events).toEqual(['insert', 'update']);
  });

  it('コミット時評価の但し書き(括弧)は落ちる', () => {
    const plan = parseFires('after insert or update (constraint trigger, deferrable initially deferred)');

    expect(plan.timing).toBe('after');
    expect(plan.events).toEqual(['insert', 'update']);
  });

  it('イベントは宣言の順ではなく insert / update / delete / truncate の順に正規化する', () => {
    expect(parseFires('before update or delete').events).toEqual(['update', 'delete']);
  });

  it('既定は行トリガであり、文トリガは宣言したときだけ', () => {
    expect(parseFires('after insert').level).toBe('row');
    expect(parseFires('after insert for each statement').level).toBe('statement');
  });

  it('読めない宣言は timing: null / events: [] で返る(突合の側が落とす)', () => {
    expect(parseFires('たまに実行する')).toEqual({
      declared: 'たまに実行する',
      timing: null,
      events: [],
      level: 'row',
      condition: null,
    });
    expect(parseFires('after insret').events).toEqual([]);
    expect(parseFires('instead of insert').timing).toBeNull();
  });
});

describe('更新で見ている列の読み取り', () => {
  it('update of の列を宣言順に取り出す(小文字・カンマ区切り・or で終わる)', () => {
    expect(updatedColumnsOf('before insert or update of due_at')).toEqual(['due_at']);
    expect(updatedColumnsOf('before insert or update of Title, due_at')).toEqual(['title', 'due_at']);
    expect(updatedColumnsOf('before update of checked, linked or insert')).toEqual(['checked', 'linked']);
  });

  it('列を名指さない update はどの列の更新でも発火する(all)', () => {
    expect(updatedColumnsOf('before insert or update')).toBe('all');
  });

  it('列を名指した update と名指さない update の混在は、名指した列だけを返す(安全側。実際はどの列でも発火する)', () => {
    // 狭く読むと、`follow` の検査が「含まない」と言いすぎる(正しい宣言に error を出す)側にだけ誤る。通しすぎはしない。
    expect(updatedColumnsOf('before insert or update of a or update')).toEqual(['a']);
    expect(updatedColumnsOf('before insert or update or update of a')).toEqual(['a']);
  });

  it('更新で発火しない宣言は null である', () => {
    expect(updatedColumnsOf('before insert')).toBeNull();
    expect(updatedColumnsOf('after delete')).toBeNull();
  });
});

describe('発火の条件(when (…))の読み取り(点検 20 回目 C20-7)', () => {
  it('括弧の釣り合いで条件を切り出し、いつ・何で・列の読みに混ぜない', () => {
    const plan = parseFires('after update of is_staff when (old.is_staff is true and (new.is_staff is not true)) (constraint trigger, deferrable initially deferred)');
    expect(plan).toMatchObject({ timing: 'after', events: ['update'], level: 'row', condition: 'old.is_staff is true and (new.is_staff is not true)' });
    expect(updatedColumnsOf('after update of is_staff when (old.is_staff is true)')).toEqual(['is_staff']);
  });

  it('条件の無い宣言は null・閉じていない条件は読めない宣言になる', () => {
    expect(parseFires('before insert').condition).toBeNull();
    expect(splitCondition('before insert when (a')).toEqual({ rest: 'before insert when (a', condition: null });
    expect(parseFires('before insert when (a').events).toEqual([]);
  });

  it('生成器に渡す節は条件を字面のまま末尾に運ぶ(点検 21 回目 C21-5。以前は黙って捨てた)', () => {
    expect(firesClause('before update of a when (old.a is null)')).toEqual({ fires: 'before update of a', condition: 'old.a is null' });
    expect(firesClause('after update of is_staff when (old.is_staff is true and (new.is_staff is not true)) (constraint trigger)')).toEqual({
      fires: 'after update of is_staff',
      condition: 'old.is_staff is true and (new.is_staff is not true)',
    });
    expect(firesClause('before insert')).toEqual({ fires: 'before insert' });
    // 宣言の字面のまま渡す口(写しのトリガ・仕組みの表のトリガ)も同じ 1 か所で割る。条件の無い宣言は 1 字も変えない(点検 22 回目 O22-4)。
    expect(triggerFires('before  update of a')).toEqual({ fires: 'before  update of a' });
    expect(triggerFires('before update of a  when (old.a = 1)')).toEqual({ fires: 'before update of a', condition: 'old.a = 1' });
  });

  it('生成の create trigger は条件を for each row の後に置く(置き場は ddl-guards の 1 か所)', () => {
    const fn = { name: 'f', comment: 'c', body: ['return new;'] };
    const withWhen = triggerStatements({ name: 't', ...(firesClause("before update of a when (old.a = 'X Y')") ?? { fires: '' }), function: fn }, 'public.items').join('\n');
    expect(withWhen).toMatch(/before update of a on public\.items\n\s+for each row\n\s+when \(old\.a = 'X Y'\)\n\s+execute function public\.f\(\);/);
    // 条件の無い宣言は字面を 1 字も変えない(適用済みの migration と同じ字面)。
    const plain = triggerStatements({ name: 't', fires: 'before  update of a', function: fn }, 'public.items').join('\n');
    expect(plain).toMatch(/ before {2}update of a on public\.items\n\s+for each row\n\s+execute function public\.f\(\);/);
  });
});

