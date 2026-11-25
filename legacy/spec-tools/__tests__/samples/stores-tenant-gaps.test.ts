/**
 * 題材 `stores` で、テナント境界の検査(V20 / V26)が**黙っていた形**の赤 → 緑(点検 3 回目 A3-1〜A3-4)。
 *
 * - A3-1: 状態遷移の guard から会社の項を外すと、会社管理者(claim)が他社の注文・移動を動かせる形として V26 が止める。
 * - A3-2(c): `context` に無い参照の欄(商品)を作成の入力で受けると、他社の商品を指す注文を作れる形として V26 が止める。
 * - A3-3: 未ログインの `scope: all` をテナントを持つ表に足すと、V20 が warning で名指す(ログイン中の人の境界まで消える)。
 * - A3-4: `accept` の `on: [create]` は読み取りを受け入れない(読み取りの境界を外すと V20 が error)。
 *
 * 題材本体は書き換えない(一時ツリーの写しだけを書き換える)。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { runSampleSystem } from './harness.js';
import type { SampleRun } from './harness.js';

const ORDER_STATES = 'docs/specs/domain/sales_order/states.md';
const MOVE_STATES = 'docs/specs/domain/stock_move/states.md';
const ORDER_ENTITY = 'docs/specs/domain/sales_order/entity.md';
const ORDER_CREATE = 'docs/specs/backend/actions/sales_order/create.md';
const ORDER_TABLE = 'docs/specs/backend/data/tables/sales_orders.md';
const PRODUCT_ACCESS = 'docs/specs/domain/product/access.md';
const MOVE_ACCESS = 'docs/specs/domain/stock_move/access.md';

/** 指摘を `検査 重さ 集約 規則の種類 ロール 列` の行にする。 */
function lines(run: SampleRun, verifier: string): string[] {
  return run.findings
    .filter((finding) => finding.verifier === verifier)
    .map((finding) => {
      const ce = finding.counterexample ?? {};
      return [finding.severity, ce['entity'], ce['key'] ?? 'reads', ce['event'] ?? '', ce['by'], ce['column'], ce['kind'] ?? ''].join(' ').replace(/ +/gu, ' ').trim();
    });
}

describe('stores — テナント境界の検査が黙っていた形(点検 3 回目)', () => {
  let plain: SampleRun;
  let transitionHole: SampleRun;
  let foreignRef: SampleRun;
  let anonymousAll: SampleRun;
  let createOnlyAccept: SampleRun;

  beforeAll(async () => {
    plain = await runSampleSystem('stores');
    transitionHole = await runSampleSystem('stores', {
      rewrite: {
        [ORDER_STATES]: (text) => text.replace(/ {4}guard: sales_order\.company_id == actor\.company_id[^\n]*\n/u, ''),
        [MOVE_STATES]: (text) => text.replace(' and stock_move.company_id == actor.company_id', ''),
      },
    });
    // 注文が商品を入力で受ける(context には足さない)= 他社の商品の id を入れられる。
    foreignRef = await runSampleSystem('stores', {
      rewrite: {
        [ORDER_ENTITY]: (text) =>
          text.replace(
            '  - name: total_amount\n',
            '  - name: product_id\n    type: ref(product)\n    required: true\n    label: 商品\n    description: 注文した商品\n    personal: false\n  - name: total_amount\n',
          ),
        [ORDER_CREATE]: (text) => text.replace('  - sales_order.store_id\n', '  - sales_order.store_id\n  - sales_order.product_id\n'),
        [ORDER_TABLE]: (text) =>
          text.replace('  - column: placed_by\n', '  - column: product_id\n    references: products\n    on_delete: restrict\n  - column: placed_by\n'),
      },
    });
    anonymousAll = await runSampleSystem('stores', {
      rewrite: { [PRODUCT_ACCESS]: (text) => text.replace('  - by: anonymous\n    scope: none\n', '  - by: anonymous\n    scope: all\n') },
    });
    // 読み取りの境界を外し、作成の理由だけを書いた accept(on: [create])で受け入れたつもりになる形。
    createOnlyAccept = await runSampleSystem('stores', {
      rewrite: {
        [MOVE_ACCESS]: (text) =>
          text
            .replace(/ {4}filters: \{ company_id: actor\.company_id \}[^\n]*\n/u, '')
            .replace(
              'accept:\n',
              'accept:\n  - by: staff_member\n    filter: company_id\n    on: [create]\n    reason: 作成のときは DB が写すので結ばなくてよい\n',
            ),
      },
    });
  }, 600_000);

  it('緑: 題材そのものは V20 / V26 とも 0 件(遷移の guard も会社を結んでいる)', () => {
    expect(lines(plain, 'V20')).toEqual([]);
    expect(lines(plain, 'V26')).toEqual([]);
  });

  it('赤(A3-1・A5-2): 遷移の guard から会社の項を外すと、会社管理者の取消を他社の行に届く形として止める(binding の店舗責任者も、編集と揃えて名指す)', () => {
    expect(lines(transitionHole, 'V26')).toEqual([
      'error sales_order events cancel store_manager company_id',
      'error sales_order events cancel company_admin company_id',
      'error stock_move events void store_manager company_id',
      'error stock_move events void company_admin company_id',
    ]);
  });

  it('赤(A3-1): 生成される遷移の RPC は、guard の会社の項を実行者の行から読んで比べる(仕様で結べば生成物も結ぶ)', () => {
    const rpc = [...plain.generatedFiles].find(([file]) => file.endsWith('_rpc_apply_sales_order_transition.sql'))?.[1] ?? '';
    expect(rpc).toMatch(/when p_event_id = 'sales_order\.cancel' and p_expected_state = 'awaiting_payment' then coalesce\(\(\(t\.company_id\) = \(\(select ractor\.company_id from public\.staff_members ractor where ractor\.id = p_actor_id\)\)\), false\)/u);
    const holed = [...transitionHole.generatedFiles].find(([file]) => file.endsWith('_rpc_apply_sales_order_transition.sql'))?.[1] ?? '';
    expect(holed).not.toContain('ractor.company_id');
  });

  it('赤(A3-1): 一致の証明は他のテナントの行でも実行する(境界を結んだ遷移・作成に crossTenant が立つ)', () => {
    const worlds = [...plain.generatedFiles].find(([file]) => file.endsWith('eq-worlds.ts'))?.[1] ?? '';
    const cancel = worlds.slice(worlds.indexOf("op: 'sales_order.cancel'"), worlds.indexOf("op: 'sales_order.create'"));
    expect(cancel).toContain('crossTenant: true');
    const pay = worlds.slice(worlds.indexOf("op: 'sales_order.pay'"));
    expect(pay.slice(0, pay.indexOf('},\n    ],'))).not.toContain('crossTenant');
  });

  it('赤(A3-2(c)): context に無い商品を入力で受けると、他社の商品を指す注文を作れる形として止める', () => {
    expect(lines(foreignRef, 'V26')).toEqual(['error sales_order creates staff_member product_id unbound_ref']);
  });

  it('赤(A3-3): 未ログインの scope: all をテナントを持つ表に足すと、V20 が warning で名指す', () => {
    expect(lines(anonymousAll, 'V20')).toEqual(['warning product reads anonymous company_id actorless_open']);
  });

  it('赤(A3-4): accept の on: [create] は読み取りを受け入れない(読み取りの境界を外すと V20 が error)', () => {
    expect(lines(createOnlyAccept, 'V20')).toEqual(['error stock_move reads staff_member company_id']);
  });
});
