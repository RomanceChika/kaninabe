/**
 * 画面の到達の入力が使えなかったことの報告(S13・S16・Y3・Y5)の、入力の状態の決め方と行のテスト。
 *
 * 入力の状態は `product.md` の `uses`(採っているか)と画面の読み込みの結果(読めたか・読み込みの error が残るか)で決まる。
 * 0 枚の読込済みは阻害でない。実ローダー・実パイプラインを通した確認は `reachability-gaps-pipeline.test.ts`。
 */

import { describe, expect, it } from 'vitest';
import { makeFinding } from '../../../lib/kernel/finding.js';
import type { Finding } from '../../../lib/kernel/finding.js';
import { logReachabilityGaps, REACHABILITY_DEPENDENTS, reachabilityGapsOf } from '../../../lib/verify/reachability-notes.js';
import { aggregate, entitySpec, field, role, specModel } from '../../helpers/model-builder-v8plus.js';
import { authModel } from '../../helpers/auth-builder.js';
import { screenInput, screenSpec } from '../../helpers/screen-builder.js';
import type { ScreenSpecModel } from '../../../lib/model/screen/types.js';
import type { UsecaseSpecModel } from '../../../lib/model/usecase/types.js';

const domain = () =>
  specModel({
    roles: [role('anonymous'), role('member'), role('system')],
    aggregates: [aggregate({ name: 'entry', entity: entitySpec('entry', [field('title', { kind: 'string' })]) })],
  });

const loaded = (count: number) => screenInput({ domain: domain(), screens: Array.from({ length: count }, (_, i) => screenSpec({ name: `s${i}`, for: ['member'], entryPoint: true })) }).screens;
const missing = () => screenInput({ domain: domain(), screensUnavailable: true }).screens;
const auth = screenInput({ domain: domain() }).auth;
const error: Finding = makeFinding('S0', { message: '壊れている', location: { file: 'x.md' }, suggestion: '直す' });
const warning: Finding = makeFinding('S0', { severity: 'warning', message: '注意', location: { file: 'x.md' }, suggestion: '見る' });

describe('reachabilityGapsOf(画面の入力の状態)', () => {
  const base = { domain: domain(), auth, authLoadFindings: [] as readonly Finding[], authDropped: 0, loadFindings: [] as readonly Finding[], dropped: 0 };

  it('採っていて読み込めていれば使える(欠けなし)', () => {
    expect(reachabilityGapsOf({ ...base, screens: loaded(2), uses: ['screens'] })).toEqual([]);
  });

  it('0 枚の読込済みは阻害でない(実行・0 件)', () => {
    expect(reachabilityGapsOf({ ...base, screens: loaded(0), uses: ['screens'] })).toEqual([]);
  });

  it('読み込みの warning だけなら使える', () => {
    expect(reachabilityGapsOf({ ...base, screens: loaded(1), uses: ['screens'], loadFindings: [warning] })).toEqual([]);
  });

  it('採っていなければ未選択(置き場に仕様があっても、選択は推定しない)', () => {
    const expected = [{ input: 'screens', state: 'unselected' }];

    expect(reachabilityGapsOf({ ...base, screens: missing(), uses: ['actions'] })).toEqual(expected);
    expect(reachabilityGapsOf({ ...base, screens: loaded(1), uses: [] })).toEqual(expected);
  });

  it('採ったのに置き場に仕様が無ければ阻害(missing)', () => {
    expect(reachabilityGapsOf({ ...base, screens: missing(), uses: ['screens'] })).toEqual([
      { input: 'screens', state: 'blocked', reason: 'missing' },
    ]);
  });

  it('採って読めたが、読めずに捨てた画面・宣言があれば阻害(invalid)', () => {
    expect(reachabilityGapsOf({ ...base, screens: loaded(1), uses: ['screens'], loadFindings: [error], dropped: 1 })).toEqual([
      { input: 'screens', state: 'blocked', reason: 'invalid' },
    ]);
  });

  it('読み込みの error が残っていても、画面を落としていなければ(id の不一致など)使える', () => {
    expect(reachabilityGapsOf({ ...base, screens: loaded(1), uses: ['screens'], loadFindings: [error], dropped: 0 })).toEqual([]);
  });
});

describe('reachabilityGapsOf(認証フローの関門の入力の状態)', () => {
  const base = { domain: domain(), screens: loaded(1), dropped: 0, authDropped: 0, loadFindings: [] as readonly Finding[] };
  const authError: Finding = makeFinding('H0', { message: '壊れている', location: { file: 'auth.md' }, suggestion: '直す' });
  const authWarning: Finding = makeFinding('H0', { severity: 'warning', message: '注意', location: { file: 'auth.md' }, suggestion: '見る' });

  it('採っていなければ関門は無い事実: 欠けに載らない(置き場に仕様があっても、選択は推定しない)', () => {
    expect(reachabilityGapsOf({ ...base, uses: ['screens'], auth: authModel(), authLoadFindings: [] })).toEqual([]);
    expect(reachabilityGapsOf({ ...base, uses: ['screens'], auth: authModel({}, false), authLoadFindings: [] })).toEqual([]);
  });

  it('採って読めていれば使える(関門が 0 本の読込済みも・読み込みの warning だけでも)', () => {
    expect(reachabilityGapsOf({ ...base, uses: ['screens', 'auth'], auth: authModel(), authLoadFindings: [] })).toEqual([]);
    expect(reachabilityGapsOf({ ...base, uses: ['screens', 'auth'], auth: authModel(), authLoadFindings: [authWarning] })).toEqual([]);
  });

  it('採ったのに置き場に仕様が無ければ阻害(missing)', () => {
    expect(reachabilityGapsOf({ ...base, uses: ['screens', 'auth'], auth: authModel({}, false), authLoadFindings: [] })).toEqual([
      { input: 'auth', state: 'blocked', reason: 'missing' },
    ]);
  });

  it('採って読めたが、読み込みで行を落とした(dropped > 0)なら阻害(invalid)', () => {
    expect(reachabilityGapsOf({ ...base, uses: ['screens', 'auth'], auth: authModel(), authLoadFindings: [authError], authDropped: 1 })).toEqual([
      { input: 'auth', state: 'blocked', reason: 'invalid' },
    ]);
  });

  it('読み込みの error が残っていても行を落としていなければ(未知のキー・id の重複)読込済み: 到達を広く見積もる阻害にしない', () => {
    expect(reachabilityGapsOf({ ...base, uses: ['screens', 'auth'], auth: authModel(), authLoadFindings: [authError], authDropped: 0 })).toEqual([]);
  });

  it('採ったが構築できなかった(置き場にはあるが宣言が null)なら阻害(load-failed)', () => {
    expect(reachabilityGapsOf({ ...base, uses: ['screens', 'auth'], auth: { available: true, flow: null }, authLoadFindings: [] })).toEqual([
      { input: 'auth', state: 'blocked', reason: 'load-failed' },
    ]);
  });

  it('画面と関門の両方が使えなければ、画面、関門の順に両方を返す', () => {
    expect(
      reachabilityGapsOf({ ...base, screens: missing(), uses: ['screens', 'auth'], auth: authModel({}, false), authLoadFindings: [] }),
    ).toEqual([
      { input: 'screens', state: 'blocked', reason: 'missing' },
      { input: 'auth', state: 'blocked', reason: 'missing' },
    ]);
  });
});

describe('logReachabilityGaps(読む検査ごとの行)', () => {
  const usecasesLoaded = { available: true, usecases: [] } as const;
  const usecasesMissing = { available: false, usecases: [] } as const;
  const screensPlaced = { available: true } as ScreenSpecModel;
  const screensAbsent = { available: false } as ScreenSpecModel;
  const lines = (
    gaps: Parameters<typeof logReachabilityGaps>[0],
    usecases: UsecaseSpecModel = usecasesLoaded,
    screens: ScreenSpecModel = screensPlaced,
  ): string[] => {
    const out: string[] = [];
    logReachabilityGaps(gaps, { usecases, screens }, (line: string) => out.push(line));
    return out;
  };

  it('欠けが無ければ何も言わない', () => {
    expect(lines([])).toEqual([]);
  });

  it('欠けがあり、ユースケース仕様が読めていれば、S13・S16・Y1・Y3・Y5 の順に 1 行ずつ(語は未実施 / 阻害)', () => {
    const unselected = lines([{ input: 'screens', state: 'unselected' }]);

    // 画面の欠けに依る検査だけ(S14・S15 は関門の欠けだけに依るので、画面の欠けでは言わない)。
    const onScreens = REACHABILITY_DEPENDENTS.filter((dependent) => dependent.gapInputs === undefined || dependent.gapInputs.includes('screens'));
    expect(unselected).toHaveLength(onScreens.length);
    unselected.forEach((line, index) => {
      expect(line.startsWith(`${onScreens[index]?.id}: 未実施 — 製品が screens を採っていない(product.md の uses に無い)ため、`)).toBe(true);
    });
    expect(onScreens.map((dependent) => dependent.id)).toEqual(['S13', 'S16', 'Y1', 'Y3', 'Y5']);
    expect(REACHABILITY_DEPENDENTS.map((dependent) => dependent.id)).toEqual(['S7', 'S13', 'S14', 'S15', 'S16', 'Y1', 'Y3', 'Y5']);

    const blocked = lines([{ input: 'screens', state: 'blocked', reason: 'invalid' }]);
    expect(blocked).toHaveLength(5);
    expect(blocked.every((line) => line.includes('阻害 — screens を採っているが検査へ渡せない(読めなかった仕様があってモデルが欠けている、または欠けていないと言えない'))).toBe(true);
  });

  it('ユースケース仕様が読めていないとき、ユースケース仕様が母集合の検査(S16・Y1・Y3・Y5)は行を出さない(S13 だけ言う)', () => {
    for (const gap of [
      { input: 'screens', state: 'unselected' },
      { input: 'screens', state: 'blocked', reason: 'missing' },
    ] as const) {
      expect(lines([gap], usecasesMissing).map((line) => line.slice(0, line.indexOf(':')))).toEqual(['S13']);
    }
  });

  it('S 群が飛んでいるとき(画面の置き場が無い)、S 群の中の検査(S13・S16)は行を出さない(群の「スキップしました」と二重に数えない)。Y1・Y3・Y5 は言う', () => {
    for (const gap of [
      { input: 'screens', state: 'unselected' },
      { input: 'screens', state: 'blocked', reason: 'missing' },
    ] as const) {
      expect(lines([gap], usecasesLoaded, screensAbsent).map((line) => line.slice(0, line.indexOf(':')))).toEqual(['Y1', 'Y3', 'Y5']);
    }
  });

  it('画面が阻害でも置き場があって S 群が走るときは、S13・S16 も言う', () => {
    const rows = lines([{ input: 'screens', state: 'blocked', reason: 'invalid' }], usecasesLoaded, screensPlaced);

    expect(rows.map((line) => line.slice(0, line.indexOf(':')))).toEqual(['S13', 'S16', 'Y1', 'Y3', 'Y5']);
  });

  it('関門が阻害のとき、読む検査ごとに「auth を採っているが検査へ渡せない」と名指す(画面が使えていても)', () => {
    const rows = lines([{ input: 'auth', state: 'blocked', reason: 'load-failed' }]);

    expect(rows.map((line) => line.slice(0, line.indexOf(':')))).toEqual(['S7', 'S13', 'S14', 'S15', 'S16', 'Y3', 'Y5']);
    expect(rows.every((line) => line.includes('阻害 — auth を採っているが検査へ渡せない(読めない・壊れている。'))).toBe(true);
  });

  it('関門(auth)の欠けだけに依る検査(S14・S15)は、画面の欠けでは言わない。S 群が飛んでいれば関門の欠けでも言わない', () => {
    const authGap = { input: 'auth', state: 'blocked', reason: 'invalid' } as const;

    expect(lines([{ input: 'screens', state: 'unselected' }]).some((line) => /^S1[45]:/.test(line))).toBe(false);
    expect(lines([authGap], usecasesLoaded, screensAbsent).map((line) => line.slice(0, line.indexOf(':')))).toEqual(['Y3', 'Y5']);
  });

  it('S 群の中の検査かの印は、S7・S13・S14・S15・S16 だけに付いている', () => {
    expect(REACHABILITY_DEPENDENTS.filter((dependent) => dependent.needsScreensGroup).map((dependent) => dependent.id)).toEqual(['S7', 'S13', 'S14', 'S15', 'S16']);
  });

  it('ユースケース仕様が要るかの印は、S16・Y1・Y3・Y5 だけに付いている', () => {
    expect(REACHABILITY_DEPENDENTS.filter((dependent) => dependent.needsUsecases).map((dependent) => dependent.id)).toEqual(['S16', 'Y1', 'Y3', 'Y5']);
  });
});
