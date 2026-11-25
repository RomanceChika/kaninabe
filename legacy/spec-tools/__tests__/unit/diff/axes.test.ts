import { describe, expect, it } from 'vitest';
import { semanticDiff } from '../../../lib/diff/collect.js';
import type { DiffAxis, SemanticChange, SideSnapshot } from '../../../lib/diff/types.js';
import {
  aggregateResults,
  apiFile,
  apiFileWithInternal,
  apiFileWithRpcs,
  GENERATED,
  implicationsFile,
  labelsFile,
  notificationsFile,
  plansFile,
  RESULTS,
  rlsFile,
  rolesFile,
  rulesFile,
  saveResults,
  screensFile,
  snapshot,
  transitionsFile,
} from './fixtures.js';
import { TEST_ROOTS } from '../../helpers/product-roots.js';

/** その軸の行だけを文で取り出す。 */
function textsOf(base: SideSnapshot, head: SideSnapshot, axis: DiffAxis): string[] {
  return semanticDiff(base, head, TEST_ROOTS)
    .changes.filter((change: SemanticChange) => change.axis === axis)
    .map((change: SemanticChange) => change.text);
}

/** 表示名の生成物(どの軸の fixture にも添える)。 */
const LABELS = {
  [`${GENERATED}/unit.labels.ts`]: labelsFile('unit', { idle: '待機中' }, { open: 'ひらく', close: 'とじる' }),
  [`${GENERATED}/roles.ts`]: rolesFile({ chief: '責任者', guest: '来訪者', helper: '助っ人' }),
};

/** 単発の操作の結果表 1 本(拒否の番号だけを差し替える)。 */
function results(refusal: number, state = 'idle'): string {
  return aggregateResults({
    aggregate: 'unit',
    ops: ['unit.open'],
    operations: [
      {
        op: 'unit.open',
        refusals: [{ reason: 'role_forbidden', allowedRoles: ['chief'] }],
        cases: [[state, 'chief', 'from_session', null, [], refusal]],
      },
    ],
  });
}

describe('軸 1: 権限(結果表の case)', () => {
  it('落ちていた組み合わせが通るようになると 🔓 になる(名詞は仕様の label)', () => {
    const texts = textsOf(
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: results(1) }),
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: results(0) }),
      'permission',
    );
    expect(texts).toEqual([
      '🔓 ひらく(`unit.open`) を 責任者(`chief`)(ロール配列 `from_session`)が 待機中(`idle`) でできるようになった(❌ role_forbidden chief → ✅)',
    ]);
  });

  it('通っていた組み合わせが落ちるようになると 🔒 になる', () => {
    const texts = textsOf(
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: results(0) }),
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: results(1) }),
      'permission',
    );
    expect(texts[0]).toContain('🔒');
    expect(texts[0]).toContain('できなくなった(✅ → ❌ role_forbidden chief)');
  });

  it('状態だけが違う変化は 1 行に畳み、状態を並べる', () => {
    const many = (refusal: number): string =>
      aggregateResults({
        aggregate: 'unit',
        ops: ['unit.open'],
        operations: [
          {
            op: 'unit.open',
            refusals: [{ reason: 'role_forbidden', allowedRoles: ['chief'] }],
            cases: [
              ['idle', 'chief', 'from_session', null, [], refusal],
              ['busy', 'chief', 'from_session', null, [], refusal],
            ],
          },
        ],
      });
    const texts = textsOf(
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: many(1) }),
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: many(0) }),
      'permission',
    );
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('`busy` / 待機中(`idle`) で');
  });

  it('**列の並びは `caseFields` の名前で読む**(位置が変わっても黙らない)', () => {
    const shuffled = (refusal: number): string =>
      JSON.stringify({
        aggregate: 'unit',
        ops: ['unit.open'],
        problems: [],
        caseFields: ['actor', 'state', 'array', 'field', 'axis', 'refusal'],
        actors: [{ key: 'chief', role: 'chief', basis: 'binding', arrays: [] }],
        operations: [
          {
            op: 'unit.open',
            refusals: [{ reason: 'role_forbidden', allowedRoles: ['chief'] }],
            cases: [['chief', 'idle', 'from_session', null, [], refusal]],
          },
        ],
      });
    const texts = textsOf(
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: shuffled(1) }),
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: shuffled(0) }),
      'permission',
    );
    expect(texts[0]).toContain('を 責任者(`chief`)');
    expect(texts[0]).toContain('待機中(`idle`) で');
  });

  it('組み合わせの出入りは「で という…」にならない(助詞が宙に浮かない)', () => {
    const one = aggregateResults({
      aggregate: 'unit',
      ops: ['unit.open'],
      operations: [{ op: 'unit.open', refusals: [], cases: [['idle', 'chief', 'from_session', null, [], 0]] }],
    });
    const two = aggregateResults({
      aggregate: 'unit',
      ops: ['unit.open'],
      operations: [
        {
          op: 'unit.open',
          refusals: [],
          cases: [
            ['idle', 'chief', 'from_session', null, [], 0],
            ['busy', 'chief', 'from_session', null, [], 0],
          ],
        },
      ],
    });
    const texts = textsOf(
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: one }),
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: two }),
      'permission',
    );
    expect(texts).toEqual([
      '➕ ひらく(`unit.open`) を 責任者(`chief`)(ロール配列 `from_session`)が `busy` で実行する組み合わせが結果表に増えた(結末 ✅)',
    ]);
    expect(texts[0]).not.toContain('で という');
  });

  it('基点に無い生成物は操作 1 本 = 1 行の ➕ として出す', () => {
    const texts = textsOf(
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: null }),
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: results(0) }),
      'permission',
    );
    expect(texts).toEqual(['➕ ひらく(`unit.open`) の結末(1 通り)が結果表に増えた']);
  });

  it('比較先に無い生成物は ➖ として出す', () => {
    const texts = textsOf(
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: results(0) }),
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: null }),
      'permission',
    );
    expect(texts).toEqual(['➖ ひらく(`unit.open`) の結末(1 通り)が結果表から消えた']);
  });

  it('**実行者が 1 人増えたら 1 行に畳む**(✅ だけ内訳を残し、❌ は数だけ)', () => {
    const world = (actors: readonly { key: string; role: string }[]): string =>
      aggregateResults({
        aggregate: 'unit',
        ops: ['unit.open', 'unit.close'],
        actors,
        operations: ['unit.open', 'unit.close'].map((op) => ({
          op,
          refusals: [{ reason: 'role_forbidden', allowedRoles: ['chief'] }],
          cases: actors.flatMap((actor) =>
            ['idle', 'busy'].map((state) => [state, actor.key, 'from_session', null, [], actor.key === 'chief' ? 0 : 1]),
          ),
        })),
      });
    const base = snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: world([{ key: 'chief', role: 'chief' }]) });
    const head = snapshot({
      ...LABELS,
      [`${RESULTS}/unit.json`]: world([
        { key: 'chief', role: 'chief' },
        { key: 'helper', role: 'helper' },
      ]),
    });
    const texts = textsOf(base, head, 'permission');
    expect(texts).toEqual(['➕ 実行者 助っ人(`helper`) が結果表に増えた(操作 2 本・✅ 0 件・❌ 4 件(内訳は省く))']);
  });

  it('保存点の結果表も同じ軸で見る(落ちた手順まで中身に入る)', () => {
    const save = (blocked: number | null): string =>
      saveResults({
        usecase: 'flow',
        key: 'flow.save',
        steps: [{ op: 'unit.open', label: 'ひらく' }],
        refusals: [{ reason: 'role_forbidden', allowedRoles: ['chief'] }],
        cases: [['chief', 'from_session', 1, 'full', [], blocked, [blocked === null ? 0 : 1]]],
      });
    const texts = textsOf(
      snapshot({ ...LABELS, [`${RESULTS}/flow.json`]: save(0) }),
      snapshot({ ...LABELS, [`${RESULTS}/flow.json`]: save(null) }),
      'permission',
    );
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('🔓');
    expect(texts[0]).toContain('手順 1 `unit.open` で停止');
  });
});

describe('軸 1 の第 2 の元: 規則の表(結果表が答えていない操作)', () => {
  /** 結果表が world を作れない集約(`operations: []`)。 */
  const blindResults = aggregateResults({
    aggregate: 'unit',
    ops: ['unit.update'],
    problems: ['unit の world を宣言から作れません'],
    operations: [],
  });

  const writes = (roles: readonly string[]): Record<string, string> => ({
    [`${GENERATED}/unit.writes.ts`]: rulesFile(
      'unit',
      'Write',
      roles.map((role) => ({ by: role, fields: ['title'], guardSource: 'unit.state == idle' })),
    ),
  });

  it('**`by` にロールが 1 つ増えたら 🔓 が出る**(結果表が黙っていても)', () => {
    const texts = textsOf(
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: blindResults, ...writes(['chief']) }),
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: blindResults, ...writes(['chief', 'guest']) }),
      'permission',
    );
    expect(texts).toEqual([
      '🔓 `unit.update` を 来訪者(`guest`) ができるようになった(宣言 unit.state == idle / title)',
    ]);
  });

  it('`by` からロールが消えたら 🔒 が出る', () => {
    const texts = textsOf(
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: blindResults, ...writes(['chief', 'guest']) }),
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: blindResults, ...writes(['chief']) }),
      'permission',
    );
    expect(texts[0]).toContain('🔒');
    expect(texts[0]).toContain('来訪者(`guest`) ができなくなった');
  });

  it('結果表が答えていない操作は、出力に運ばれる理由になる', () => {
    const outcome = semanticDiff(snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: blindResults, ...writes(['chief']) }), snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: blindResults, ...writes(['chief']) }), TEST_ROOTS);
    expect(outcome.changes).toEqual([]);
    const undecided = outcome.problems.filter((problem) => problem.kind === 'unanswered');
    expect(undecided.length).toBeGreaterThan(0);
    expect(undecided[0]?.reason).toContain('unit.update');
  });

  it('**結果表が答えている操作は第 2 の元で二重に数えない**', () => {
    const decided = aggregateResults({
      aggregate: 'unit',
      ops: ['unit.update'],
      operations: [{ op: 'unit.update', refusals: [], cases: [['idle', 'chief', 'from_session', 'title', [], 0]] }],
    });
    const texts = textsOf(
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: decided, ...writes(['chief']) }),
      snapshot({ ...LABELS, [`${RESULTS}/unit.json`]: decided, ...writes(['chief', 'guest']) }),
      'permission',
    );
    expect(texts).toEqual([]);
  });

  it('遷移の by も同じ元で見る(端と条件は宣言の中身に入る)', () => {
    const machine = (roles: readonly string[]): Record<string, string> => ({
      [`${GENERATED}/unit.transitions.ts`]: transitionsFile('unit', [
        { event: 'open', from: ['idle'], to: 'busy', by: roles, effects: [] },
      ]),
    });
    const texts = textsOf(
      snapshot({ ...LABELS, ...machine(['chief']) }),
      snapshot({ ...LABELS, ...machine(['chief', 'guest']) }),
      'permission',
    );
    expect(texts).toEqual(['🔓 ひらく(`unit.open`) を 来訪者(`guest`) ができるようになった(宣言 idle → busy)']);
  });
});

describe('軸 2: 操作の増減', () => {
  const plans = (ops: readonly string[]): Record<string, string> => ({
    [`${GENERATED}/operation-plans.ts`]: plansFile('operationPlans', ops),
  });

  it('増えた操作を ➕ で出す', () => {
    expect(
      textsOf(
        snapshot({ ...LABELS, ...plans(['unit.open']) }),
        snapshot({ ...LABELS, ...plans(['unit.open', 'unit.close']) }),
        'operations',
      ),
    ).toEqual(['➕ 操作 とじる(`unit.close`)が増えた']);
  });

  it('消えた操作を ➖ で出す', () => {
    expect(
      textsOf(
        snapshot({ ...LABELS, ...plans(['unit.open', 'unit.close']) }),
        snapshot({ ...LABELS, ...plans(['unit.open']) }),
        'operations',
      ),
    ).toEqual(['➖ 操作 とじる(`unit.close`)が消えた']);
  });

  it('改名は「消えた + 増えた」として出す(改名の推定はしない)', () => {
    expect(
      textsOf(
        snapshot({ ...LABELS, ...plans(['unit.open']) }),
        snapshot({ ...LABELS, ...plans(['unit.begin']) }),
        'operations',
      ),
    ).toEqual(['➕ 操作 `unit.begin`が増えた', '➖ 操作 ひらく(`unit.open`)が消えた']);
  });
});

describe('軸 3: 見える行', () => {
  const rls = (
    policies: Record<string, readonly string[]>,
    migrations: Record<string, string> = {},
    conditions: Record<string, string> = {},
  ): Record<string, string> => ({
    [`${GENERATED}/rls-expectations.ts`]: rlsFile(policies, migrations, conditions),
  });

  it('ポリシーが増えると 🔓 になる', () => {
    expect(
      textsOf(
        snapshot({ ...LABELS, ...rls({ units: [] }) }),
        snapshot({ ...LABELS, ...rls({ units: ['units_select_guest_all'] }) }),
        'rows',
      ),
    ).toEqual(['🔓 `units` の行を 来訪者(`guest`) が読めるようになった(範囲 all)']);
  });

  it('ポリシーが消えると 🔒 になる', () => {
    expect(
      textsOf(
        snapshot({ ...LABELS, ...rls({ units: ['units_select_guest_all'] }) }),
        snapshot({ ...LABELS, ...rls({ units: [] }) }),
        'rows',
      ),
    ).toEqual(['🔒 `units` の行を 来訪者(`guest`) が読めなくなった(範囲 all)']);
  });

  it('条件の在処が入れ替わると 🔁 になる(名前では表せない差)', () => {
    const texts = textsOf(
      snapshot({ ...LABELS, ...rls({ units: [] }, { units: '001_units.sql' }) }),
      snapshot({ ...LABELS, ...rls({ units: [] }, { units: '002_units.sql' }) }),
      'rows',
    );
    expect(texts).toEqual(['🔁 `units` を見せる条件の在処が入れ替わった(001_units.sql → 002_units.sql)']);
  });

  it('行の状態による絞りが足されると 🔒 になる(束 §14)', () => {
    const policies = { units: ['units_select_guest_all'] };
    const texts = textsOf(
      snapshot({ ...LABELS, ...rls(policies) }),
      snapshot({ ...LABELS, ...rls(policies, {}, { units_select_guest_all: 'unit.state != closed' }) }),
      'rows',
    );
    expect(texts).toEqual([
      '🔒 `units_select_guest_all` は行の状態で見え方が絞られた(unit.state != closed)',
    ]);
  });

  it('行の状態による絞りが外れると 🔓 になる(可視性が広がる)', () => {
    const policies = { units: ['units_select_guest_all'] };
    const texts = textsOf(
      snapshot({ ...LABELS, ...rls(policies, {}, { units_select_guest_all: 'unit.state != closed' }) }),
      snapshot({ ...LABELS, ...rls(policies) }),
      'rows',
    );
    expect(texts).toEqual([
      '🔓 `units_select_guest_all` の行の状態による絞りが外れた(unit.state != closed)',
    ]);
  });

  it('絞りの中身が入れ替わると 🔁 になる(広がったとも狭まったとも言えない)', () => {
    const policies = { units: ['units_select_guest_all'] };
    const texts = textsOf(
      snapshot({ ...LABELS, ...rls(policies, {}, { units_select_guest_all: 'unit.state != closed' }) }),
      snapshot({ ...LABELS, ...rls(policies, {}, { units_select_guest_all: 'unit.state != archived' }) }),
      'rows',
    );
    expect(texts).toEqual([
      '🔁 `units_select_guest_all` の行の状態による絞りが変わった(unit.state != closed → unit.state != archived)',
    ]);
  });
});

describe('軸 4: 公開される欄', () => {
  const api = (views: Record<string, unknown>): Record<string, string> => ({
    [`${GENERATED}/api-expectations.ts`]: apiFile(views),
  });

  it('列が載ると 🔓 になる', () => {
    expect(
      textsOf(
        snapshot({ ...LABELS, ...api({ units: { columns: ['id'], masked: [] } }) }),
        snapshot({ ...LABELS, ...api({ units: { columns: ['id', 'memo'], masked: [] } }) }),
        'columns',
      ),
    ).toEqual(['🔓 `units.memo` が外に出る面に載った(新しく公開される欄)']);
  });

  it('隠しの宣言が増えると 🔒(隠し列になった)になる', () => {
    expect(
      textsOf(
        snapshot({ ...LABELS, ...api({ units: { columns: ['memo'], masked: [] } }) }),
        snapshot({
          ...LABELS,
          ...api({ units: { columns: ['memo'], masked: [{ column: 'memo', visibleTo: ['chief'] }] } }),
        }),
        'columns',
      ),
    ).toEqual(['🔒 `units.memo` が隠し列になった(解けるのは chief だけ)']);
  });

  it('隠しが外れると 🔓 になる(**解ける相手が減ったとは読めない文にする**)', () => {
    const texts = textsOf(
      snapshot({
        ...LABELS,
        ...api({ units: { columns: ['memo'], masked: [{ column: 'memo', visibleTo: ['chief'] }] } }),
      }),
      snapshot({ ...LABELS, ...api({ units: { columns: ['memo'], masked: [] } }) }),
      'columns',
    );
    expect(texts).toEqual([
      '🔓 `units.memo` の隠しが外れ、その行を読める相手すべてに見えるようになった(それまで解けたのは chief)',
    ]);
  });

  it('見える相手が増えると 🔓、減ると 🔒 になる', () => {
    const view = (roles: readonly string[]): Record<string, string> =>
      api({ units: { columns: ['memo'], masked: [{ column: 'memo', visibleTo: roles }] } });
    expect(
      textsOf(snapshot({ ...LABELS, ...view(['chief']) }), snapshot({ ...LABELS, ...view(['chief', 'guest']) }), 'columns')[0],
    ).toContain('🔓');
    expect(
      textsOf(snapshot({ ...LABELS, ...view(['chief', 'guest']) }), snapshot({ ...LABELS, ...view(['chief']) }), 'columns')[0],
    ).toContain('🔒');
  });

  it('surface のロールに何も与えないビュー(内部テーブルの面)の列は数えない', () => {
    // 手書きだった `api.jobs` を生成物へ差し替えた回(2026-09-23)の形 —— 期待表の
    // `apiViews` に載るようになっただけで、surface のロールには `select` が 1 つも無いまま
    // である。数えると「外に出る surface に載った」が事実でなくなる。
    const internal = (views: Record<string, unknown>): Record<string, string> => ({
      [`${GENERATED}/api-expectations.ts`]: apiFileWithInternal(views, ['queue']),
    });
    expect(
      textsOf(
        snapshot({ ...LABELS, ...internal({}) }),
        snapshot({ ...LABELS, ...internal({ queue: { columns: ['id', 'payload'], masked: [] } }) }),
        'columns',
      ),
    ).toEqual([]);
    // 同じ列が**surface に出る側**のビューに載れば、そこは数える(内部かどうかだけが違う)。
    expect(
      textsOf(
        snapshot({ ...LABELS, ...internal({}) }),
        snapshot({ ...LABELS, ...internal({ units: { columns: ['id'], masked: [] } }) }),
        'columns',
      ),
    ).toEqual(['🔓 `units.id` が外に出る面に載った(新しく公開される欄)']);
  });

  it('外から呼べる RPC が増えると 🔓 になる', () => {
    const withRpcs = (rpcs: readonly string[]): Record<string, string> => ({
      [`${GENERATED}/api-expectations.ts`]: apiFileWithRpcs({}, rpcs),
    });
    expect(textsOf(snapshot({ ...LABELS, ...withRpcs([]) }), snapshot({ ...LABELS, ...withRpcs(['open_unit']) }), 'columns')).toEqual(
      ['🔓 RPC `open_unit` が外から呼べるようになった'],
    );
  });
});

describe('軸 5: 通知', () => {
  const decl = (audience: string, recipient: Record<string, unknown>): Record<string, unknown> => ({
    id: 'notice_opened',
    medium: 'chat',
    audience,
    mention: 'none',
    trigger: 'auto',
    summary: '開いたことを知らせる',
    recipient,
  });
  const catalog = (decls: readonly Record<string, unknown>[]): Record<string, string> => ({
    [`${GENERATED}/notifications.ts`]: notificationsFile(decls),
  });
  const effects = (list: readonly string[]): Record<string, string> => ({
    [`${GENERATED}/unit.transitions.ts`]: transitionsFile('unit', [
      { event: 'open', from: ['idle'], to: 'busy', by: ['chief'], effects: list },
    ]),
  });
  /** 助っ人は必ず来訪者である = 来訪者のほうが広い集合。 */
  const ROLES = {
    [`${GENERATED}/roles.ts`]: implicationsFile(
      { chief: '責任者', guest: '来訪者', helper: '助っ人' },
      { helper: ['guest'] },
    ),
  };
  const toChief = decl('chief_box', { kind: 'role', role: 'chief' });

  it('通知が増える・消える', () => {
    expect(textsOf(snapshot({ ...LABELS, ...catalog([]) }), snapshot({ ...LABELS, ...catalog([toChief]) }), 'notifications')).toEqual([
      '➕ 通知 開いたことを知らせる(`notice_opened`)が増えた',
    ]);
    expect(textsOf(snapshot({ ...LABELS, ...catalog([toChief]) }), snapshot({ ...LABELS, ...catalog([]) }), 'notifications')).toEqual([
      '➖ 通知 開いたことを知らせる(`notice_opened`)が消えた',
    ]);
  });

  it('**宛先種別が広がると 🔓**(本人 < ロール < チャンネル)', () => {
    const texts = textsOf(
      snapshot({ ...LABELS, ...ROLES, ...catalog([decl('own_box', { kind: 'self', subjectKey: 'owner' })]) }),
      snapshot({ ...LABELS, ...ROLES, ...catalog([decl('open_box', { kind: 'channel' })]) }),
      'notifications',
    );
    expect(texts.every((text) => text.startsWith('🔓'))).toBe(true);
    expect(texts.some((text) => text.includes('宛先が広がった'))).toBe(true);
  });

  it('同じロール宛でも、含意から広い側への変化は 🔓・狭い側は 🔒', () => {
    const narrow = catalog([decl('helper_box', { kind: 'role', role: 'helper' })]);
    const wide = catalog([decl('guest_box', { kind: 'role', role: 'guest' })]);
    const widened = textsOf(snapshot({ ...LABELS, ...ROLES, ...narrow }), snapshot({ ...LABELS, ...ROLES, ...wide }), 'notifications');
    const narrowed = textsOf(snapshot({ ...LABELS, ...ROLES, ...wide }), snapshot({ ...LABELS, ...ROLES, ...narrow }), 'notifications');
    expect(widened.every((text) => text.startsWith('🔓'))).toBe(true);
    expect(narrowed.every((text) => text.startsWith('🔒'))).toBe(true);
  });

  it('広さを決められない入れ替わりは 🔁 のまま', () => {
    const left = catalog([decl('chief_box', { kind: 'role', role: 'chief' })]);
    const right = catalog([decl('guest_box', { kind: 'role', role: 'guest' })]);
    const texts = textsOf(snapshot({ ...LABELS, ...ROLES, ...left }), snapshot({ ...LABELS, ...ROLES, ...right }), 'notifications');
    expect(texts.every((text) => text.startsWith('🔁'))).toBe(true);
  });

  it('遷移が通知を飛ばすようになる・飛ばさなくなる', () => {
    const base = snapshot({ ...LABELS, ...catalog([toChief]), ...effects([]) });
    const head = snapshot({ ...LABELS, ...catalog([toChief]), ...effects(['notice_opened']) });
    expect(textsOf(base, head, 'notifications')).toEqual([
      '➕ 遷移 ひらく(`unit.open`)が通知 `notice_opened` を飛ばすようになった',
    ]);
    expect(textsOf(head, base, 'notifications')).toEqual([
      '➖ 遷移 ひらく(`unit.open`)が通知 `notice_opened` を飛ばさなくなった',
    ]);
  });

  it('通知でない効果には反応しない(カタログが母集合)', () => {
    const base = snapshot({ ...LABELS, ...catalog([toChief]), ...effects([]) });
    const head = snapshot({ ...LABELS, ...catalog([toChief]), ...effects(['recalculate_totals']) });
    expect(textsOf(base, head, 'notifications')).toEqual([]);
  });
});

describe('軸 6: 画面', () => {
  const route = (extra: Record<string, unknown>): Record<string, unknown> => ({
    unit_admin: { id: 'screen-unit-admin', name: 'unit_admin', actions: [], navigations: [], ...extra },
  });
  const screens = (extra: Record<string, unknown>): Record<string, string> => ({
    [`${GENERATED}/screens.ts`]: screensFile(route(extra)),
  });

  it('画面から操作を起こせるようになる・なくなる', () => {
    const base = snapshot({ ...LABELS, ...screens({}) });
    const head = snapshot({ ...LABELS, ...screens({ actions: ['unit.open'] }) });
    expect(textsOf(base, head, 'screens')).toEqual([
      '➕ 画面 `screen-unit-admin` から操作 ひらく(`unit.open`)を起こせるようになった',
    ]);
    expect(textsOf(head, base, 'screens')).toEqual([
      '➖ 画面 `screen-unit-admin` から操作 ひらく(`unit.open`)を起こせなくなった',
    ]);
  });

  it('出ていける先の出入りを出す', () => {
    const base = snapshot({ ...LABELS, ...screens({}) });
    const head = snapshot({ ...LABELS, ...screens({ navigations: [{ on: 'back_link', to: 'screen-unit-list' }] }) });
    expect(textsOf(base, head, 'screens')).toEqual([
      '➕ 画面 `screen-unit-admin` から `screen-unit-list` へ出られるようになった(きっかけ `back_link`)',
    ]);
  });

  it('**サインインの関門が外れると 🔓**・付くと 🔒', () => {
    const gated = snapshot({ ...LABELS, ...screens({ requiresAuth: true }) });
    const open = snapshot({ ...LABELS, ...screens({ requiresAuth: false }) });
    expect(textsOf(gated, open, 'screens')).toEqual(['🔓 画面 `screen-unit-admin` がサインインなしで開くようになった']);
    expect(textsOf(open, gated, 'screens')).toEqual(['🔒 画面 `screen-unit-admin` にサインインの関門が付いた']);
  });

  it('見るロールが増えると 🔓・絞りが付くと 🔒', () => {
    const one = snapshot({ ...LABELS, ...screens({ forRoles: ['chief'] }) });
    const two = snapshot({ ...LABELS, ...screens({ forRoles: ['chief', 'guest'] }) });
    const any = snapshot({ ...LABELS, ...screens({ forRoles: [] }) });
    expect(textsOf(one, two, 'screens')).toEqual(['🔓 画面 `screen-unit-admin` を 来訪者(`guest`) が開けるようになった']);
    expect(textsOf(any, one, 'screens')[0]).toContain('🔒');
    expect(textsOf(any, one, 'screens')[0]).toContain('に絞られた');
    expect(textsOf(one, any, 'screens')[0]).toContain('🔓');
    expect(textsOf(one, any, 'screens')[0]).toContain('絞りが外れた');
  });

  it('新しい画面の関門は「狭まった」にならない(両版に居る画面だけを見る)', () => {
    const base = snapshot({ [`${GENERATED}/screens.ts`]: screensFile({}) });
    const head = snapshot({ ...LABELS, ...screens({ requiresAuth: true, forRoles: ['chief'] }) });
    expect(textsOf(base, head, 'screens')).toEqual([]);
  });
});
