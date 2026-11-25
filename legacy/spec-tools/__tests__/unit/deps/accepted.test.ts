/** 受け入れ表の読み取りと当てはめ(期限内は赤にしない・期限切れは赤・不正な行は採らない)。 */

import { describe, expect, it } from 'vitest';
import { applyAccepted, livePremises, parseAcceptedTable } from '../../../lib/deps/accepted.js';
import { finding as baseFinding } from './helpers.js';

/** 版つきの指摘(受け入れ表は版を名指すので、既定の版 1.0.0 を持たせる)。 */
const finding: typeof baseFinding = (over = {}) => baseFinding({ version: '1.0.0', ...over });

const HEAD = '| 種別 | 対象 | パッケージ | 版 | 前提 | 理由 | 見直しの期限 |\n|---|---|---|---|---|---|---|\n';

describe('parseAcceptedTable', () => {
  it.each([
    ['表なし(null)', null, 0, 0],
    ['見出しと区切りだけ', HEAD, 0, 0],
    ['正しい advisory 行', `${HEAD}| advisory | GHSA-aaaa | left-pad | 1.0.0 | - | 到達不能 | 2026-12-01 |`, 1, 0],
    ['正しい cooldown 行(バッククォート付き)', `${HEAD}| cooldown | \`1.2.3\` | \`left-pad\` | \`1.2.3\` | - | 緊急の修正 | 2026-10-30 |`, 1, 0],
    ['表の外の文章は無視する', `前置き\n${HEAD}| advisory | GHSA-a | * | 1.0.0 | - | 理由 | 2026-12-01 |\n後書き`, 1, 0],
    ['種別の綴り違いは採らない', `${HEAD}| advisry | GHSA-a | x | 1.0.0 | - | 理由 | 2026-12-01 |`, 0, 1],
    ['理由が空は採らない', `${HEAD}| advisory | GHSA-a | x | 1.0.0 | - |  | 2026-12-01 |`, 0, 1],
    ['日付の形が違う', `${HEAD}| advisory | GHSA-a | x | 1.0.0 | - | 理由 | 2026/12/01 |`, 0, 1],
    ['実在しない日付', `${HEAD}| advisory | GHSA-a | x | 1.0.0 | - | 理由 | 2026-02-30 |`, 0, 1],
    ['列が足りない', `${HEAD}| advisory | GHSA-a | x | 1.0.0 | 理由 |`, 0, 1],
    ['対象が空', `${HEAD}| advisory |  | x | 1.0.0 | - | 理由 | 2026-12-01 |`, 0, 1],
    // 9 回目 C9-2: cooldown の行は名前と版の両方を名指す(* は書けない)。
    ['cooldown: * / *(全部の部品の待ちを外す)', `${HEAD}| cooldown | * | * | * | - | 理由 | 2026-10-30 |`, 0, 1],
    ['cooldown: 版が *', `${HEAD}| cooldown | * | left-pad | * | - | 理由 | 2026-10-30 |`, 0, 1],
    ['cooldown: パッケージが *', `${HEAD}| cooldown | 1.2.3 | * | 1.2.3 | - | 理由 | 2026-10-30 |`, 0, 1],
    ['cooldown: 版が範囲', `${HEAD}| cooldown | ^1.2.3 | left-pad | ^1.2.3 | - | 理由 | 2026-10-30 |`, 0, 1],
    ['cooldown: 版がタグ', `${HEAD}| cooldown | latest | left-pad | latest | - | 理由 | 2026-10-30 |`, 0, 1],
    ['cooldown: 版の一部(1.2)', `${HEAD}| cooldown | 1.2 | left-pad | 1.2 | - | 理由 | 2026-10-30 |`, 0, 1],
    ['cooldown: パッケージの名前に glob', `${HEAD}| cooldown | 1.2.3 | left-* | 1.2.3 | - | 理由 | 2026-10-30 |`, 0, 1],
    ['cooldown: プレリリースの版とスコープつきの名前', `${HEAD}| cooldown | 1.2.3-rc.1 | @scope/pkg.x | 1.2.3-rc.1 | - | 理由 | 2026-10-30 |`, 1, 0],
    // 版の欄(受け入れは名指した版だけ。* ・範囲・空は採らない = fail-closed)。
    ['版: 複数の正確な版(カンマ区切り・バッククォート付き)', `${HEAD}| advisory | GHSA-a | x | \`2.3.2\`, 4.0.7 | - | 理由 | 2026-12-01 |`, 1, 0],
    ['版: * は採らない', `${HEAD}| advisory | GHSA-a | x | * | - | 理由 | 2026-12-01 |`, 0, 1],
    ['版: 範囲は採らない', `${HEAD}| advisory | GHSA-a | x | ^1.2.3 | - | 理由 | 2026-12-01 |`, 0, 1],
    ['版: 空は採らない', `${HEAD}| advisory | GHSA-a | x |  | - | 理由 | 2026-12-01 |`, 0, 1],
    ['版: 版の一部(1.2)は採らない', `${HEAD}| advisory | GHSA-a | x | 1.2 | - | 理由 | 2026-12-01 |`, 0, 1],
    ['版: 1 つでも崩れていれば行ごと採らない', `${HEAD}| advisory | GHSA-a | x | 1.0.0, >=2 | - | 理由 | 2026-12-01 |`, 0, 1],
    ['版: 空の項(末尾のカンマ)は採らない', `${HEAD}| advisory | GHSA-a | x | 1.0.0, | - | 理由 | 2026-12-01 |`, 0, 1],
    ['前提の列が無い 6 列の行は採らない', `${HEAD}| advisory | GHSA-a | x | 1.0.0 | 理由 | 2026-12-01 |`, 0, 1],
    // 前提の欄(閉じた表の名前だけ。知らない名前・空・重なりは採らない = fail-closed。条件そのものは dev-repo のテストが見る)。
    ['前提: 閉じた表の名前は採る', `${HEAD}| advisory | GHSA-a | x | 1.0.0 | \`next-config-no-images\` | 理由 | 2026-12-01 |`, 1, 0],
    ['前提: 知らない名前は採らない', `${HEAD}| advisory | GHSA-a | x | 1.0.0 | no-such-premise | 理由 | 2026-12-01 |`, 0, 1],
    ['前提: 1 つでも知らない名前があれば行ごと採らない', `${HEAD}| advisory | GHSA-a | x | 1.0.0 | next-config-no-images, other | 理由 | 2026-12-01 |`, 0, 1],
    ['前提: 空は採らない(無いなら - と書く)', `${HEAD}| advisory | GHSA-a | x | 1.0.0 |  | 理由 | 2026-12-01 |`, 0, 1],
    ['前提: 同じ名前の重なりは採らない', `${HEAD}| advisory | GHSA-a | x | 1.0.0 | next-config-no-images, next-config-no-images | 理由 | 2026-12-01 |`, 0, 1],
    ['版の列が無い古い 5 列の行は採らない', `${HEAD}| advisory | GHSA-a | x | 理由 | 2026-12-01 |`, 0, 1],
    ['cooldown: 版が対象と違えば採らない', `${HEAD}| cooldown | 1.2.3 | left-pad | 1.2.4 | - | 理由 | 2026-10-30 |`, 0, 1],
    ['cooldown: 版を 2 つ並べたら採らない', `${HEAD}| cooldown | 1.2.3 | left-pad | 1.2.3, 1.2.4 | - | 理由 | 2026-10-30 |`, 0, 1],
    ['advisory はパッケージ * を書ける(版の待ちとは別の扱い)', `${HEAD}| advisory | GHSA-a | * | 1.0.0 | - | 理由 | 2026-12-01 |`, 1, 0],
  ])('%s', (_name, text, entries, problems) => {
    const table = parseAcceptedTable(text);
    expect(table.entries).toHaveLength(entries);
    expect(table.problems).toHaveLength(problems);
  });
});

describe('applyAccepted', () => {
  const entry = (over: Partial<Parameters<typeof applyAccepted>[1][number]> = {}) => ({ kind: 'advisory' as const, target: 'GHSA-aaaa', pkg: 'left-pad', versions: ['1.0.0'] as readonly string[], premises: [] as const, reason: '到達不能', reviewBy: '2026-10-27', ...over });

  it.each([
    ['期限内 → accepted', entry(), finding(), '2026-10-22', 'accepted'],
    ['期限の当日はまだ有効', entry({ reviewBy: '2026-10-22' }), finding(), '2026-10-22', 'accepted'],
    ['期限の翌日は期限切れ → red', entry({ reviewBy: '2026-10-21' }), finding(), '2026-10-22', 'red'],
    ['別名(CVE)でも当たる', entry({ target: 'CVE-1' }), finding({ aliases: ['CVE-1'] }), '2026-10-22', 'accepted'],
    ['パッケージが違えば当たらない', entry({ pkg: 'other' }), finding(), '2026-10-22', 'red'],
    ['パッケージ * は全部に当たる', entry({ pkg: '*' }), finding({ pkg: 'zzz' }), '2026-10-22', 'accepted'],
    ['ID が違えば当たらない', entry({ target: 'GHSA-bbbb' }), finding(), '2026-10-22', 'red'],
    ['警告も期限切れなら red(見直しを強制)', entry({ reviewBy: '2026-01-01' }), finding({ severity: 'low', level: 'warning' }), '2026-10-22', 'red'],
    ['警告の期限内は accepted', entry(), finding({ severity: 'low', level: 'warning' }), '2026-10-22', 'accepted'],
    ['cooldown: 版が合えば accepted', entry({ kind: 'cooldown', target: '1.0.0' }), finding({ kind: 'cooldown', id: 'cooldown', version: '1.0.0', level: 'warning' }), '2026-10-22', 'accepted'],
    ['cooldown: 版が違えば警告のまま', entry({ kind: 'cooldown', target: '2.0.0' }), finding({ kind: 'cooldown', id: 'cooldown', version: '1.0.0', level: 'warning' }), '2026-10-22', 'warning'],
    // 9 回目 C9-2: 表の読み取りを経ない行でも、* は cooldown の指摘に当たらない(全部に当たる形を作らない)。
    ['cooldown: 版の * は当たらない', entry({ kind: 'cooldown', target: '*' }), finding({ kind: 'cooldown', id: 'cooldown', version: '9.9.9', level: 'warning' }), '2026-10-22', 'warning'],
    ['cooldown: パッケージの * は当たらない', entry({ kind: 'cooldown', target: '1.0.0', pkg: '*' }), finding({ kind: 'cooldown', id: 'cooldown', version: '1.0.0', level: 'warning' }), '2026-10-22', 'warning'],
    ['cooldown: パッケージが違えば当たらない', entry({ kind: 'cooldown', target: '1.0.0', pkg: 'other' }), finding({ kind: 'cooldown', id: 'cooldown', version: '1.0.0', level: 'warning' }), '2026-10-22', 'warning'],
    ['cooldown: 公開日時が引けない版(赤)は * でも受け入れない(C7-7)', entry({ kind: 'cooldown', target: '*', pkg: '*' }), finding({ kind: 'cooldown', id: 'cooldown-time-missing', version: '1.0.0', level: 'red' }), '2026-10-22', 'red'],
    ['cooldown: 公開日時が時計より後の版(赤)は版を名指しても受け入れない(C7-7)', entry({ kind: 'cooldown', target: '1.0.0' }), finding({ kind: 'cooldown', id: 'cooldown-future', version: '1.0.0', level: 'red' }), '2026-10-22', 'red'],
    ['advisory の行は cooldown の指摘に当たらない', entry({ target: 'cooldown' }), finding({ kind: 'cooldown', id: 'cooldown', level: 'warning' }), '2026-10-22', 'warning'],
  ])('%s', (_name, row, f, today, expected) => {
    applyAccepted([f], [row], today);
    expect(f.level).toBe(expected);
  });

  it.each([
    ['名指した版は accepted', ['2.3.2', '4.0.7'], '4.0.7', 'accepted'],
    ['名指していない版は赤のまま(同じ advisory でも)', ['2.3.2'], '4.0.7', 'red'],
    ['版の分からない指摘には当たらない', ['1.0.0'], undefined, 'red'],
  ] as const)('版: %s', (_name, versions, version, expected) => {
    const f = baseFinding(version === undefined ? {} : { version });
    applyAccepted([f], [entry({ versions })], '2026-10-22');
    expect(f.level).toBe(expected);
  });

  it('表から読んだ行も、名指していない版には当たらない(読み取りと当てはめを通す)', () => {
    const table = parseAcceptedTable(`${HEAD}| advisory | GHSA-aaaa | left-pad | 2.3.2 | - | 到達不能 | 2026-10-27 |`);
    const covered = finding({ version: '2.3.2' });
    const uncovered = finding({ version: '4.0.7' });
    applyAccepted([covered, uncovered], table.entries, '2026-10-22');
    expect([covered.level, uncovered.level]).toEqual(['accepted', 'red']);
  });

  it('前提の名前は読んだ行に残る(照らしは dev-repo のテストが期限内の行についてだけ回す)', () => {
    const table = parseAcceptedTable(`${HEAD}| advisory | GHSA-aaaa | left-pad | 1.0.0 | next-config-no-images | 到達不能 | 2026-10-27 |`);
    expect(table.entries.map((row) => row.premises)).toEqual([['next-config-no-images']]);
  });

  it.each([
    ['期限内の行の前提は生きている', '2026-10-27', ['GHSA-aaaa']],
    ['期限の当日もまだ生きている', '2026-10-22', ['GHSA-aaaa']],
    ['期限切れの行の前提は照らさない', '2026-10-21', undefined],
  ] as const)('livePremises: %s', (_name, reviewBy, expected) => {
    const live = livePremises([entry({ premises: ['next-config-no-images'], reviewBy }), entry({ target: 'GHSA-none' })], '2026-10-22');
    expect(live.get('next-config-no-images')).toEqual(expected);
  });

  it('当たらなかった行を返す(不要な行の候補)', () => {
    const rows = [entry(), entry({ target: 'GHSA-zzzz' })];
    expect(applyAccepted([finding()], rows, '2026-10-22')).toEqual([rows[1]]);
  });
});

describe('applyAccepted: 期限は重大度の上限を超えられない(今日から数えて critical 3 日・high 7 日・moderate 30 日・low 90 日・不明は high と同じ)', () => {
  const TODAY = '2026-10-22';
  /** 今日から `days` 日後の `YYYY-MM-DD`。 */
  const after = (days: number): string => new Date(Date.parse(`${TODAY}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const row = (reviewBy: string) => ({ kind: 'advisory' as const, target: 'GHSA-aaaa', pkg: 'left-pad', versions: ['1.0.0'], premises: [], reason: '到達不能', reviewBy });

  it.each([
    ['critical', 3, 'accepted'],
    ['critical', 4, 'red'],
    ['high', 7, 'accepted'],
    ['high', 8, 'red'],
    ['moderate', 30, 'accepted'],
    ['moderate', 31, 'red'],
    ['low', 90, 'accepted'],
    ['low', 91, 'red'],
    ['unknown', 7, 'accepted'],
    ['unknown', 8, 'red'],
  ] as const)('%s は今日から %i 日後の期限で %s', (severity, days, expected) => {
    const f = finding({ severity, level: 'red' });
    applyAccepted([f], [row(after(days))], TODAY);
    expect(f.level).toBe(expected);
  });

  it('上限を超えた行は赤のまま、上限の日数を指摘に残す(報告が理由を言える)', () => {
    const f = finding({ severity: 'high' });
    applyAccepted([f], [row(after(30))], TODAY);
    expect(f.level).toBe('red');
    expect(f.accepted).toMatchObject({ expired: false, overDeadline: 7 });
  });

  it('上限内の行は overDeadline を持たない', () => {
    const f = finding({ severity: 'high' });
    applyAccepted([f], [row(after(7))], TODAY);
    expect(f.accepted?.overDeadline).toBeUndefined();
  });

  // 9 回目 C9-2: cooldown の期限は今日から 7 日(COOLDOWN_DAYS)まで。表に足した日の列は無いので今日から数える。
  it.each([
    [0, 'accepted'],
    [7, 'accepted'],
    [8, 'red'],
    [30, 'red'],
    [26_000, 'red'],
  ] as const)('cooldown の期限は今日から %i 日後で %s(重大度に依らず 7 日)', (days, expected) => {
    const f = finding({ kind: 'cooldown', id: 'cooldown', version: '1.0.0', level: 'warning', severity: 'unknown' });
    applyAccepted([f], [{ kind: 'cooldown', target: '1.0.0', pkg: 'left-pad', versions: ['1.0.0'], premises: [], reason: '緊急の修正', reviewBy: after(days) }], TODAY);
    expect(f.level).toBe(expected);
    if (expected === 'red') expect(f.accepted).toMatchObject({ expired: false, overDeadline: 7 });
  });

  it('C9-2 の反例: * / * の 2099 年の行は表で拒まれ、指摘は警告のまま(出荷の関門では赤に上がる)', () => {
    const table = parseAcceptedTable(`${HEAD}| cooldown | * | * | * | - | 理由 | 2099-12-31 |`);
    expect(table.entries).toEqual([]);
    expect(table.problems).toHaveLength(1);
    const f = finding({ kind: 'cooldown', id: 'cooldown', pkg: 'evil-dep', version: '1.2.4', title: '公開から 0.1 日', level: 'warning' });
    applyAccepted([f], table.entries, '2026-10-29');
    expect(f.level).toBe('warning');
  });

  it('上限の判定は重大度ごと(同じ行が 2 つの重大度の指摘に当たると、長い期限は重い方だけ赤)', () => {
    const heavy = finding({ id: 'GHSA-aaaa', severity: 'high' });
    const light = finding({ id: 'GHSA-aaaa', severity: 'low', lockfile: 'docs/package-lock.json' });
    applyAccepted([heavy, light], [row(after(30))], TODAY);
    expect([heavy.level, light.level]).toEqual(['red', 'accepted']);
  });
});
