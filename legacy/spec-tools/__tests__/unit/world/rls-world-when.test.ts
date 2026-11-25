/**
 * `reads[].when` の**反例の行**を宣言から決める写像の単体テスト(束 §14)。
 *
 * 対象: `lib/world/rls-world-when.ts`。
 *
 * ここで固定するのは 2 つである。
 *   1. **条件を偽にする状態を、状態機械の宣言から選べる**(選べなければ「作れない」と報告する)
 *   2. その状態で不変条件が値を要求する欄を、**的の行から埋められる**(埋められなければ報告する)
 *
 * 反例の行が無い world では、ポリシーから条件を丸ごと落としても挙動テストが緑になる ——
 * だからここが「決められなかった」を黙って空に倒さないことが、検査そのものである。
 */

import { describe, expect, it } from 'vitest';
import type { InvariantFormal, SpecModel } from '../../../lib/model/types.js';
import { whenCounterexamples, whenRowOf } from '../../../lib/world/rls-world-when.js';
import type { RlsWorldRow } from '../../../lib/world/rls-world-rows.js';
import {
  accessSpec,
  aggregate,
  entitySpec,
  field,
  invariant,
  invariantSpec,
  machine,
  readRule,
  specModel,
} from '../../helpers/model-builder-v8plus.js';

/** 保管の 2 欄と状態を持つ doc 集約(初期状態は drafting)。 */
function model(reads: readonly string[], ...formals: readonly InvariantFormal[]): SpecModel {
  return specModel({
    aggregates: [
      aggregate({
        name: 'doc',
        entity: entitySpec('doc', [
          field('title', { kind: 'string' }, { required: true }),
          field('archived_at', { kind: 'datetime' }),
          field('archived_by', { kind: 'ref', entity: 'staff' }),
          field('state', { kind: 'state', machine: 'doc' }),
        ]),
        stateMachines: [
          machine({ machine: 'doc', states: ['drafting', 'circulating', 'archived'], initial: 'drafting' }),
        ],
        invariants: invariantSpec(
          formals.map((formal, index) => invariant({ id: `INV-DOC-00${index + 1}`, formal })),
        ),
        access: accessSpec('doc', {
          reads: reads.map((when, index) => readRule(`role${index}`, { kind: 'all' }, when)),
        }),
      }),
    ],
  });
}

/** 状態と保管の 2 欄の同値(archive の INV-DOCUMENT-002 と同じ形)。 */
const SYNC: InvariantFormal = {
  kind: 'check',
  expr:
    'doc.state == archived and doc.archived_at is not null and doc.archived_by is not null' +
    ' or doc.state != archived and doc.archived_at is null and doc.archived_by is null',
};

/** 的の行(祖先に staff が届いている系統)。 */
const TARGET: RlsWorldRow = {
  key: 'role0:doc',
  table: 'docs',
  entity: 'doc',
  values: { title: 'title-1' },
  refs: { department_id: 'role0:department' },
  actor: null,
  ancestry: { doc: 'role0:doc', staff: 'role0:staff', department: 'role0:department' },
};

describe('条件を偽にする状態を宣言から選ぶ', () => {
  it('`state != {状態}` はその状態を採る', () => {
    const found = whenCounterexamples(model(['doc.state != archived'], SYNC), access(['doc.state != archived']));

    expect(found.ok).toBe(true);
    expect(found.ok === true && found.rows.map((row) => row.slot)).toEqual(['state-archived']);
  });

  it('`state in [...]` は並びに無い状態を採る', () => {
    const when = 'doc.state in [drafting, circulating]';
    const found = whenCounterexamples(model([when], SYNC), access([when]));

    expect(found.ok === true && found.rows.map((row) => row.slot)).toEqual(['state-archived']);
  });

  it('同じ状態に落ちる条件は 1 行に畳む(同じ行を 2 つ置いても確かめられることは同じ)', () => {
    const reads = ['doc.state != archived', 'doc.state in [drafting, circulating]'];
    const found = whenCounterexamples(model(reads, SYNC), access(reads));

    expect(found.ok === true && found.rows).toHaveLength(1);
    expect(found.ok === true && found.rows[0]?.blocks).toEqual(['role0', 'role1']);
  });

  it('状態で決まらない条件は「決められない」と報告する(黙って反例なしにしない)', () => {
    const when = 'doc.archived_at == now';
    const found = whenCounterexamples(model([when], SYNC), access([when]));

    expect(found.ok).toBe(false);
    expect(found.ok === false && found.reasons[0]).toContain(when);
  });

  it('どの状態でも偽にならない条件も「決められない」(恒真は絞っていない)', () => {
    const when = 'doc.state in [drafting, circulating, archived]';
    const found = whenCounterexamples(model([when], SYNC), access([when]));

    expect(found.ok).toBe(false);
  });

  it('条件が 1 つも無ければ行を置かない', () => {
    const found = whenCounterexamples(model([], SYNC), accessSpec('doc', { reads: [] }));
    expect(found.ok === true && found.rows).toEqual([]);
  });
});

describe('反例の行', () => {
  it('状態を差し替え、その状態で要る欄を的の行から埋める', () => {
    const when = 'doc.state != archived';
    const spec = model([when], SYNC);
    const found = whenCounterexamples(spec, access([when]));
    const row = found.ok === true ? found.rows[0] : undefined;
    const made = whenRowOf(TARGET, row!, { domain: spec, entity: 'doc', next: () => 7, order: new Map() });

    expect(made.ok).toBe(true);
    if (!made.ok) return;
    // 状態は差し替わり、保管の 2 欄は不変条件の要求どおり埋まる(`archived_by` は参照なので
    // 同じ系統の行を指す)。参照も境界の値も的の行から写るので、系統は変わらない。
    expect(made.row.values['state']).toBe('archived');
    expect(made.row.values['archived_at']).toBeDefined();
    expect(made.row.refs['archived_by']).toBe('role0:staff');
    expect(made.row.refs['department_id']).toBe('role0:department');
    expect(made.row.key).toBe('role0:doc#when-state-archived');
    expect(made.row.actor).toBeNull();
    // 祖先は的と同じで、自分の集約だけが自分を指す(オラクルが束縛の行を引くのに使う)。
    expect(made.row.ancestry).toEqual({
      doc: 'role0:doc#when-state-archived',
      staff: 'role0:staff',
      department: 'role0:department',
    });
  });

  it('埋める参照が系統に無ければ「置けない」と報告する', () => {
    const when = 'doc.state != archived';
    const spec = model([when], SYNC);
    const found = whenCounterexamples(spec, access([when]));
    const orphan: RlsWorldRow = { ...TARGET, ancestry: { doc: 'role0:doc' } };
    const made = whenRowOf(orphan, (found.ok === true ? found.rows[0] : undefined)!, {
      domain: spec,
      entity: 'doc',
      next: () => 7,
      order: new Map(),
    });

    expect(made.ok).toBe(false);
    expect(made.ok === false && made.unplaceable).toEqual(['archived_by']);
  });

  it('空を要求する欄は落とす(状態を戻した行に値が残らない)', () => {
    // 初期状態を偽にする条件では、反例の行が「保管でない」側になる —— そのときは
    // 保管の 2 欄が空でなければ執行点が拒否する。
    const when = 'doc.state == archived';
    const spec = model([when], SYNC);
    const found = whenCounterexamples(spec, access([when]));
    const row = found.ok === true ? found.rows[0] : undefined;
    const withValues: RlsWorldRow = {
      ...TARGET,
      values: { ...TARGET.values, archived_at: '2030-01-01T00:00:00.000Z' },
      refs: { ...TARGET.refs, archived_by: 'role0:staff' },
    };
    const made = whenRowOf(withValues, row!, { domain: spec, entity: 'doc', next: () => 7, order: new Map() });

    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.row.values['state']).toBe('drafting');
    expect(made.row.values['archived_at']).toBeUndefined();
    expect(made.row.refs['archived_by']).toBeUndefined();
  });
});

/** 読み取り規則だけを持つアクセス宣言(条件の並びから作る)。 */
function access(reads: readonly string[]) {
  return accessSpec('doc', {
    reads: reads.map((when, index) => readRule(`role${index}`, { kind: 'all' }, when)),
  });
}
