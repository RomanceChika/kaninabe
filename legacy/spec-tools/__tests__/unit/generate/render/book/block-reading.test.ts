/**
 * ブロックごとの読む量(`render/book/block-reading.ts`)と、手引きの「読む量」の節のテスト。
 *
 * 必読 = 公理 + 受け入れ(理由つき + まだ通していない)。仕様ファイル 1 枚を 1 回だけ数える。
 * 検証の結果・基点が渡されていなければ、まだ通していない分・変更は null(0 とは書かない)。
 */

import { describe, expect, it } from 'vitest';
import { makeFinding } from '../../../../../lib/kernel/finding.js';
import { blockReadings, hasReading, sumReadings, unplacedReading } from '../../../../../lib/generate/render/book/block-reading.js';
import { bookCtx, bookModel } from '../../../../helpers/book-fixture.js';
import { bookHtmlPage, pageText } from '../../../../helpers/book-html.js';

const INVARIANTS = 'docs/specs/domain/workshop/invariants.md';
const warn = (id: string, file: string): ReturnType<typeof makeFinding> =>
  makeFinding(id, { severity: 'warning', message: `${id} の警告`, location: { file }, suggestion: '直す。' });

/** 検証の結果を渡した文脈(公理の置き場に 2 件・操作に 1 件・場所を引けないもの 1 件)。 */
function ctxWith(readingBase?: { ref: string; changes: Array<{ element: 'invariant.statement' | 'state.label'; kind: 'changed' | 'removed'; key: string; before: string | null; after: string | null }> }): ReturnType<typeof bookCtx> {
  return {
    ...bookCtx(),
    findings: [warn('Y10', INVARIANTS), warn('Y10', INVARIANTS), warn('A18', 'docs/specs/backend/actions/workshop/publish.md'), warn('W1', 'legacy/spec-tools/lib/x.ts')],
    ...(readingBase === undefined ? {} : { readingBase }),
  };
}

describe('blockReadings', () => {
  it('公理は不変条件の本数、まだ通していない分は場所のファイルの警告の件数。公理は業務、構造の警告は開発者', () => {
    const readings = blockReadings(bookModel(), ctxWith());
    const invariants = readings.find((reading) => reading.file === INVARIANTS);

    expect(invariants).toMatchObject({ chapter: 'docs/book/domain/workshop.md', axioms: 2, reasoned: 0, pending: 2, changed: null });
    expect(invariants?.byReader).toEqual({
      business: { axioms: 2, reasoned: 0, pending: 0 },
      developer: { axioms: 0, reasoned: 0, pending: 2 },
    });
    expect(invariants !== undefined && hasReading(invariants)).toBe(true);
  });

  it('アクセスの宣言は access.md の公理に数える(内部実行の読み取りは除く)。標識は行き先つきで残る: 公理の注記は公理の側、操作の標識は受け入れの側', () => {
    const readings = blockReadings(bookModel(), ctxWith());
    const access = readings.find((reading) => reading.file === 'docs/specs/domain/workshop/access.md');
    const action = readings.find((reading) => reading.file === 'docs/specs/backend/actions/workshop/publish.md');

    // 読むは 集約 × 役の表の 1 行(メンバー・未ログインの 2 宣言が 1 行になる)+ 書く 1 行。内部実行の読み取りは数えない。
    expect(access).toMatchObject({ axioms: 2, signs: 1, signClass: 'axiom' });
    expect(access !== undefined && hasReading(access)).toBe(true);
    expect(action).toMatchObject({ axioms: 0, signs: 1, signClass: 'accepted', pending: 1 });
  });

  it('状態の意味(summary を持つ状態)と節の要約は states.md、章頭の 1 文は entity.md の公理に数える(計算される欄は導出で、数えない)', () => {
    const model = bookModel();
    const workshop = model.aggregates.get('workshop')!;
    const machine = { ...workshop.stateMachines[0]!, summary: '節の要約です。', stateSummaries: { [workshop.stateMachines[0]!.states[0]!]: '場面です。' } };
    const withSummaries = {
      ...model,
      aggregates: new Map([...model.aggregates, ['workshop', { ...workshop, stateMachines: [machine], entity: { ...workshop.entity!, summary: '章頭です。' } }]]),
    };
    const readings = blockReadings(withSummaries, bookCtx());

    expect(readings.find((reading) => reading.file === machine.location.file)?.axioms).toBe(2);
    expect(readings.find((reading) => reading.file === workshop.entity!.location.file)?.axioms).toBe(1);
  });

  it('計算の例の表の行は、宣言のある操作の仕様(action_spec)の公理に数える。読み手は業務', () => {
    const file = 'docs/specs/backend/actions/workshop/publish.md';
    const row = (note: string): { note: string; facts: Record<string, never>; input: Record<string, never>; expect: number; location: { file: string } } => ({
      note,
      facts: {},
      input: {},
      expect: 1,
      location: { file },
    });
    const base = bookCtx();
    const actions = (base.actions?.actions ?? []).map((action) =>
      action.handles.raw === 'workshop.publish'
        ? { ...action, computes: [{ raw: 'workshop.starts_at', entity: 'workshop', field: 'starts_at', ref: 'startOf', reads: [], shape: 'facts_input' as const, examples: [row('a'), row('b')], location: { file } }] }
        : action,
    );
    const ctx = { ...base, actions: { ...(base.actions as NonNullable<typeof base.actions>), actions } };
    const action = blockReadings(bookModel(), ctx).find((reading) => reading.file === file);

    expect(action?.axioms).toBe(2);
    expect(action?.byReader.business.axioms).toBe(2);
    expect(action?.byReader.developer.axioms).toBe(0);
  });

  it('検証の結果が渡されていなければ、まだ通していない分は null(0 とは別)。基点が無ければ変更も null', () => {
    const readings = blockReadings(bookModel(), bookCtx());
    const invariants = readings.find((reading) => reading.file === INVARIANTS);

    expect(invariants?.pending).toBeNull();
    expect(invariants?.changed).toBeNull();
  });

  it('基点つきなら、公理の側の差分を、その不変条件が書かれたファイルに配る。消えたものは引けない', () => {
    const base = { ref: 'abc', changes: [
      { element: 'invariant.statement' as const, kind: 'changed' as const, key: 'INV-C-001', before: 'a', after: 'b' },
      { element: 'invariant.statement' as const, kind: 'removed' as const, key: 'INV-GONE-001', before: 'a', after: null },
    ] };
    const readings = blockReadings(bookModel(), ctxWith(base));

    expect(readings.find((reading) => reading.file === INVARIANTS)?.changed).toBe(1);
    expect(unplacedReading(bookModel(), ctxWith(base)).changes?.map((change) => change.key)).toEqual(['INV-GONE-001']);
  });

  it('標識を数える母集合から外したファイル(案内・雛形・台帳)と、割り付けの無いファイルは含めない', () => {
    const ctx = {
      ...ctxWith(),
      findings: [warn('M0', 'docs/specs/domain/README.md')],
      specSources: new Map([['docs/specs/domain/README.md', '---\ndoc_type: directory_guide\n---\n\n- 判断\n']]),
    };

    expect(blockReadings(bookModel(), ctx).some((reading) => reading.file === 'docs/specs/domain/README.md')).toBe(false);
  });
});

describe('sumReadings', () => {
  it('合計は行の足し算。まだ通していない・変更は、渡されているときだけ数にする(行が 0 件でも未集計は null)', () => {
    const rows = blockReadings(bookModel(), ctxWith());

    // 公理 6 = 不変条件など 4 + 画面 2 枚(画面の層は、画面 1 枚を 1 本と数える)。
    expect(sumReadings(rows, ctxWith())).toMatchObject({ axioms: 6, pending: 3, changed: null });
    // 読み手ごとの合計(業務 + 開発者 = 合計)。Y10 と A18 は構造の警告なので開発者に載る。
    expect(sumReadings(rows, ctxWith()).byReader).toEqual({
      business: { axioms: 6, reasoned: 0, pending: 0 },
      developer: { axioms: 0, reasoned: 0, pending: 3 },
    });
    expect(sumReadings([], bookCtx())).toEqual({
      axioms: 0,
      reasoned: 0,
      pending: null,
      changed: null,
      byReader: { business: { axioms: 0, reasoned: 0, pending: null }, developer: { axioms: 0, reasoned: 0, pending: null } },
    });
    expect(sumReadings([], ctxWith({ ref: 'x', changes: [] })).changed).toBe(0);
  });
});

describe('unplacedReading', () => {
  it('場所を引けない警告は配れなかった側。検証の結果が無ければ空', () => {
    expect(unplacedReading(bookModel(), ctxWith()).pending.map((finding) => finding.verifier)).toEqual(['W1']);
    expect(unplacedReading(bookModel(), bookCtx()).pending).toEqual([]);
  });
});

describe('レビューの手引きの「読む量」の節', () => {
  function guide(ctx = ctxWith()): string {
    const page = bookHtmlPage(bookModel(), ctx, 'review-guide.html');
    if (page === undefined) throw new Error('ページが生成されませんでした');
    return pageText(page);
  }

  it('必読 = 公理 + 受け入れの定義と、読み手ごとの節(業務・開発者)と、配れなかったものの節を出す', () => {
    const text = guide();

    expect(text).toContain('\n読む量\n');
    expect(text).toContain('必読 = 公理 + 受け入れ。受け入れは');
    expect(text).toContain('\n業務(業務の判断をする人が読む)\n');
    expect(text).toContain('\n開発者(開発者が読む)\n');
    expect(text).toContain('数える公理は 5 種類');
    expect(text).toContain('アクセスの数え方は、判断ポイントの台帳');
    expect(text).toContain('計算される欄(computes)の宣言は数えない');
    expect(text).toContain('必読 N」は人が読む量の下限');
    expect(text).toContain('\nどの章にも配れないもの\n');
    // 配れない警告は ID と件数だけ(文面・場所・行は生成物に入れない)。
    expect(text).toContain('警告 W1 1 件');
    expect(text).not.toContain('W1 の警告');
  });

  it('ブロックの行は 必読 = 公理 + 受け入れ、今回変わった(基点なしは —)、受け入れの内訳を持つ', () => {
    const text = guide();

    // 同じブロックが、業務には公理の 2、開発者には構造の警告の 2 を持つ(読み手ごとに別の行)。
    expect(text).toMatch(/集約 workshop[^|]*\| 破ってはいけないこと\(不変条件\) \| domain\/workshop\/invariants\.md \| 2 \| — \| 0\(理由つき 0・まだ通していない 0\)/);
    expect(text).toMatch(/集約 workshop[^|]*\| 破ってはいけないこと\(不変条件\) \| domain\/workshop\/invariants\.md \| 2 \| — \| 2\(理由つき 0・まだ通していない 2\)/);
    expect(text).toContain('合計 必読 ');
    expect(text).toContain('今回変わった —');
  });

  it('検証の結果が無ければ「未集計」と書く(0 とは書かない)', () => {
    const text = guide(bookCtx());

    expect(text).toContain('まだ通していない 未集計');
  });

  it('検証の結果が無い文脈の「どの章にも配れないもの」は「無い」と言い切らない(集めていないだけ)。検証済みで 0 件なら「無い」', () => {
    const unverified = guide(bookCtx());
    expect(unverified).toContain('警告の分は未集計(検証の結果が渡されていない)');
    expect(unverified).not.toContain('配れなかったものは無い');
    const verified = guide({ ...bookCtx(), findings: [] });
    expect(verified).toContain('配れなかったものは無い');
    expect(verified).not.toContain('警告の分は未集計');
  });

  it('基点つきなら、今回変わった の欄に数が入る', () => {
    const text = guide(ctxWith({ ref: 'abc', changes: [{ element: 'invariant.statement', kind: 'changed', key: 'INV-C-001', before: 'a', after: 'b' }] }));

    // 今回変わったは公理の側の差分なので、業務の行にだけ数が入る(開発者の行は —)。
    expect(text).toMatch(/ 2 \| 1 \| 0\(理由つき 0・まだ通していない 0\)/);
    expect(text).toMatch(/ 2 \| — \| 2\(理由つき 0・まだ通していない 2\)/);
  });

  it('標識の行き先を、読み手ごとに数える(足さない)', () => {
    const text = guide();
    // 画面の標識の読み手は付いた仕様の種類で決まる。ここでは access(公理の注記)と操作が業務に載る。
    expect(text).toMatch(/標識 公理の側 1 本・受け入れの側 1 本\(足さない\)/);
    expect(text).toMatch(/標識 公理の側 0 本・受け入れの側 0 本\(足さない\)/);
  });
});
