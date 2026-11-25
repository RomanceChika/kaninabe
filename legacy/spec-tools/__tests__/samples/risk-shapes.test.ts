/**
 * 危ない形の検査(R 群)と読み込みの文法(R17)の**効き目の証明** —— 題材の写しを 1 か所だけ壊すと鳴り、受け入れを書くと消える。
 *
 * 「壊すと鳴る」の効き目の証明の形である。fixture 本体は書き換えず、
 * `verifySample` が一時ツリーの写しを壊して本物の `runAllVerifications` を通す(生成と型検査はしない軽い入口)。
 * 無改変の題材が R 群で 0 件であることは、題材ごとの既知解テスト(`{題材}.test.ts` の「error が無い」)が見ている。
 *
 * 1 つの `it` で 1 か所だけを壊す(2 か所を同時に壊すと、どちらが鳴らしたのか読めなくなる)。
 */

import { describe, expect, it } from 'vitest';
import { verifySample } from './harness.js';
import type { Finding } from '../../lib/kernel/finding.js';

/** その検査 ID の error(`検査 ID message`)。 */
function errorsOf(findings: readonly Finding[], id: string): readonly string[] {
  return findings.filter((finding) => finding.verifier === id && finding.severity === 'error').map((finding) => `${finding.location.file} ${finding.message}`);
}

/** 本文の 1 か所を置き換える書き換え(置き換えが効かなければ harness が throw する)。 */
function replace(from: string, to: string): (text: string) => string {
  return (text) => text.replace(from, to);
}

const EXTERNAL_CATALOG = 'docs/specs/backend/external.md';
const DEPARTMENT_ACCESS = 'docs/specs/domain/department/access.md';
const ADMIN_WRITER = `writes:
  - by: user
    fields: [admin_id]
  - by: department_admin`;

describe('R2 役の根拠の欄の書き手(壊すと鳴る)', () => {
  it('rooms: どの利用者も任意の部門の admin_id を書ける規則を足すと、部門の管理者のすり替えとして鳴る', async () => {
    const findings = await verifySample('rooms', { [DEPARTMENT_ACCESS]: replace('writes:\n  - by: department_admin', ADMIN_WRITER) });

    expect(errorsOf(findings, 'R2')).toEqual([
      expect.stringContaining('役 department_admin の根拠の欄 department.admin_id(binding)をその役を持たない user が書ける形です'),
    ]);
  });

  it('rooms: 同じ規則に self_assign の理由を書くと R2 は消える(その場で名指す受け入れ)', async () => {
    const accepted = `${ADMIN_WRITER.replace(
      'fields: [admin_id]',
      'fields: [admin_id]\n    self_assign:\n      - field: department.admin_id\n        role: department_admin\n        by: [user]\n        reason: 部門の管理者は社員が自分で名乗り出る運用(テストの受け入れ)',
    )}`;
    const findings = await verifySample('rooms', { [DEPARTMENT_ACCESS]: replace('writes:\n  - by: department_admin', accepted) });

    expect(errorsOf(findings, 'R2')).toEqual([]);
  });

  it('stores: 従業員が自分の is_admin を書ける規則を足すと、自己昇格として鳴る', async () => {
    const findings = await verifySample('stores', {
      'docs/specs/domain/staff_member/access.md': replace('fields_hidden:', 'writes:\n  - by: staff_member\n    fields: [is_admin]\nfields_hidden:'),
    });

    expect(errorsOf(findings, 'R2')).toEqual([expect.stringContaining('役 company_admin の根拠の欄 staff_member.is_admin(claim)')]);
  });

  it('stores: 従業員が自分の所属会社(actor.company_id の欄)を書ける規則を足すと、境界の乗り換えとして鳴る', async () => {
    const findings = await verifySample('stores', {
      'docs/specs/domain/staff_member/access.md': replace('fields_hidden:', 'writes:\n  - by: staff_member\n    fields: [company_id]\nfields_hidden:'),
    });

    expect(errorsOf(findings, 'R2')).toEqual([expect.stringContaining('実行者の属性 staff_member.company_id(actor.company_id の欄)')]);
  });
});

describe('R10 上限の無い欄(壊すと鳴る)', () => {
  it('stores: 商品コードの max_length を消すと鳴る', async () => {
    const findings = await verifySample('stores', { 'docs/specs/domain/product/entity.md': replace('    max_length: 24\n', '') });

    expect(errorsOf(findings, 'R10')).toEqual([expect.stringContaining('product.sku は長さの上限が無い文字列の欄です')]);
  });
});

const ROOM_ACCESS = 'docs/specs/domain/feedback/access.md';
const DEPARTMENT_ACCESS_FILE = 'docs/specs/domain/department/access.md';
const ROOM_TABLE = 'docs/specs/backend/data/tables/feedbacks.md';
const ROOM_ABUSE = `    abuse:
      global_ceiling: { max: 50, per: 1 hour }
`;
const ROOM_PUBLIC = `    public: 検査の足場。未ログインに削除を開けることを意図して受け入れている
`;

describe('R5 未ログインの書き込みの歯止め(壊すと鳴る)', () => {
  it('rooms: 無改変の題材は未ログインの作成(天井つき)・削除(理由つき)を持ち、R5 は 0 件(正例)', async () => {
    const findings = await verifySample('rooms', {});

    expect(errorsOf(findings, 'R5')).toEqual([]);
  });

  it('rooms: 未ログインの作成から abuse を消すと、全体の天井が無いとして鳴る', async () => {
    const findings = await verifySample('rooms', { [ROOM_ACCESS]: replace(ROOM_ABUSE, '') });

    expect(errorsOf(findings, 'R5')).toEqual([expect.stringContaining('feedback.creates[0](by: anonymous) は未ログインが書ける作成で、全体の天井がありません')]);
  });

  it('rooms: 未ログインの作成が無かった集約(department)に abuse の無い未ログインの作成を足すと鳴り、abuse を書くと消える(正の対)', async () => {
    const broken = await verifySample('rooms', { [DEPARTMENT_ACCESS_FILE]: replace('writes:\n', 'creates:\n  - by: anonymous\nwrites:\n') });
    const fixed = await verifySample('rooms', {
      [DEPARTMENT_ACCESS_FILE]: replace('writes:\n', 'creates:\n  - by: anonymous\n    abuse: { global_ceiling: { max: 10, per: 1 hour } }\nwrites:\n'),
    });

    expect(errorsOf(broken, 'R5')).toEqual([expect.stringContaining('department.creates[0](by: anonymous) は未ログインが書ける作成で、全体の天井がありません')]);
    expect(errorsOf(fixed, 'R5')).toEqual([]);
  });

  it('rooms: 表の DDL が生成物でない(ddl_migration を消す)と、生成器が天井を出せない宣言として R5-4 が鳴る', async () => {
    const findings = await verifySample('rooms', { [ROOM_TABLE]: replace('ddl_migration: 20260912120207_ddl_feedbacks.sql\n', '') });

    expect(errorsOf(findings, 'R5')).toEqual([expect.stringContaining('feedback.creates[0](by: anonymous) の abuse は、生成器が制約トリガにできません: 表 feedbacks の DDL が生成物ではありません')]);
  });

  it('rooms: 同名のトリガを手で宣言すると(二重になるので)R5-4 が鳴る', async () => {
    const findings = await verifySample('rooms', {
      [ROOM_TABLE]: replace(
        'ddl_migration: 20260912120207_ddl_feedbacks.sql\n',
        'ddl_migration: 20260912120207_ddl_feedbacks.sql\ntriggers:\n  - name: check_feedback_rate_limit\n    function: check_feedback_rate_limit\n    fires: after insert\n    deferred: true\n',
      ),
    });

    expect(errorsOf(findings, 'R5')).toEqual([expect.stringContaining('check_feedback_rate_limit という名前のトリガ・関数が宣言されています')]);
  });

  it('rooms: per_key.max が global_ceiling.max より大きいと鳴る', async () => {
    const findings = await verifySample('rooms', {
      [ROOM_ACCESS]: replace(ROOM_ABUSE, `    abuse:
      global_ceiling: { max: 50, per: 1 hour }
      per_key: { column: message, max: 51, per: 1 hour }
`),
    });

    expect(errorsOf(findings, 'R5')).toEqual([expect.stringContaining('per_key.max=51 が global_ceiling.max=50 より大きい')]);
  });

  it('rooms: per_key.column が欄に無い・at が日時でないと鳴る', async () => {
    const noColumn = await verifySample('rooms', {
      [ROOM_ACCESS]: replace(ROOM_ABUSE, `    abuse:
      global_ceiling: { max: 50, per: 1 hour }
      per_key: { column: no_such, max: 5, per: 1 hour }
`),
    });
    const notDatetime = await verifySample('rooms', {
      [ROOM_ACCESS]: replace(ROOM_ABUSE, `    abuse:
      global_ceiling: { max: 50, per: 1 hour }
      at: message
`),
    });

    expect(errorsOf(noColumn, 'R5')).toEqual([expect.stringContaining('per_key.column="no_such" は集約の欄にありません')]);
    expect(errorsOf(notDatetime, 'R5')).toEqual([expect.stringContaining('at="message" は日時(datetime)の欄ではありません')]);
  });

  it('rooms: 期間を切る欄が auto でない(空にできる・入力で書ける)・編集で書き換えられると、生成器が支えられない宣言として鳴る', async () => {
    const notAuto = await verifySample('rooms', {
      [ROOM_ACCESS]: replace(ROOM_ABUSE, `    abuse:
      global_ceiling: { max: 50, per: 1 hour }
      at: message
`),
    });
    const nullable = await verifySample('rooms', {
      'docs/specs/domain/feedback/entity.md': replace('  - name: created_at\n    type: datetime\n    auto: true\n', '  - name: created_at\n    type: datetime\n'),
    });

    expect(errorsOf(notAuto, 'R5')).toEqual([expect.stringContaining('at="message"')]);
    expect(errorsOf(nullable, 'R5')).toEqual([expect.stringContaining('期間を切る欄が決まりません')]);
  });

  it('rooms: 未ログインでない作成(system)に abuse を書くと、効く先の無い宣言として鳴る', async () => {
    const findings = await verifySample('rooms', {
      [ROOM_ACCESS]: replace('creates:\n', 'creates:\n  - by: system\n    abuse: { global_ceiling: { max: 5, per: 1 hour } }\n'),
    });

    expect(errorsOf(findings, 'R5')).toEqual([expect.stringContaining('feedback.creates[0](by: system) に abuse がありますが')]);
  });

  it('rooms: 未ログインの削除から public の理由を消すと鳴り、未ログインの更新を public なしで足しても鳴る', async () => {
    const noReason = await verifySample('rooms', { [ROOM_ACCESS]: replace(ROOM_PUBLIC, '') });
    const openedWrite = await verifySample('rooms', { [ROOM_ACCESS]: replace('deletes:\n', 'writes:\n  - by: anonymous\n    fields: [message]\ndeletes:\n') });

    expect(errorsOf(noReason, 'R5')).toEqual([expect.stringContaining('feedback.deletes[0](by: anonymous) は未ログインが更新・削除・遷移を起こせる形です')]);
    expect(errorsOf(openedWrite, 'R5')).toEqual([expect.stringContaining('feedback.writes[0](by: anonymous) は未ログインが更新・削除・遷移を起こせる形です')]);
  });

  it('rooms: 未ログインの更新に public で理由を書くと消え、未ログインでない削除に public を書くと腐った受け入れとして鳴る', async () => {
    const accepted = await verifySample('rooms', {
      [ROOM_ACCESS]: replace('deletes:\n', 'writes:\n  - by: anonymous\n    fields: [message]\n    public: テストの受け入れ\ndeletes:\n'),
    });
    const stray = await verifySample('rooms', {
      [ROOM_ACCESS]: replace('deletes:\n', 'deletes:\n  - by: system\n    public: 未ログインでないのに書いた理由\n'),
    });

    expect(errorsOf(accepted, 'R5')).toEqual([]);
    expect(errorsOf(stray, 'R5')).toEqual([expect.stringContaining('feedback.deletes[0](by: system) に public がありますが')]);
  });
});

const PAID_OPEN = '    timeout_ms: 10000\n    endpoints: [/api/transfer]\n    spend: paid\n';
const PAID_GROUND = '    meter: update_claim\n    authz: { kind: role, role: accountant }\n';
const PAID_ABUSE = `${PAID_OPEN}${PAID_GROUND}    abuse:\n      max_body_bytes:\n        /api/transfer: 4096\n      quota: { max: 5, per: 1 hour, key: actor }\n`;

describe('R5-7 / R5-8 有料の口の濫用の歯止めの宣言(壊すと鳴る。宣言の検査で、執行は X8 が見る)', () => {
  it('expenses: 無改変の題材は有料の口を持たず、R5 は 0 件', async () => {
    expect(errorsOf(await verifySample('expenses', {}), 'R5')).toEqual([]);
  });

  it('expenses: 口(endpoints)つきの spend: paid に abuse が無いと R5-7 が鳴り、abuse(口ごとの上限 + 枠)を書くと消える(正の対)', async () => {
    const broken = await verifySample('expenses', { [EXTERNAL_CATALOG]: replace('    timeout_ms: 10000\n', PAID_OPEN) });
    const fixed = await verifySample('expenses', { [EXTERNAL_CATALOG]: replace('    timeout_ms: 10000\n', PAID_ABUSE) });

    expect(errorsOf(broken, 'R5')).toEqual([expect.stringContaining('連携 bank_transfer は spend: paid の口(/api/transfer)ですが、濫用の歯止めの宣言が揃っていません')]);
    expect(errorsOf(fixed, 'R5')).toEqual([]);
  });

  it('expenses: 本文の上限が口に足りない・枠の source が config に無いと R5-7 が鳴る', async () => {
    const noLimit = await verifySample('expenses', { [EXTERNAL_CATALOG]: replace('    timeout_ms: 10000\n', PAID_ABUSE.replace('/api/transfer: 4096', '/api/other: 4096')) });
    const noSource = await verifySample('expenses', { [EXTERNAL_CATALOG]: replace('    timeout_ms: 10000\n', PAID_ABUSE.replace('max: 5', 'source: NOT_IN_CONFIG')) });

    expect(errorsOf(noLimit, 'R5')).toEqual([expect.stringContaining('abuse.max_body_bytes に口の上限がありません: /api/transfer')]);
    expect(errorsOf(noSource, 'R5')).toEqual([expect.stringContaining('quota.source="NOT_IN_CONFIG" は config カタログに実在しません')]);
  });

  it('expenses: meter が data_table の rpc に無い・authz が public・役が台帳に無いと R5-7 が鳴る(いずれも宣言の接地)', async () => {
    const noRpc = await verifySample('expenses', { [EXTERNAL_CATALOG]: replace('    timeout_ms: 10000\n', PAID_ABUSE.replace('meter: update_claim', 'meter: not_an_rpc')) });
    const open = await verifySample('expenses', { [EXTERNAL_CATALOG]: replace('    timeout_ms: 10000\n', PAID_ABUSE.replace('{ kind: role, role: accountant }', '{ kind: public }')) });
    const noRole = await verifySample('expenses', { [EXTERNAL_CATALOG]: replace('    timeout_ms: 10000\n', PAID_ABUSE.replace('role: accountant', 'role: nobody')) });
    const contextual = await verifySample('expenses', { [EXTERNAL_CATALOG]: replace('    timeout_ms: 10000\n', PAID_ABUSE.replace('role: accountant', 'role: approver')) });

    expect(errorsOf(noRpc, 'R5')).toEqual([expect.stringContaining('meter="not_an_rpc" は data_table の kind: rpc の関数に実在しません')]);
    expect(errorsOf(open, 'R5')).toEqual([expect.stringContaining('authz.kind: public は有料の口に書けません')]);
    expect(errorsOf(noRole, 'R5')).toEqual([expect.stringContaining('authz.role="nobody" は役の台帳に実在しません')]);
    expect(errorsOf(contextual, 'R5')).toEqual([expect.stringContaining('authz.role="approver" は対象の行に依って立つ文脈依存の役です')]);
  }, 480_000);

  it('stores: 受信の連携に spend: paid を書くと、効く先の無い宣言として R5-8 が鳴る', async () => {
    const findings = await verifySample('stores', { [EXTERNAL_CATALOG]: replace('    retry: none\n', '    retry: none\n    spend: paid\n') });

    expect(errorsOf(findings, 'R5')).toEqual([expect.stringContaining('連携 payment_notice_webhook に spend がありますが、受信の連携です')]);
  });
});

describe('X7 外へ送る自由文の無害化(壊すと鳴る)', () => {
  it('expenses: 送る欄から無害化の宣言を消すと、送る行に neutralize が無いとして読み込みで落ちる', async () => {
    const findings = await verifySample('expenses', { [EXTERNAL_CATALOG]: replace('      neutralize: [control_chars]\n', '') });

    expect(findings.filter((finding) => finding.severity === 'error').map((finding) => finding.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('sends に neutralize がありません')]),
    );
  });

  it('expenses: 利用者が入力で書く申請の件名(claim.title)を送りながら neutralize_none と書くと X7 が鳴る', async () => {
    const findings = await verifySample('expenses', {
      [EXTERNAL_CATALOG]: (text) =>
        text
          .replace('fields: [claim.total_amount, employee.display_name]', 'fields: [claim.total_amount, claim.title]')
          .replace('      neutralize: [control_chars]\n', '      neutralize_none: 検査の足場(件名は送らないつもり)\n'),
    });

    const x7 = errorsOf(findings, 'X7');
    expect(x7).toHaveLength(1);
    expect(x7[0]).toContain('neutralize_none');
    expect(x7[0]).toContain('claim.title');
  });

  it('expenses: 件名を送っても、無害化の部品を宣言すれば X7 は鳴らない(対照。アダプタの突合は題材に実装の木が無いので飛ぶ)', async () => {
    const findings = await verifySample('expenses', { [EXTERNAL_CATALOG]: replace('fields: [claim.total_amount, employee.display_name]', 'fields: [claim.total_amount, claim.title]') });

    expect(errorsOf(findings, 'X7')).toEqual([]);
  });
});

describe('R17 読み込みの文法(壊すと読み込みで落ちる)', () => {
  it('stores: 受信のポート名に import を閉じる並びを書くと X0 で落ちる', async () => {
    const findings = await verifySample('stores', {
      [EXTERNAL_CATALOG]: replace('port: PaymentNoticeReceiver', "port: \"PaymentNoticeReceiver } from 'x'; import { Y\""),
    });

    expect(errorsOf(findings, 'X0')).toEqual([expect.stringContaining('port が書ける形ではありません')]);
  });

  it('stores: 2 つの表が同じ名前の関数を宣言すると(別の overload)T0 で落ちる', async () => {
    const overload = `functions:
  - name: insert_product
    args: [uuid]
    params: [p_id]
    kind: rpc
    shape: composite
    returns: rows
    also_writes: {}
    self_writes: []
  - name: insert_store`;
    const findings = await verifySample('stores', { 'docs/specs/backend/data/tables/stores.md': replace('functions:\n  - name: insert_store', overload) });

    expect(errorsOf(findings, 'T0')).toEqual([expect.stringContaining('関数 insert_product を 2 つの表が宣言しています')]);
  });

  it('rooms: ロール ID に SQL の文を書くと V1 で落ちる', async () => {
    const findings = await verifySample('rooms', {
      'docs/specs/domain/roles.md': replace('  - id: system', '  - id: "x on public.t; drop table y; --"\n    kind: anonymous\n  - id: system'),
    });

    expect(errorsOf(findings, 'V1')).toEqual(expect.arrayContaining([expect.stringContaining('id が書ける形ではありません')]));
  });
});
