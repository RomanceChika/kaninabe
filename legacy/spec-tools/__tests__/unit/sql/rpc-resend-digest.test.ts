/**
 * 複合 RPC(保存点)の**入力の全体の比べ**の生成の規約網羅テスト(点検 21 回目 A21-1 / B21-1)。
 *
 * 対象の要求(持ち主は `lib/sql/rpc-resend-digest.ts`。並べるのは `generate/render/usecase-rpc-resend.ts`):
 *   - 1 回目は、正規化した `p_input` の要約を**短命の表**(仕組みの表 `resend_digests`)に 1 行残す。**追記専用の監査ログには
 *     置かない**(入力は個人列を含み、消去が監査ログに届かない)。先頭で保持の時間を過ぎた行を消す
 *   - 再送は、持ち主の確かめ(委任する枝は錨の作成の RPC を呼び直す)の**後で**、まず 1 回目の要約が保持の時間の内にあるかを見て
 *     (無ければ UC412 `resend_expired`)、次に要約を比べ、違えば UC412 `resend_input_mismatch`。委任する枝・しない枝の両方に出す。
 *     比べは読み直しより前に置く(違う入力に 1 回目の行を返さない)
 *   - 置き場の表が宣言に無ければ、Y12 と生成器が同じ 1 本(`resendDigestStoreProblem`)で止める
 *   - 返さない方針(`returns_existing: false`)は再送をいつも断るので、要約を刻まず比べもしない
 *   - 正規化: 手順の別名だけ・空の欄は落とす・無い/形の違う手順は `{}` / `[]`・入力の外(`p_expected`)は入れない
 *
 * 実 DB での実測は app の統合テスト(create-rpc-idempotency.test.ts の TC-GUAR-IDEMPOTENT-007)と、保存点の一致の証明の生成テスト
 * (`expectSaveResendEdited`)が受け持つ。
 */

import { describe, expect, it } from 'vitest';
import {
  RESEND_EXPIRED,
  RESEND_TARGET_DELETED,
  raiseResendExpired,
  recordResendDigest,
  resendDigestDiffers,
  resendDigestEvent,
  resendDigestExpired,
  resendInputDigest,
} from '../../../lib/sql/rpc-resend-digest.js';
import { resendDigestStoreProblem, resendDigestTableOf } from '../../../lib/usecase/resend-policy.js';
import { usecaseRpcGenerator } from '../../../lib/generate/render/code-usecase-rpc.js';
import { resendAfterAnchor, resendBlock, type ResendDigest } from '../../../lib/generate/render/usecase-rpc-resend.js';
import type { SaveStepPlan } from '../../../lib/usecase/step-plan.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../helpers/usecase-builder.js';
import { rpcActions, rpcDataTables, rpcDomain } from '../../helpers/usecase-rpc-fixture.js';
import { GEN_CTX } from '../../helpers/generate-context.js';
import { TEST_PLATFORM } from '../../helpers/platform.js';
import type { DataTableSpec } from '../../../lib/model/data/types.js';
import { dataTableModel } from '../../helpers/data-builder.js';

/** container.create → item.create(繰り返し)の 1 保存点(錨 = container.create)。 */
function generate(containerResend?: DataTableSpec['resend'], withoutStore = false): string {
  const usecase = usecaseSpec({
    name: 'demo',
    saves: [
      usecaseSave('register', [usecaseStep('container.create'), usecaseStep('item.create', { repeat: true })], {
        migration: '20260909000050_usecase_demo_register.sql',
        name: 'demo',
      }),
    ],
  });
  return (
    usecaseRpcGenerator.generate(rpcDomain(), {
      ...GEN_CTX,
      actions: rpcActions(),
      dataTables: withoutStore ? withoutDigestStore() : containerResend === undefined ? rpcDataTables() : rpcDataTables(false, containerResend),
      usecases: { available: true, usecases: [usecase] },
    })[0]?.content ?? ''
  );
}

/** 置き場の表(framework: resend_digests)を除いた data_table。 */
function withoutDigestStore() {
  return dataTableModel(rpcDataTables().tables.filter((table) => table.framework !== 'resend_digests'));
}

/** 置き場(24 時間)。 */
const STORE = { table: 'resend_digests', retentionHours: 24 } as const;

/** 再送の枝(先頭の if exists 〜 対応する end if)。 */
function branchOf(sql: string): string {
  const start = sql.indexOf('if exists (select 1 from public.containers where id = p_id) then');
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf('\n    end if;', start));
}

describe('保存点の入力の要約の式(rpc-resend.ts)', () => {
  it('event_id は操作 ID と取り違えない接頭辞つき(操作 ID は `:` を含まない)', () => {
    expect(resendDigestEvent('demo', 'register')).toBe('usecase:demo.register');
  });

  it('正規化: 手順の別名だけを手順の順に並べ、空の欄を落とし、無い・形の違う手順は {} / [] にして sha256 の 16 進にする', () => {
    const digest = resendInputDigest(
      [
        { alias: 'a.create', repeat: false },
        { alias: 'b.create', repeat: true },
        { alias: 'a.create', repeat: false }, // 同じ別名は 1 度だけ(遷移が同じ行を動かす手順)
      ],
      'p_input',
    );
    expect(digest).toBe(
      "encode(sha256(convert_to(jsonb_build_object(" +
        "'a.create', case when jsonb_typeof(p_input -> 'a.create') = 'object' then jsonb_strip_nulls(p_input -> 'a.create') else '{}'::jsonb end, " +
        "'b.create', case when jsonb_typeof(p_input -> 'b.create') = 'array' then jsonb_strip_nulls(p_input -> 'b.create') else '[]'::jsonb end" +
        ")::text, 'UTF8')), 'hex')",
    );
    // 入力の外(判断時の前提・ロール)は入れない。
    expect(digest).not.toContain('p_expected');
    expect(digest).not.toContain('p_actor_roles');
  });

  it('残す文: 保持の時間を過ぎた行を掴めた分だけ消し、同じ鍵は過ぎた行だけを消し、短命の表へ 1 行足す。保持の時間の内の同じ鍵の行は置き換えず断る(1 回目の入力が勝つ。点検 22 回目 A22-1)', () => {
    const sql = recordResendDigest({ store: STORE, event: 'usecase:demo.register', key: 'p_id', digest: 'D', indent: '    ', operation: "'container.create'" });
    expect(sql).toBe(
      [
        "    with expired as (select o.id from public.resend_digests o where not (o.created_at > now() - interval '24 hours') order by o.id for update skip locked)",
        '    delete from public.resend_digests d using expired where d.id = expired.id;',
        "    delete from public.resend_digests d where d.event_id = 'usecase:demo.register' and d.entity_id = p_id and not (d.created_at > now() - interval '24 hours');",
        '    insert into public.resend_digests (event_id, entity_id, actor_id, input_digest)',
        "    values ('usecase:demo.register', p_id, p_actor_id, D)",
        '    on conflict (event_id, entity_id) do nothing;',
        '    if not found then',
        "        raise exception using errcode = 'UC412', message = 'usecase_guard:' || 'container.create', detail = 'resend_target_deleted';",
        '    end if;',
      ].join('\n'),
    );
    // 足せない = 1 回目の要約が残るのに錨の行が無い(1 回目が作った行が消された)。「既に保存されています」の語は使わない。
    expect(RESEND_TARGET_DELETED).toBe('resend_target_deleted');
    expect(sql).not.toContain('resend_already_saved');
    // 同じ鍵の保持の時間の内の行を無条件に消す文は出さない(1 回目の要約を 2 本目の入力で置き換えない)。
    expect(sql).not.toContain("d.entity_id = p_id;");
    expect(sql).not.toContain('domain_events');
  });

  it('保持の時間は宣言の値がそのまま interval に入る(過ぎた行は比べにも使わない)', () => {
    const store = { table: 'resend_digests', retentionHours: 2 };
    expect(resendDigestExpired(store, 'usecase:demo.register', 'p_id')).toBe(
      "not exists (select 1 from public.resend_digests r where r.event_id = 'usecase:demo.register' and r.entity_id = p_id and r.created_at > now() - interval '2 hours')",
    );
    expect(resendDigestDiffers(store, 'usecase:demo.register', 'p_id', 'D')).toBe(
      "not exists (select 1 from public.resend_digests r where r.event_id = 'usecase:demo.register' and r.entity_id = p_id and r.created_at > now() - interval '2 hours' and r.input_digest = D)",
    );
  });

  it('保持の時間を過ぎた再送の拒否は UC412・語は resend_expired', () => {
    expect(RESEND_EXPIRED).toBe('resend_expired');
    expect(raiseResendExpired("'container.create'", '  ')).toBe(
      "  raise exception using errcode = 'UC412', message = 'usecase_guard:' || 'container.create', detail = 'resend_expired';",
    );
  });

  it.each([
    ['宣言あり', [{ table: 'resend_digests', framework: 'resend_digests', retentionHours: 24 }], STORE],
    ['保持の時間が無い', [{ table: 'resend_digests', framework: 'resend_digests' }], null],
    ['仕組みの表でない同名の表', [{ table: 'resend_digests' }], null],
    ['表が無い', [], null],
  ] as const)('置き場の引き当て: %s', (_label, tables, expected) => {
    expect(resendDigestTableOf(tables)).toEqual(expected);
  });

  it.each([
    ['返す方針(own)・置き場なし → 問題', { kind: 'own', creator: 'owner_id' }, [], true],
    ['返す方針(recorded)・置き場なし → 問題', { kind: 'recorded' }, [], true],
    ['返す方針・置き場あり → なし', { kind: 'own', creator: 'owner_id' }, [{ table: 'resend_digests', framework: 'resend_digests', retentionHours: 24 }], false],
    ['返さない方針・置き場なし → なし(比べない)', { kind: 'conflict' }, [], false],
    ['錨なし → なし', null, [], false],
  ] as const)('置き場の要否: %s', (_label, resend, tables, problem) => {
    const found = resendDigestStoreProblem(resend, tables);
    expect(found !== null).toBe(problem);
    if (found !== null) expect(found.counterexample).toEqual({ framework: 'resend_digests' });
  });
});

describe('複合 RPC への置き方(usecase-rpc-resend.ts)', () => {
  it('委任する枝: 錨の作成の RPC を呼び直した後・読み直しの前に、保持の時間 → 要約の比べの順で見て、UC412 resend_expired / resend_input_mismatch', () => {
    const branch = branchOf(generate());
    const call = branch.indexOf('from api.insert_container(');
    const expired = branch.indexOf("detail = 'resend_expired';");
    const compare = branch.indexOf('r.input_digest = ');
    const refuse = branch.indexOf("raise exception using errcode = 'UC412', message = 'usecase_guard:' || 'container.create', detail = 'resend_input_mismatch';");
    const returns = branch.indexOf('return jsonb_build_object(');

    expect(call).toBeGreaterThan(-1);
    expect(expired).toBeGreaterThan(call);
    expect(compare).toBeGreaterThan(expired);
    expect(refuse).toBeGreaterThan(compare);
    expect(returns).toBeGreaterThan(refuse);
    // 比べるのは手順の全部の入力(子の手順の別名も要約に入る)。
    expect(branch.slice(compare, refuse)).toContain("p_input -> 'item.create'");
    // 監査ログは読まない(要約は短命の表だけにある)。
    expect(branch).not.toContain('domain_events');
  });

  it('委任する枝: 呼び直しの前に印を消し、呼び直しが印を立てなければ(新しい行を作った)要約の比べの前に UC412 resend_target_deleted で戻す(点検 23 回目 A23-1)', () => {
    const branch = branchOf(generate());
    const clear = branch.indexOf("perform set_config('st.resent_id', '', true);");
    const call = branch.indexOf('from api.insert_container(');
    const check = branch.indexOf("if not (current_setting('st.resent_id', true) is not distinct from p_id::text) then");
    const deleted = branch.indexOf("raise exception using errcode = 'UC412', message = 'usecase_guard:' || 'container.create', detail = 'resend_target_deleted';");
    const expired = branch.indexOf("detail = 'resend_expired';");

    expect(clear).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(clear);
    expect(check).toBeGreaterThan(call);
    expect(deleted).toBeGreaterThan(check);
    expect(expired).toBeGreaterThan(deleted);
  });

  it('1 回目は全部の手順の後・結果を返す前に、同じ要約を短命の表に 1 行残す(監査ログには何も書かない)', () => {
    const sql = generate();
    const record = sql.indexOf("values ('usecase:demo.register', p_id, p_actor_id, encode(sha256(");
    expect(sql).not.toContain('domain_events');
    const lastStep = sql.lastIndexOf('-- 手順 2: item.create');
    const returns = sql.lastIndexOf('    return v_result;');

    expect(record).toBeGreaterThan(lastStep);
    expect(returns).toBeGreaterThan(record);
    // 刻む式と比べる式は同じ(正規化が 2 か所でずれない)。
    const digest = resendInputDigest(
      [
        { alias: 'container.create', repeat: false },
        { alias: 'item.create', repeat: true },
      ],
      'p_input',
    );
    // 先頭の枝の比べ・錨の作成の後の合流の比べ・1 回目の刻みの 3 か所(点検 22 回目 A22-1 で合流が足された)。
    expect(sql.split(digest)).toHaveLength(4);
  });

  it('返さない方針の錨では要約を残さず比べもしない(同じ鍵はいつも UC409)', () => {
    const sql = generate({ returnsExisting: false, location: { file: 'containers.md', pointer: 'resend' } });
    expect(sql).not.toContain('input_digest');
    expect(sql).not.toContain('resend_digests');
    expect(sql).not.toContain('resend_expired');
    expect(sql).not.toContain('resend_input_mismatch');
    expect(branchOf(sql)).toContain("detail = 'resend_already_saved'");
  });

  it('委任しない枝(錨が最初の手順でない形)にも、持ち主の確かめの後・読み直しの前に同じ比べを出す', () => {
    const anchor = { index: 1, op: 'container.create', alias: 'container.create', table: 'containers', entity: 'container', repeat: false } as SaveStepPlan;
    const digest: ResendDigest = { record: 'RECORD', expired: 'EXPIRED', differs: 'DIFFERS' };
    const lines = resendBlock(
      { anchor, resend: { kind: 'own', creator: 'owner_id' }, entries: [{ alias: 'container.create', expression: '(select 1)' }] },
      [],
      new Map(),
      TEST_PLATFORM,
      digest,
    ).join('\n');
    const ownership = lines.indexOf('t.owner_id = p_actor_id');
    const expired = lines.indexOf('if EXPIRED then');
    const compare = lines.indexOf('if DIFFERS then');
    const returns = lines.indexOf('return jsonb_build_object(');

    expect(ownership).toBeGreaterThan(-1);
    expect(expired).toBeGreaterThan(ownership);
    expect(lines.slice(expired, compare)).toContain("detail = 'resend_expired'");
    expect(compare).toBeGreaterThan(expired);
    expect(lines.slice(compare)).toContain("detail = 'resend_input_mismatch'");
    expect(returns).toBeGreaterThan(compare);
    // 錨の作成の RPC は呼び直さない(委任しない枝)。
    expect(lines).not.toContain('insert_container(');
  });

  it('要約が無い(返さない方針)なら比べの文を出さない', () => {
    const anchor = { index: 0, op: 'container.create', alias: 'container.create', table: 'containers', entity: 'container', repeat: false } as SaveStepPlan;
    const lines = resendBlock({ anchor, resend: { kind: 'conflict' }, entries: [] }, [], new Map(), TEST_PLATFORM, null).join('\n');
    expect(lines).not.toContain('resend_input_mismatch');
    expect(lines).not.toContain('resend_expired');
    expect(lines).toContain("detail = 'resend_already_saved'");
  });

  it('錨の作成の前に再送の印を消し、直後に印を見て、以降の手順を実行せずに先頭の枝と同じ比べと読み直しへ合流する(点検 22 回目 A22-1)', () => {
    const sql = generate();
    const step1 = sql.indexOf('-- 手順 1: container.create');
    const clear = sql.lastIndexOf("perform set_config('st.resent_id', '', true);", step1);
    const call = sql.indexOf('from api.insert_container(', step1);
    const signalled = sql.indexOf("if current_setting('st.resent_id', true) is not distinct from p_id::text then", call);
    const step2 = sql.indexOf('-- 手順 2: item.create');
    const merged = sql.slice(signalled, step2);

    expect(clear).toBeGreaterThan(sql.indexOf('end if;'));
    expect(clear).toBeLessThan(call);
    expect(signalled).toBeGreaterThan(call);
    expect(step2).toBeGreaterThan(signalled);
    expect(merged.indexOf("detail = 'resend_expired'")).toBeGreaterThan(-1);
    expect(merged.indexOf("detail = 'resend_input_mismatch'")).toBeGreaterThan(merged.indexOf("detail = 'resend_expired'"));
    expect(merged.indexOf('return jsonb_build_object(')).toBeGreaterThan(merged.indexOf("detail = 'resend_input_mismatch'"));
    // 合流は 1 回目の要約を刻まない(刻むのは全部の手順の後だけ)。
    expect(merged).not.toContain('insert into public.resend_digests');
  });

  it('返さない方針の錨では印を見ない(作成 RPC が再送をいつも断る)', () => {
    const sql = generate({ returnsExisting: false, location: { file: 'containers.md', pointer: 'resend' } });
    expect(sql).not.toContain('st.resent_id');
  });

  it('錨が最初の手順でない(委任しない枝)なら、合流でも持ち主を確かめ、前の手順が書いた後なので読み直して返さず競合で戻す', () => {
    const anchor = { index: 1, op: 'container.create', alias: 'container.create', table: 'containers', entity: 'container', repeat: false } as SaveStepPlan;
    const digest: ResendDigest = { record: 'RECORD', expired: 'EXPIRED', differs: 'DIFFERS' };
    const around = resendAfterAnchor({ anchor, resend: { kind: 'own', creator: 'owner_id' }, entries: [{ alias: 'container.create', expression: '(select 1)' }] }, digest);
    const after = around.after.join('\n');

    expect(around.before.join('\n')).toContain("perform set_config('st.resent_id', '', true);");
    expect(after.indexOf('t.owner_id = p_actor_id')).toBeGreaterThan(after.indexOf('st.resent_id'));
    expect(after.indexOf('if DIFFERS then')).toBeGreaterThan(after.indexOf('if EXPIRED then'));
    expect(after).not.toContain('return jsonb_build_object(');
    expect(after).toContain("errcode = 'UC409'");
  });

  it('繰り返す手順の錨・返さない方針・錨なしには何も置かない', () => {
    const repeat = { index: 0, op: 'container.create', alias: 'container.create', table: 'containers', entity: 'container', repeat: true } as SaveStepPlan;
    const single = { ...repeat, repeat: false } as SaveStepPlan;
    const empty = { before: [], after: [] };
    expect(resendAfterAnchor({ anchor: repeat, resend: { kind: 'own', creator: 'owner_id' }, entries: [] }, null)).toEqual(empty);
    expect(resendAfterAnchor({ anchor: single, resend: { kind: 'conflict' }, entries: [] }, null)).toEqual(empty);
    expect(resendAfterAnchor({ anchor: null, resend: null, entries: [] }, null)).toEqual(empty);
  });

  it('置き場の表が宣言に無ければ、生成器は Y12 の名前で止まる(存在しない表へ書く SQL を出さない)', () => {
    expect(() => generate(undefined, true)).toThrow(/Y12/u);
  });
});
