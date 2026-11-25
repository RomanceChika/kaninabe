/**
 * 遷移の境界(V26)の受け入れと binding のロールの赤 → 緑(点検 5 回目 A5-1・A5-2。探り台本 audit-r5/A/probe1 の B0〜B2・C1 / C2)。
 *
 * - A5-1: `accept` の `events` の名指しは**遷移の定義の単位**。同じ ID の遷移が遷移元違いで 2 本あると、ID だけの名指しは曖昧で V2 が error
 *   (後から足した 2 本目に黙って効かない)。`{ID}@{遷移元の状態}` で 1 本目だけを受け入れ、2 本目は V26 が名指す。
 * - A5-2: binding のロールの遷移も、編集(`writes` の `when`)と同じく境界の項を guard に求める(archive の起案者の回覧)。
 *
 * 題材本体は書き換えない(一時ツリーの写しだけを書き換える)。
 */

import { describe, expect, it } from 'vitest';
import type { Finding } from '../../lib/kernel/finding.js';
import { verifySample } from './harness.js';

const SD = 'docs/specs/domain/company/';
const COMPANY_ENTITY = `${SD}entity.md`;
const COMPANY_ACCESS = `${SD}access.md`;
const COMPANY_STATES = `${SD}states.md`;
const AD = 'docs/specs/domain/document/';

/** 会社に状態を足す。 */
const addState = (text: string): string =>
  text.replace('  - name: created_at\n', '  - name: state\n    type: state(company)\n    label: 状態\n    description: 状態\n    personal: false\n  - name: created_at\n');

/** 会社の状態機械(遷移を差し込む)。 */
const states = (events: string) => (): string =>
  [
    '---',
    'doc_type: state_spec',
    'scope: common',
    'id: company-states',
    'state_machine: company',
    'states:',
    '  - id: active',
    '    label: 有効',
    '  - id: pending',
    '    label: 審査中',
    '  - id: suspended',
    '    label: 停止',
    '    tone: negative',
    'initial: pending',
    'final: [suspended]',
    'events:',
    `${events}---`,
    '',
    '# 会社の状態',
    '',
  ].join('\n');

/** 1 本目の停止(有効な会社)と、審査を通す内部実行。 */
const FIRST = [
  '  - id: suspend',
  '    label: 停止する',
  '    from: [active]',
  '    to: suspended',
  '    by: [company_admin]',
  '    otherwise_forbidden: 停止済み',
  '  - id: activate',
  '    label: 有効にする',
  '    from: [pending]',
  '    to: active',
  '    by: [system]',
  '    otherwise_forbidden: 審査中だけ',
  '',
].join('\n');

/** 後から足した 2 本目の停止(審査中の会社。同じ ID・同じロール・遷移元違い。V8 は通す)。 */
const SECOND = [
  '  - id: suspend',
  '    label: 審査中のまま停止する',
  '    from: [pending]',
  '    to: suspended',
  '    by: [company_admin]',
  '    otherwise_forbidden: 審査中だけ',
  '',
].join('\n');

/** 会社の access_spec に遷移の受け入れを足す(名指しを差し替えられる)。 */
const accept = (events: string) => (text: string): string =>
  text.replace(
    '---\n\n# 会社のアクセス権限',
    `accept:\n  - by: company_admin\n    filter: id\n    on: [transition]\n    events: [${events}]\n    reason: 有効な会社の停止は契約の解除で、運営の会社管理者が全社に対して行う\n---\n\n# 会社のアクセス権限`,
  );

/** V2 / V26 の指摘を `検査 重さ イベント ロール 種類` の行にする(会社の遷移と受け入れの分だけ)。 */
function lines(findings: readonly Finding[]): string[] {
  return findings
    .filter((finding) => (finding.verifier === 'V26' || finding.verifier === 'V2') && finding.counterexample?.['entity'] === 'company')
    .map((finding) => {
      const ce = finding.counterexample ?? {};
      return [finding.verifier, finding.severity, ce['event'] ?? ce['events'] ?? '', ce['by'] ?? '', ce['kind'] ?? ''].join(' ').replace(/ +/gu, ' ').trim();
    });
}

describe('A5-1: 遷移の受け入れは遷移の定義の単位で名指す(stores の会社の停止)', () => {
  /** [題, 遷移, 受け入れの名指し(null = 受け入れなし), 期待する行]。 */
  const CASES: readonly (readonly [string, string, string | null, readonly string[]])[] = [
    ['B0 停止 1 本・受け入れなし → V26 が名指す', FIRST, null, ['V26 error suspend company_admin']],
    ['B1 停止 1 本・ID で受け入れ → 緑', FIRST, 'suspend', []],
    ['B1b 停止 1 本・遷移元で絞って受け入れ → 緑(境界: 1 本でも @ の形は使える)', FIRST, 'suspend@active', []],
    ['B2 2 本目を足すと、ID だけの名指しは曖昧 → V2 が error・どちらの定義も受け入れない', FIRST + SECOND, 'suspend', ['V2 error suspend company_admin ambiguous', 'V26 error suspend company_admin', 'V26 error suspend company_admin']],
    ['B3 遷移元で 1 本目だけを受け入れ → 2 本目だけを V26 が名指す', FIRST + SECOND, 'suspend@active', ['V26 error suspend company_admin']],
    ['B4 両方を遷移元で受け入れ → 緑', FIRST + SECOND, 'suspend@active, suspend@pending', []],
    ['B5 当たらない遷移元 → V2 が当たらないと言う', FIRST + SECOND, 'suspend@suspended, suspend@active', ['V2 error suspend@suspended company_admin', 'V26 error suspend company_admin']],
    ['B6 そのロールで起こせない遷移(system の activate)→ V2 が当たらないと言う', FIRST, 'suspend, activate', ['V2 error activate company_admin']],
  ];

  it.each(CASES)('%s', async (_title, events, named, expected) => {
    const rewrite = { [COMPANY_ENTITY]: addState, [COMPANY_STATES]: states(events), ...(named === null ? {} : { [COMPANY_ACCESS]: accept(named) }) };
    expect(lines(await verifySample('stores', rewrite)).sort()).toEqual([...expected].sort());
  });

  it('B2 の V2 の指摘は、遷移元で絞る綴りを対処に出す', async () => {
    const findings = await verifySample('stores', { [COMPANY_ENTITY]: addState, [COMPANY_STATES]: states(FIRST + SECOND), [COMPANY_ACCESS]: accept('suspend') });
    const ambiguous = findings.find((finding) => finding.verifier === 'V2' && finding.counterexample?.['kind'] === 'ambiguous');
    expect(ambiguous?.suggestion).toContain('suspend@active / suspend@pending');
    const unaccepted = findings.find((finding) => finding.verifier === 'V26' && finding.counterexample?.['event'] === 'suspend');
    expect(unaccepted?.suggestion).toMatch(/events: \[suspend@(active|pending)\]/u);
  });

  it('名指しの形が読めない(@ の後が空・区切りが違う)→ 読み込みの error', async () => {
    for (const bad of ['suspend@', 'suspend#active']) {
      const findings = await verifySample('stores', { [COMPANY_ENTITY]: addState, [COMPANY_STATES]: states(FIRST), [COMPANY_ACCESS]: accept(bad) });
      expect(findings.some((finding) => finding.severity === 'error' && finding.message.includes('の形が読めません')), bad).toBe(true);
    }
  });
});

describe('A5-2: binding のロールの遷移も境界を guard に求める(archive の起案者)', () => {
  /** 回覧の guard を外し、起案者(binding)だけにする(探り台本 C1)。 */
  const dropCirculateGuard = (text: string): string =>
    text.replace(
      '    by: [document_author, curator]\n    guard: document.department_id == actor.department_id   # 他部署の文書は動かせない(部署の境界。curator は部署に依らず立つロールなので行の部署を結ぶ —— V26)\n',
      '    by: [document_author]\n',
    );

  it('題材そのもの(回覧の guard が部署を結ぶ)は V26 が 0 件', async () => {
    expect((await verifySample('archive')).filter((finding) => finding.verifier === 'V26')).toEqual([]);
  });

  it('C1: 起案者(binding)の回覧から部署の項を外すと、編集(C2)と同じく V26 が error', async () => {
    const circulate = (await verifySample('archive', { [`${AD}states.md`]: dropCirculateGuard })).filter((finding) => finding.verifier === 'V26');
    expect(circulate.map((finding) => `${finding.severity} ${String(finding.counterexample?.['event'])} ${String(finding.counterexample?.['by'])}`)).toEqual(['error circulate document_author']);
    const write = (await verifySample('archive', { [`${AD}access.md`]: (text) => text.replace('when: state == drafting and document.department_id == actor.department_id', 'when: state == drafting') })).filter(
      (finding) => finding.verifier === 'V26',
    );
    expect(write.map((finding) => finding.severity)).toEqual(['error']);
  });
});
