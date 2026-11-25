/**
 * 人向けの表示の章(render/book/face-*)のテスト用フィクスチャ。
 *
 * 親(workshop。状態機械 2 本・公理 3 本)・親を `on delete cascade` で参照する 3 つの集約
 * (部 = 親を動かす人だけが動かす → 節に畳む / 枠 = メンバーが動かす → 自分の章 / 当日のチェック = 親の
 * 遷移を動かす人が動かす → 節に畳む)・親を参照する公理を持つ範囲外の集約を、小さな世界にまとめる。
 * 本番の仕様の数は、HTML の本の生成物を読む dev-repo のテスト(`chapter-axiom-overlap.test.ts` など)が見る。
 */

import type { SpecModel } from '../../lib/model/types.js';
import type { GenerateContext } from '../../lib/gen-kit/generator.js';
import type { InvariantDef } from '../../lib/model/types.js';
import { makeFinding } from '../../lib/kernel/finding.js';
import type { ReadingBase } from '../../lib/semantics/reading-change.js';
import { dataTable, dataTableModel } from './data-builder.js';
import { GEN_CTX } from './generate-context.js';
import {
  accessSpec,
  aggregate,
  create,
  effect,
  entitySpec,
  event,
  field,
  loc,
  machine,
  read,
  role,
  roleSpec,
  specModel,
  write,
} from './model-builder.js';
import { actionSpec, testCase } from './trace-builder.js';
import { ledger, term } from './terms-builder.js';
import { usecaseAccept, usecaseSave, usecaseSpec, usecaseStep } from './usecase-builder.js';

/** 公理 1 本(住む集約のディレクトリの invariants.md に書かれたもの)。 */
function invariant(
  aggregateName: string,
  id: string,
  statement: string,
  entities: readonly string[],
  extra: Partial<InvariantDef> = {},
): InvariantDef {
  return {
    id,
    statement,
    entities,
    enforcedBy: [{ kind: 'db_constraint', ref: `${id.toLowerCase()}_check`, location: loc() }],
    location: loc(`docs/specs/domain/${aggregateName}/invariants.md`),
    ...extra,
  };
}

/** 催しの公理。括弧の補足・例外の文・一意性・式に写せないものを 1 本ずつ持つ。 */
export const WORKSHOP_INVARIANTS: readonly InvariantDef[] = [
  invariant(
    'workshop',
    'INV-WORKSHOP-001',
    '受付締切(entry_deadline)は開演日時(starts_at)より前でなければならない',
    ['workshop'],
    { formal: { kind: 'check', expr: 'workshop.entry_deadline < workshop.starts_at' } },
  ),
  invariant(
    'workshop',
    'INV-WORKSHOP-002',
    '確定へ入る時点で承認待ちの枠は 0 件である（確定したあとに届いた依頼は残ってよい）。例外は中止された催しだけである',
    ['workshop', 'entry'],
    {
      enforcedBy: [
        { kind: 'trigger', ref: 'check_no_requested', location: loc() },
        { kind: 'application', ref: 'assertNoRequested', location: loc() },
      ],
    },
  ),
  invariant('workshop', 'INV-WORKSHOP-003', '同じ会場で開演日時は重複しない', ['workshop'], {
    formal: { kind: 'uniqueness', keys: ['venue_id', 'starts_at'] },
  }),
];

/** 親(状態機械 2 本)。 */
function workshopAggregate(): ReturnType<typeof aggregate> {
  return aggregate('workshop', {
    entity: entitySpec('workshop', {
      label: '催し',
      fields: [
        field('id', { kind: 'uuid' }, { auto: true }),
        field('starts_at', { kind: 'datetime' }, { required: true }),
        field('state', { kind: 'state', machine: 'workshop' }),
      ],
    }),
    stateMachines: [
      machine('workshop', {
        states: ['draft', 'open', 'closed', 'called_off'],
        initial: 'draft',
        final: ['called_off'],
        stateLabels: { draft: '下書き', open: '受付中', closed: '締切', called_off: '中止' },
        stateTone: { called_off: 'negative' },
        stateSettles: { open: ['fees'] },
        settlesVocabulary: { fees: '料金' },
        events: [
          event('publish', { from: ['draft'], to: 'open', by: ['organizer', 'staff'], label: '公開する' }),
          event('cancel', {
            from: ['draft', 'open', 'closed'],
            to: 'called_off',
            by: ['organizer', 'staff'],
            guard: 'now < workshop.starts_at',
            label: '中止する',
          }),
        ],
        effects: [effect('cancel', ['notify_cancelled'])],
      }),
      machine('workshop_publication', {
        states: ['hidden', 'shown'],
        initial: 'hidden',
        stateLabels: { hidden: '未掲載', shown: '掲載中' },
        events: [event('show', { from: ['hidden'], to: 'shown', by: ['organizer'], label: '掲載する' })],
      }),
    ],
    access: accessSpec('workshop', {
      reads: [read('member', 'all'), read('system', 'all')],
      creates: [create('organizer')],
      writes: [write('organizer', ['starts_at'], 'state == draft')],
    }),
    invariants: { invariants: [...WORKSHOP_INVARIANTS], location: loc('docs/specs/domain/workshop/invariants.md') },
  });
}

/** 親を参照する子の集約を 1 つ作る(ref の欄・作る人・公理)。 */
function child(
  name: string,
  creator: string,
  invariants: readonly InvariantDef[],
): ReturnType<typeof aggregate> {
  return aggregate(name, {
    entity: entitySpec(name, {
      label: name === 'workshop_part' ? '部' : name === 'entry' ? '枠' : '当日のチェック',
      fields: [field('id', { kind: 'uuid' }, { auto: true }), field('workshop_id', { kind: 'ref', entity: 'workshop' }, { required: true })],
    }),
    access: accessSpec(name, { creates: [create(creator)] }),
    invariants: { invariants, location: loc(`docs/specs/domain/${name}/invariants.md`) },
  });
}

/** 小さな世界のドメイン仕様。 */
export function faceModel(): SpecModel {
  return specModel(
    [
      workshopAggregate(),
      child('workshop_part', 'organizer', [
        invariant('workshop_part', 'INV-PART-001', '部の開始時刻は催しの開演日時以降でなければならない', ['workshop_part', 'workshop']),
        invariant('workshop_part', 'INV-PART-002', '同一催し内で部の順番は重複しない', ['workshop_part'], {
          formal: { kind: 'uniqueness', keys: ['workshop_id', 'order_index'] },
        }),
      ]),
      child('entry', 'member', [
        invariant('entry', 'INV-ENTRY-001', '催しの定員を超えて枠は増えない', ['entry', 'workshop']),
        invariant('entry', 'INV-ENTRY-002', '枠の種別は発表か聴講者のどちらかである', ['entry']),
      ]),
      child('workshop_check', 'staff', [invariant('workshop_check', 'INV-CHECK-001', 'システム連動の項目は人が消し込めない', ['workshop_check'])]),
      aggregate('member', { entity: entitySpec('member', { label: 'メンバー', fields: [field('id', { kind: 'uuid' }, { auto: true })] }) }),
    ],
    roleSpec([
      role('anonymous'),
      role('member'),
      role('system'),
      role('organizer', 'workshop.organizer_id == actor.id', ['member'], undefined, '世話役'),
      role('staff', undefined, ['member'], 'authenticated_default', '運営スタッフ'),
    ]),
  );
}

/** 標識を持つ仕様ファイルの生テキスト(`> ` で始まる手書きの段落が標識)。 */
function signSource(docType: string, sign: string): string {
  return ['---', `doc_type: ${docType}`, '---', '', `- ${sign}`, ''].join('\n');
}

/** 小さな世界の生成コンテキスト(データの表・操作・タスク・標識つき)。 */
export function faceCtx(humanFaceChapters: number | 'all' = 1): GenerateContext {
  const tables = dataTableModel([
    dataTable('workshops', { entity: 'workshop', checks: [{ name: 'workshops_deadline', handwritten: '適用済みの migration が作った執行点' }] }),
    dataTable('workshop_parts', { entity: 'workshop_part', foreignKeys: [{ column: 'workshop_id', references: 'workshops', onDelete: 'cascade' }] }),
    dataTable('entries', { entity: 'entry', foreignKeys: [{ column: 'workshop_id', references: 'workshops', onDelete: 'cascade' }] }),
    dataTable('workshop_checks', { entity: 'workshop_check', foreignKeys: [{ column: 'workshop_id', references: 'workshops', onDelete: 'cascade' }] }),
  ]);
  const unit = (id: string): ReturnType<typeof testCase> =>
    testCase({ id, type: 'unit', specIds: ['x'], implementation: 'app/x.test.ts::case' });
  const actions = [
    actionSpec({ handles: 'workshop.publish', testCases: [unit('TC-WORKSHOP-PUBLISH-001'), testCase({ id: 'TC-WORKSHOP-PUBLISH-002', type: 'integration', specIds: ['x'], implementation: 'app/x.test.ts::case2' })] }),
    actionSpec({ handles: 'workshop.cancel', runner: { reason: '同一トランザクションの副作用を持つ' }, testCases: [unit('TC-WORKSHOP-CANCEL-001')] }),
    actionSpec({ handles: 'workshop_publication.show', testCases: [unit('TC-WORKSHOP-PUBLICATION-SHOW-001')] }),
    actionSpec({ handles: 'workshop_part.create', testCases: [unit('TC-WORKSHOP_PART-CREATE-001')] }),
    actionSpec({ handles: 'entry.create', testCases: [unit('TC-ENTRY-CREATE-001')] }),
  ];
  const usecases = [
    usecaseSpec({
      name: 'workshop_publish',
      goal: '世話役が催しを公開する',
      saves: [usecaseSave('publish', [usecaseStep('workshop.publish')])],
      accept: [usecaseAccept('inputs', '作成時に全部入力できるほうが軽い')],
      testCases: [unit('TC-USECASE-WORKSHOP_PUBLISH-001')],
    }),
    usecaseSpec({ name: 'entry_join', saves: [usecaseSave('join', [usecaseStep('entry.create')])] }),
  ];
  return {
    ...GEN_CTX,
    humanFaceChapters,
    dataTables: tables,
    actions: { actions, unhandled: [], scans: [], unscanned: [], testTagBaseline: [] },
    usecases: { available: true, usecases },
    specSources: new Map([
      ['docs/specs/domain/workshop/entity.md', signSource('entity_spec', '余剰の配分ルールは仕様の外である。')],
      ['docs/specs/domain/workshop/states.md', signSource('state_spec', '締切と確定を分けている。')],
      ['docs/specs/domain/workshop/invariants.md', signSource('invariant_spec', '執行点は 2 つある。')],
    ]),
    terms: {
      available: true,
      ledger: ledger([
        term('公理', { id: 'axiom', face: 'book', gloss: '人が意味を判定する宣言' }),
        term('集約', { id: 'aggregate', face: 'book', gloss: '守られるルールの境界' }),
        term('注釈', { id: 'tag', face: 'framework', gloss: '仕様とテストを結ぶ注釈' }),
      ]),
    },
  };
}

/**
 * 検証の警告(と、あれば基点つきの差分)を渡した生成コンテキスト。
 *
 * 範囲の中の 2 件(催しの公理のファイル = Y10 / 催しの表 = T8)・範囲の外の 1 件(枠の公理のファイル)・
 * 仕様の木の外の 1 件(場所を引けない)を持つ。
 */
export function faceCtxWithFindings(readingBase?: ReadingBase): GenerateContext {
  const warn = (id: string, file: string): ReturnType<typeof makeFinding> =>
    makeFinding(id, { severity: 'warning', message: `${id} の警告`, location: { file }, suggestion: '直す。理由は次の文で書く。' });
  return {
    ...faceCtx(),
    findings: [
      warn('Y10', 'docs/specs/domain/workshop/invariants.md'),
      warn('T8', 'docs/specs/backend/data/tables/workshops.md'),
      warn('Y10', 'docs/specs/domain/entry/invariants.md'),
      warn('W1', 'legacy/spec-tools/lib/semantics/x.ts'),
    ],
    ...(readingBase === undefined ? {} : { readingBase }),
  };
}
