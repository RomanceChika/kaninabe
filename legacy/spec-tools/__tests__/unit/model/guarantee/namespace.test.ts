/**
 * 保証台帳 2 本の名前空間の予約(Z0 が持ち主つきで検査する)のユニットテスト。
 *
 * 規約: 仕組みの台帳は保証 ID `fw_…`・テストケース ID `TC-FW-…`・文書 ID `framework-guarantee-catalog`。
 * 製品の台帳はそれらを**使えない**(ID は台帳をまたいで全体で一意 — 持ち主つきのキーにしない)。
 * 台帳をまたぐ canary(他方の台帳のテストケースを指す)も、自分の台帳の test_cases に閉じるので落ちる。
 */

import { describe, expect, it } from 'vitest';
import { SpecReporter } from '../../../../lib/model/parse-common.js';
import { parseGuaranteeCatalog } from '../../../../lib/model/guarantee/parse-guarantee.js';
import type { LedgerOwner } from '../../../../lib/kernel/ledger-owner.js';

const VOCABULARY = { enforcer: [{ id: 'type_system' }, { id: 'rls' }] };

/** 保証 1 件とそのテストケース 1 件を持つ台帳のフロントマター。 */
function frontmatter(init: { id: string; guarantee: string; testCase: string; canary?: string }): Record<string, unknown> {
  return {
    doc_type: 'guarantee_spec',
    scope: 'backend',
    id: init.id,
    vocabulary: VOCABULARY,
    guarantees: [
      {
        id: init.guarantee,
        label: '言い切り',
        enforced_by: ['rls'],
        status: 'enforced',
        canaries: [init.canary ?? init.testCase],
        summary: '説明',
      },
    ],
    test_cases: [
      {
        id: init.testCase,
        type: 'unit',
        covers: ['forbidden'],
        spec_ids: [init.id],
        implementation: 'x/__tests__/a.test.ts::見張る',
      },
    ],
  };
}

function parse(data: Record<string, unknown>, owner: LedgerOwner) {
  return parseGuaranteeCatalog(data, new SpecReporter('framework/guarantees.md'), { owner });
}

const FRAMEWORK_OK = { id: 'framework-guarantee-catalog', guarantee: 'fw_engine', testCase: 'TC-FW-ENGINE-001' };
const PRODUCT_OK = { id: 'guarantee-catalog', guarantee: 'rows_by_rls', testCase: 'TC-GUAR-ROWS-001' };

describe('Z0: 名前空間の予約', () => {
  it('仕組みの台帳は fw_ / TC-FW- / framework-guarantee-catalog で通り、台帳の id もその値になる', () => {
    const { value, findings } = parse(frontmatter(FRAMEWORK_OK), 'framework');

    expect(findings).toEqual([]);
    expect(value?.id).toBe('framework-guarantee-catalog');
  });

  it('製品の台帳は予約の綴りを使わなければ通る(owner を省いても製品)', () => {
    const result = parseGuaranteeCatalog(frontmatter(PRODUCT_OK), new SpecReporter('docs/specs/backend/guarantees.md'));

    expect(result.findings).toEqual([]);
    expect(result.value?.id).toBe('guarantee-catalog');
  });

  it('製品の台帳が fw_ 始まりの保証 ID を使うと error', () => {
    const { findings } = parse(frontmatter({ ...PRODUCT_OK, guarantee: 'fw_rows' }), 'product');

    expect(findings.map((f) => f.message)).toEqual([expect.stringContaining('仕組みの予約(fw_ 始まり)の綴り')]);
    expect(findings[0]?.severity).toBe('error');
  });

  it('製品の台帳が TC-FW- 始まりのテストケース ID を使うと error', () => {
    const { findings } = parse(frontmatter({ ...PRODUCT_OK, testCase: 'TC-FW-ROWS-001' }), 'product');

    expect(findings.map((f) => f.message)).toEqual([expect.stringContaining('仕組みの予約(TC-FW- 始まり)の綴り')]);
  });

  it('製品の台帳が文書 ID framework-guarantee-catalog を宣言すると error', () => {
    const { findings } = parse(frontmatter({ ...PRODUCT_OK, id: 'framework-guarantee-catalog' }), 'product');

    expect(findings.some((f) => f.message.includes('カタログの id ではありません'))).toBe(true);
  });

  it('仕組みの台帳が fw_ 始まりでない保証 ID を使うと error', () => {
    const { findings } = parse(frontmatter({ ...FRAMEWORK_OK, guarantee: 'engine' }), 'framework');

    expect(findings.map((f) => f.message)).toEqual([expect.stringContaining('fw_ 始まりではありません')]);
  });

  it('仕組みの台帳が TC-FW- 始まりでないテストケース ID を使うと error', () => {
    const { findings } = parse(frontmatter({ ...FRAMEWORK_OK, testCase: 'TC-GUAR-ENGINE-001' }), 'framework');

    expect(findings.map((f) => f.message)).toEqual([expect.stringContaining('TC-FW- 始まりではありません')]);
  });

  it('仕組みの台帳が文書 ID guarantee-catalog を宣言すると error(製品の id は使えない)', () => {
    const { findings } = parse(frontmatter({ ...FRAMEWORK_OK, id: 'guarantee-catalog' }), 'framework');

    expect(findings.some((f) => f.message.includes('カタログの id ではありません'))).toBe(true);
  });

  it('台帳をまたぐ canary(他方の台帳のテストケースを指す)は、自分の test_cases に無いので error', () => {
    const product = parse(frontmatter({ ...PRODUCT_OK, canary: 'TC-FW-ENGINE-001' }), 'product');
    const framework = parse(frontmatter({ ...FRAMEWORK_OK, canary: 'TC-GUAR-ROWS-001' }), 'framework');

    for (const { findings } of [product, framework]) {
      expect(findings.some((f) => f.message.includes('に対応する test_cases がありません'))).toBe(true);
    }
  });

  it('同じ保証 ID が両方の台帳にあれば、製品の側が予約を破った error として現れる(台帳をまたぐ重複を黙って通さない)', () => {
    const framework = parse(frontmatter(FRAMEWORK_OK), 'framework');
    const product = parse(frontmatter({ ...PRODUCT_OK, guarantee: FRAMEWORK_OK.guarantee }), 'product');

    expect(framework.findings).toEqual([]);
    expect(product.findings.some((f) => f.message.includes('仕組みの予約(fw_ 始まり)の綴り'))).toBe(true);
  });
});
