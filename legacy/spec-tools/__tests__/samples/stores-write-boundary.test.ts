/**
 * 題材 `stores` の書き込みのテナント境界(V26)の赤 → 緑。
 *
 * 実例の穴: 商品の作成は `company_id` を入力で受けるのに、`when` が実行者の会社と結んでいなければ、会社管理者が
 * 他社の商品を作れる(読み取りの境界 `reads[].filters` が閉じていても、書き込みが開いていれば境界は無いのと同じ)。
 *
 * - 緑: 題材そのもの(`when` で `product.company_id == actor.company_id` を結んでいる)は V26 が 0 件。
 * - 赤: 一時ツリーの写しの `when` を外すと、外した規則を名指して V26 が error を出す(題材本体は書き換えない)。
 */

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { runSampleSystem, verifySample } from './harness.js';
import type { Finding } from '../../lib/kernel/finding.js';
import type { SampleRun } from './harness.js';

const PRODUCT_ACCESS = 'docs/specs/domain/product/access.md';

/** 題材の `when`(商品の作成)。 */
const CREATE_WHEN = '    when: product.company_id == actor.company_id   # 他社の商品は作れない(テナント境界。company_id は入力で受けるので、ここで結ばないと他社に作れる)\n';
/** 題材の `when`(商品の編集)。 */
const READ_FILTERS = '    filters: { company_id: actor.company_id }   # 会社を跨がない(テナント境界)\n';
const MOVE_ACCESS = 'docs/specs/domain/stock_move/access.md';
const NOTICE_ACCESS = 'docs/specs/domain/payment_notice/access.md';
const PRODUCT_TERM = ' and product.company_id == actor.company_id';
const WRITE_WHEN = '    when: product.company_id == actor.company_id   # 他社の商品は直せない(テナント境界)\n';
const TABLE_SPECS = 'docs/specs/backend/data/tables';
const STORES_TABLE = `${TABLE_SPECS}/stores.md`;
const STAFF_TABLE = `${TABLE_SPECS}/staff_members.md`;

/** data_table から、INV-STORE-002 のトリガ 1 本(`triggers[]` の行と `functions[]` の行)を取り除く。 */
function withoutStoreManagerTrigger(name: string): (text: string) => string {
  return (text) => {
    const triggers = new RegExp(`triggers:\\n {2}- name: ${name}\\n(?: {4}.*\\n)+\\n`);
    // 表にほかのトリガ(凍結の freeze_* など)があれば、その要素だけを外す。
    const item = new RegExp(` {2}- name: ${name}\\n(?: {4}.*\\n)+`);
    const fn = new RegExp(` {2}- name: ${name}\\n {4}args: \\[\\]\\n {4}kind: trigger\\n`);
    const dropped = text.replace(triggers, '');
    return (dropped === text ? text.replace(item, '') : dropped).replace(fn, '');
  };
}

/** V26 の指摘を `ロール 規則の種類` の行にする。 */
function v26Lines(run: SampleRun): string[] {
  return run.errors
    .filter((finding) => finding.verifier === 'V26')
    .map((finding) => `${finding.counterexample?.['entity']}.${finding.counterexample?.['key']} by ${finding.counterexample?.['by']}`);
}

describe('stores — 書き込みのテナント境界(V26)', () => {
  let plain: SampleRun;
  let createHole: SampleRun;
  let writeHole: SampleRun;
  let readHole: SampleRun;
  let productHole: SampleRun;
  let receiptHole: SampleRun;
  let noticeReadOnly: SampleRun;
  // 検証だけ(トリガを外すと、そのトリガの掴みの宣言が覆っていた責任者の新しい行の先掴みも消え、update_store は生成を断られる —— T6)。
  let retargetHole: readonly Finding[];
  let oneEndHole: SampleRun;

  beforeAll(async () => {
    plain = await runSampleSystem('stores');
    createHole = await runSampleSystem('stores', { rewrite: { [PRODUCT_ACCESS]: (text) => text.replace(CREATE_WHEN, '') } });
    writeHole = await runSampleSystem('stores', { rewrite: { [PRODUCT_ACCESS]: (text) => text.replace(WRITE_WHEN, '') } });
    readHole = await runSampleSystem('stores', { rewrite: { [PRODUCT_ACCESS]: (text) => text.replace(READ_FILTERS, '') } });
    productHole = await runSampleSystem('stores', { rewrite: { [MOVE_ACCESS]: (text) => text.replace(PRODUCT_TERM, '') } });
    // 伝票の受け入れ(on: [create])を読み取りだけ(on 無し)に戻す = 書き込みを受け入れない。
    receiptHole = await runSampleSystem('stores', {
      rewrite: { [MOVE_ACCESS]: (text) => text.replace('    filter: stock_receipt.company_id\n    on: [create]\n', '    filter: stock_receipt.company_id\n') },
    });
    noticeReadOnly = await runSampleSystem('stores', {
      rewrite: { [NOTICE_ACCESS]: (text) => text.replace('    filter: company_id\n    on: [create]\n', '    filter: company_id\n') },
    });
    // 責任者の付け替えを縛る執行点(INV-STORE-002 の両端のトリガ)を外す = 新しい責任者の会社を縛るものが無くなる。
    retargetHole = await verifySample('stores', {
      [STORES_TABLE]: withoutStoreManagerTrigger('check_store_manager_company'),
      [STAFF_TABLE]: withoutStoreManagerTrigger('check_store_manager_company_on_staff_member'),
    });
    // 片側(責任者の側)だけを外す = 従業員が別の会社へ移るのを止めるものが無くなる。
    oneEndHole = await runSampleSystem('stores', {
      rewrite: { [STAFF_TABLE]: withoutStoreManagerTrigger('check_store_manager_company_on_staff_member') },
    });
  }, 300_000);

  it('緑: 題材は書き込みのどの規則でも境界を結んでいる(V26 が 0 件)', () => {
    expect(v26Lines(plain)).toEqual([]);
  });

  it('赤: 商品の作成から when を外すと、会社管理者が他社の商品を作れる形として止まる', () => {
    expect(v26Lines(createHole)).toEqual(['product.creates by company_admin']);
    const finding = createHole.errors.find((entry) => entry.verifier === 'V26');
    expect(finding?.message).toContain('actor.company_id');
    expect(finding?.message).toContain('他のテナントの行を書ける形');
  });

  it('赤: 商品の編集から when を外すと、他社の商品を直せる形として止まる(作成だけでなく編集も)', () => {
    expect(v26Lines(writeHole)).toEqual(['product.writes by company_admin']);
  });

  it('赤: 読み取りの filters を外すと V20 が error で止める(warning で通らない)', () => {
    const findings = readHole.findings.filter((finding) => finding.verifier === 'V20');
    expect(findings.map((finding) => finding.severity)).toEqual(['error']);
    expect(findings[0]?.counterexample).toMatchObject({ entity: 'product', by: 'staff_member', column: 'company_id' });
    expect(plain.findings.filter((finding) => finding.verifier === 'V20')).toEqual([]);
  });

  it('赤: 在庫の移動から商品の結びを外すと、他社の商品を指す移動を作れる形として止まる(入力で受ける親は 1 本ずつ結ぶ)', () => {
    expect(v26Lines(productHole)).toEqual(['stock_move.creates by staff_member']);
    const finding = productHole.errors.find((entry) => entry.verifier === 'V26');
    expect(finding?.counterexample?.['column']).toBe('product.company_id');
  });

  it('赤: 書き込みの受け入れ(on)を外すと、読み取りだけの accept は書き込みを受け入れない(error)', () => {
    expect(v26Lines(receiptHole)).toEqual(['stock_move.creates by staff_member']);
    expect(receiptHole.errors.find((entry) => entry.verifier === 'V26')?.counterexample?.['column']).toBe('stock_receipt.company_id');
  });

  it('赤: 内部実行(system)の作成は受け入れが無ければ warning で名指される(error にはしない)', () => {
    expect(plain.warnings.filter((finding) => finding.verifier === 'V26')).toEqual([]);
    const warnings = noticeReadOnly.warnings.filter((finding) => finding.verifier === 'V26');
    expect(warnings.map((finding) => finding.counterexample?.['entity'])).toEqual(['payment_notice']);
    expect(noticeReadOnly.errors.filter((finding) => finding.verifier === 'V26')).toEqual([]);
  });

  it('緑: 店舗の責任者の付け替え(編集)は accept 無しで通る(INV-STORE-002 のトリガが実在する執行点として数えられる)', () => {
    expect(plain.errors.filter((finding) => finding.verifier === 'V26')).toEqual([]);
    const access = readFileSync(new URL('../fixtures/samples/stores/docs/specs/domain/store/access.md', import.meta.url), 'utf-8');
    expect(access).not.toContain('filter: manager_id');
  });

  it('赤: 店舗の責任者の付け替え(編集)は、執行点のトリガを両端とも外すと error で止まる(旧い値への when だけでは新しい責任者の会社を縛れない)', () => {
    const errors = retargetHole.filter((finding) => finding.severity === 'error');
    const lines = errors.filter((finding) => finding.verifier === 'V26');
    expect(lines.map((finding) => `${finding.counterexample?.['entity']}.${finding.counterexample?.['field']} by ${finding.counterexample?.['by']}`)).toEqual([
      'store.manager_id by company_admin',
    ]);
    expect(lines[0]?.counterexample?.['kind']).toBe('retarget');
    // 外したトリガの掴みの宣言(staff_members を書いた後の manager_id で掴む)が消えると、外部キーの確かめの先掴みも照らせなくなる(点検 fix26 3 回目 D26c-1)。
    expect(errors.filter((finding) => finding.verifier === 'T6').map((finding) => finding.counterexample?.['function'])).toEqual(['update_store']);
  });

  it('赤: 別の集約の列との等式は片側のトリガだけでは通らない(T17 が欠けた端を名指す)', () => {
    const lines = oneEndHole.errors.filter((finding) => finding.verifier === 'T17');
    expect(lines.map((finding) => finding.counterexample?.['missingSide'])).toEqual(['referenced']);
    expect(lines[0]?.message).toContain('INV-STORE-002');
    expect(lines[0]?.message).toContain('staff_member');
  });
});
