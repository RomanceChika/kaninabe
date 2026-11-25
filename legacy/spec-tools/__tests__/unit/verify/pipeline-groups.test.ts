/**
 * 群ごとの実行口(pipeline-groups)が**飛ばした範囲を scope 行に載せる**ことのテスト。
 *
 * 対象の要求: S7 の原則「検査していないことを警告・報告として出す」。X1(アダプタとディレクトリの
 * 突合)と J2(実装・Route Handler・Cron 登録の突合)は `app/` が無い環境では飛ぶが、束 ⑲-1 の
 * 時点ではそれが**無言**で、ログは `X1〜X4 を実行しました` / `J1〜J5 を実行しました` と出ていた
 * (検査していない範囲を緑が広く見せる形)。ここはその 1 行を固定する。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runJobs } from '../../../lib/verify/jobs-group.js';
import { runExternal } from '../../../lib/verify/external-group.js';
import { isSkipNote } from '../../../lib/verify/skip-notes.js';
import { aggregate, entitySpec, event, field, machine, specModel } from '../../helpers/model-builder.js';
import { jobModel, scheduledJob } from '../../helpers/job-builder.js';
import { externalCatalog, externalModel, integration } from '../../helpers/external-builder.js';
import { configCatalog } from '../../helpers/config-builder.js';
import { dataTableModel } from '../../helpers/data-builder.js';
import { scanDecl, scanResult } from '../../helpers/trace-builder.js';
import { buildTcRegistry } from '../../../lib/testcase/registry.js';
import { collectTcEntries } from '../../../lib/spec-index/sources.js';
import { TEST_ROOTS, writeProductDeclaration } from '../../helpers/product-roots.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../helpers/verify-inputs.js';
import { barePlatformTarget, TEST_LAYOUT, TEST_TARGETS } from '../../helpers/platform.js';
import { jobTargetsOf } from '../../../lib/target-api/contract.js';
import { NO_JOB_TARGETS } from '../../../lib/job/target-checks.js';
import type { Target } from '../../../lib/target-api/contract.js';
import type { ProductLayout } from '../../../lib/model/product/layout.js';
import { SUPABASE_TARGET } from '../../../lib/targets/supabase/target.js';

/** fixtures 配下。 */
const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures');

/** 作った「実装の木を持つ製品の木」(名前 → 一時ディレクトリ)。読むだけなので同じ名前では 1 度だけ作る。 */
const groundedRepos = new Map<string, string>();

/**
 * 実装の木(`app/`)を持つ fixture を、**自分の宣言(`product.md`)つきの一時ディレクトリ**へ写して返す。
 * (fixture は宣言を持たないので、そのまま渡すと `detectRepoRoot` が fixture を包むリポジトリまで登る ——
 * 包むリポジトリが `app/` を持つかどうかでテストの結果が変わってしまう。fixture 自身を製品の木にして、包むものに依らせない。)
 *
 * @param name `fixtures/` の下の fixture の名前(`jobs-repo` など)
 * @returns 宣言つきの木のルート(絶対パス)
 */
function groundedRepo(name: string): string {
  const cached = groundedRepos.get(name);
  if (cached !== undefined) return cached;
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `grounded-${name}-`));
  fs.cpSync(path.join(FIXTURES, name), repo, { recursive: true });
  writeProductDeclaration(repo);
  groundedRepos.set(name, repo);
  return repo;
}

/** workshop.close_deadline を持つ最小ドメイン(J2 の fires / due_from の接地先)。 */
const DOMAIN = specModel([
  aggregate('workshop', {
    entity: entitySpec('workshop', { fields: [field('entry_deadline', { kind: 'datetime' })] }),
    stateMachines: [
      machine('workshop', {
        states: ['accepting', 'closed'],
        initial: 'accepting',
        events: [
          event('close_deadline', {
            from: ['accepting'],
            to: 'closed',
            by: ['system'],
            otherwiseForbidden: '締切は募集中の催しにだけ意味がある',
          }),
        ],
      }),
    ],
  }),
]);

/**
 * `app/` を持たないリポジトリの木を作って、その中の docs を走査の起点として返す。
 * (実リポジトリの中に置くと `detectRepoRoot` が本物の宣言(`product.md`)まで登ってしまうため、
 * 一時ディレクトリに作り、そこへ宣言を書く。)
 */
function specOnlyDomainRoot(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-only-'));
  writeProductDeclaration(repo);
  const domainRoot = path.join(repo, TEST_ROOTS.specs, 'domain');
  fs.mkdirSync(domainRoot, { recursive: true });
  return domainRoot;
}

/** ログを集める。 */
function collector(): { readonly lines: string[]; readonly log: (line: string) => void } {
  const lines: string[] = [];
  return { lines, log: (line: string) => lines.push(line) };
}

/** 後段が登録した検査(本番と同じ全部入り)。 */
const FULL_CHECKS = jobTargetsOf(TEST_TARGETS);

/** 時刻起点のジョブ 1 本だけのカタログ。 */
function jobs() {
  return jobModel([scheduledJob('run_due_jobs')]);
}

/** 連携 1 件だけのカタログを X 群に流す。 */
function externalArgs(domainRoot: string, testsAvailable: boolean) {
  const external = externalModel([integration('discord_webhook')]);
  return {
    model: specModel([]),
    external: loadedInput(externalCatalog([integration('discord_webhook')])),
    config: loadedInput(configCatalog([])),
    dataTables: loadedInput(dataTableModel([])),
    registry: buildTcRegistry(collectTcEntries({ external })),
    tests: scanResult({ available: testsAvailable, testFiles: [] }),
    actions: null,
    domainRoot,
    roots: TEST_ROOTS,
    layout: TEST_LAYOUT,
  };
}

describe('J 群の scope 行', () => {
  it('app/ が無ければ J2 の突合を飛ばしたことを書く', () => {
    const sink = collector();

    runJobs(DOMAIN, jobs(), specOnlyDomainRoot(), TEST_ROOTS, sink.log, FULL_CHECKS, TEST_LAYOUT, UNSELECTED);

    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toContain('実装の木が無いため J2 の実装・Route Handler・Cron 登録の突合はスキップ');
  });

  it('app/ があれば J1〜J7 を実行したと書く(飛ばしていないので但し書きを出さない)', () => {
    const sink = collector();

    runJobs(DOMAIN, jobs(), groundedRepo('jobs-repo'), TEST_ROOTS, sink.log, FULL_CHECKS, TEST_LAYOUT, UNSELECTED);

    expect(sink.lines[0]).toContain('J1〜J7 を実行しました');
    expect(sink.lines[0]).not.toContain('スキップ');
  });
});

describe('J 群の scope 行(後段が受け持つ検査の口)', () => {
  it('後段が全部そろっていれば、未実施の行は出ない(行は実行したという 1 本だけ)', () => {
    const sink = collector();

    runJobs(DOMAIN, jobs(), groundedRepo('jobs-repo'), TEST_ROOTS, sink.log, FULL_CHECKS, TEST_LAYOUT, UNSELECTED);

    expect(sink.lines).toHaveLength(1);
  });

  it('後段が無ければ、受け持つ検査を ID ごとに「未実施 — <役割>の後段がこの構成に無い」と名指す(行頭の形は他の未実施の行と同じ)', () => {
    const sink = collector();

    runJobs(DOMAIN, jobs(), groundedRepo('jobs-repo'), TEST_ROOTS, sink.log, NO_JOB_TARGETS, TEST_LAYOUT, UNSELECTED);

    expect(sink.lines[0]).toContain('J1〜J7 を実行しました(J2 は接地と入口の衝突・閉世界のみ。J3 / J4 は下の未実施)');
    expect(sink.lines.slice(1)).toEqual([
      'J2: 未実施 — ホストの後段がこの構成に無いため、Cron の登録とカタログの双方向の突合は見ていません(実装・起動口・fires・due_from の接地と、HTTP の入口(起動口・受信口・認証の callback・送信の連携の口)の衝突と閉世界の検査は実行済み)。',
      'J3: 未実施 — プラットフォームの後段がこの構成に無いため、DB 内のスケジューラの登録とカタログの双方向の突合は見ていません。',
      'J4: 未実施 — ホストの後段がこの構成に無いため、ホストの Cron の頻度制約の突合は見ていません。',
    ]);
    for (const line of sink.lines.slice(1)) expect(isSkipNote(line), line).toBe(true);
  });

  it('プラットフォームの後段を選んでいるのに J3 を登録していなければ「後段 <名前> がこの検査を登録していない」と言う(「この構成に無い」とは言わない)。ホストの後段は選んでいないので J2 / J4 は「この構成に無い」', () => {
    const sink = collector();

    runJobs(DOMAIN, jobs(), groundedRepo('jobs-repo'), TEST_ROOTS, sink.log, jobTargetsOf([barePlatformTarget()]), TEST_LAYOUT, UNSELECTED);

    expect(sink.lines[0]).toContain('J1〜J7 を実行しました(J2 は接地と入口の衝突・閉世界のみ。J3 / J4 は下の未実施)');
    expect(sink.lines.slice(1)).toEqual([
      'J2: 未実施 — ホストの後段がこの構成に無いため、Cron の登録とカタログの双方向の突合は見ていません(実装・起動口・fires・due_from の接地と、HTTP の入口(起動口・受信口・認証の callback・送信の連携の口)の衝突と閉世界の検査は実行済み)。',
      'J3: 未実施 — プラットフォームの後段 bare-platform がこの検査を登録していないため、DB 内のスケジューラの登録とカタログの双方向の突合は見ていません。',
      'J4: 未実施 — ホストの後段がこの構成に無いため、ホストの Cron の頻度制約の突合は見ていません。',
    ]);
  });

  it('ホストの後段が J4 を理由つきで対象外と宣言すれば、J4 は「対象外」の 1 行(未実施の行は出ない)。未実施として数えない(範囲サマリに入らない)', () => {
    const sink = collector();
    const j2 = TEST_TARGETS.flatMap((target) => target.verifiers).find((verifier) => verifier.id === 'J2');
    if (j2 === undefined) throw new Error('J2 を登録した後段が無い');
    const quietHost: Target = { id: 'quiet-host', role: 'host', verifiers: [j2], generators: [], notApplicable: { J4: '頻度の制約を持たないホスト' } };

    runJobs(DOMAIN, jobs(), groundedRepo('jobs-repo'), TEST_ROOTS, sink.log, jobTargetsOf([SUPABASE_TARGET, quietHost]), TEST_LAYOUT, UNSELECTED);

    expect(sink.lines[0]).toContain('J1〜J7 を実行しました(J4 は下の対象外)');
    expect(sink.lines.slice(1)).toEqual(['J4: 対象外 — ホストの後段 quiet-host は、ホストの Cron の頻度制約の突合を対象外と宣言しています(理由: 頻度の制約を持たないホスト)。']);
    expect(sink.lines.filter((line) => isSkipNote(line))).toEqual([]);
  });

  it('実装の木が無いときは、実装・起動口の接地は実行済みと言わない(実行していない)。fires・due_from の接地だけを言う', () => {
    const sink = collector();

    runJobs(DOMAIN, jobs(), specOnlyDomainRoot(), TEST_ROOTS, sink.log, NO_JOB_TARGETS, TEST_LAYOUT, UNSELECTED);

    expect(sink.lines[1]).toBe('J2: 未実施 — ホストの後段がこの構成に無いため、Cron の登録とカタログの双方向の突合は見ていません(fires・due_from の接地は実行済み。HTTP の入口の衝突と閉世界は実装の木が無いので見ていない)。');
    expect(sink.lines.join('\n')).not.toContain('実装・起動口・fires');
  });

  it('外部連携が阻害なら、受信口との URL の衝突を見ていないと行で言う(ジョブどうしは実行済み)。未選択は受信口が事実として無いので言わない', () => {
    const blocked = collector();
    runJobs(DOMAIN, jobs(), groundedRepo('jobs-repo'), TEST_ROOTS, blocked.log, FULL_CHECKS, TEST_LAYOUT, blockedInput('load-failed'));
    const none = collector();
    runJobs(DOMAIN, jobs(), groundedRepo('jobs-repo'), TEST_ROOTS, none.log, FULL_CHECKS, TEST_LAYOUT, UNSELECTED);

    // 同じ入力(外部連携)の阻害は 1 行に畳む(別々の行にすると、範囲サマリの件数に同じ原因が 2 度数えられる)。
    expect(blocked.lines).toHaveLength(2);
    expect(blocked.lines[1]).toBe(
      'J2: 阻害 — external を採っているが検査へ渡せない(読めない・壊れている。原因の error は各種類の読み込みの診断と P 群が出している)ため、' +
        '受信口の URL とジョブの endpoint の衝突は見ていません(ジョブどうしの衝突は実行済み)。' +
        'また、どの宣言にも当たらない HTTP の入口(閉世界)の判定は出していません(1 本の URL に結べない入口と、認証の callback・送信の連携の口の実在は実行済み)。',
    );
    expect(blocked.lines.filter((line) => isSkipNote(line))).toHaveLength(1);
    expect(none.lines).toHaveLength(1);
  });

  it('ジョブのカタログが無ければ、口の行は出さない(カタログが無いことだけが言われる)', () => {
    const sink = collector();

    runJobs(DOMAIN, { available: false, catalog: null }, groundedRepo('jobs-repo'), TEST_ROOTS, sink.log, NO_JOB_TARGETS, TEST_LAYOUT, UNSELECTED);

    // 実装の木を宣言していれば、ジョブのカタログが無くても HTTP の入口の衝突(J2 の続き)は実行する — 見出しが「スキップ」の一言で隠さない。
    expect(sink.lines).toEqual([
      'J 群(ジョブ仕様): specs/backend/jobs.md が無いためスキップしました(HTTP の入口の衝突 = J2 の続きだけは、実装の木があるので受信口と画面の route の分を実行しました。' +
        'HTTP の入口の閉世界(実装の木の全入口が宣言に当たる)も実行しました)。',
    ]);
  });

  it('ジョブのカタログが無く外部連携が阻害なら、実行したのは画面の route の分だけと言う(受信口の主張は作れないので「受信口と」とは言わない)。未選択なら受信口は事実として無いので言い分けない', () => {
    const blocked = collector();
    runJobs(DOMAIN, { available: false, catalog: null }, groundedRepo('jobs-repo'), TEST_ROOTS, blocked.log, NO_JOB_TARGETS, TEST_LAYOUT, blockedInput('load-failed'));
    const unselected = collector();
    runJobs(DOMAIN, { available: false, catalog: null }, groundedRepo('jobs-repo'), TEST_ROOTS, unselected.log, NO_JOB_TARGETS, TEST_LAYOUT, UNSELECTED);

    expect(blocked.lines).toEqual([
      'J 群(ジョブ仕様): specs/backend/jobs.md が無いためスキップしました(HTTP の入口の衝突 = J2 の続きだけは、実装の木があるので画面の route の分だけ(受信口の URL は外部連携の阻害のため見ていません)を実行しました。' +
        'HTTP の入口の閉世界(実装の木の全入口が宣言に当たる)も実行しました)。',
      // 外部連携が阻害だと受信口と送信の連携の口を知れないので、どの宣言にも当たらない入口の判定だけを保留する(行で言う)。
      'J2: 阻害 — external を採っているが検査へ渡せない(読めない・壊れている。原因の error は各種類の読み込みの診断と P 群が出している)ため、' +
        'どの宣言にも当たらない HTTP の入口(閉世界)の判定は出していません(1 本の URL に結べない入口と、認証の callback・送信の連携の口の実在は実行済み)。',
    ]);
    expect(unselected.lines[0]).toContain('受信口と画面の route の分を実行しました');
    expect(unselected.lines).toHaveLength(1);
  });

  it('ジョブのカタログが無く、実装の木を宣言しているのに木が実在しなければ(仕様だけのリポジトリ)、入口の衝突は実行し、閉世界は実装の木が無いのでスキップしたと言う', () => {
    const sink = collector();

    runJobs(DOMAIN, { available: false, catalog: null }, specOnlyDomainRoot(), TEST_ROOTS, sink.log, NO_JOB_TARGETS, TEST_LAYOUT, UNSELECTED);

    expect(sink.lines).toEqual([
      'J 群(ジョブ仕様): specs/backend/jobs.md が無いためスキップしました(HTTP の入口の衝突 = J2 の続きだけは、実装の木があるので受信口と画面の route の分を実行しました。' +
        'HTTP の入口の閉世界は実装の木を走査するが、木のディレクトリが実在しないのでスキップしました)。',
    ]);
  });

  it('ジョブのカタログが無く外部連携が阻害でも、実装の木が無ければ入口の衝突は実行していないので「スキップ」だけを言う', () => {
    const sink = collector();

    runJobs(DOMAIN, { available: false, catalog: null }, groundedRepo('jobs-repo'), { ...TEST_ROOTS, app: null }, sink.log, NO_JOB_TARGETS, TEST_LAYOUT, blockedInput('load-failed'));

    expect(sink.lines).toEqual(['J 群(ジョブ仕様): specs/backend/jobs.md が無いためスキップしました。']);
  });

  it('ジョブのカタログが無く実装の木も無ければ、何も実行していないので「スキップ」だけを言う', () => {
    const sink = collector();

    runJobs(DOMAIN, { available: false, catalog: null }, groundedRepo('jobs-repo'), { ...TEST_ROOTS, app: null }, sink.log, NO_JOB_TARGETS, TEST_LAYOUT, UNSELECTED);

    expect(sink.lines).toEqual(['J 群(ジョブ仕様): specs/backend/jobs.md が無いためスキップしました。']);
  });
});

describe('J 群の scope 行(HTTP の入口の閉世界)', () => {
  it('認証仕様が読めない(ファイルはあるが構築できない)なら、どの宣言にも当たらない入口の判定を保留したと行で言う。読めていれば言わない', () => {
    const unreadable = collector();
    runJobs(DOMAIN, jobs(), groundedRepo('jobs-repo'), TEST_ROOTS, unreadable.log, FULL_CHECKS, TEST_LAYOUT, UNSELECTED, undefined, { available: true, flow: null });
    const absent = collector();
    runJobs(DOMAIN, jobs(), groundedRepo('jobs-repo'), TEST_ROOTS, absent.log, FULL_CHECKS, TEST_LAYOUT, UNSELECTED, undefined, { available: false, flow: null });

    expect(unreadable.lines).toHaveLength(2);
    expect(unreadable.lines[1]).toBe(
      'J2: 阻害 — auth を採っているが検査へ渡せない(読めない・壊れている。原因の error は各種類の読み込みの診断と P 群が出している)ため、' +
        'どの宣言にも当たらない HTTP の入口(閉世界)の判定は出していません(1 本の URL に結べない入口と、認証の callback・送信の連携の口の実在は実行済み)。',
    );
    expect(absent.lines).toHaveLength(1);
  });

  describe('走査で読めなかった場所(ディレクトリでない根 = ENOTDIR)', () => {
    /** 走査の根を、ディレクトリでないファイル(`route.ts`)に向けた配置。 */
    const unreadableRoot = (): ProductLayout => {
      const entry = TEST_LAYOUT['http-entry'];
      if (entry?.classify === undefined) throw new Error('テストの前提が壊れています: 配置が http-entry の逆引きを持たない');
      return { ...TEST_LAYOUT, 'http-entry': { ...entry, classify: { ...entry.classify, dir: 'app/api/jobs/run/route.ts' } } };
    };

    it('読めなかった場所を名指しで阻害と言う(完全な走査の「指摘 0」と同じに見せない)。範囲サマリの件数に数える。読めていれば言わない', () => {
      const sink = collector();
      const whole = collector();

      runJobs(DOMAIN, jobs(), groundedRepo('jobs-repo'), TEST_ROOTS, sink.log, FULL_CHECKS, unreadableRoot(), UNSELECTED);
      runJobs(DOMAIN, jobs(), groundedRepo('jobs-repo'), TEST_ROOTS, whole.log, FULL_CHECKS, TEST_LAYOUT, UNSELECTED);

      const lines = sink.lines.filter((line) => line.startsWith('J2: 阻害 — '));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^J2: 阻害 — app\/src\/app\/api\/jobs\/run\/route\.ts を読めなかったため、入口の閉世界は見ていません\(読めた部分の入口の分類は実行済み。/);
      expect(isSkipNote(lines[0] ?? '')).toBe(true);
      expect(whole.lines.filter((line) => line.startsWith('J2: 阻害 — '))).toEqual([]);
    });

    it('ジョブのカタログが無いときの見出しは、閉世界を読めた部分だけ実行したと言い、同じ阻害の行を続ける', () => {
      const sink = collector();

      runJobs(DOMAIN, { available: false, catalog: null }, groundedRepo('jobs-repo'), TEST_ROOTS, sink.log, NO_JOB_TARGETS, unreadableRoot(), UNSELECTED);

      expect(sink.lines[0]).toContain('HTTP の入口の閉世界(実装の木の全入口が宣言に当たる)は、読めなかった場所があるので読めた部分だけ実行しました');
      expect(sink.lines[1]).toMatch(/^J2: 阻害 — app\/src\/app\/api\/jobs\/run\/route\.ts を読めなかったため、入口の閉世界は見ていません/);
    });
  });

  it('配置が http-entry の逆引きを持たず走査の根を決められなければ、未実施と名指す(黙って緑にしない)', () => {
    const sink = collector();
    const { 'http-entry': _entry, ...withoutEntry } = TEST_LAYOUT;

    runJobs(DOMAIN, jobs(), groundedRepo('jobs-repo'), TEST_ROOTS, sink.log, FULL_CHECKS, withoutEntry, UNSELECTED);

    expect(sink.lines).toContain(
      'J2: 未実施 — 置き場の配置が HTTP の入口(http-entry)の逆引きを持たず走査の根を決められないため、実装の木の入口がどの宣言に当たるか(閉世界)は見ていません。',
    );
    expect(isSkipNote(sink.lines.at(-1) ?? '')).toBe(true);
  });
});

describe('J 群の scope 行(scans の発火元)', () => {
  it('認証仕様が読めず scans の発火元を判断できなかったイベントを、未検査として書く', () => {
    const sink = collector();
    const actions = {
      actions: [],
      unhandled: [],
      scans: [scanDecl('membership.activate', 'app/src/operation/membership/activate.ts')],
      unscanned: [],
      testTagBaseline: [],
    };

    runJobs(DOMAIN, jobs(), specOnlyDomainRoot(), TEST_ROOTS, sink.log, FULL_CHECKS, TEST_LAYOUT, UNSELECTED, actions, { available: true, flow: null });

    expect(sink.lines[0]).toContain('認証仕様が読めないため、scans の発火元は未検査: membership.activate');
  });
});

describe('X 群の入力の状態の行(テーブル仕様が使えないために判定を出さなかった対象)', () => {
  /** 受信の連携 1 件。 */
  const inboundArgs = (dataTables: Parameters<typeof runExternal>[0]['dataTables']) => {
    const billing = [integration('billing_hook', { direction: 'inbound', effect: 'write', degrade: 'refuse', emits: 'invoice.settle' })];
    const external = externalModel(billing);
    return {
      ...externalArgs(groundedRepo('external-repo-valid'), true),
      external: loadedInput(externalCatalog(billing)),
      registry: buildTcRegistry(collectTcEntries({ external })),
      dataTables,
    };
  };

  it('未選択も阻害も、群の要約行の後に X5 の行(受信の連携を名指す)を出す。読込済みなら出さない', () => {
    for (const [state, word] of [
      [UNSELECTED, '未実施 — 製品が data_tables を採っていない'],
      [blockedInput<never>('invalid'), '阻害 — data_tables を採っているが検査へ渡せない'],
    ] as const) {
      const sink = collector();

      runExternal(inboundArgs(state), sink.log);

      expect(sink.lines[0]).toContain('X1〜X8 を実行しました');
      const x5 = sink.lines.filter((line) => line.startsWith('X5: '));
      expect(x5).toHaveLength(1);
      expect(x5[0]).toContain(`X5: ${word}`);
      expect(x5[0]).toContain('(対象 1 件: billing_hook)');
    }
    const loaded = collector();

    runExternal(inboundArgs(loadedInput(dataTableModel([]))), loaded.log);

    expect(loaded.lines).toHaveLength(1);
  });

  it('X1(b) は阻害のときだけ言う(内部テーブルかもしれないディレクトリを名指す)。未選択は事実なので言わない', () => {
    const unselected = collector();
    const blocked = collector();

    runExternal(inboundArgs(UNSELECTED), unselected.log);
    runExternal(inboundArgs(blockedInput<never>('missing')), blocked.log);

    expect(unselected.lines.some((line) => line.startsWith('X1: '))).toBe(false);
    const x1 = blocked.lines.filter((line) => line.startsWith('X1: '));
    expect(x1).toHaveLength(1);
    expect(x1[0]).toContain('X1: 阻害 — data_tables を採っているが検査へ渡せない(置き場に仕様が無い');
    expect(x1[0]).toContain('app/src/infrastructure/');
  });

  it('X2 は設定カタログが阻害のときだけ言う(設定を挙げた連携を名指す)。未選択は事実なので言わず、読込済みなら言わない', () => {
    const lines = (config: Parameters<typeof runExternal>[0]['config']): string[] => {
      const sink = collector();
      runExternal({ ...externalArgs(groundedRepo('external-repo-valid'), true), config }, sink.log);
      return sink.lines.filter((line) => line.startsWith('X2: '));
    };

    expect(lines(UNSELECTED)).toEqual([]);
    expect(lines(loadedInput(configCatalog([])))).toEqual([]);
    for (const reason of ['missing', 'load-failed', 'invalid'] as const) {
      const x2 = lines(blockedInput<never>(reason));
      expect(x2).toHaveLength(1);
      expect(x2[0]).toContain('X2: 阻害 — config を採っているが検査へ渡せない(');
      expect(x2[0]).toContain('(対象 1 件: discord_webhook)');
    }
  });

  it('カタログが無いときは、使えない入力でも要約のスキップの行だけ', () => {
    const sink = collector();
    const args = { ...externalArgs(groundedRepo('external-repo-valid'), true), dataTables: UNSELECTED, external: UNSELECTED };

    runExternal(args, sink.log);

    expect(sink.lines).toEqual(['X 群(外部連携カタログ): specs/backend/external.md が無いためスキップしました。']);
  });

  it('外部連携が阻害(置き場に仕様が無い)なら、スキップの行ではなく「X1〜X8: 阻害 — …」で見ていないことを名指す', () => {
    const sink = collector();
    const args = { ...externalArgs(groundedRepo('external-repo-valid'), true), external: blockedInput<never>('missing') };

    runExternal(args, sink.log);

    expect(sink.lines).toEqual([
      'X1〜X8: 阻害 — external を採っているが検査へ渡せない(置き場に仕様が無い。原因の error は各種類の読み込みの診断と P 群が出している)ため、外部連携カタログの検査(X1〜X8)は見ていません。',
    ]);
    expect(isSkipNote(sink.lines[0] ?? '')).toBe(true);
  });

  it('外部連携が置き場にはあるが読めない・壊れているなら、宣言を読む検査(X1・X2・X3・X5・X6・X7・X8)を見ていないと名指し、台帳だけを見る X4 は実行する', () => {
    for (const reason of ['load-failed', 'invalid'] as const) {
      const sink = collector();
      const args = { ...externalArgs(groundedRepo('external-repo-valid'), true), external: blockedInput<never>(reason) };

      runExternal(args, sink.log);

      expect(sink.lines).toHaveLength(2);
      expect(sink.lines[0]).toBe('X 群(外部連携カタログ): 宣言を読めないため、台帳だけを見る検査を実行しました。');
      expect(sink.lines[1]).toContain('X1〜X8: 阻害 — external を採っているが検査へ渡せない(');
      expect(sink.lines[1]).toContain('ため、外部連携の宣言を読む検査(X1・X2・X3・X5・X6・X7・X8)は見ていません(台帳だけを見る検査は実行済み)。');
      expect(sink.lines.filter(isSkipNote)).toEqual([sink.lines[1]]);
    }
  });
});

describe('X 群の scope 行', () => {
  it('app/ が無ければ X1 の突合を飛ばしたことを書く(X4 の @tc 突合と並べて出す)', () => {
    const sink = collector();

    runExternal(externalArgs(specOnlyDomainRoot(), false), sink.log);

    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]).toContain('X1 のアダプタ・ディレクトリの突合');
    expect(sink.lines[0]).toContain('X4 の @tc 突合');
  });

  it('app/ があり走査もできていれば X1〜X8 を実行したと書く', () => {
    const sink = collector();

    runExternal(externalArgs(groundedRepo('external-repo-valid'), true), sink.log);

    expect(sink.lines[0]).toContain('X1〜X8 を実行しました');
    expect(sink.lines[0]).not.toContain('スキップ');
  });
});
