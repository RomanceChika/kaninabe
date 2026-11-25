/**
 * 仕組みの保証台帳の生成(本文ブロック・章の読み取り専用の表)のユニットテスト。
 *
 * 固定するのは:
 *   - 本文ブロックは製品の台帳と同じ本文を、台帳ごとの書き先(framework/guarantees.md)に出す。書くのは自分の木のときだけ
 *   - 台帳を読めなかった(阻害)・根を渡していないときは、何も書かず投げない
 *   - 章に「仕組みの保証」の表が 1 つ出る。読めなかったときは名指しで言い、黙って消さない。製品の台帳が無ければ章そのものが出ない
 */

import { describe, expect, it } from 'vitest';
import { frameworkGuaranteeBodyGenerator } from '../../../../lib/generate/render/guarantee-body.js';
import { bookChapterSections, pageText } from '../../../helpers/book-html.js';
import type { FrameworkLedgerInput } from '../../../../lib/generate/framework-ledger-context.js';
import { specModel, stubGuards } from '../../../helpers/model-builder.js';
import { frameworkGuaranteeModel, guarantee, guaranteeModel } from '../../../helpers/guarantee-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_LAYOUT, TEST_PLATFORM } from '../../../helpers/platform.js';
import { NO_GATES } from '../../../helpers/generate-context.js';

const FW_MODEL = frameworkGuaranteeModel([
  guarantee('fw_engine', { label: '表に無い遷移は許さない', canaries: ['TC-FW-ENGINE-001', 'TC-FW-ENGINE-002'] }),
  guarantee('fw_later', { status: 'planned', plannedReason: '着手待ち' }),
]);

/** 製品の台帳に仕組みの台帳の入力を添えた生成の文脈。 */
function ctx(frameworkLedger?: FrameworkLedgerInput) {
  return {
    guards: stubGuards(),
    roots: TEST_ROOTS,
    platform: TEST_PLATFORM,
    layout: TEST_LAYOUT,
    gates: NO_GATES,
    guarantees: guaranteeModel([guarantee('rows_by_rls', { canaries: ['TC-GUAR-ROWS-001'] })]),
    ...(frameworkLedger === undefined ? {} : { frameworkLedger }),
  };
}

const LOADED: FrameworkLedgerInput = { load: { state: 'loaded', model: FW_MODEL, findings: [] }, ownTree: true };

describe('framework-guarantee-body(本文ブロック)', () => {
  it('仕組みの台帳の本文を framework/guarantees.md の guarantee-body に出す(製品の台帳と同じ形の本文)', () => {
    const sections = frameworkGuaranteeBodyGenerator.generate(specModel([]), ctx(LOADED));

    expect(sections).toHaveLength(1);
    expect(sections[0]?.file).toBe('framework/guarantees.md');
    expect(sections[0]?.marker).toBe('guarantee-body');
    const content = sections[0]?.content ?? '';
    expect(content).toContain('| `fw_engine` | 表に無い遷移は許さない |');
    expect(content).toContain('`TC-FW-ENGINE-001`, `TC-FW-ENGINE-002`');
    expect(content).toContain('### まだ執行されていない保証(1 件');
  });

  it('別の製品の木を生成しているとき(ownTree でない)は、道具の木の台帳へ書かない', () => {
    expect(frameworkGuaranteeBodyGenerator.generate(specModel([]), ctx({ ...LOADED, ownTree: false }))).toEqual([]);
  });

  it('台帳を読めなかった(阻害)・根を渡していないときは、何も出さず投げない', () => {
    const blocked: FrameworkLedgerInput = { load: { state: 'blocked', reason: '台帳がありません', findings: [] }, ownTree: true };

    expect(frameworkGuaranteeBodyGenerator.generate(specModel([]), ctx(blocked))).toEqual([]);
    expect(frameworkGuaranteeBodyGenerator.generate(specModel([]), ctx({ load: { state: 'not_requested' }, ownTree: true }))).toEqual([]);
    expect(frameworkGuaranteeBodyGenerator.generate(specModel([]), ctx())).toEqual([]);
  });
});

describe('book-guarantees(HTML の本の保証の章。仕組みの保証の表)', () => {
  function chapter(frameworkLedger?: FrameworkLedgerInput): string {
    return pageText(bookChapterSections(specModel([]), ctx(frameworkLedger), 'guarantees.html')[0]?.content ?? '');
  }

  it('読み取り専用の表に、仕組みの保証の ID・label・状態・見張りテストの本数が並ぶ', () => {
    const content = chapter(LOADED);

    expect(content).toContain('仕組みの保証(読み取り専用)');
    expect(content).toContain('fw_engine | 表に無い遷移は許さない | enforced | 2');
    expect(content).toContain('fw_later |');
    expect(content).toContain('保証 2 本');
  });

  it('台帳を読めなかったときは「読めなかった」と理由を名指しで言い、章は生成される(投げない)', () => {
    const content = chapter({ load: { state: 'blocked', reason: '台帳がありません', findings: [] }, ownTree: true });

    expect(content).toContain('仕組みの保証(読み取り専用)');
    expect(content).toContain('読めなかった: 台帳がありません');
    expect(content).not.toContain('fw_engine |');
  });

  it('仕組みの台帳を読んでいない(根を渡さない)ときは、節を出さない', () => {
    expect(chapter()).not.toContain('仕組みの保証');
    expect(chapter({ load: { state: 'not_requested' }, ownTree: true })).not.toContain('仕組みの保証');
  });

  it('製品の台帳が無ければ章そのものが出ない(表だけを単独で出さない)', () => {
    const noProduct = { ...ctx(LOADED), guarantees: guaranteeModel([], { available: false }) };

    expect(bookChapterSections(specModel([]), noProduct, 'guarantees.html')).toEqual([]);
  });
});
