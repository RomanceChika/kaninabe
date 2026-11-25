/**
 * 題材 `stores` の**テナントの根の表**(`company`)を、テナント境界の検査(V20 / V26)が見ることの赤 → 緑(点検 4 回目 A4-1)。
 *
 * 根は自分を指す参照の列を持たないので、以前は境界の候補が 0 件だった —— 読み取りの `filters` を消しても・会社管理者の
 * `writes` を `when` なしで足しても・guard なしの遷移を足しても、V20 / V26 は黙っていた(生成される RPC は会社を比べない =
 * A 社の管理者が B 社の会社の行を書き換え・停止できる)。根では `id` を境界の列として扱い、`company.id == actor.company_id` で結ぶ。
 *
 * - 緑: 題材そのもの(`filters: { id: actor.company_id }` を手で書いている形)は V20 / V26 とも 0 件(stores-tenant-gaps と同じ)。
 * - 赤: 3 つの反例がそれぞれ error。
 * - 緑: `when` で結んだ編集は V26 が黙り、生成される RPC の認可が会社を実行者の行から読んで比べる。
 *
 * 題材本体は書き換えない(一時ツリーの写しだけを書き換える)。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { runSampleSystem } from './harness.js';
import type { SampleRun } from './harness.js';

const D = 'docs/specs/domain/company/';
const COMPANY_ACCESS = `${D}access.md`;
const COMPANY_ENTITY = `${D}entity.md`;
const COMPANY_TABLE = 'docs/specs/backend/data/tables/companies.md';
const UPDATE_ACTION = 'docs/specs/backend/actions/company/update.md';

/** 会社管理者の会社名の編集(`when` は引数で選ぶ)。 */
const withWrite = (when: string | null) => (text: string): string =>
  text.replace(
    '---\n\n# 会社のアクセス権限',
    `writes:\n  - by: company_admin\n    fields: [name]\n${when === null ? '' : `    when: ${when}\n`}---\n\n# 会社のアクセス権限`,
  );

/** 会社の停止(guard なし)の状態遷移。 */
const STATES = `---
doc_type: state_spec
scope: common
id: company-states
state_machine: company
states:
  - id: active
    label: 有効
  - id: suspended
    label: 停止
    tone: negative
initial: active
final: [suspended]
events:
  - id: suspend
    label: 停止する
    from: [active]
    to: suspended
    by: [company_admin]
    otherwise_forbidden: 停止済み
---

# 会社の状態
`;

/** 会社名の編集の action_spec(生成物の RPC を作るため)。 */
const ACTION = `---
doc_type: action_spec
scope: backend
id: company-update-action
handles: company.update
input:
  - company.id
  - company.name
errors:
  inherits: common
  additional: []
---

# 会社名の編集
`;

/** 会社名の編集の RPC(data_table の functions)。 */
const withFunction = (text: string): string =>
  text.replace(
    'indexes:',
    `functions:
  - name: update_company
    args: [uuid, jsonb, uuid, "text[]", "text[]"]
    params: [p_company_id, p_changes, p_actor_id, p_actor_roles, p_effects]
    kind: rpc
    shape: update
    migration: 20260912100099_rpc_update_company.sql
    also_writes: {domain_events: [insert]}

indexes:`,
  );

/** 指摘を `重さ 集約 規則の種類 ロール 列` の行にする(会社の指摘だけ)。 */
function lines(run: SampleRun, verifier: string): string[] {
  return run.findings
    .filter((finding) => finding.verifier === verifier && finding.counterexample?.['entity'] === 'company')
    .map((finding) => {
      const ce = finding.counterexample ?? {};
      return [finding.severity, ce['entity'], ce['key'] ?? 'reads', ce['event'] ?? '', ce['by'], ce['column'] ?? ce['rules']].join(' ').replace(/ +/gu, ' ').trim();
    });
}

/** 生成された `api.update_company` の SQL。 */
function updateRpc(run: SampleRun): string {
  return [...run.generatedFiles].find(([file]) => file.endsWith('_rpc_update_company.sql'))?.[1] ?? '';
}

describe('stores — テナントの根の表(company)の境界(点検 4 回目 A4-1)', () => {
  let readOpen: SampleRun;
  let writeOpen: SampleRun;
  let transitionOpen: SampleRun;
  let writeBound: SampleRun;

  beforeAll(async () => {
    readOpen = await runSampleSystem('stores', {
      rewrite: { [COMPANY_ACCESS]: (text) => text.replace(/ {4}filters: \{ id: actor\.company_id \}[^\n]*\n/u, '') },
    });
    writeOpen = await runSampleSystem('stores', {
      rewrite: { [COMPANY_ACCESS]: withWrite(null), [UPDATE_ACTION]: () => ACTION, [COMPANY_TABLE]: withFunction },
    });
    transitionOpen = await runSampleSystem('stores', {
      rewrite: {
        [COMPANY_ENTITY]: (text) =>
          text.replace('  - name: created_at\n', '  - name: state\n    type: state(company)\n    label: 状態\n    description: 状態\n    personal: false\n  - name: created_at\n'),
        [`${D}states.md`]: () => STATES,
      },
    });
    writeBound = await runSampleSystem('stores', {
      rewrite: { [COMPANY_ACCESS]: withWrite('company.id == actor.company_id'), [UPDATE_ACTION]: () => ACTION, [COMPANY_TABLE]: withFunction },
    });
  }, 600_000);

  it('赤: 根の読み取りの filters を消すと、全社の会社の行が全従業員に見える形として V20 が止める', () => {
    expect(lines(readOpen, 'V20')).toEqual(['error company reads staff_member id']);
  });

  it('赤: 会社管理者の編集を when なしで足すと、他社の会社の行を書き換えられる形として V26 が止める(以前は「検査できない」の warning だけ)', () => {
    expect(lines(writeOpen, 'V26')).toEqual(['error company writes company_admin id']);
    // 結ばなければ生成物も会社を比べない(検査が止める理由そのもの)。
    expect(updateRpc(writeOpen)).toContain('create or replace function api.update_company(');
    expect(updateRpc(writeOpen)).not.toContain('ractor.company_id');
  });

  it('赤: 根に guard なしの遷移を足すと、他社の会社を停止できる形として V26 が止める(以前は無音)', () => {
    expect(lines(transitionOpen, 'V26')).toEqual(['error company events suspend company_admin id']);
  });

  it('緑: when に company.id == actor.company_id を書けば V26 は黙り、生成される RPC の認可が会社を実行者の行と比べる', () => {
    expect(lines(writeBound, 'V26')).toEqual([]);
    const rpc = updateRpc(writeBound);
    expect(rpc).toContain('create or replace function api.update_company(');
    // 会社の行の id を、実行者の行(staff_members)の会社と比べる(写しのトークンではなく行から読む)。
    expect(rpc).toContain('coalesce(((t.id) = ((select ractor.company_id from public.staff_members ractor where ractor.id = p_actor_id))), false)');
  });
});
