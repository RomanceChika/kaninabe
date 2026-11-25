/**
 * 検査への入力の状態(未選択 / 阻害 / 読込済み)と検査の結果の区別(未実施 / 阻害 / 実行)の契約テスト。
 *
 * **出典**: 外部レビュー の隔離試作 `st-input-state-prototype/input-state.test.cjs`
 * (sha256 de1c12fbf9bbe99c52a69000435f13d4e13928fc0670b695f09047bec3205a97)の 11 本を vitest へ写した。
 * 本体(`lib/kernel/input-state.ts`)の方針は試作から 1 点だけ変えてある — 阻害にするのは「読み込みの error が残る」ときでなく
 * 「モデルから仕様を落としたとき」(ローダーが数える `dropped`。数えられない種類 = null だけが従来どおり error 1 件で阻害)。
 * warning だけなら実行・例外は成功に変換しない・読み込みと検査の診断は別々に持つ点は試作のまま。
 * 実 A13 / 実ローダーとの接続は `trace/verifiers/a13-schedule-manual-job-tags.test.ts` と
 * `verify/input-state-counterexamples.test.ts` が見る。
 */

import { describe, expect, it } from 'vitest';
import { availableLoad, catalogInput, inputValue, mapCatalogInput, runCatalogCheck, unusableOf, type CatalogLoad } from '../../../lib/kernel/input-state.js';
import type { Finding } from '../../../lib/kernel/finding.js';
import { readableValue } from '../../../lib/kernel/readable-value.js';

interface Catalog {
  readonly jobs: readonly string[];
  readonly testCases: readonly string[];
}

const error: Finding = Object.freeze({
  verifier: 'J0',
  severity: 'error',
  message: 'Invalid catalog',
  location: { file: 'jobs.md' },
  suggestion: 'Correct catalog',
});
const warning: Finding = Object.freeze({ ...error, severity: 'warning' });
const empty: Catalog = Object.freeze({ jobs: Object.freeze([]), testCases: Object.freeze([]) });

/** 読み込みの結果を作る(省略すると「空のカタログが読めた」。`dropped` は省略で 0 = 仕様は落としていない)。 */
function load(
  catalog: Catalog | null = empty,
  findings: readonly Finding[] = [],
  available = true,
  dropped = 0,
): CatalogLoad<Catalog> {
  return { model: { available, catalog }, findings, dropped };
}

/** 呼ばれたら落とす検査(使える入力が無いときに回ってはならない)。 */
const mustNotRun = (): never => {
  throw new Error('Checker ran without usable input');
};

describe('入力の状態と検査の結果(外部レビュー 試作の契約 11 本)', () => {
  it('明示的に未選択の種類は、検査を評価せず未実施になる', () => {
    expect(runCatalogCheck(catalogInput<Catalog>('unselected'), mustNotRun).status).toBe('skipped');
  });

  it('選択したのに読み込みの結果が無ければ阻害(not-loaded)', () => {
    const run = runCatalogCheck(catalogInput<Catalog>('selected'), mustNotRun);

    expect(run.status).toBe('blocked');
    expect(run).toMatchObject({ reason: 'not-loaded' });
  });

  it('選択したのにファイルが無ければ阻害(missing)であり、未選択とは推定しない', () => {
    const run = runCatalogCheck(catalogInput('selected', load(null, [], false)), mustNotRun);

    expect(run).toMatchObject({ status: 'blocked', reason: 'missing' });
  });

  it('カタログが null なら、読み込みの診断を保ったまま検査を止める(load-failed)', () => {
    const run = runCatalogCheck(catalogInput('selected', load(null, [error])), mustNotRun);

    expect(run).toMatchObject({ status: 'blocked', reason: 'load-failed' });
    expect(run.loaderFindings[0]).toBe(error);
  });

  it('カタログが null で診断も無い場合でも阻害であり、合格にはならない', () => {
    expect(runCatalogCheck(catalogInput('selected', load(null)), mustNotRun).status).toBe('blocked');
  });

  it('読込済みの空のカタログは 1 回だけ評価され、実行と報告される', () => {
    let calls = 0;
    const run = runCatalogCheck(catalogInput('selected', load()), (value) => {
      calls += 1;
      expect(value).toBe(empty);
      return [];
    });

    expect(calls).toBe(1);
    expect(run).toEqual({ status: 'executed', loaderFindings: [], verifierFindings: [] });
  });

  it('仕様を落としていれば、読み込みの error が残っていなくても阻害(invalid)', () => {
    const run = runCatalogCheck(catalogInput('selected', load(empty, [error], true, 1)), mustNotRun);

    expect(run).toMatchObject({ status: 'blocked', reason: 'invalid' });
    expect(run.loaderFindings[0]).toBe(error);
  });

  it('読み込みの error が残っていても、仕様を落としていなければ(id の不一致など)読込済みで検査を回す。error は診断に残る', () => {
    let calls = 0;
    const run = runCatalogCheck(catalogInput('selected', load(empty, [error], true, 0)), () => {
      calls += 1;
      return [];
    });

    expect(calls).toBe(1);
    expect(run).toMatchObject({ status: 'executed' });
    expect(run.loaderFindings[0]).toBe(error);
  });

  it('落とした数が 1 以上なら、error の有無によらず阻害(invalid)。0 なら warning だけでも診断なしでも読込済み', () => {
    const run = runCatalogCheck(catalogInput('selected', load(empty, [error], true, 1)), mustNotRun);

    expect(run).toMatchObject({ status: 'blocked', reason: 'invalid' });
    expect(catalogInput('selected', load(empty, [], true, 1))).toMatchObject({ state: 'blocked', reason: 'invalid' });
    expect(catalogInput('selected', load(empty, [warning], true, 0)).state).toBe('loaded');
    expect(catalogInput('selected', load(empty, [], true, 0)).state).toBe('loaded');
  });

  it('warning だけなら評価でき、読み込みの診断は別に保たれる', () => {
    const run = runCatalogCheck(catalogInput('selected', load(empty, [warning])), () => []);

    expect(run.status).toBe('executed');
    expect(run.loaderFindings[0]).toBe(warning);
  });

  it('検査の違反は実行のあとも残る(実行は合格を意味しない)', () => {
    const violation: Finding = Object.freeze({ ...error, verifier: 'A13' });
    const results = Object.freeze([violation]);

    const run = runCatalogCheck(catalogInput('selected', load()), () => results);

    expect(run.status).toBe('executed');
    expect(run.verifierFindings).toBe(results);
  });

  it('未実施にしても、すでに集めた読み込みの error は消えない', () => {
    const run = runCatalogCheck(catalogInput('unselected', load(null, [error])), mustNotRun);

    expect(run.status).toBe('skipped');
    expect(run.loaderFindings[0]).toBe(error);
  });

  it('検査が投げた例外は、空の成功に変換されずそのまま伝わる', () => {
    expect(() =>
      runCatalogCheck(catalogInput('selected', load()), () => {
        throw new Error('checker failed');
      }),
    ).toThrow(/checker failed/);
  });
});

describe('availableLoad(available だけを持つモデルを読み込みの結果へ写す)', () => {
  it('読めたモデルはそのまま読込済みになる(0 件も読込済み)', () => {
    const model = { available: true, items: [] as readonly string[] };

    const input = catalogInput('selected', availableLoad(model));

    expect(input).toEqual({ state: 'loaded', value: model, findings: [] });
  });

  it('available: false は置き場に仕様が無い(阻害 = missing)。0 件のカタログとは違う', () => {
    expect(catalogInput('selected', availableLoad({ available: false, items: [] }))).toEqual({ state: 'blocked', reason: 'missing', findings: [] });
  });

  it('読み込みの診断を渡すと保たれ、仕様を落としていれば阻害(invalid)・落としていなければ読込済み', () => {
    const dropped = catalogInput('selected', availableLoad({ available: true }, [error], 1));
    const kept = catalogInput('selected', availableLoad({ available: true }, [error], 0));

    expect(dropped).toMatchObject({ state: 'blocked', reason: 'invalid' });
    expect(dropped.findings[0]).toBe(error);
    expect(kept).toMatchObject({ state: 'loaded' });
    expect(kept.findings[0]).toBe(error);
  });

  it('落とした数を渡さなければ 0(落としていない)として、error が残っていても読込済み', () => {
    expect(catalogInput('selected', availableLoad({ available: true }, [error]))).toMatchObject({ state: 'loaded' });
  });
});

describe('inputValue / unusableOf(あれば読む側へ渡す形と、使えなかった入力の記録)', () => {
  it('読込済みなら値を返す(0 件の空もここ)。未選択・阻害は undefined', () => {
    expect(inputValue(catalogInput('selected', load()))).toBe(empty);
    expect(inputValue(catalogInput<Catalog>('unselected'))).toBeUndefined();
    expect(inputValue(catalogInput('selected', load(null)))).toBeUndefined();
  });

  it('使えなかった入力は、未選択と阻害(理由つき)を区別して記録する。読込済みは null', () => {
    expect(unusableOf(catalogInput<Catalog>('unselected'), 'jobs')).toEqual({ input: 'jobs', state: 'unselected' });
    expect(unusableOf(catalogInput('selected', load(null)), 'jobs')).toEqual({ input: 'jobs', state: 'blocked', reason: 'load-failed' });
    expect(unusableOf(catalogInput('selected', load(empty, [error], true, 1)), 'jobs')).toEqual({ input: 'jobs', state: 'blocked', reason: 'invalid' });
    expect(unusableOf(catalogInput('selected', load()), 'jobs')).toBeNull();
  });
});


describe('partial(仕様を落とした阻害だけが持つ、読めた分のモデル)', () => {
  it('仕様を落とした阻害(invalid)は読めた分を partial に持つ。置き場が無い・構築できない阻害と、読込済みは持たない', () => {
    const dropped = catalogInput('selected', load(empty, [error], true, 1));

    expect(dropped).toMatchObject({ state: 'blocked', reason: 'invalid', partial: empty });
    expect(catalogInput('selected', load(null, [], false))).not.toHaveProperty('partial');
    expect(catalogInput('selected', load(null))).not.toHaveProperty('partial');
    expect(catalogInput('selected', load())).not.toHaveProperty('partial');
  });

  it('mapCatalogInput は partial も写し、未選択・partial の無い阻害はそのまま、読込済みは値を写す', () => {
    const toCount = (catalog: Catalog): number => catalog.jobs.length;

    expect(mapCatalogInput(catalogInput('selected', load(empty, [error], true, 1)), toCount)).toMatchObject({ state: 'blocked', reason: 'invalid', partial: 0 });
    expect(mapCatalogInput(catalogInput('selected', load(null)), toCount)).toEqual({ state: 'blocked', reason: 'load-failed', findings: [] });
    expect(mapCatalogInput(catalogInput<Catalog>('unselected'), toCount)).toEqual({ state: 'unselected', findings: [] });
    expect(mapCatalogInput(catalogInput('selected', load()), toCount)).toEqual({ state: 'loaded', value: 0, findings: [] });
  });
});

describe('readableValue(読めた分: 読込済みなら全体・仕様を落とした阻害なら部分)', () => {
  it('読込済みは値・partial を持つ阻害は読めた分・それ以外(未選択・partial の無い阻害)は undefined', () => {
    const model = { available: true, items: [1] };

    expect(readableValue(catalogInput('selected', availableLoad(model)))).toBe(model);
    expect(readableValue(catalogInput('selected', availableLoad(model, [], 1)))).toBe(model);
    expect(readableValue(catalogInput('selected', availableLoad({ available: false })))).toBeUndefined();
    expect(readableValue(catalogInput<typeof model>('selected'))).toBeUndefined();
    expect(readableValue(catalogInput<typeof model>('unselected'))).toBeUndefined();
  });
});
