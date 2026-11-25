/**
 * 条件を課すトリガの本文の生成(`ddl-check-triggers.ts`)のユニットテスト。
 *
 * 固定するのは 7 つである:
 *   - 普通のトリガは `new` の欄を見て `if not (…) then raise` になる
 *   - 遅延(コミット時評価)のトリガは**いまの行を読み直す**(`exists (select 1 from … )`)
 *   - `raise` の文面は **`using message`** で渡す(`statement` に `%` が入っても書式として
 *     解釈されない)。トリガ名 + 不変条件 ID + statement が載る(制約名 → 不変条件の写像が拾う)
 *   - `formal` を持たない不変条件・context で相手に届かない別の集約の式は**反映されない**(理由を報告する。
 *     届く 2 つの集約の一致は `ddl-cross-check-body.test.ts` が固定する)
 *   - `fires` は表名も注記も落ちて、列の名指し(`of …`)だけが残る
 *   - **`delete` を含む `fires` では出さない**(BEFORE DELETE で `NEW` が空になり、行を返す形が
 *     その削除を取り消す)
 *   - **`deferred: true` で timing が `after` でない宣言では出さない**(Postgres が拒否する)
 */

import { describe, expect, it } from 'vitest';
import { checkTriggerOf, checkTriggersIn } from '../../../lib/sql/ddl-check-triggers.js';
import type { DataTableSpec, DataTriggerDecl } from '../../../lib/model/data/types.js';
import type { SpecModel } from '../../../lib/model/types.js';
import { aggregate, entitySpec, field, roleSpec, specModel } from '../../helpers/model-builder.js';
import { invariant, invariantSpec } from '../../helpers/model-builder-v8plus.js';
import { dataTable } from '../../helpers/data-builder.js';

/** 題材: 消し込みシート(自表の 2 列)と、別の集約(催し)。 */
function domain(
  formal: { readonly kind: 'check'; readonly expr: string } | undefined,
  statement = 'システム連動の項目は人が手で消し込めない',
): SpecModel {
  return specModel(
    [
      aggregate('workshop', {
        entity: entitySpec('workshop', {
          fields: [field('id', { kind: 'uuid' }, { auto: true }), field('open', { kind: 'boolean' })],
        }),
      }),
      aggregate('sheet', {
        entity: entitySpec('sheet', {
          fields: [
            field('id', { kind: 'uuid' }, { auto: true }),
            field('checked', { kind: 'boolean' }, { required: true }),
            field('linked_event', { kind: 'string' }),
          ],
        }),
        invariants: invariantSpec([
          invariant({
            id: 'INV-SHEET-001',
            entities: ['sheet'],
            statement,
            ...(formal === undefined ? {} : { formal }),
          }),
        ]),
      }),
    ],
    roleSpec(['anonymous', 'member', 'system']),
  );
}

/** 条件を課すトリガ 1 本。 */
function trigger(init: {
  readonly fires?: string;
  readonly deferred?: boolean;
  readonly invariant?: string;
  readonly supplies?: readonly string[];
}): DataTriggerDecl {
  return {
    name: 'check_sheet_manual',
    functionName: 'check_sheet_manual',
    fires: init.fires ?? 'before insert or update of checked, linked_event on sheets',
    deferred: init.deferred ?? false,
    supplies: [...(init.supplies ?? [])],
    params: {},
    ...(init.invariant === undefined ? {} : { invariant: init.invariant }),
  };
}

/** 消し込みシートの表(トリガ 1 本つき)。 */
function table(decl: DataTriggerDecl): DataTableSpec {
  return dataTable('sheets', { entity: 'sheet', triggers: [decl] });
}

/** 自表の 2 列だけを見る式。 */
const SELF = { kind: 'check', expr: 'sheet.checked == false or sheet.linked_event is null' } as const;

describe('条件を課すトリガの本文', () => {
  it('普通のトリガは new の欄を見て if not (…) then raise になる', () => {
    const decl = trigger({ invariant: 'INV-SHEET-001' });
    const built = checkTriggerOf(decl, table(decl), domain(SELF));

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.trigger.function.body).toEqual([
      'if not (COALESCE(((new.checked = false) OR (new.linked_event IS NULL)), false)) then',
      '    raise exception using',
      "        message = 'check_sheet_manual: INV-SHEET-001: システム連動の項目は人が手で消し込めない',",
      "        errcode = 'check_violation',",
      "        constraint = 'check_sheet_manual';",
      'end if;',
      'return new;',
    ]);
    expect(built.trigger.deferred).toBeUndefined();
    expect(built.trigger.function.securityDefiner).toBeUndefined();
  });

  // 本文が読む自表の列を 1 つでも落とした発火は生成しない(その列の更新で条件が破れても発火しない。fix25s)。
  it('本文が読む自表の列(linked_event)を落とした update of は、落とした列を理由に生成しない', () => {
    const decl = trigger({ invariant: 'INV-SHEET-001', fires: 'before insert or update of checked on sheets' });
    const built = checkTriggerOf(decl, table(decl), domain(SELF));
    expect(built.ok ? '' : built.reason).toContain('linked_event を見ていない');
  });

  it('fires は表名も注記も落ち、列の名指しだけが残る', () => {
    const decl = trigger({ invariant: 'INV-SHEET-001' });
    const built = checkTriggerOf(decl, table(decl), domain(SELF));

    expect(built.ok && built.trigger.fires).toBe('before insert or update of checked, linked_event');
  });

  it('遅延のトリガはいまの行を読み直し、定義者の権限で走る', () => {
    const decl = trigger({
      deferred: true,
      invariant: 'INV-SHEET-001',
      fires: 'after insert or update (constraint trigger, deferrable initially deferred)',
    });
    const built = checkTriggerOf(decl, table(decl), domain(SELF));

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.trigger.deferred).toBe(true);
    expect(built.trigger.fires).toBe('after insert or update');
    expect(built.trigger.function.securityDefiner).toBe(true);
    expect(built.trigger.function.body.slice(0, 4)).toEqual([
      'if exists (',
      '    select 1 from public.sheets t',
      '    where t.id = new.id and not (COALESCE(((t.checked = false) OR (t.linked_event IS NULL)), false))',
      ') then',
    ]);
    // コミットまでに消えた行には何も課さない(読み直して行が無ければ `exists` が偽になる)。
    expect(built.trigger.function.body.at(-1)).toBe('return null;');
  });

  it('別の集約の欄を見る式は、context で相手に届かなければ反映されない(理由を報告する)', () => {
    const other = { kind: 'check', expr: 'sheet.checked == false or workshop.open == true' } as const;
    const decl = trigger({ invariant: 'INV-SHEET-001' });
    const built = checkTriggerOf(decl, table(decl), domain(other));

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toContain('1 段の参照の欄で届かない');
  });

  it('formal を持たない不変条件は反映されない', () => {
    const decl = trigger({ invariant: 'INV-SHEET-001' });
    const built = checkTriggerOf(decl, table(decl), domain(undefined));

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toContain('formal がありません');
  });

  it('不変条件を宣言しないトリガは反映されない', () => {
    const decl = trigger({});
    const built = checkTriggerOf(decl, table(decl), domain(SELF));

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toContain('不変条件を宣言していない');
  });

  it('値を供給するトリガはこちらの担当ではない(写しの生成が受け持つ)', () => {
    const decl = trigger({ invariant: 'INV-SHEET-001', supplies: ['linked_event'] });

    expect(checkTriggersIn(table(decl), domain(SELF))).toEqual([]);
  });

  it('生成できるトリガは計画に並ぶ', () => {
    const decl = trigger({ invariant: 'INV-SHEET-001' });

    expect(checkTriggersIn(table(decl), domain(SELF)).map((t) => t.name)).toEqual(['check_sheet_manual']);
  });

  it('delete を含む fires では出さない(行を返す形がその削除を取り消す)', () => {
    const decl = trigger({ invariant: 'INV-SHEET-001', fires: 'before insert or update or delete of checked, linked_event' });
    const built = checkTriggerOf(decl, table(decl), domain(SELF));

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toContain('insert / update にしか出せない');
    expect(built.reason).toContain('delete');
  });

  it('deferred: true で before の宣言では出さない(Postgres が制約トリガを拒否する)', () => {
    const decl = trigger({
      invariant: 'INV-SHEET-001',
      deferred: true,
      fires: 'before insert or update (constraint trigger, deferrable initially deferred)',
    });
    const built = checkTriggerOf(decl, table(decl), domain(SELF));

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.reason).toContain('after でなければならない');
  });

  it('statement に % が入っても書式として解釈されない(using message で渡す)', () => {
    const decl = trigger({ invariant: 'INV-SHEET-001' });
    const built = checkTriggerOf(decl, table(decl), domain(SELF, '消し込み率は 100% にならない'));

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.trigger.function.body).toEqual([
      'if not (COALESCE(((new.checked = false) OR (new.linked_event IS NULL)), false)) then',
      '    raise exception using',
      "        message = 'check_sheet_manual: INV-SHEET-001: 消し込み率は 100% にならない',",
      "        errcode = 'check_violation',",
      "        constraint = 'check_sheet_manual';",
      'end if;',
      'return new;',
    ]);
  });
});
