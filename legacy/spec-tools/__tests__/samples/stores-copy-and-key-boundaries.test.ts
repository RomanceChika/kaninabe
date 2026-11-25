/**
 * 題材 `stores` の写しで、点検 12 回目の反例を全検証器に通す(A12-1・A12-2・A12-3 の赤 → 緑)。
 *
 * - A12-1: 状態の欄の `defaults` が `initial` を上書きする(探り台本 Y2)
 * - A12-2: 写しのトリガが隠し列・個人列の約束を切る(探り台本 H0・H1)
 * - A12-3: 一意の鍵からテナントの列を落とす(探り台本 U1)
 *
 * 題材本体は書き換えない(一時ツリーの写しだけを書き換える)。
 */

import { describe, expect, it } from 'vitest';
import { verifySample } from './harness.js';

const rep = (from: string, to: string) => (text: string): string => {
  const next = text.split(from).join(to);
  if (next === text) throw new Error(`no ${from}`);
  return next;
};

const NOTICE = 'docs/specs/domain/payment_notice/';
const PRODUCT_TABLE = 'docs/specs/backend/data/tables/products.md';
const PRODUCT_INVARIANTS = 'docs/specs/domain/product/invariants.md';
const ORDER_TABLE = 'docs/specs/backend/data/tables/sales_orders.md';

/** 注文者名を、従業員が読める入金通知の列へトリガで写す。 */
const copyCustomer = (personal: string, accept = ''): Readonly<Record<string, (text: string) => string>> => ({
  [`${NOTICE}entity.md`]: rep(
    '  - name: external_event_id\n',
    `  - name: customer_name\n    type: string\n    required: true\n    max_length: 60\n    supplied_by: db\n    label: 注文者名の写し\n    description: 写し\n    personal: ${personal}\n${personal === 'true' ? '    personal_placeholder: 消去済み\n' : ''}  - name: external_event_id\n`,
  ),
  [`${NOTICE}invariants.md`]: rep(
    '---\n\n# 入金通知',
    '  - id: INV-PAYMENT-NOTICE-009\n    statement: 注文者名の写し\n    entities: [payment_notice, sales_order]\n    formal:\n      type: check\n      expr: payment_notice.customer_name == sales_order.customer_name\n    enforced_by:\n      - kind: trigger\n        ref: sync_notice_customer\n---\n\n# 入金通知',
  ),
  [`${NOTICE}access.md`]: rep('  - by: staff_member\n    scope: none                     # 入金の生の記録は一般の従業員には見せない', '  - by: staff_member\n    scope: all\n    filters: { company_id: actor.company_id }'),
  'docs/specs/backend/data/tables/payment_notices.md': rep(
    'foreign_keys:\n',
    `triggers:\n  - name: sync_notice_customer\n    function: sync_notice_customer\n    fires: before insert or update of order_id, customer_name\n    supplies: [customer_name]\n    invariant: INV-PAYMENT-NOTICE-009\n${accept}\nforeign_keys:\n`,
  ),
});

const HIDDEN_ACCEPT = '    copy_accept:\n      - column: customer_name\n        on: hidden\n        role: staff_member\n        reader: staff_member\n        reason: 通知の画面では従業員に見せる業務である\n';

/** 指摘の文(書き換えが足すトリガの関数の宣言は、この試験の主題でないので数えない)。 */
async function messages(verifier: string, rewrites: Readonly<Record<string, (text: string) => string>>): Promise<readonly string[]> {
  return (await verifySample('stores', rewrites)).filter((finding) => finding.verifier === verifier && finding.severity === 'error' && !finding.message.includes('functions[]')).map((finding) => finding.message);
}

describe('stores — 点検 12 回目の反例', () => {
  it('A12-1: 状態の欄の defaults は T1 が止める(Y2)', async () => {
    const found = await messages('T1', { [ORDER_TABLE]: rep('defaults:\n', 'defaults:\n  state: "\'paid\'::text"\n') });
    expect(found).toEqual([expect.stringContaining('initial を黙って上書きします')]);
  });

  it('A12-2: 隠し列を隠した相手の読める列へ写すトリガは T15 が止める(H0)', async () => {
    expect(await messages('T15', copyCustomer('true'))).toEqual([expect.stringContaining('staff_member から隠した列')]);
  });

  it('A12-2: 個人列を personal: false へ写すトリガも止める(H1)', async () => {
    const found = await messages('T15', copyCustomer('false', HIDDEN_ACCEPT));
    expect(found).toEqual([expect.stringContaining('個人列の値を personal: true でない列へ写します')]);
  });

  it('A12-2: 理由つきの受け入れで緑', async () => {
    expect(await messages('T15', copyCustomer('true', HIDDEN_ACCEPT))).toEqual([]);
  });

  it('A12-3: 一意の鍵からテナントの列を落とすと V26 が止める(U1)。global_key で緑', async () => {
    const index = { [PRODUCT_TABLE]: rep('on: [company_id, sku]', 'on: [sku]') };
    const invariants = PRODUCT_INVARIANTS;
    expect(await messages('V26', { ...index, [invariants]: rep('keys: [company_id, sku]', 'keys: [sku]') })).toEqual([expect.stringContaining('境界 company_id を含まず')]);
    expect(await messages('V26', { ...index, [invariants]: rep('keys: [company_id, sku]', 'keys: [sku]\n      global_key:\n        keys: [sku]\n        reason: 仕入れ先が配る全社共通の番号') })).toEqual([]);
  });
});

const UNIQUE_ROW = '    on: [company_id, sku]\n    unique: true\n';

describe('stores — 点検 13 回目の反例', () => {
  it.each([
    { name: 'U2 索引だけ on: [sku]', table: rep('on: [company_id, sku]', 'on: [sku]'), message: '同じ列の集合ではありません' },
    { name: 'U2d 索引が不変条件より広い', table: rep('on: [company_id, sku]', 'on: [company_id, sku, name]'), message: '同じ列の集合ではありません' },
    { name: 'U2e 索引に where を足す', table: rep(UNIQUE_ROW, `${UNIQUE_ROW}    where: unit_price > 0\n`), message: '比べられる形ではありません' },
    { name: 'U2f 執行点の索引から unique を消す', table: rep(UNIQUE_ROW, '    on: [company_id, sku]\n'), message: 'unique: true がありません' },
  ])('A13-1: $name は T23 が止める', async ({ table, message }) => {
    expect(await messages('T23', { [PRODUCT_TABLE]: table })).toEqual([expect.stringContaining(message)]);
  });

  it('A13-1: U3 検索の索引に unique: true を足すだけでも V26 が止める。行の global_key で緑', async () => {
    const unique = (extra: string) => ({ [PRODUCT_TABLE]: rep('  - name: products_sku_idx\n', `  - name: products_sku_idx\n    unique: true\n${extra}`) });
    expect(await messages('V26', unique(''))).toEqual([expect.stringContaining('products_sku_idx の on [sku] は product の境界 company_id を含まず')]);
    expect(await messages('V26', unique('    global_key:\n      keys: [sku]\n      reason: 仕入れ先が配る全社共通の番号\n'))).toEqual([]);
  });

  it('A13-3: U7 計算した鍵も人の入力に数える', async () => {
    const found = await messages('V26', {
      [PRODUCT_INVARIANTS]: rep('keys: [company_id, sku]', 'keys: [sku]'),
      [PRODUCT_TABLE]: rep('on: [company_id, sku]', 'on: [sku]'),
      ['docs/specs/backend/actions/product/create.md']: (text) => rep('errors:\n', 'computes:\n  - field: product.sku\n    ref: makeSku\n\nerrors:\n')(rep('  - product.sku\n', '')(text)),
    });
    expect(found).toEqual([expect.stringContaining('境界 company_id を含まず')]);
  });

  it('A13-4: G6 受け入れの後で鍵を変えると腐った受け入れになる', async () => {
    const found = await messages('V26', {
      [PRODUCT_TABLE]: rep('on: [company_id, sku]', 'on: [sku, name]'),
      [PRODUCT_INVARIANTS]: rep('keys: [company_id, sku]', 'keys: [sku, name]\n      global_key:\n        keys: [sku]\n        reason: 仕入れ先が配る全社共通の番号'),
    });
    expect(found).toEqual([expect.stringContaining('名指した列 [sku] が今の鍵 [sku, name] と違います')]);
  });

  it('A13-4: C1 受け入れの後で写し先を未ログインへ開くと止まる', async () => {
    const rewrites = copyCustomer('true', HIDDEN_ACCEPT);
    const access = `${NOTICE}access.md`;
    const opened = { ...rewrites, [access]: (text: string) => rep('  - by: anonymous\n    scope: none', '  - by: anonymous\n    scope: all')((rewrites[access] ?? ((value) => value))(text)) };
    expect(await messages('T15', opened)).toEqual([expect.stringContaining('reads の by: anonymous で読めます')]);
  });

  it('A13-5: U8 隠した相手が書ける隠し列を鍵にすると V26 が止める', async () => {
    const statement = '  - id: INV-SALES-ORDER-099\n    statement: 同じ会社で顧客名は重複しない\n    entities: [sales_order]\n    formal:\n      type: uniqueness\n      keys: [company_id, customer_name]\n    enforced_by:\n      - kind: db_constraint\n        ref: sales_orders_customer_unique\n';
    const found = await messages('V26', {
      ['docs/specs/domain/sales_order/invariants.md']: rep('invariants:\n', `invariants:\n${statement}`),
      [ORDER_TABLE]: rep('indexes:\n', 'indexes:\n  - name: sales_orders_customer_unique\n    on: [company_id, customer_name]\n    unique: true\n    invariant: INV-SALES-ORDER-099\n'),
    });
    expect(found).toEqual([expect.stringContaining('customer_name は staff_member から隠した列で、staff_member が書けます')]);
  });
});
