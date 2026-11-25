/**
 * 作成の**冪等な再送の枝**と、**実行者を指す参照の欄の縛り**の生成の規約網羅テスト。
 *
 * 対象の要求:
 *   - ARCH-SP-BE-0001 §テーブル仕様 の `resend`(再送で既存の行を返すのは作成者 = 実行者の行だけ /
 *     返さない宣言なら同じ id は競合 / 書かなければ T6 / Y12 が止める)
 *   - 作成の RPC は実行者を指す参照の欄を `p_actor_id` に縛る(違えば UC403)。解くのは system のロール・
 *     `delegate` で欄を名指した規則だけ。縛る欄を input に載せた宣言は T6 が止める
 *
 * 負例(他人が同じ冪等キーで再送しても他人の行が返らない)は、生成した SQL の字面で固定する ——
 * 「既存の行を返す文は、必ず作成者の条件を持つ」「条件が満たされなければ枝の中で UC409」。実 DB での
 * 実測は app の統合テスト(guarantees/create-resend-own-only.test.ts)が受け持つ。
 */

import { describe, expect, it } from 'vitest';
import { buildRpcBody } from '../../../lib/sql/rpc-body.js';
import { RESEND_SIGNAL_SETTING, clearResendSignal, resendComparedColumns, resendSignalled, signalResend } from '../../../lib/sql/rpc-resend.js';
import type { DataTableSpec } from '../../../lib/model/data/types.js';
import type { CreateRule } from '../../../lib/model/types-access.js';
import type { SpecModel } from '../../../lib/model/types.js';
import type { ActionSpecModel } from '../../../lib/model/trace/types.js';
import { usecaseRpcGenerator } from '../../../lib/generate/render/code-usecase-rpc.js';
import { readbackPlans } from '../../../lib/usecase/save-readback.js';
import { planSave } from '../../../lib/usecase/step-plan.js';
import { resolveSaveParams } from '../../../lib/usecase/param-source.js';
import { TEST_PLATFORM } from '../../helpers/platform.js';
import { dataTable, dataTableModel } from '../../helpers/data-builder.js';
import { accessSpec, aggregate, create, entitySpec, field, role, roleSpec, specModel } from '../../helpers/model-builder.js';
import { actionSpec } from '../../helpers/trace-builder.js';
import { GEN_CTX } from '../../helpers/generate-context.js';
import { usecaseSave, usecaseSpec, usecaseStep } from '../../helpers/usecase-builder.js';

/** 再送の宣言の位置(指摘の場所に使うだけ)。 */
const AT = { file: 'docs/specs/backend/data/tables/boxes.md', pointer: 'resend' } as const;

/** 再送で返すのは作成者(owner_id = 実行者)の行だけ。 */
const OWN: DataTableSpec['resend'] = { returnsExisting: true, creator: 'owner_id', location: AT };

/** 再送で既存の行を返さない。 */
const NONE: DataTableSpec['resend'] = { returnsExisting: false, location: AT };

/** 返す宣言(作成者の欄なし = 監査ログの実行者で確かめる。点検 20 回目 B20-1)。 */
const RECORDED: DataTableSpec['resend'] = { returnsExisting: true, location: AT };

/** 規則に代理の欄と理由を足す(名指した欄だけを解く。点検 10 回目 A10-2)。 */
function delegated(rule: CreateRule, reason: string, field: string): CreateRule {
  return { ...rule, delegate: [{ entity: 'box', field, reason, location: { file: 'access.md', pointer: 'creates[0].delegate[0]' } }] };
}

/**
 * owner(実行者。staff の claim を持つ)/ box(持ち主 = 実行者への参照)の最小ドメイン。
 *
 * @param creates box の作成の規則
 */
function domain(creates: readonly CreateRule[] = [create('member')], reviewerRequired = false): SpecModel {
  return specModel(
    [
      aggregate('owner', {
        entity: entitySpec('owner', {
          fields: [
            field('id', { kind: 'uuid' }),
            field('name', { kind: 'string' }, { required: true, session: true }),
            field('is_staff', { kind: 'boolean' }, { session: true }),
          ],
        }),
      }),
      aggregate('box', {
        entity: entitySpec('box', {
          fields: [
            field('id', { kind: 'uuid' }),
            field('owner_id', { kind: 'ref', entity: 'owner' }, { required: true }),
            // 別の人を指す欄(承認者のように、人が選ぶ)。入力に出したときだけ行に入る。
            field('reviewer_id', { kind: 'ref', entity: 'owner' }, { required: reviewerRequired }),
            field('title', { kind: 'string' }, { required: true }),
          ],
        }),
        access: accessSpec('box', { creates }),
      }),
    ],
    roleSpec([role('member'), role('anonymous'), role('system'), { ...role('staff', undefined, ['member']), claim: 'owner.is_staff' }]),
  );
}

/**
 * box.create の action_spec(`input` を差し替えられる)。持ち主の欄 owner_id は、入力に出していなければ `owner` で明示する
 * (`owner: null` で宣言しない形。点検 9 回目 A9-1 —— 作成者で埋まる欄は明示の宣言だけ)。
 */
function actions(input: readonly string[] = ['box.title'], owner: string | null = 'box.owner_id'): ActionSpecModel {
  const declared = owner !== null && !input.includes(owner);
  return {
    actions: [actionSpec({ handles: 'box.create', input: [...input], ...(declared ? { owner } : {}) })],
    unhandled: [],
    scans: [],
    unscanned: [],
    testTagBaseline: [],
  };
}

/** insert_box の宣言(持ち主を 1 欄の引数で受ける)。 */
const INSERT_BOX = {
  name: 'insert_box',
  args: ['uuid', 'uuid', 'jsonb', 'uuid', 'text[]'],
  params: ['p_id', 'p_owner_id', 'p_values', 'p_actor_id', 'p_actor_roles'],
  kind: 'rpc',
  shape: 'create',
  alsoWrites: [],
} as const;

/** boxes の data_table(再送の宣言を差し替えられる。undefined なら宣言なし)。 */
function boxes(resend: DataTableSpec['resend']): DataTableSpec {
  return dataTable('boxes', { entity: 'box', resend, functions: [INSERT_BOX] });
}

/** insert_box を組み立てる(失敗なら理由を文字列にして返す)。 */
function build(options: {
  readonly resend: DataTableSpec['resend'];
  readonly creates?: readonly CreateRule[];
  readonly input?: readonly string[];
  /** reviewer_id も必須にする(必須で入力に無い実行者への参照が 2 本の形。A8-1)。 */
  readonly reviewerRequired?: boolean;
  /** box.create の `owner`(null なら宣言しない)。 */
  readonly owner?: string | null;
  /** 問題の直し方の文も返す。 */
  readonly withSuggestion?: boolean;
}): string {
  const result = buildRpcBody({
    name: INSERT_BOX.name,
    params: INSERT_BOX.params,
    args: INSERT_BOX.args,
    shape: 'create',
    table: boxes(options.resend),
    domain: domain(options.creates, options.reviewerRequired === true),
    tableOf: (entity) => (entity === 'box' ? 'boxes' : entity === 'owner' ? 'owners' : null),
    actions: actions(options.input, options.owner === undefined ? 'box.owner_id' : options.owner),
    specFiles: ['docs/specs/backend/data/tables/boxes.md'],
    entityLabel: '箱',
    platform: TEST_PLATFORM,
  });
  return result.ok ? result.sql : result.problems.map((problem) => (options.withSuggestion === true ? `${problem.message} ${problem.suggestion}` : problem.message)).join('\n');
}

/** 再送の枝(挿入の後ろの、0 行の分類の中の同じ id の行があるときの if 〜 UC409)を切り出す。 */
function resendBranch(sql: string, table: string): string {
  const start = sql.indexOf(`if exists (select 1 from public.${table} where id = p_id) then`, sql.indexOf('on conflict (id) do nothing'));
  expect(start).toBeGreaterThan(-1);
  const conflict = sql.indexOf("errcode = 'UC409'", start);
  expect(conflict).toBeGreaterThan(start);
  return sql.slice(start, conflict);
}

describe('再送の印(点検 22 回目 A22-1)', () => {
  it('作成 RPC の再送の枝が立て、複合 RPC が錨の作成の前に消し、直後に鍵と比べて読む(txn の内だけの設定)', () => {
    expect(RESEND_SIGNAL_SETTING).toBe('st.resent_id');
    expect(signalResend('  ')).toBe("  perform set_config('st.resent_id', p_id::text, true);");
    expect(clearResendSignal('  ')).toBe("  perform set_config('st.resent_id', '', true);");
    expect(resendSignalled('p_id')).toBe("current_setting('st.resent_id', true) is not distinct from p_id::text");
  });
});

describe('単発の作成 RPC の再送の枝', () => {
  // 点検 26 回目 B26-1: 行の before insert トリガは一意の衝突の判定より先に走るので、挿入の後ろでだけ再送を決めると、押し直しでも
  // 番号のずらし・上端の断り・確かめのトリガが動く。同じ id の行があれば挿入の前に決める(段の順と中身は挿入の後ろの枝と同じ)。
  it.each([
    ['own', OWN],
    ['recorded', RECORDED],
    ['返さない', NONE],
  ] as const)('同じ id の行があれば、掴みの後・挿入の前に、ロール → 再送の順で決める(%s。挿入の後ろの枝と同じ中身。点検 26 回目 B26-1)', (_label, resend) => {
    const sql = build({ resend });
    const exists = '    if exists (select 1 from public.boxes where id = p_id) then';
    const before = sql.indexOf(exists);
    // 既にある行は掴みの文が先に排他で掴む(消す txn のコミットを待つ。点検 23 回目 A23-1 の交錯を挿入の前の枝で再び開けない)。
    const lock = sql.indexOf('    perform 1\n    from public.boxes t\n    where t.id = p_id\n    for update of t;');
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(before);
    const insert = sql.indexOf('    insert into public.boxes (');
    expect(before).toBeGreaterThan(-1);
    expect(before).toBeLessThan(insert);
    // 掴みの文(perform … for share / for update)の後に置く(同じ鍵の 1 回目がまだコミットしていない押し直しは、掴みで待ってから見る)。
    expect(sql.lastIndexOf('for share of', insert)).toBeLessThan(before);
    const pre = sql.slice(before, insert);
    // ロールの段が再送より前(by の立たない実行者に既存の行を返さない)。
    expect(pre.indexOf("errcode = 'UC403'")).toBeGreaterThan(-1);
    expect(pre.indexOf("errcode = 'UC403'")).toBeLessThan(pre.indexOf('-- 再送') === -1 ? pre.indexOf('-- この表は') : pre.indexOf('-- 再送'));
    // 中身は挿入の後ろの枝と同じ(字下げが 1 段浅いだけ)。
    const after = resendBranch(sql, 'boxes').split('\n').slice(1).map((line) => line.trim()).filter((line) => line !== '');
    const preInner = pre.slice(pre.indexOf('end if;') + 'end if;'.length).split('\n').map((line) => line.trim()).filter((line) => line !== '');
    // 挿入の後ろの枝の切り出しは UC409 の手前で切れるので、最後の 1 行(途中で切れた raise)を除いて比べる。
    expect(after.length).toBeGreaterThan(1);
    expect(preInner.slice(0, after.length - 1)).toEqual(after.slice(0, -1));
  });

  it('返すのは作成者が実行者の行だけで、満たさなければ枝の中で UC409(他人の行は返らない)', () => {
    const sql = build({ resend: OWN });
    const branch = resendBranch(sql, 'boxes');

    expect(branch).toContain(
      'select t.* into v_row from public.boxes t\n             where t.id = p_id and p_actor_id is not null and t.owner_id = p_actor_id;',
    );
    expect(branch).toContain('return next v_row;');
    expect(branch).toContain('return;');
    // 既存の行を返す直前に、同じ txn の呼び手へ「再送だった」の印を立てる(点検 22 回目 A22-1)。
    expect(branch.indexOf("perform set_config('st.resent_id', p_id::text, true);")).toBeGreaterThan(-1);
    expect(branch.indexOf("perform set_config('st.resent_id', p_id::text, true);")).toBeLessThan(branch.indexOf('return next v_row;'));
    // 負例: 作成者を問わずに既存の行を読む文(以前の形)は 1 つも無い。
    expect(sql).not.toMatch(/select \* into v_row from public\.boxes where id = p_id;/);
    // 既存の行を読む文は、どれも作成者の条件を持つ(返す枝が実行者を問わない形に戻らない)。
    // 挿入の前の枝と挿入の後ろの枝の 2 つ(点検 26 回目 B26-1)で、どちらも作成者の条件を持つ。
    const reads = sql.split('\n').filter((line) => line.includes('into v_row from public.boxes'));
    expect(reads).toHaveLength(2);
    expect(sql.split('\n').filter((line) => line.includes('where t.id = p_id and p_actor_id is not null and t.owner_id = p_actor_id;'))).toHaveLength(2);
  });

  it('行を入れた後に、同じ鍵の作成が監査ログに既にあれば作り直さず、本人は UC412 resend_target_deleted・他人は UC409(点検 23 回目 O23-2)', () => {
    const sql = build({ resend: OWN });
    const earlier = "if exists (select 1 from public.domain_events r where r.entity_id = p_id and r.event_id = 'box.create') then";
    const own = "if exists (select 1 from public.domain_events r where r.entity_id = p_id and r.event_id = 'box.create' and r.actor_id is not distinct from p_actor_id) then";
    const deleted = "raise exception using errcode = 'UC412', message = 'usecase_guard:' || 'box.create', detail = 'resend_target_deleted';";
    const at = sql.indexOf(earlier);
    // 0 行の分類の if の後(行を入れられた経路)・監査ログを書く前に置く(入れる前に見ると、消す txn との交錯で作り直す)。
    expect(at).toBeGreaterThan(sql.indexOf('on conflict (id) do nothing'));
    expect(at).toBeGreaterThan(sql.indexOf('return next v_row;'));
    expect(at).toBeLessThan(sql.indexOf('insert into public.domain_events'));
    expect(sql.indexOf(own)).toBeGreaterThan(at);
    expect(sql.indexOf(deleted)).toBeGreaterThan(sql.indexOf(own));
    expect(sql.slice(sql.indexOf(deleted)).indexOf("raise exception using errcode = 'UC409', message = 'usecase_conflict:box.create';")).toBeGreaterThan(-1);
  });

  it('作り直しの拒否は返さない宣言の表にも置く(消された後の押し直しは既に保存されているでもない)', () => {
    expect(build({ resend: NONE })).toContain("detail = 'resend_target_deleted';");
  });

  it('実行者が null の呼び出しは「誰でも」ではない(作成者の条件に is not null が並ぶ)', () => {
    const sql = build({ resend: OWN });

    expect(sql).toContain('p_actor_id is not null and t.owner_id = p_actor_id');
    // 再送で返す枝の持ち主の条件は null どうしを一致にしない(作り直しの拒否の監査ログの照らしは別の段。どちらでも断るだけで中身は返さない)。
    expect(resendBranch(sql, 'boxes')).not.toContain('is not distinct from p_actor_id');
  });

  it('返さない宣言なら、同じ id の行があれば常に UC409(既存の行を読む文が無い)', () => {
    const sql = build({ resend: NONE });
    // 既存の行を返さないので、再送の印も立てない(点検 22 回目 A22-1)。
    expect(sql).not.toContain('st.resent_id');
    const branch = resendBranch(sql, 'boxes');

    expect(branch).not.toContain('return next');
    expect(sql).not.toContain('into v_row from public.boxes');
    // 同じ鍵の押し直しは「既に保存されている」の語で断る(画面の文言の種類。)。
    const start = sql.indexOf('if exists (select 1 from public.boxes where id = p_id) then', sql.indexOf('on conflict (id) do nothing'));
    expect(sql.slice(start, sql.indexOf('end if;', start))).toContain(
      "raise exception using errcode = 'UC409', message = 'usecase_conflict:' || 'box.create', detail = 'resend_already_saved';",
    );
  });

  it('返す宣言の他人の行は、語の無い従来の競合のまま(同じ鍵の押し直しの語は載せない)', () => {
    const sql = build({ resend: { returnsExisting: true, creator: 'owner_id', location: AT } });
    expect(sql).not.toContain('resend_already_saved');
  });

  it('宣言が無ければ本文を組み立てない(黙って実行者を問わない枝を出さない)', () => {
    const problems = build({ resend: undefined });

    expect(problems).toContain('boxes.md に resend の宣言がありません');
  });

  it('作成者の欄が、作成で実行者に埋まる列でなければ本文を組み立てない', () => {
    const problems = build({ resend: { returnsExisting: true, creator: 'title', location: AT } });

    expect(problems).toContain('resend.creator(title)は、insert_box が実行者そのもので埋める列ではありません');
  });

  it('関数のコメントに再送の契約(作成者の欄)が載る', () => {
    expect(build({ resend: OWN })).toContain('作成者の欄が実行者と一致するときだけ(他人の行は UC409)。作成者の欄: owner_id。');
    expect(build({ resend: NONE })).toContain('同じ id の行が既にあれば、再送でも既存の行を返さず UC409。');
  });
});

describe('再送の持ち主と入力の確かめ(点検 20 回目 B20-1)', () => {
  it('作成者の欄が無い宣言は、その作成の監査ログの実行者で確かめる(null どうしも一致 = 未ログインは鍵が範囲)', () => {
    const sql = build({ resend: RECORDED });
    const branch = resendBranch(sql, 'boxes');

    expect(branch).toContain(
      "where t.id = p_id and exists (select 1 from public.domain_events r where r.entity_id = t.id and r.event_id = 'box.create' and r.actor_id is not distinct from p_actor_id);",
    );
    expect(branch).toContain('return next v_row;');
    expect(branch).not.toContain('t.owner_id = p_actor_id');
    expect(sql).toContain('その作成の監査ログの実行者が今回の実行者と一致するときだけ');
  });

  it.each([
    ['作成者の欄で確かめる', OWN],
    ['監査ログで確かめる', RECORDED],
  ] as const)('%s: 入力から入る列が既存の行と違えば、返さずに拒否の語 resend_input_mismatch(UC412)で断る', (_title, resend) => {
    const branch = resendBranch(build({ resend }), 'boxes');
    const differs = branch.indexOf("if v_row.title is distinct from (p_values ->> 'title') then");
    const refuse = branch.indexOf("raise exception using errcode = 'UC412', message = 'usecase_guard:' || 'box.create', detail = 'resend_input_mismatch';");
    const returns = branch.indexOf('return next v_row;');

    expect(differs).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(differs);
    expect(returns).toBeGreaterThan(refuse);
    // 実行者で埋まる列・id は比べない(同じ入力なら必ず同じ)。
    expect(branch).not.toContain('v_row.owner_id is distinct from');
    expect(branch).not.toContain('v_row.id is distinct from');
  });

  it('比べる列は入力から入る列だけ(id・実行者・時刻の式・トリガが供給する列は比べない)', () => {
    const columns = [
      { name: 'id', expression: 'p_id', fromParam: true, actor: false },
      { name: 'owner_id', expression: 'p_actor_id', fromParam: true, actor: true },
      { name: 'title', expression: "p_values ->> 'title'", fromParam: false, actor: false },
      { name: 'room_id', expression: 'p_room_id', fromParam: true, actor: false },
      { name: 'stamped_at', expression: 'v_now', fromParam: false, actor: false },
      { name: 'made_at', expression: "coalesce((p_values ->> 'made_at')::timestamptz, now())", fromParam: false, actor: false },
      { name: 'label', expression: "p_values ->> 'label'", fromParam: false, actor: false },
      { name: 'kind', expression: "'plain'", fromParam: false, actor: false },
    ];
    expect(resendComparedColumns(columns, new Set(['label'])).map((column) => column.name)).toEqual(['title', 'room_id']);
  });
});

describe('作成 RPC の実行者の参照の欄の縛り(by の段)', () => {
  /** 持ち主の欄の縛りの条件。 */
  const OWNER = 'coalesce((p_owner_id) = p_actor_id, false)';
  /** 承認者の欄(p_values から取り出す)の縛りの条件。 */
  const REVIEWER = "coalesce(((p_values ->> 'reviewer_id')::uuid) = p_actor_id, false)";

  /** ロールの段(0 行の分類の最初の if)の述語。 */
  function roleStage(sql: string): string {
    const start = sql.indexOf('    if not found then\n        if not (');
    expect(start).toBeGreaterThan(-1);
    return sql.slice(start, sql.indexOf("errcode = 'UC403'", start));
  }

  it('A(input に無い持ち主の欄): 既定のログインロールの規則の by に縛りが入り、ロールの段(UC403)で落ちる', () => {
    const sql = build({ resend: OWN });

    expect(roleStage(sql)).toContain(OWNER);
    // 書き込みの where にも同じ条件が入る(ロールの述語の一部)。
    expect(sql.slice(sql.indexOf('insert into public.boxes'), sql.indexOf('on conflict (id) do nothing'))).toContain(OWNER);
    // 書き込みの前に別の段で落とす形(以前の先頭の縛り)は持たない —— 順は engine と同じ「ロール → 再送 → 前提 → ガード」。
    expect(sql).not.toContain('is distinct from p_actor_id');
    // 挿入の前の再送の枝(点検 26 回目 B26-1)も、ロールの段(同じ述語)を先に置く。
    const pre = sql.indexOf('if exists (select 1 from public.boxes where id = p_id) then');
    expect(pre).toBeGreaterThan(-1);
    expect(sql.indexOf(OWNER, pre)).toBeLessThan(sql.indexOf('-- 再送', pre));
    expect(sql.indexOf(OWNER, sql.indexOf('on conflict (id) do nothing'))).toBeLessThan(
      sql.indexOf('if exists (select 1 from public.boxes where id = p_id) then', sql.indexOf('on conflict (id) do nothing')),
    );
  });

  it('system のロールだけの規則なら縛らない(実行者がいない内部実行)', () => {
    expect(build({ resend: NONE, creates: [create('system')] })).not.toContain(OWNER);
  });

  it('claim のロールの規則も、ロールの種類では解かない(A は両方の規則が縛る。規則ごとの積。点検 11 回目 A11-3)', () => {
    const stage = roleStage(build({ resend: NONE, creates: [create('member'), create('staff')] }));

    expect(stage.split(OWNER)).toHaveLength(3); // member の規則と staff の規則に 1 回ずつ
    expect(stage).toContain('is_staff');
  });

  it('A は delegate では解けない(input に出していない持ち主の欄まで開けない)', () => {
    const sql = build({ resend: NONE, creates: [delegated(create('member'), '窓口担当が代わりに作る', 'owner_id')] });

    expect(roleStage(sql)).toContain(OWNER);
  });

  it('B(input にある欄)に解く規則が 1 つも無ければ本文を組み立てない(誰が選んでも必ず UC403)', () => {
    const problems = build({ resend: NONE, input: ['box.title', 'box.reviewer_id'] });

    expect(problems).toContain('box.create の input に実行者の参照の欄 reviewer_id があります');
  });

  it('B は delegate で解ける。A(持ち主)は縛ったまま(承認者を選ぶ申請の形)', () => {
    const sql = build({
      resend: OWN,
      creates: [delegated(create('member'), '申請者が承認者を選ぶ', 'reviewer_id')],
      input: ['box.title', 'box.reviewer_id'],
    });

    expect(sql).not.toContain(REVIEWER);
    expect(roleStage(sql)).toContain(OWNER);
  });

  it('B を claim のロールの delegate が解く形(司書が利用者の名義で貸す): 名指さない規則だけが自分の名義に縛られる', () => {
    const stage = roleStage(build({ resend: NONE, creates: [create('member'), delegated(create('staff'), '窓口で利用者に代わって作る', 'owner_id')], input: ['box.title', 'box.owner_id'] }));

    expect(stage.split(OWNER)).toHaveLength(2);
    expect(stage).toContain('is_staff');
  });

  it('B は claim のロールでも、delegate で名指さなければ解けない(誰が選んでも必ず UC403 の形として止まる。点検 11 回目 A11-3)', () => {
    const problems = build({ resend: NONE, creates: [create('member'), create('staff')], input: ['box.title', 'box.owner_id'] });

    expect(problems).toContain('box.create の input に実行者の参照の欄 owner_id があります');
  });
});

describe('複合 RPC の先頭の再送の枝', () => {
  /** box.create だけの保存点。 */
  function usecase() {
    return usecaseSpec({
      name: 'demo',
      saves: [usecaseSave('make', [usecaseStep('box.create')], { migration: '20260909000050_usecase_demo_make.sql', name: 'demo' })],
    });
  }

  /** 生成した migration(失敗なら例外のメッセージ)。 */
  function generate(resend: DataTableSpec['resend']): string {
    try {
      return (
        usecaseRpcGenerator.generate(domain(), {
          ...GEN_CTX,
          actions: actions(),
          // 保存点の再送の入力の要約の置き場(錨が既存の行を返す保存点に要る。点検 21 回目 A21-1)
          dataTables: dataTableModel([boxes(resend), dataTable('resend_digests', { internal: true, framework: 'resend_digests', retentionHours: 24 })]),
          usecases: { available: true, usecases: [usecase()] },
        })[0]?.content ?? ''
      );
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  it('既存の行を返す前に作成者と入力の確かめを錨の作成の RPC に任せ(同じ引数で呼び直す)、通ったときだけ読み直す(点検 20 回目 B20-1)', () => {
    const sql = generate(OWN);
    const start = sql.indexOf('if exists (select 1 from public.boxes where id = p_id) then');
    const end = sql.indexOf('\n    end if;', start);
    const branch = sql.slice(start, end);
    const call = branch.indexOf('from api.insert_box(');
    const refuse = branch.indexOf("raise exception using errcode = 'UC409', message = 'usecase_conflict:box.create';", call);
    const returns = branch.indexOf('return jsonb_build_object(');

    expect(start).toBeGreaterThan(-1);
    // 他人の行・入力の違う再送は、呼び直した作成の RPC が断る(複合 RPC は確かめを 2 か所に書かない)。
    expect(call).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(call);
    expect(returns).toBeGreaterThan(refuse);
    expect(branch).not.toContain('t.owner_id = p_actor_id');
  });

  it('返さない宣言なら、錨の行があれば常に UC409(既存の行を返さない)', () => {
    const sql = generate(NONE);
    const start = sql.indexOf('if exists (select 1 from public.boxes where id = p_id) then');
    const end = sql.indexOf('end if;', start);

    expect(start).toBeGreaterThan(-1);
    expect(sql.slice(start, end)).toContain("errcode = 'UC409', message = 'usecase_conflict:' || 'box.create', detail = 'resend_already_saved';");
    expect(sql.slice(start, end)).not.toContain('return jsonb_build_object(');
  });

  it('錨の表に宣言が無ければ読み直しの判定(Y12 と共有)が問題にする', () => {
    const planned = planSave(usecase(), usecase().saves[0]!, {
      domain: domain(),
      actions: actions(),
      dataTables: dataTableModel([boxes(undefined)]),
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    const resolved = resolveSaveParams(planned.plan, domain());
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const readback = readbackPlans(planned.plan, resolved.steps);

    expect(readback.ok).toBe(false);
    expect(readback.ok ? '' : readback.problems.map((problem) => problem.message).join('\n')).toContain(
      'boxes.md に resend の宣言がありません',
    );
  });
});

describe('再送の作成者の欄の候補は owner で明示した欄だけ(点検 9 回目 A9-1)', () => {
  const OWNER = 'coalesce((p_owner_id) = p_actor_id, false)';
  const NOT_ACTOR = 'resend.creator(reviewer_id)は、insert_box が実行者そのもので埋める列ではありません';
  const REVIEWER: DataTableSpec['resend'] = { returnsExisting: true, creator: 'reviewer_id', location: AT };

  it.each([
    { name: 'owner で明示した欄を creator にすれば通る', options: { resend: OWN }, fragment: 'p_actor_id is not null and t.owner_id = p_actor_id' },
    {
      name: 'owner の宣言が無ければ、入力に無い必須の実行者参照でも作成者の欄にならない(推測しない)',
      options: { resend: OWN, owner: null },
      fragment: '作成者で埋めると明示された列が無いので',
    },
    {
      name: '必須の査閲者(owner で明示しない)を creator にすると止まり、直し方は明示の列だけを挙げる',
      options: { resend: REVIEWER, reviewerRequired: true },
      fragment: '作成者で埋めると明示された列(owner_id)に直す',
    },
    {
      name: '代理作成(起案者を input)で残った査閲者を creator にしても、直し方に査閲者の列を挙げない(探り台本 D1v の形)',
      options: { resend: REVIEWER, reviewerRequired: true, input: ['box.title', 'box.owner_id'], creates: [delegated(create('member'), '庶務が起案者を指名する', 'owner_id')] },
      fragment: '作成者で埋めると明示された列が無いので',
    },
  ])('$name', ({ options, fragment }) => {
    const result = build({ ...options, withSuggestion: true });

    expect(result).toContain(fragment);
    if (options.resend === REVIEWER) {
      expect(result).toContain(NOT_ACTOR);
      expect(result).not.toMatch(/明示された列\([^)]*reviewer_id/u);
    }
  });

  it('明示の持ち主の欄は規則の by の段で縛る', () => {
    expect(build({ resend: NONE })).toContain(OWNER);
  });
});
