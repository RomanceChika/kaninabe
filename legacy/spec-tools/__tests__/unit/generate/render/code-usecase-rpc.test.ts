/**
 * 複合 RPC の生成器(code-usecase-rpc)の規約網羅テスト。
 * 対象の要求: usecase-spec-writing.md §複合 RPC の生成 / ADR-0011 §4。
 *   - 出力先は `supabase/migrations/{saves[].migration}`(ファイル全体・AUTO-GENERATED ヘッダ)
 *   - 引数は名前付きで渡し、値は「引数名 → 供給元」の規約から決まる
 *   - 0 行は競合(`UC409`)、最初に作る行が既にあれば再送として以降を実行しない
 *   - 決められない引数があれば生成時エラー(黙って出さない、をしない)
 */

import { describe, expect, it } from 'vitest';
import { usecaseRpcGenerator } from '../../../../lib/generate/render/code-usecase-rpc.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../../helpers/usecase-builder.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { rpcActions, rpcDataTables, rpcDomain } from '../../../helpers/usecase-rpc-fixture.js';
import { GEN_CTX } from '../../../helpers/generate-context.js';
import type { GenerateContext } from '../../../../lib/gen-kit/generator.js';
import type { UsecaseSpec } from '../../../../lib/model/usecase/types.js';

/** 錨の表(containers)が再送で既存の行を返さない宣言(作成者の欄が実行者で埋まらない形に使う)。 */
const CONFLICT_CONTAINER = {
  returnsExisting: false,
  location: { file: 'docs/specs/backend/data/tables/containers.md', pointer: 'resend' },
} as const;

/** container.create → item.create → item.submit の 1 保存点(参照の鎖が 2 段)。 */
function registerUsecase(): UsecaseSpec {
  return usecaseSpec({
    name: 'demo',
    saves: [
      usecaseSave(
        'register',
        [usecaseStep('container.create'), usecaseStep('item.create'), usecaseStep('item.submit')],
        { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' },
      ),
    ],
  });
}

/** container.create → item.create(繰り返し)の 1 保存点。 */
function repeatUsecase(): UsecaseSpec {
  return usecaseSpec({
    name: 'demo',
    saves: [
      usecaseSave('register', [usecaseStep('container.create'), usecaseStep('item.create', { repeat: true })], {
        migration: '20260909000050_usecase_demo_register.sql',
        name: 'demo',
      }),
    ],
  });
}

/** 生成器に渡す文脈。 */
function context(usecase: UsecaseSpec, dataTables = rpcDataTables(), actions = rpcActions()): GenerateContext {
  return {
    ...GEN_CTX,
    actions,
    dataTables,
    usecases: { available: true, usecases: [usecase] },
  };
}

describe('code-usecase-rpc', () => {
  it('保存点ごとに migration をファイル全体として生成する', () => {
    const sections = usecaseRpcGenerator.generate(rpcDomain(), context(registerUsecase()));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('supabase/migrations/20260909000050_usecase_demo_register.sql');
    expect(sections[0]?.wholeFile).toBe(true);
    expect(sections[0]?.content.startsWith('-- AUTO-GENERATED')).toBe(true);
  });

  it('引数は名前付きで渡し、値は規約から決まる(冪等キー・実行者・予測した状態・遷移先・副作用)', () => {
    const content = usecaseRpcGenerator.generate(rpcDomain(), context(registerUsecase()))[0]?.content ?? '';

    // 最初の作成だけが呼び側の冪等キーを受け取り、以降の作成はその場で採番する。
    expect(content).toContain('p_id => p_id');
    expect(content).toContain('p_id => gen_random_uuid()');
    expect(content).toContain('p_item_id => v_item.id');
    // 実行者を指す必須の参照は入力に無いので実行者そのもの。
    expect(content).toContain('p_owner_id => p_actor_id');
    // 保存点の中で作った集約の id は前の手順の結果(plpgsql 変数)。
    expect(content).toContain('p_container_id => v_container.id');
    // 予測した状態(作成 → initial)と遷移先・副作用は仕様のリテラル。
    expect(content).toContain("p_expected_state => 'draft'");
    expect(content).toContain("p_next_state => 'submitted'");
    expect(content).toContain("p_effects => array['notify_owner']::text[]");
    expect(content).toContain("p_event_id => 'item.submit'");
  });

  it('defaults.self を宣言した手順では、実行者を指す欄は必須でなくても実行者そのものになる', () => {
    // owner_id を必須から外すと「必須で入力に無い」経路は消える。残る唯一の根拠が
    // defaults.self であり、それだけで p_actor_id に解決できることを見る。
    const usecase = usecaseSpec({
      name: 'demo',
      saves: [
        usecaseSave('register', [usecaseStep('container.create', { defaultsSelf: true })], {
          migration: '20260909000050_usecase_demo_register.sql',
          name: 'demo',
        }),
      ],
    });

    const content =
      usecaseRpcGenerator.generate(rpcDomain({ ownerRequired: false }), context(usecase))[0]?.content ?? '';

    expect(content).toContain('p_owner_id => p_actor_id');
  });

  it('defaults.self が無ければ、必須でない実行者への参照は action_spec の input に宣言したときだけ入力から読む', () => {
    const usecase = usecaseSpec({
      name: 'demo',
      saves: [
        usecaseSave('register', [usecaseStep('container.create')], {
          migration: '20260909000050_usecase_demo_register.sql',
          name: 'demo',
        }),
      ],
    });
    const tables = rpcDataTables(false, CONFLICT_CONTAINER);

    const content =
      usecaseRpcGenerator.generate(rpcDomain({ ownerRequired: false }), context(usecase, tables, rpcActions({ containerOwner: true })))[0]
        ?.content ?? '';

    expect(content).toContain("p_owner_id => (p_input -> 'container.create' ->> 'owner_id')::uuid");
    // 宣言が無ければ保存点でも入力に落とさない(単発と同じく決まらない。点検 7 回目 A7-2)。
    expect(() => usecaseRpcGenerator.generate(rpcDomain({ ownerRequired: false }), context(usecase, tables))).toThrow(
      /insert_container の引数 p_owner_id に渡す値が仕様のどこにもありません/u,
    );
  });

  it('0 行は競合(UC409)として全体を戻す', () => {
    const content = usecaseRpcGenerator.generate(rpcDomain(), context(registerUsecase()))[0]?.content ?? '';

    expect(content).toContain("raise exception using errcode = 'UC409', message = 'usecase_conflict:item.create'");
  });

  it('繰り返しの手順は入力の配列を回し、結果を配列として返す', () => {
    const content = usecaseRpcGenerator.generate(rpcDomain(), context(repeatUsecase()))[0]?.content ?? '';

    expect(content).toContain("for v_element in select * from jsonb_array_elements(coalesce(p_input -> 'item.create'");
    expect(content).toContain("v_result := v_result || jsonb_build_object('item.create', v_items);");
    // 再送のときは親(最初に作る行)から辿って配列を読み直す。
    expect(content).toContain("jsonb_agg(to_jsonb(t) order by t.id)");
  });

  it('最初に作る行が既にあれば再送として以降の手順を実行しない', () => {
    const content = usecaseRpcGenerator.generate(rpcDomain(), context(registerUsecase()))[0]?.content ?? '';

    expect(content).toContain('if exists (select 1 from public.containers where id = p_id) then');
  });

  it('再送の節に空の式を出さない(読み直しの式は Y12 と共有の判定が返したものだけ。束 ⑲-1)', () => {
    const content = usecaseRpcGenerator.generate(rpcDomain(), context(registerUsecase()))[0]?.content ?? '';

    const start = content.indexOf('return jsonb_build_object(');
    const resend = content.slice(start, content.indexOf('end if;', start));
    const entries = resend.split('\n').filter((line) => /^ {12}'/.test(line));

    // 手順の数だけ並び、どの行も `'別名', (select …)` の形(`'別名', ` で切れていない)。
    expect(entries).toHaveLength(3);
    for (const line of entries) expect(line).toMatch(/^ {12}'[^']+', \(select /);
  });

  it('security definer と search_path を固定し、service_role だけに実行を許す', () => {
    const content = usecaseRpcGenerator.generate(rpcDomain(), context(registerUsecase()))[0]?.content ?? '';

    expect(content).toContain('security definer');
    expect(content).toContain('set search_path = public');
    expect(content).toContain('revoke all on function api.usecase_demo_register(uuid, uuid, text[], jsonb, jsonb) from public;');
    expect(content).toContain('grant execute on function api.usecase_demo_register(uuid, uuid, text[], jsonb, jsonb) to service_role;');
  });

  it('決められない引数があれば生成時エラーにする(黙って出さない、をしない)', () => {
    const broken = dataTableModel([
      ...rpcDataTables().tables.filter((table) => table.table !== 'items'),
      dataTable('items', {
        entity: 'item',
        functions: [
          {
            name: 'insert_item',
            args: ['uuid', 'uuid', 'jsonb', 'uuid'],
            params: ['p_id', 'p_mystery', 'p_values', 'p_actor_id'],
            kind: 'rpc',
            shape: 'create',
            alsoWrites: [],
          },
          {
            name: 'apply_item_transition',
            args: ['uuid', 'text', 'text', 'text[]', 'text', 'uuid'],
            params: ['p_item_id', 'p_expected_state', 'p_next_state', 'p_effects', 'p_event_id', 'p_actor_id'],
            kind: 'rpc',
            shape: 'transition',
            alsoWrites: [],
          },
        ],
      }),
    ]);

    expect(() => usecaseRpcGenerator.generate(rpcDomain(), context(registerUsecase(), broken))).toThrow(
      /p_mystery/,
    );
  });

  /** 同じ操作(item.create)を 2 回実行する保存点(自分の 1 行 + 繰り返す残り)。 */
  function aliasUsecase(): UsecaseSpec {
    return usecaseSpec({
      name: 'demo',
      saves: [
        usecaseSave(
          'register',
          [
            usecaseStep('container.create'),
            usecaseStep('item.create', { as: 'first', label: '最初の 1 つ', defaultsSelf: true }),
            usecaseStep('item.create', { as: 'rest', repeat: true }),
          ],
          { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' },
        ),
      ],
    });
  }

  it('別名(as)を書いた手順は、入力と結果の鍵・行変数・コメントが別名になる', () => {
    const content =
      usecaseRpcGenerator.generate(
        rpcDomain({ itemOwner: true }),
        context(aliasUsecase(), rpcDataTables(true), rpcActions({ itemOwner: true })),
      )[0]?.content ?? '';

    // 入力・結果の鍵は別名。行変数は 2 つ目の作成だけ別名から採る(1 本目は集約の名前)。
    expect(content).toContain('p_container_id => v_container.id');
    expect(content).toContain("'name', p_input -> 'first' -> 'name'");
    expect(content).toContain("jsonb_build_object('first', to_jsonb(v_item))");
    expect(content).toContain("coalesce(p_input -> 'rest', '[]'::jsonb)");
    expect(content).toContain("jsonb_build_object('rest', v_items)");
    expect(content).toContain('v_rest public.items;');
    expect(content).toContain('-- 手順 2: item.create(as first)');
  });

  it('同じ表に行を作る手順が 2 つあるとき、再送の読み直しは実行者の行と残りに分かれる', () => {
    const content =
      usecaseRpcGenerator.generate(
        rpcDomain({ itemOwner: true }),
        context(aliasUsecase(), rpcDataTables(true), rpcActions({ itemOwner: true })),
      )[0]?.content ?? '';

    // 繰り返さない側は「実行者で埋まる列」で 1 行に定まる。
    expect(content).toContain(
      "'first', (select to_jsonb(t) from public.items t where t.container_id = p_id and t.owner_id = p_actor_id limit 1)",
    );
    // 繰り返す側はその行を除いた残り。
    expect(content).toContain(
      "'rest', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from public.items t " +
        'where t.container_id = p_id and t.id <> (select t.id from public.items t ' +
        'where t.container_id = p_id and t.owner_id = p_actor_id limit 1))',
    );
  });

  it('繰り返す作成しか先行していない参照は生成時エラーにする(どの行を指すか決まらない)', () => {
    // item(repeat)を作ってから item.submit を実行する —— 動かす行が 1 つに定まらない。
    const usecase = usecaseSpec({
      name: 'demo',
      saves: [
        usecaseSave(
          'register',
          [
            usecaseStep('container.create'),
            usecaseStep('item.create', { as: 'rows', repeat: true }),
            usecaseStep('item.submit'),
          ],
          { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' },
        ),
      ],
    });

    expect(() => usecaseRpcGenerator.generate(rpcDomain(), context(usecase))).toThrow(/繰り返す作成/);
  });

  it('同じ表に行を作る手順が 2 つあり、行を 1 つに定められなければ生成時エラーにする', () => {
    // どちらの item も実行者で埋まる列を持たないので、再送のときに「どちらの行か」が決まらない。
    const usecase = usecaseSpec({
      name: 'demo',
      saves: [
        usecaseSave(
          'register',
          [
            usecaseStep('container.create'),
            usecaseStep('item.create', { as: 'first' }),
            usecaseStep('item.create', { as: 'second' }),
          ],
          { migration: '20260909000050_usecase_demo_register.sql', name: 'demo' },
        ),
      ],
    });

    expect(() => usecaseRpcGenerator.generate(rpcDomain(), context(usecase))).toThrow(/読み直せません/);
  });

  it('usecase_spec が無い環境では何も生成しない', () => {
    expect(usecaseRpcGenerator.generate(rpcDomain(), GEN_CTX)).toEqual([]);
  });
});
