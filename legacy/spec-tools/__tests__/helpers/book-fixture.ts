/**
 * ハンドブック(render/book/*)のテスト用の共通フィクスチャ。
 *
 * ドメイン 2 集約(状態機械つきの workshop / 持たない member)+ query / screen / chrome /
 * design / action を一式そろえた GenerateContext を組み立てる。各テストは
 * この最小世界に対する出力の形(章の骨格・⚠・標識の引用・集計)を検める。
 */

import type { SpecModel } from '../../lib/model/types.js';
import type { GenerateContext } from '../../lib/gen-kit/generator.js';
import type { InvariantDef, InvariantSpec } from '../../lib/model/types.js';
import {
  accessSpec,
  aggregate,
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
import { querySpec } from './query-builder.js';
import { chromeSpec, screenSpec } from './screen-builder.js';
import { actionSpec } from './trace-builder.js';
import { colorToken, group, tokenSpec } from './design-builder.js';
import { GEN_CTX } from './generate-context.js';
import { ledger, term } from './terms-builder.js';

/** invariants.md 相当(workshop 用)。 */
function invariantSpecOf(entity: string, invariants: readonly InvariantDef[]): InvariantSpec {
  return { invariants, location: loc(`docs/specs/domain/${entity}/invariants.md`) };
}

/** DSL 外(formal 無し)の不変条件 1 件。 */
export const INFORMAL_INVARIANT: InvariantDef = {
  id: 'INV-C-002',
  statement: '受理数は定員を超えない',
  entities: ['workshop'],
  enforcedBy: [{ kind: 'application', ref: 'acceptGuard', location: loc() }],
  location: loc('docs/specs/domain/workshop/invariants.md'),
};

/** ドメイン仕様(workshop = 状態機械つき / member = エンティティのみ)。 */
export function bookModel(): SpecModel {
  const workshop = aggregate('workshop', {
    entity: entitySpec('workshop', {
      fields: [
        field('id', { kind: 'uuid' }, { auto: true, description: '催しID' }),
        field('organizer_id', { kind: 'ref', entity: 'member' }, { required: true, description: '世話役' }),
        field('title', { kind: 'string' }, { required: true, description: '催しタイトル' }),
        field('starts_at', { kind: 'datetime' }, { required: true, description: '開演日時' }),
        field('state', { kind: 'state', machine: 'workshop' }, { description: '催しの状態' }),
      ],
    }),
    stateMachines: [
      machine('workshop', {
        states: ['draft', 'accepting'],
        initial: 'draft',
        stateLabels: { draft: '下書き', accepting: '受付中' },
        events: [
          event('publish', { from: ['draft'], to: 'accepting', by: ['organizer'], label: '公開する' }),
          event('close', {
            from: ['accepting'],
            to: 'draft',
            by: ['system'],
            guard: 'now >= workshop.starts_at',
            label: '締める',
          }),
        ],
      }),
    ],
    access: accessSpec('workshop', {
      reads: [read('member', 'all'), read('anonymous', 'none'), read('system', 'all')],
      writes: [write('organizer', ['title'], 'state == draft')],
    }),
    invariants: invariantSpecOf('workshop', [
      {
        id: 'INV-C-001',
        statement: '開演日時は必須',
        entities: ['workshop'],
        formal: { kind: 'check', expr: 'workshop.starts_at > now' },
        enforcedBy: [{ kind: 'db_constraint', ref: 'chk', location: loc() }],
        location: loc('docs/specs/domain/workshop/invariants.md'),
      },
      INFORMAL_INVARIANT,
    ]),
  });
  const member = aggregate('member', {
    entity: entitySpec('member', {
      fields: [field('id', { kind: 'uuid' }, { auto: true, description: 'メンバーID' })],
    }),
  });
  return specModel(
    [workshop, member],
    roleSpec([
      role('member'),
      role('anonymous'),
      role('system'),
      role('organizer', 'workshop.organizer_id == actor.id', ['member']),
    ]),
  );
}

/** query / screen / chrome / design / action / 標識ソースまでそろえた文脈。 */
export function bookCtx(): GenerateContext {
  const queries = [
    querySpec({ name: 'workshop_list', source: 'workshop', for: ['member'], scopeUsed: 'all' }),
    querySpec({
      name: 'workshop_detail',
      source: 'workshop',
      for: ['member'],
      scopeUsed: 'all',
      returns: 'one',
      includes: [{ entity: 'member', scopeUsed: 'all' }],
    }),
  ];
  const screens = [
    screenSpec({
      name: 'workshop_detail',
      route: '/workshops/:id',
      group: 'workshop',
      chrome: 'chrome-main',
      requiresAuth: true,
      subject: 'workshop',
      precondition: 'state == accepting',
      onFail: 'screen-workshop-list',
      reads: ['query-workshop-detail'],
      actions: ['workshop.publish'],
      overlays: [{ id: 'confirm', actions: ['workshop.update'] }],
      navigations: [{ on: 'workshop.publish.success', to: 'screen-workshop-detail' }],
    }),
    screenSpec({ name: 'workshop_list', route: '/workshops', group: 'workshop', entryPoint: true }),
  ];
  const specSources = new Map<string, string>([
    [
      'docs/specs/domain/workshop/access.md',
      ['---', 'doc_type: access_spec', '---', '', '# 見出し', '', '下書きも意図的に全公開とする。', ''].join('\n'),
    ],
    [
      'docs/specs/backend/actions/workshop/publish.md',
      ['---', 'doc_type: action_spec', '---', '', '- 公開の取り消しは用意しない。', ''].join('\n'),
    ],
  ]);
  return {
    ...GEN_CTX,
    queries: { available: true, queries },
    screens: {
      available: true,
      screens,
      chromes: [chromeSpec({ name: 'main', navigations: [{ on: 'home_link', to: 'screen-workshop-list' }] })],
      unexposed: [],
      unreachableStates: [],
      unseenStates: [],
    },
    design: {
      available: true,
      spec: tokenSpec({
        groups: [group('color', [colorToken('color-ink', '#111111'), colorToken('color-canvas', '#ffffff')])],
        contrast: [{ fg: 'color-ink', bg: 'color-canvas', min: 4.5 }],
      }),
    },
    actions: {
      actions: [actionSpec({ handles: 'workshop.publish' })],
      unhandled: [],
      scans: [],
      unscanned: [],
      testTagBaseline: [],
    },
    specSources,
    terms: { available: true, ledger: BOOK_LEDGER },
  };
}

/**
 * 表紙の「この本に出てくる言葉」を確かめるための小さな台帳。
 * `face: book` の 3 行(例の差し込み先 2 つを含む)と、表に出てはいけない `face: framework` の 1 行。
 */
export const BOOK_LEDGER = ledger([
  term('集約', { id: 'aggregate', face: 'book', gloss: '守られるルールの境界を 1 単位にしたもの' }),
  term('状態機械', { id: 'state_machine', face: 'book', gloss: 'その集約のライフサイクル{例}。矢印に無い移動はできない' }),
  term('ロール', { id: 'role', face: 'book', gloss: '誰が。文脈依存ロール{例}がある' }),
  term('注釈', { id: 'tag', face: 'framework', gloss: '仕様とテストを結ぶ注釈' }),
]);
