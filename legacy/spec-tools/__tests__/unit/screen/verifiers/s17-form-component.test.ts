/**
 * S17(`kind: form` の部品の宣言)の規約網羅テスト。
 *
 * 対象の要求: screen-spec-writing.md「`kind: form` の `action` が (a) 画面の `actions` に居る
 * (b) 作成か編集である (c) 1 部品 1 操作 (d) 同じ操作を 2 つの部品が載せない」+ chrome には書けない(ADR-0015)。
 */

import { describe, expect, it } from 'vitest';
import { formComponentVerifier } from '../../../../lib/screen/verifiers/s17-form-component.js';
import {
  accessSpec,
  aggregate,
  createRule,
  deleteRule,
  event,
  machine,
  specModel,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import { SCREEN_CTX, chromeSpec, screenInput, screenSpec } from '../../../helpers/screen-builder.js';
import type { ComponentInit } from '../../../helpers/screen-builder.js';

/** 作成・編集・削除(標本)と遷移(催し)を持つドメイン。 */
function domain() {
  return specModel({
    aggregates: [
      aggregate({
        name: 'sample',
        access: accessSpec('sample', {
          creates: [createRule('member')],
          writes: [writeRule('staff', ['name'])],
          deletes: [deleteRule('staff')],
        }),
      }),
      aggregate({
        name: 'workshop',
        stateMachines: [
          machine({
            machine: 'workshop',
            states: ['draft', 'open'],
            events: [event({ id: 'publish', from: ['draft'], to: 'open', by: ['member'] })],
          }),
        ],
      }),
    ],
  });
}

/** `kind: form` の部品 1 つ。 */
function form(name: string, action: string | readonly string[]): ComponentInit {
  return { name, kind: 'form', action };
}

/** 検査器を回して文面だけを返す。 */
function run(screens: readonly ReturnType<typeof screenSpec>[], chromes: readonly ReturnType<typeof chromeSpec>[] = []) {
  return formComponentVerifier.verify(screenInput({ domain: domain(), screens, chromes }), SCREEN_CTX);
}

describe('S17 フォームの部品の宣言', () => {
  it('actions に居る作成の操作を載せるなら通る', () => {
    const findings = run([
      screenSpec({
        name: 'sample_admin',
        actions: ['sample.create'],
        slots: [{ slot: 'body.center', components: [form('sample_form', 'sample.create'), 'sample_table'] }],
      }),
    ]);

    expect(findings).toEqual([]);
  });

  it('編集(update)の操作も載せられる', () => {
    const findings = run([
      screenSpec({
        name: 'sample_admin',
        actions: ['sample.update'],
        slots: [{ slot: 'body.center', components: [form('sample_editor', 'sample.update')] }],
      }),
    ]);

    expect(findings).toEqual([]);
  });

  it('kind を書かない部品(手書き)は何も見ない', () => {
    const findings = run([
      screenSpec({ name: 'sample_admin', slots: [{ slot: 'body.center', components: ['sample_form'] }] }),
    ]);

    expect(findings).toEqual([]);
  });

  it('(a) 画面の actions に無い操作を載せるとエラー(宣言した操作の一覧を示す)', () => {
    const findings = run([
      screenSpec({
        name: 'sample_admin',
        actions: ['sample.update'],
        slots: [{ slot: 'body.center', components: [form('sample_form', 'sample.create')] }],
      }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'S17', severity: 'error' });
    expect(findings[0]?.message).toContain('sample.create');
    expect(findings[0]?.message).toContain('actions にありません');
    expect(findings[0]?.suggestion).toContain('sample.update');
  });

  it('(a) 重ね表示の actions に居る操作は画面の母集合に入る(S2 / S10 と同じ)', () => {
    const findings = run([
      screenSpec({
        name: 'sample_admin',
        overlays: [{ id: 'create_dialog', openedBy: 'open_button', actions: ['sample.create'] }],
        slots: [{ slot: 'body.center', components: [form('sample_form', 'sample.create'), 'open_button'] }],
      }),
    ]);

    expect(findings).toEqual([]);
  });

  it('(b) 削除の操作はフォームにできない(overlay の操作を指すと赤)', () => {
    const findings = run([
      screenSpec({
        name: 'sample_admin',
        overlays: [{ id: 'delete_confirm', openedBy: 'sample_table', actions: ['sample.delete'] }],
        slots: [{ slot: 'body.center', components: [form('sample_form', 'sample.delete'), 'sample_table'] }],
      }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('削除');
    expect(findings[0]?.message).toContain('フォームにできません');
  });

  it('(b) 状態機械の遷移はフォームにできない', () => {
    const findings = run([
      screenSpec({
        name: 'workshop_manage',
        actions: ['workshop.publish'],
        slots: [{ slot: 'body.center', components: [form('publish_form', 'workshop.publish')] }],
      }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('状態機械の遷移');
  });

  it('(c) 1 部品に 2 つの操作を書くとエラー', () => {
    const findings = run([
      screenSpec({
        name: 'sample_admin',
        actions: ['sample.create', 'sample.update'],
        slots: [{ slot: 'body.center', components: [form('sample_form', ['sample.create', 'sample.update'])] }],
      }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('2 つあります');
    expect(findings[0]?.suggestion).toContain('部品を分けて');
  });

  it('(e) runner: manual の操作はフォームにできない(宣言したのに何も起きない状態を作らない)', () => {
    const screens = [
      screenSpec({
        name: 'sample_admin',
        actions: ['sample.update'],
        slots: [{ slot: 'body.center', components: [form('sample_editor', 'sample.update')] }],
      }),
    ];

    const findings = formComponentVerifier.verify(screenInput({ domain: domain(), screens }), {
      ...SCREEN_CTX,
      manualOperations: new Set(['sample.update']),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'S17', severity: 'error' });
    expect(findings[0]?.message).toContain('runner: manual');
    expect(findings[0]?.message).toContain('sample.update');
    expect(findings[0]?.suggestion).toContain('手書きの部品');
  });

  it('(e) runner を宣言していない操作(計画で走る)は通る', () => {
    const screens = [
      screenSpec({
        name: 'sample_admin',
        actions: ['sample.update'],
        slots: [{ slot: 'body.center', components: [form('sample_editor', 'sample.update')] }],
      }),
    ];

    const findings = formComponentVerifier.verify(screenInput({ domain: domain(), screens }), {
      ...SCREEN_CTX,
      manualOperations: new Set(['sample.create']),
    });

    expect(findings).toEqual([]);
  });

  it('(d) 同じ操作を 2 つの部品が載せるとエラー(2 つ目を指す)', () => {
    const findings = run([
      screenSpec({
        name: 'sample_admin',
        actions: ['sample.create'],
        slots: [
          {
            slot: 'body.center',
            components: [form('sample_form', 'sample.create'), form('another_form', 'sample.create')],
          },
        ],
      }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('another_form');
    expect(findings[0]?.message).toContain('sample_form');
  });

  it('(d) 別の画面なら同じ操作のフォームを持ってよい(部品は画面ごとに 1 つの生成物)', () => {
    const findings = run([
      screenSpec({
        name: 'sample_admin',
        actions: ['sample.create'],
        slots: [{ slot: 'body.center', components: [form('sample_form', 'sample.create')] }],
      }),
      screenSpec({
        name: 'organizer_workshops',
        actions: ['sample.create'],
        slots: [{ slot: 'body.center', components: [form('sample_form', 'sample.create')] }],
      }),
    ]);

    expect(findings).toEqual([]);
  });

  it('予約 ID の別名(集約名と entity 名)は同じ操作として数える', () => {
    const aliasDomain = specModel({
      aggregates: [
        aggregate({
          name: 'program',
          access: accessSpec('program_item', { creates: [createRule('organizer')] }),
        }),
      ],
    });
    const screen = screenSpec({
      name: 'organizer_program',
      actions: ['program.create'],
      slots: [
        {
          slot: 'body.center',
          components: [form('first_form', 'program_item.create'), form('second_form', 'program.create')],
        },
      ],
    });

    const findings = formComponentVerifier.verify(screenInput({ domain: aliasDomain, screens: [screen] }), SCREEN_CTX);

    expect(findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining('second_form'),
    ]);
  });

  it('ドメインに接地しない操作は S2 の領分なので S17 は黙る', () => {
    const findings = run([
      screenSpec({
        name: 'sample_admin',
        actions: ['sample.nothing'],
        slots: [{ slot: 'body.center', components: [form('sample_form', 'sample.nothing')] }],
      }),
    ]);

    expect(findings).toEqual([]);
  });

  it('重ね表示の中の部品も見る', () => {
    const findings = run([
      screenSpec({
        name: 'sample_admin',
        actions: ['sample.update'],
        overlays: [
          {
            id: 'create_dialog',
            openedBy: 'open_button',
            slots: [{ slot: 'body.center', components: [form('dialog_form', 'sample.create')] }],
          },
        ],
        slots: [{ slot: 'body.center', components: ['open_button'] }],
      }),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('dialog_form');
  });

  it('chrome の部品には書けない(chrome は操作を持たない外枠)', () => {
    const findings = run(
      [],
      [chromeSpec({ name: 'member', slots: [{ slot: 'header', components: [form('app_header', 'sample.create')] }] })],
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('chrome member');
  });

  it('action を読めなかった宣言(S0 が見たもの)は何も言わない', () => {
    const findings = run([
      screenSpec({
        name: 'sample_admin',
        slots: [{ slot: 'body.center', components: [{ name: 'sample_form', kind: 'form' }] }],
      }),
    ]);

    expect(findings).toEqual([]);
  });
});
