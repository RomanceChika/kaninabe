/**
 * S18(読みを載せる部品の宣言)の規約網羅テスト。
 *
 * 対象の要求: screen-spec-writing.md「`kind: table` / `detail` の `reads` / `shows` と、`kind: form` の `reads`
 * (参照の欄の選択肢)」(ADR-0015 の改訂)。
 *   (a) 読みが種類に合う(table = many・detail = one・form = many で `[id, 表示名]`)
 *   (b) `reads` が画面の `reads` の要素 (c) `shows` の欄が実在し ref でない
 *   (d) form の `reads` の source が操作の入力の ref の欄の参照先と一致 (f) table を持つ画面は `empty` を宣言する
 *   (e2) 参照先が `display_field` を宣言していれば、選択肢の表示名(第 2 列)はその欄
 */

import { describe, expect, it } from 'vitest';
import { readComponentVerifier } from '../../../../lib/screen/verifiers/s18-read-component.js';
import type { OperationInput } from '../../../../lib/screen/verifier.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  field,
  specModel,
  writeRule,
} from '../../../helpers/model-builder-v8plus.js';
import { querySpec } from '../../../helpers/query-builder.js';
import { SCREEN_CTX, chromeSpec, screenInput, screenSpec } from '../../../helpers/screen-builder.js';
import type { ComponentInit } from '../../../helpers/screen-builder.js';

/** 催し(会場と世話役への ref を持つ)・会場・メンバーを持つドメイン。 */
function domain() {
  return specModel({
    aggregates: [
      aggregate({
        name: 'workshop',
        entity: entitySpec('workshop', [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('title', { kind: 'string' }, { required: true }),
          field('venue_id', { kind: 'ref', entity: 'venue' }),
          field('organizer_id', { kind: 'ref', entity: 'member' }, { required: true }),
          field('starts_at', { kind: 'datetime' }, { required: true }),
        ]),
        access: accessSpec('workshop', { writes: [writeRule('organizer', ['title', 'venue_id', 'organizer_id'])] }),
      }),
      aggregate({
        name: 'entry',
        entity: entitySpec('entry', [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('workshop_id', { kind: 'ref', entity: 'workshop' }, { required: true }),
          field('note', { kind: 'string' }),
        ]),
      }),
      aggregate({
        name: 'venue',
        entity: entitySpec('venue', [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('name', { kind: 'string' }, { required: true }),
        ]),
      }),
      aggregate({
        name: 'member',
        entity: entitySpec('member', [
          field('id', { kind: 'uuid' }, { auto: true }),
          field('display_name', { kind: 'string' }, { required: true }),
        ]),
      }),
    ],
  });
}

/** 読み(query_spec)の標本。 */
function queries() {
  return [
    querySpec({
      name: 'workshop_list',
      source: 'workshop',
      for: ['member'],
      scopeUsed: 'all',
      projection: ['id', 'title', 'venue_id', 'starts_at'],
      includes: [{ entity: 'venue', scopeUsed: 'all', projection: ['id', 'name'] }],
    }),
    querySpec({
      name: 'workshop_detail',
      source: 'workshop',
      for: ['member'],
      scopeUsed: 'all',
      returns: 'one',
      params: [{ name: 'workshop_id', ref: 'workshop.id' }],
      projection: ['id', 'title', 'venue_id', 'organizer_id', 'starts_at'],
      includes: [
        { entity: 'venue', scopeUsed: 'all', projection: ['id', 'name'] },
        { entity: 'member', scopeUsed: 'all', projection: ['id', 'display_name'] },
        { entity: 'entry', scopeUsed: 'all', projection: ['id', 'note'] },
      ],
    }),
    querySpec({ name: 'venue_options', source: 'venue', for: ['member'], scopeUsed: 'all', projection: ['id', 'name'] }),
    querySpec({
      name: 'venue_list',
      source: 'venue',
      for: ['member'],
      scopeUsed: 'all',
      projection: ['id', 'name', 'id'],
    }),
    querySpec({ name: 'member_options', source: 'member', for: ['member'], scopeUsed: 'all', projection: ['id', 'display_name'] }),
  ];
}

/** `kind` つきの部品(table / detail / form)。 */
function part(name: string, rest: Omit<Extract<ComponentInit, { name: string }>, 'name'>): ComponentInit {
  return { name, ...rest };
}

/** 操作の入力(`workshop.update` は会場と世話役の ref を取る)。 */
const INPUTS = new Map<string, readonly OperationInput[]>([
  [
    'workshop.update',
    [
      { entity: 'workshop', field: 'id' },
      { entity: 'workshop', field: 'title' },
      { entity: 'workshop', field: 'venue_id' },
      { entity: 'workshop', field: 'organizer_id' },
    ],
  ],
]);

/** 検査器を回す。 */
function run(
  screens: readonly ReturnType<typeof screenSpec>[],
  chromes: readonly ReturnType<typeof chromeSpec>[] = [],
  inputs: ReadonlyMap<string, readonly OperationInput[]> = INPUTS,
) {
  return readComponentVerifier.verify(screenInput({ domain: domain(), queries: queries(), screens, chromes }), {
    ...SCREEN_CTX,
    operationInputs: inputs,
  });
}

/** 表 1 つの画面。 */
function tableScreen(rest: Omit<Extract<ComponentInit, { name: string }>, 'name' | 'kind'>, extra: { requires?: ('empty')[] } = {}) {
  return screenSpec({
    name: 'workshop_list',
    reads: ['query-workshop-list'],
    requires: extra.requires ?? ['empty'],
    slots: [{ slot: 'body.center', components: [part('workshop_table', { kind: 'table', reads: 'query-workshop-list', ...rest })] }],
  });
}

describe('S18 読みを載せる部品の宣言', () => {
  it('table: 画面の reads の many の読みで shows が実在すれば通る(併読の欄も出せる)', () => {
    expect(run([tableScreen({ shows: ['title', 'venue.name', 'starts_at'] })])).toEqual([]);
  });

  it('shows を省略しても通る(省略 = 全欄)', () => {
    expect(run([tableScreen({})])).toEqual([]);
  });

  it('detail: returns: one の読みで、1 件に決まる併読(venue / member)の欄を出せる', () => {
    const screen = screenSpec({
      name: 'workshop_detail',
      reads: ['query-workshop-detail'],
      slots: [
        {
          slot: 'body.center',
          components: [
            part('workshop_summary', {
              kind: 'detail',
              reads: 'query-workshop-detail',
              shows: ['title', 'venue.name', 'member.display_name'],
            }),
          ],
        },
      ],
    });

    expect(run([screen])).toEqual([]);
  });

  it('同じ読みを 2 つの部品が出してもよい(shows が違う)', () => {
    const screen = screenSpec({
      name: 'workshop_detail',
      reads: ['query-workshop-detail'],
      slots: [
        {
          slot: 'body.center',
          components: [
            part('summary_a', { kind: 'detail', reads: 'query-workshop-detail', shows: ['title'] }),
            part('summary_b', { kind: 'detail', reads: 'query-workshop-detail', shows: ['starts_at'] }),
          ],
        },
      ],
    });

    expect(run([screen])).toEqual([]);
  });

  it('kind を書かない部品(手書き)は何も見ない', () => {
    const screen = screenSpec({ name: 'workshop_list', slots: [{ slot: 'body.center', components: ['workshop_table'] }] });

    expect(run([screen])).toEqual([]);
  });

  it('(b) 画面の reads に無い読みを出すとエラー(いまある読みを示す)', () => {
    const screen = screenSpec({
      name: 'workshop_list',
      reads: ['query-venue-list'],
      requires: ['empty'],
      slots: [{ slot: 'body.center', components: [part('workshop_table', { kind: 'table', reads: 'query-workshop-list' })] }],
    });

    const findings = run([screen]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ verifier: 'S18', severity: 'error' });
    expect(findings[0]?.message).toContain('query-workshop-list');
    expect(findings[0]?.message).toContain('この画面の reads にありません');
    expect(findings[0]?.suggestion).toContain('query-venue-list');
  });

  it('(a) returns: one の読みを kind: table に載せるとエラー', () => {
    const screen = screenSpec({
      name: 'workshop_list',
      reads: ['query-workshop-detail'],
      requires: ['empty'],
      slots: [{ slot: 'body.center', components: [part('workshop_table', { kind: 'table', reads: 'query-workshop-detail' })] }],
    });

    const findings = run([screen]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('returns: one');
    expect(findings[0]?.suggestion).toContain('kind: detail');
  });

  it('(a) returns: many の読みを kind: detail に載せるとエラー', () => {
    const screen = screenSpec({
      name: 'workshop_detail',
      reads: ['query-workshop-list'],
      slots: [{ slot: 'body.center', components: [part('workshop_summary', { kind: 'detail', reads: 'query-workshop-list' })] }],
    });

    const findings = run([screen]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('returns: many');
    expect(findings[0]?.suggestion).toContain('kind: table');
  });

  it('(c) projection にも併読にも無い欄を shows に書くとエラー(出せる欄を示す)', () => {
    const findings = run([tableScreen({ shows: ['title', 'capacity'] })]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('shows capacity');
    expect(findings[0]?.suggestion).toContain('venue.name');
  });

  it('(c) 1 行に複数が付く併読(entry)の欄は出せない', () => {
    const screen = screenSpec({
      name: 'workshop_detail',
      reads: ['query-workshop-detail'],
      slots: [
        {
          slot: 'body.center',
          components: [part('workshop_summary', { kind: 'detail', reads: 'query-workshop-detail', shows: ['entry.note'] })],
        },
      ],
    });

    const findings = run([screen]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('shows entry.note');
  });

  it('(c) ref の欄(venue_id)を shows に書くとエラー(併読の欄で書くよう促す)', () => {
    const findings = run([tableScreen({ shows: ['venue_id'] })]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('ref の欄');
    expect(findings[0]?.suggestion).toContain('venue.name');
  });

  it('(f) kind: table を持つ画面が empty を宣言していないとエラー', () => {
    const findings = run([tableScreen({}, { requires: [] })]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('states.requires に empty がありません');
    expect(findings[0]?.message).toContain('workshop_table');
  });

  it('(f) detail だけの画面は empty を要求されない / table が無くて empty を宣言していてもよい(手書きの表)', () => {
    const detailOnly = screenSpec({
      name: 'workshop_detail',
      reads: ['query-workshop-detail'],
      slots: [{ slot: 'body.center', components: [part('workshop_summary', { kind: 'detail', reads: 'query-workshop-detail' })] }],
    });
    const handWritten = screenSpec({
      name: 'venue_admin',
      requires: ['empty'],
      slots: [{ slot: 'body.center', components: ['venue_table'] }],
    });

    expect(run([detailOnly, handWritten])).toEqual([]);
  });

  it('chrome の table / detail には書けない', () => {
    const chrome = chromeSpec({
      name: 'member',
      slots: [{ slot: 'header', components: [part('app_header', { kind: 'table', reads: 'query-workshop-list' })] }],
    });

    const findings = run([], [chrome]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('chrome member');
    expect(findings[0]?.message).toContain('kind: table');
  });

  it('読みが実在しない(S2 の領分)なら黙る', () => {
    const screen = screenSpec({
      name: 'workshop_list',
      reads: ['query-no-such'],
      requires: ['empty'],
      slots: [{ slot: 'body.center', components: [part('workshop_table', { kind: 'table', reads: 'query-no-such' })] }],
    });

    expect(run([screen])).toEqual([]);
  });

  it('query_spec を読めていなければ読みの突合は何もしない(chrome の指摘だけ残る)', () => {
    const findings = readComponentVerifier.verify(
      screenInput({
        domain: domain(),
        queriesUnavailable: true,
        screens: [tableScreen({})],
      }),
      SCREEN_CTX,
    );

    expect(findings).toEqual([]);
  });

  describe('kind: form の reads(参照の欄の選択肢)', () => {
    /** 編集フォームの画面。 */
    function formScreen(reads: string) {
      return screenSpec({
        name: 'workshop_manage',
        reads: [reads],
        actions: ['workshop.update'],
        slots: [
          {
            slot: 'body.center',
            components: [part('workshop_form', { kind: 'form', action: 'workshop.update', reads })],
          },
        ],
      });
    }

    it('source が操作の入力の ref の欄の参照先と一致すれば通る', () => {
      expect(run([formScreen('query-venue-options')])).toEqual([]);
    });

    it('(a) 選択肢の形でない読み(projection が 2 欄でない)はエラー', () => {
      const findings = run([formScreen('query-workshop-list')]);

      expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('選択肢の形ではありません')]);
    });

    it('(a) returns: one の読みはエラー', () => {
      const findings = run([formScreen('query-workshop-detail')]);

      expect(findings[0]?.message).toContain('returns: one');
      expect(findings[0]?.suggestion).toContain('複数行を返す読み');
    });

    it('(e2) 参照先の集約が display_field を宣言していれば、選択肢の表示名(第 2 列)はその欄でなければエラー', () => {
      const run2 = (displayField: string) => {
        const base = domain();
        const aggregates = [...base.aggregates.entries()].map(([name, specs]) =>
          aggregate({
            name,
            ...(specs.entity === undefined ? {} : { entity: name === 'venue' ? { ...specs.entity, displayField } : specs.entity }),
            ...(specs.access === undefined ? {} : { access: specs.access }),
          }),
        );
        return readComponentVerifier.verify(
          screenInput({ domain: specModel({ aggregates }), queries: queries(), screens: [formScreen('query-venue-options')] }),
          { ...SCREEN_CTX, operationInputs: INPUTS },
        );
      };

      expect(run2('name')).toEqual([]);
      const findings = run2('id');
      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('表示名の欄 name が、venue の display_field(id)と違います');
      expect(findings[0]?.suggestion).toContain('[id, id]');
      expect(findings[0]?.counterexample).toMatchObject({ source: 'venue', label: 'name', displayField: 'id' });
    });

    it('(e2) display_field を宣言していない集約は、第 2 列を問わない', () => {
      expect(run([formScreen('query-venue-options')])).toEqual([]);
    });

    it('(d) 操作の入力に source を指す ref の欄が無いとエラー', () => {
      const none = new Map<string, readonly OperationInput[]>([['workshop.update', [{ entity: 'workshop', field: 'title' }]]]);

      const findings = run([formScreen('query-venue-options')], [], none);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('どの ref の欄の選択肢にもなりません');
    });

    it('(d) 同じ参照先を指す欄が 2 つあると曖昧でエラー(欄を示す)', () => {
      const ambiguous = specModel({
        aggregates: [
        aggregate({
          name: 'workshop',
          entity: entitySpec('workshop', [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('venue_id', { kind: 'ref', entity: 'venue' }),
            field('backup_venue_id', { kind: 'ref', entity: 'venue' }),
          ]),
        }),
        aggregate({
          name: 'venue',
          entity: entitySpec('venue', [field('id', { kind: 'uuid' }, { auto: true }), field('name', { kind: 'string' })]),
        }),
        ],
      });
      const inputs = new Map<string, readonly OperationInput[]>([
        [
          'workshop.update',
          [
            { entity: 'workshop', field: 'venue_id' },
            { entity: 'workshop', field: 'backup_venue_id' },
          ],
        ],
      ]);

      const findings = readComponentVerifier.verify(
        screenInput({ domain: ambiguous, queries: queries(), screens: [formScreen('query-venue-options')] }),
        { ...SCREEN_CTX, operationInputs: inputs },
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]?.message).toContain('venue_id / backup_venue_id');
      expect(findings[0]?.message).toContain('決まりません');
    });

    it('(d) 操作の入力を読めていない(action_spec が無い)なら黙る', () => {
      expect(run([formScreen('query-venue-options')], [], new Map())).toEqual([]);
    });

    it('reads を書かない form は何も見ない', () => {
      const screen = screenSpec({
        name: 'workshop_manage',
        actions: ['workshop.update'],
        slots: [{ slot: 'body.center', components: [part('workshop_form', { kind: 'form', action: 'workshop.update' })] }],
      });

      expect(run([screen])).toEqual([]);
    });
  });
});

describe('S18 読み取りクエリ(query_spec)が阻害のとき(入力の状態の保留)', () => {
  it('読めていれば読みの形の食い違いを言い、阻害なら言わない(欠けた読みの形を突合しない)', () => {
    const screen = screenSpec({
      name: 'workshop_list',
      reads: ['query-workshop-detail'],
      requires: ['empty'],
      slots: [{ slot: 'body.center', components: [part('workshop_table', { kind: 'table', reads: 'query-workshop-detail' })] }],
    });
    const input = screenInput({ domain: domain(), queries: queries(), screens: [screen] });

    expect(readComponentVerifier.verify(input, { ...SCREEN_CTX, operationInputs: INPUTS })).toHaveLength(1);
    expect(readComponentVerifier.verify(input, { ...SCREEN_CTX, operationInputs: INPUTS, blockedInputs: ['queries'] })).toEqual([]);
  });
});
