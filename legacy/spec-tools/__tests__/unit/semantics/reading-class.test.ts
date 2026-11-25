/**
 * 公理 / 導出 / 受け入れの分類(`semantics/reading-class.ts`)のテスト。
 *
 * 設計メモ book-human-face.md §7-2 の表を、そのまま固定する。要素の種類で決まる分は宣言しない —
 * 表に無い種類は型で書けず、どの種類も 3 つのどれか 1 つに入る。
 */

import { describe, expect, it } from 'vitest';
import {
  elementsOf,
  isRequiredReading,
  READER_NAMES,
  READING_ELEMENTS,
  READING_READERS,
  readerOf,
  readerOfFinding,
  readingClassOf,
  type ReadingElement,
} from '../../../lib/semantics/reading-class.js';
import { SIGN_ELEMENT, SIGN_READER, signClassOf, type SignHost } from '../../../lib/semantics/reading-sign.js';

describe('要素の種類 → 分類(§7-2 の表)', () => {
  it('公理: invariant の statement と formal・state の label と summary・遷移の意味・access の filters と when・タスクの予算・計算の例の表', () => {
    for (const element of ['invariant.statement', 'invariant.formal', 'state.label', 'state.summary', 'transition.meaning', 'access.filters', 'access.when', 'usecase.budget', 'computes.example'] as const) {
      expect(readingClassOf(element), element).toBe('axiom');
    }
  });

  it('導出: enforced_by・tests・遷移表・実行計画・RPC・RLS・結果表・突合・computes の宣言(式は DSL の外)', () => {
    for (const element of ['invariant.enforced_by', 'invariant.tests', 'transition.table', 'execution.plan', 'rpc.body', 'rls.policy', 'result.table', 'parity.expectation', 'computes.declaration'] as const) {
      expect(readingClassOf(element), element).toBe('derived');
    }
  });

  it('受け入れ: accept・「例:」・handwritten・runner の理由と、まだ通していない警告', () => {
    for (const element of ['accept.reason', 'accept.example', 'handwritten.reason', 'runner.reason', 'finding.pending'] as const) {
      expect(readingClassOf(element), element).toBe('accepted');
    }
  });

  it('導出のはずが人の手で書かれたもの(hooks・手書きのアダプタ)は、注釈が公理に結ぶので導出に置く(宣言は要らない)', () => {
    expect(readingClassOf('hooks.body')).toBe('derived');
    expect(readingClassOf('adapter.handwritten')).toBe('derived');
  });

  it('どの種類も 3 つの分類のどれか 1 つに入り、3 つの分類の和が全種類になる', () => {
    const all = Object.keys(READING_ELEMENTS) as ReadingElement[];
    const union = [...elementsOf('axiom'), ...elementsOf('accepted'), ...elementsOf('derived')];

    expect([...union].sort()).toEqual([...all].sort());
    expect(new Set(union).size).toBe(all.length);
  });

  it('必読は公理と受け入れ。導出は読まなくてよい', () => {
    expect(isRequiredReading('axiom')).toBe(true);
    expect(isRequiredReading('accepted')).toBe(true);
    expect(isRequiredReading('derived')).toBe(false);
  });
});

describe('通知・ジョブ・画面の層(束 ブック ⑧-b。別の表を作らず、同じ表に種類を足す)', () => {
  const NOTIFICATION = ['notification.audience', 'notification.mention', 'notification.summary', 'notification.source', 'notification.tests'] as const;
  const JOB = ['job.schedule', 'job.due_from', 'job.summary', 'job.on_failure', 'job.implementation', 'job.source', 'job.tests'] as const;
  const SCREEN = ['screen.for', 'screen.precondition', 'screen.reads', 'screen.actions', 'screen.parts', 'screen.variants', 'screen.navigation', 'screen.testid', 'screen.preview', 'screen.tests'] as const;

  it('通知: 誰に・どの強さで・何を知らせるかは公理、発火元と照合テストは導出', () => {
    for (const element of ['notification.audience', 'notification.mention', 'notification.summary'] as const) expect(readingClassOf(element), element).toBe('axiom');
    for (const element of ['notification.source', 'notification.tests'] as const) expect(readingClassOf(element), element).toBe('derived');
  });

  it('ジョブ: いつ・何を基準に・何をし・失敗したらどうするかは公理、走査の実装と登録・積む元・契約テストは導出', () => {
    for (const element of ['job.schedule', 'job.due_from', 'job.summary', 'job.on_failure'] as const) expect(readingClassOf(element), element).toBe('axiom');
    for (const element of ['job.implementation', 'job.source', 'job.tests'] as const) expect(readingClassOf(element), element).toBe('derived');
  });

  it('画面: 誰が入れて・何を読み・何を束ね・何を出すかは公理、遷移・testid・プレビュー・画面テストは導出', () => {
    for (const element of ['screen.for', 'screen.precondition', 'screen.reads', 'screen.actions', 'screen.parts', 'screen.variants'] as const) expect(readingClassOf(element), element).toBe('axiom');
    for (const element of ['screen.navigation', 'screen.testid', 'screen.preview', 'screen.tests'] as const) expect(readingClassOf(element), element).toBe('derived');
  });

  it('画面の排他表示(variants)は公理: 照合相手の無い「同時には出ない」の宣言で、画面のテストは実装が守ることだけを見る(束 ブック ⑧-b2 の裁定)。遷移(navigations)は配線で画面のテストが照合するので導出のまま', () => {
    expect(readingClassOf('screen.variants')).toBe('axiom');
    expect(readingClassOf('screen.navigation')).toBe('derived');
  });

  it('画面の `ux:` の受け入れは既存の accept.reason に載せる。層ごとの受け入れの種類を足すのは、読み手が違うときだけ', () => {
    const accepted = elementsOf('accepted');

    expect(accepted).toContain('accept.reason');
    for (const element of [...NOTIFICATION, ...JOB, ...SCREEN]) expect(accepted, element).not.toContain(element);
  });

  it('時刻の登録をまだしていない理由(not_scheduled_reason)は受け入れで、読み手は開発者(cron を結線する運用の判断。業務の規定ではない)', () => {
    expect(readingClassOf('job.not_scheduled_reason')).toBe('accepted');
    expect(readerOf('job.not_scheduled_reason')).toBe('developer');
  });

  it('層の公理はすべて業務(人が意味を判定する宣言は業務の言葉で書かれている)で、導出は開発者', () => {
    for (const element of [...NOTIFICATION, ...JOB, ...SCREEN]) {
      expect(readerOf(element), element).toBe(readingClassOf(element) === 'axiom' ? 'business' : 'developer');
    }
  });
});

describe('認証・設定・保証・可視性・操作の層(束 ブック ⑧-c。同じ表に種類を足す)', () => {
  const AXIOMS = ['auth.condition', 'auth.branch', 'auth.landing', 'auth.gate', 'config.summary', 'config.absence', 'config.kind', 'config.requirement', 'guarantee.statement'] as const;
  const DERIVED = [
    'auth.axis',
    'auth.implementation',
    'auth.tests',
    'config.integration',
    'config.target',
    'config.template',
    'config.crypto',
    'config.logging',
    'config.log_events',
    'config.log_fields',
    'guarantee.enforcer',
    'guarantee.tests',
    'guarantee.mutation',
    'visibility.matrix',
    'visibility.personal',
    'visibility.query',
    'action.operation',
    'action.exception',
  ] as const;

  it('認証は決定表の条件の軸(値と持つ行を直接宣言する軸)・分岐・着地・関門、設定は意味と無いときの挙動と値の性質・要求度の語、保証は「起こりえない」という性質が公理', () => {
    for (const element of AXIOMS) expect(readingClassOf(element), element).toBe('axiom');
  });

  it('主語の軸・実装・テスト・連携の表・置き場・雛形との対応・執行者・変異の目録・横断の表・操作の表は導出', () => {
    for (const element of DERIVED) expect(readingClassOf(element), element).toBe('derived');
  });

  it('公理は業務、導出は開発者(人が意味を判定する宣言は業務の言葉で書かれている)', () => {
    for (const element of AXIOMS) expect(readerOf(element), element).toBe('business');
    for (const element of DERIVED) expect(readerOf(element), element).toBe('developer');
  });

  it('雛形に載せない理由(config.not_in_template_reason)は受け入れで、読み手は開発者(環境の運用の判断。業務の規定ではない)', () => {
    expect(readingClassOf('config.not_in_template_reason')).toBe('accepted');
    expect(readerOf('config.not_in_template_reason')).toBe('developer');
  });

  it('可視性と操作の章に公理の種類は無い: 可視性の宣言は access.* が、操作に関わる理由は既存の受け入れの種類が、集約の章で既に数えている', () => {
    const axioms = elementsOf('axiom');

    expect(axioms.filter((element) => element.startsWith('visibility.') || element.startsWith('action.'))).toEqual([]);
    for (const element of ['ux.override.reason', 'runner.reason', 'handwritten.reason', 'lint.exception.reason'] as const) {
      expect(readingClassOf(element), element).toBe('accepted');
    }
  });
});

describe('標識の分類(人が書いた判断の場所。導出ではない)', () => {
  const hosts = Object.keys(SIGN_ELEMENT) as SignHost[];

  it('どの仕様の種類に付いた標識も、導出にはならない', () => {
    for (const host of hosts) expect(signClassOf(host), host).not.toBe('derived');
  });

  it('公理を宣言する仕様(ドメインの 4 ファイルとロール)の標識は公理の側、導出の置き場に残された判断は受け入れの側', () => {
    for (const host of ['entity', 'states', 'invariants', 'access', 'roles'] as const) expect(signClassOf(host), host).toBe('axiom');
    for (const host of ['action', 'table', 'usecase', 'query', 'surface', 'notice', 'catalog', 'screen', 'design'] as const) {
      expect(signClassOf(host), host).toBe('accepted');
    }
  });
});

describe('読み手(宣言は増やさない。項目の種類で決まる)', () => {
  it('どの種類にも読み手があり、表に無い種類は型で書けない(分類の表と同じ鍵)', () => {
    expect(Object.keys(READING_READERS).sort()).toEqual(Object.keys(READING_ELEMENTS).sort());
    expect(READER_NAMES).toEqual({ business: '業務', developer: '開発者' });
  });

  it('公理はすべて業務(人が意味を判定する宣言は業務の言葉で書かれている)', () => {
    for (const element of elementsOf('axiom')) expect(readerOf(element), element).toBe('business');
  });

  it('受け入れは種類で分かれる: accept: と「例:」は業務、手書き・定型外・確認の上書き・リントの受け入れは開発者', () => {
    for (const element of ['accept.reason', 'accept.example'] as const) expect(readerOf(element), element).toBe('business');
    for (const element of ['handwritten.reason', 'runner.reason', 'ux.override.reason', 'lint.exception.reason', 'finding.pending'] as const) {
      expect(readerOf(element), element).toBe('developer');
    }
  });

  it('警告は検査の群で決まる: V 群(ドメイン仕様の意味)は業務、T・A・Y・S・Q・W などの構造の検査は開発者', () => {
    expect(readerOfFinding('V20')).toBe('business');
    for (const id of ['T8', 'T11', 'T15', 'T2', 'A18', 'Y10', 'S3', 'Q4', 'W1']) expect(readerOfFinding(id), id).toBe('developer');
  });

  it('疑う先の要素が表で決まる検査は、その要素の読み手になる: Y5(タスクの予算の超過)は業務の規定(usecase.budget)への疑い', () => {
    expect(readerOfFinding('Y5')).toBe('business');
    expect(readerOf('usecase.budget')).toBe('business');
    // 群が同じ Y10(保存点が不変条件を実行しない)は構造の警告のまま。
    expect(readerOfFinding('Y10')).toBe('developer');
  });

  it('章頭の 1 文・節の要約・段の場面は、書かれた文を人が読む公理(業務)', () => {
    for (const element of ['entity.summary', 'machine.summary', 'state.summary'] as const) {
      expect(readingClassOf(element), element).toBe('axiom');
      expect(readerOf(element), element).toBe('business');
    }
  });

  it('標識は付いた仕様の種類で決まる: ドメインの仕様・ロール・操作・タスク・読み取り経路・surface・画面・通知は業務、表・設計・ほかのカタログは開発者', () => {
    for (const host of ['entity', 'states', 'invariants', 'access', 'roles', 'action', 'usecase', 'query', 'surface', 'screen', 'notice'] as const) {
      expect(SIGN_READER[host], host).toBe('business');
    }
    for (const host of ['table', 'design', 'catalog'] as const) expect(SIGN_READER[host], host).toBe('developer');
    // 標識の種類は分類(SIGN_ELEMENT)と同じ全域で、読み手の表も全域。
    expect(Object.keys(SIGN_READER).sort()).toEqual(Object.keys(SIGN_ELEMENT).sort());
  });
});
