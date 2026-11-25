/**
 * レイアウト部品の `kind:` / `action:` / `reads:` / `shows:` / `edit:` / `actions:`(ADR-0015)の読み取りのテスト。
 *
 * パーサーが見るのは形(語彙・組になっているか)だけで、操作の意味は S17 / S19、読みの意味は S18 が見る。
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseLayout } from '../../../../lib/model/screen/parse-layout.js';

/** 部品 1 つを置いた layout を読む。 */
function parse(component: unknown) {
  const reporter = new SpecReporter('docs/specs/frontend/screens/sample/x.md');
  const layout = parseLayout({ body: { center: [component] } }, 'layout', reporter);
  return { layout, findings: reporter.findings() };
}

describe('parseLayout の kind / action / reads / shows', () => {
  it('kind: form と action を部品の属性として読み、入れ子スロットにはしない', () => {
    const { layout, findings } = parse({ sample_form: { kind: 'form', action: 'sample.create' } });

    expect(findings).toEqual([]);
    expect(layout.slots).toHaveLength(1);
    expect(layout.slots[0]?.components[0]).toMatchObject({ name: 'sample_form', kind: 'form' });
    expect(layout.slots[0]?.components[0]?.actionRefs?.map((ref) => ref.id)).toEqual(['sample.create']);
  });

  it('label と並べて書ける', () => {
    const { layout, findings } = parse({ sample_form: { label: '会場の登録', kind: 'form', action: 'sample.create' } });

    expect(findings).toEqual([]);
    expect(layout.slots[0]?.components[0]).toMatchObject({ label: '会場の登録', kind: 'form' });
  });

  it('入れ子スロットとも並べて書ける(kind / action は入れ子のスロットとして読まれない)', () => {
    const { layout, findings } = parse({
      sample_form: { kind: 'form', action: 'sample.create', footer: ['submit_bar'] },
    });

    expect(findings).toEqual([]);
    expect(layout.slots.map((slot) => slot.path).sort()).toEqual(['body.center', 'body.center.sample_form.footer']);
  });

  it('排他表示(variants)の中の部品にも書ける', () => {
    const reporter = new SpecReporter('docs/specs/frontend/screens/sample/x.md');
    const layout = parseLayout(
      { body: { center: [{ variants: { empty: { sample_form: { kind: 'form', action: 'sample.create' } } } }] } },
      'layout',
      reporter,
    );

    expect(reporter.findings()).toEqual([]);
    expect(layout.slots[0]?.components[0]).toMatchObject({ kind: 'form', variant: { key: 'empty' } });
  });

  it('action は一覧でも読む(1 部品 1 操作かは S17 が数える)', () => {
    const { layout, findings } = parse({ sample_form: { kind: 'form', action: ['sample.create', 'sample.update'] } });

    expect(findings).toEqual([]);
    expect(layout.slots[0]?.components[0]?.actionRefs?.map((ref) => ref.id)).toEqual(['sample.create', 'sample.update']);
  });

  it('kind を書かない部品は kind も action も持たない(手書きが既定)', () => {
    const { layout, findings } = parse('sample_table');

    expect(findings).toEqual([]);
    expect(layout.slots[0]?.components[0]).not.toHaveProperty('kind');
    expect(layout.slots[0]?.components[0]).not.toHaveProperty('actionRefs');
  });

  it('値域に無い kind は S0 のエラー(値域を示す)', () => {
    const { findings } = parse({ sample_table: { kind: 'grid', action: 'sample.create' } });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('部品の種類の語彙ではありません');
    expect(findings[0]?.counterexample).toMatchObject({ value: 'grid', allowed: 'form, table, detail, actions, platform_read, platform_actions' });
  });

  it('action だけで kind が無いと S0 のエラー', () => {
    const { findings } = parse({ sample_form: { action: 'sample.create' } });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('kind がありません');
  });

  it('kind: form だけで action が無いと S0 のエラー', () => {
    const { findings } = parse({ sample_form: { kind: 'form' } });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('action がありません');
  });

  it('action が操作 ID として読めなければ S0 のエラー(空文字・数値・空の一覧)', () => {
    for (const action of ['', 3, [], ['sample.create', 7]]) {
      const { findings } = parse({ sample_form: { kind: 'form', action } });

      expect(findings.map((finding) => finding.message)).toEqual([
        expect.stringContaining('操作 ID として読めません'),
      ]);
    }
  });

  it('kind: table は reads と shows を部品の属性として読む', () => {
    const { layout, findings } = parse({
      sample_table: { kind: 'table', reads: 'query-sample-list', shows: ['title', 'venue.name'] },
    });

    expect(findings).toEqual([]);
    expect(layout.slots).toHaveLength(1);
    const component = layout.slots[0]?.components[0];
    expect(component).toMatchObject({ name: 'sample_table', kind: 'table', readRef: { id: 'query-sample-list' } });
    expect(component?.showRefs?.map((ref) => ref.id)).toEqual(['title', 'venue.name']);
    expect(component).not.toHaveProperty('actionRefs');
  });

  it('shows は省略できる(省略 = 全欄)・文字列 1 つでも読む', () => {
    const omitted = parse({ sample_detail: { kind: 'detail', reads: 'query-sample-detail' } });
    expect(omitted.findings).toEqual([]);
    expect(omitted.layout.slots[0]?.components[0]).not.toHaveProperty('showRefs');

    const single = parse({ sample_detail: { kind: 'detail', reads: 'query-sample-detail', shows: 'title' } });
    expect(single.findings).toEqual([]);
    expect(single.layout.slots[0]?.components[0]?.showRefs?.map((ref) => ref.id)).toEqual(['title']);
  });

  it('kind: form は reads を任意で持てる(参照の欄の選択肢の出どころ)', () => {
    const { layout, findings } = parse({
      sample_form: { kind: 'form', action: 'sample.update', reads: 'query-venue-options' },
    });

    expect(findings).toEqual([]);
    expect(layout.slots[0]?.components[0]).toMatchObject({ kind: 'form', readRef: { id: 'query-venue-options' } });
  });

  it('kind: table / detail は reads が必須(無いと S0 のエラー)', () => {
    for (const kind of ['table', 'detail']) {
      const { findings } = parse({ sample_part: { kind } });

      expect(findings.map((finding) => finding.message)).toEqual([
        expect.stringContaining(`kind: ${kind} がありますが reads がありません`),
      ]);
    }
  });

  it('kind に書けない属性は S0 のエラー(table に action・form に shows)', () => {
    const table = parse({ sample_table: { kind: 'table', reads: 'query-sample-list', action: 'sample.create' } });
    expect(table.findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('kind: table に action は書けません'),
    ]);

    const form = parse({ sample_form: { kind: 'form', action: 'sample.create', shows: ['title'] } });
    expect(form.findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('kind: form に shows は書けません'),
    ]);
  });

  it('kind が無いのに reads / shows があると S0 のエラー', () => {
    const { findings } = parse({ sample_table: { reads: 'query-sample-list', shows: ['title'] } });

    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('reads がありますが kind がありません'),
      expect.stringContaining('shows がありますが kind がありません'),
    ]);
  });

  it('reads が読みの ID として読めなければ S0 のエラー(空文字・数値・一覧)', () => {
    for (const reads of ['', 3, ['query-a']]) {
      const { findings } = parse({ sample_table: { kind: 'table', reads } });

      expect(findings.map((finding) => finding.message)).toEqual([
        expect.stringContaining('読みの ID として読めません'),
      ]);
    }
  });

  it('shows が欄の一覧として読めなければ S0 のエラー(空の一覧・文字列でない要素)', () => {
    for (const shows of [[], ['title', 7], '', 3]) {
      const { findings } = parse({ sample_table: { kind: 'table', reads: 'query-sample-list', shows } });

      expect(findings.map((finding) => finding.message)).toEqual([
        expect.stringContaining('欄の一覧として読めません'),
      ]);
    }
  });

  it('kind: table は edit と actions を部品の属性として読み、入れ子スロットにはしない', () => {
    const { layout, findings } = parse({
      sample_table: { kind: 'table', reads: 'query-sample-list', edit: 'sample.update', actions: ['sample.delete', 'sample.leave'] },
    });

    expect(findings).toEqual([]);
    expect(layout.slots).toHaveLength(1);
    const component = layout.slots[0]?.components[0];
    expect(component).toMatchObject({ kind: 'table', editRef: { id: 'sample.update' } });
    expect(component?.buttonRefs?.map((ref) => ref.id)).toEqual(['sample.delete', 'sample.leave']);
    // `action`(フォームの操作)とは別の属性である。
    expect(component).not.toHaveProperty('actionRefs');
  });

  it('kind: actions は reads と actions を取り、actions は文字列 1 つでも読む', () => {
    const { layout, findings } = parse({
      sample_bar: { kind: 'actions', reads: 'query-sample-detail', actions: 'sample.open' },
    });

    expect(findings).toEqual([]);
    expect(layout.slots[0]?.components[0]).toMatchObject({ kind: 'actions', readRef: { id: 'query-sample-detail' } });
    expect(layout.slots[0]?.components[0]?.buttonRefs?.map((ref) => ref.id)).toEqual(['sample.open']);
  });

  it('kind: actions は reads と actions の両方が必須(欠けると S0 のエラー)', () => {
    const noReads = parse({ sample_bar: { kind: 'actions', actions: ['sample.open'] } });
    expect(noReads.findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('kind: actions がありますが reads がありません'),
    ]);

    const noActions = parse({ sample_bar: { kind: 'actions', reads: 'query-sample-detail' } });
    expect(noActions.findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('kind: actions がありますが actions がありません'),
    ]);
  });

  it('edit / actions が書けない kind は S0 のエラー(detail に edit・form に actions・actions に edit / shows)', () => {
    const detail = parse({ sample_detail: { kind: 'detail', reads: 'query-sample-detail', edit: 'sample.update' } });
    expect(detail.findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('kind: detail に edit は書けません'),
    ]);

    const form = parse({ sample_form: { kind: 'form', action: 'sample.create', actions: ['sample.delete'] } });
    expect(form.findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('kind: form に actions は書けません'),
    ]);

    const bar = parse({
      sample_bar: { kind: 'actions', reads: 'query-sample-detail', actions: ['sample.open'], edit: 'sample.update' },
    });
    expect(bar.findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('kind: actions に edit は書けません'),
    ]);
  });

  it('edit と shows は併せて書けない(編集する表の列は writes で決まる)', () => {
    const { findings } = parse({
      sample_table: { kind: 'table', reads: 'query-sample-list', edit: 'sample.update', shows: ['title'] },
    });

    expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('edit と shows は併せて書けません')]);
  });

  it('kind が無いのに edit / actions があると S0 のエラー', () => {
    const { findings } = parse({ sample_table: { edit: 'sample.update', actions: ['sample.delete'] } });

    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('edit がありますが kind がありません'),
      expect.stringContaining('actions がありますが kind がありません'),
    ]);
  });

  it('edit が操作 ID として読めなければ S0 のエラー(空文字・数値・一覧)', () => {
    for (const edit of ['', 3, ['sample.update']]) {
      const { findings } = parse({ sample_table: { kind: 'table', reads: 'query-sample-list', edit } });

      expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('操作 ID として読めません')]);
    }
  });

  it('actions が操作 ID の一覧として読めなければ S0 のエラー(空の一覧・文字列でない要素・空文字)', () => {
    for (const actions of [[], ['sample.delete', 7], '', 3]) {
      const { findings } = parse({ sample_table: { kind: 'table', reads: 'query-sample-list', actions } });

      expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('操作 ID の一覧として読めません')]);
    }
  });

  it('reads / shows だけのマッピングは入れ子スロットではない(深さの上限の段でも通る)', () => {
    const reporter = new SpecReporter('docs/specs/frontend/screens/sample/x.md');
    const deepest = { z: { kind: 'table', reads: 'query-sample-list', shows: ['title'] } };
    parseLayout(
      { body: { center: [{ x: { footer: [{ y: { footer: [deepest] } }] } }] } },
      'layout',
      reporter,
    );

    expect(reporter.findings()).toEqual([]);
  });
});

describe('parseLayout の op / ops / row_actions(プラットフォーム操作の部品。ADR-0019)', () => {
  it('kind: platform_read の op・shows・row_actions を読む', () => {
    const { layout, findings } = parse({ session_table: { kind: 'platform_read', op: 'session.list_mine', shows: ['created_at'], row_actions: ['session.end_mine'] } });
    const component = layout.slots[0]?.components[0];

    expect(findings).toEqual([]);
    expect(layout.slots).toHaveLength(1);
    expect(component).toMatchObject({ kind: 'platform_read', platformOpRef: { id: 'session.list_mine' } });
    expect(component?.rowActionRefs?.map((ref) => ref.id)).toEqual(['session.end_mine']);
    expect(component?.showRefs?.map((ref) => ref.id)).toEqual(['created_at']);
  });

  it('kind: platform_actions の ops は文字列 1 つでも一覧でも読む', () => {
    const one = parse({ bar: { kind: 'platform_actions', ops: 'session.end_others' } });
    const many = parse({ bar: { kind: 'platform_actions', ops: ['session.end_others', 'session.end_every'] } });

    expect(one.findings).toEqual([]);
    expect(one.layout.slots[0]?.components[0]?.platformOpRefs?.map((ref) => ref.id)).toEqual(['session.end_others']);
    expect(many.layout.slots[0]?.components[0]?.platformOpRefs?.map((ref) => ref.id)).toEqual(['session.end_others', 'session.end_every']);
  });

  it('kind: table に row_actions(query_spec の表の行のボタン)を書ける', () => {
    const { layout, findings } = parse({ member_table: { kind: 'table', reads: 'query-member-admin', row_actions: ['session.end_member'] } });

    expect(findings).toEqual([]);
    expect(layout.slots[0]?.components[0]?.rowActionRefs?.map((ref) => ref.id)).toEqual(['session.end_member']);
  });

  const negatives: readonly { readonly name: string; readonly component: unknown; readonly expected: string }[] = [
    { name: 'platform_read に op が無い', component: { t: { kind: 'platform_read', row_actions: ['a.b'] } }, expected: 'kind: platform_read がありますが op がありません' },
    { name: 'platform_actions に ops が無い', component: { t: { kind: 'platform_actions' } }, expected: 'kind: platform_actions がありますが ops がありません' },
    { name: 'platform_actions に op', component: { t: { kind: 'platform_actions', ops: ['a.b'], op: 'a.b' } }, expected: 'kind: platform_actions に op は書けません' },
    { name: 'platform_read に ops', component: { t: { kind: 'platform_read', op: 'a.b', ops: ['a.b'] } }, expected: 'kind: platform_read に ops は書けません' },
    { name: 'platform_read に reads(query_spec は読まない)', component: { t: { kind: 'platform_read', op: 'a.b', reads: 'query-x' } }, expected: 'kind: platform_read に reads は書けません' },
    { name: 'platform_actions に row_actions', component: { t: { kind: 'platform_actions', ops: ['a.b'], row_actions: ['a.b'] } }, expected: 'kind: platform_actions に row_actions は書けません' },
    { name: 'kind: form に op', component: { t: { kind: 'form', action: 'x.create', op: 'a.b' } }, expected: 'kind: form に op は書けません' },
    { name: 'kind が無いのに op', component: { t: { op: 'a.b' } }, expected: 'op がありますが kind がありません' },
    { name: 'op が文字列でない', component: { t: { kind: 'platform_read', op: ['a.b'] } }, expected: 'プラットフォーム操作の id として読めません' },
    { name: 'ops が空の一覧', component: { t: { kind: 'platform_actions', ops: [] } }, expected: 'プラットフォーム操作の id の一覧として読めません' },
    { name: 'row_actions に文字列でない要素', component: { t: { kind: 'platform_read', op: 'a.b', row_actions: [1] } }, expected: 'プラットフォーム操作の id の一覧として読めません' },
  ];

  it.each(negatives)('$name は S0 の違反', ({ component, expected }) => {
    expect(parse(component).findings.some((finding) => finding.message.includes(expected))).toBe(true);
  });
});
