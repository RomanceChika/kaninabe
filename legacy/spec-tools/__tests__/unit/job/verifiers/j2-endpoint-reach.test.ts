/**
 * J2(続き)Cron の起動口と走査の接地のユニットテスト。
 *
 * 規約網羅(job-spec-writing.md §検証):
 *   - 起動口(`endpoint` の Route Handler)の import の閉包が `implementation` に届くこと
 *     (起動口が別の走査を呼んでいれば赤。網の穴探し 2026-10-06 の M07)
 *   - `fires: E` の走査の実装が actions の `scans[event=E]` の実装に届くこと(M05)
 *   - `due_from` の列が、起動口と実装の閉包の期限の比較に現れること(M04)
 *
 * 閉包は実ファイルを辿るので、一時ディレクトリに小さい実装の木を作ってリポジトリルートに見立てる
 * (C24 の閉包のテストと同じ流儀)。木は `@/…`(実装の木の別名)で組むので、本物の import の形を通る。
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyEndpointReach } from '../../../../lib/job/verifiers/j2-endpoint-reach.js';
import type { JobDecl } from '../../../../lib/model/job/types.js';
import type { ActionSpecModel } from '../../../../lib/model/trace/types.js';
import { jobModel, notScheduledJob, scheduledJob } from '../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { FOREIGN_LAYOUT, TEST_LAYOUT } from '../../../helpers/platform.js';
import { scanDecl } from '../../../helpers/trace-builder.js';

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 一時ディレクトリに木を作る(パス → 本文)。 */
function repo(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'j2-reach-'));
  created.push(root);
  for (const [relative, text] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
  }
  return root;
}

/** 走査 2 本ぶんの木(起動口 → 配線 → 実装 / 読み取り口)。alpha だけが読み取り口を持つ。 */
const TREE: Readonly<Record<string, string>> = {
  'app/src/app/api/alpha/run/route.ts': "import { createAlpha } from '@/composition/alpha';\nexport const x = createAlpha;\n",
  'app/src/app/api/beta/run/route.ts': "import { createBeta } from '@/composition/beta';\nexport const x = createBeta;\n",
  'app/src/composition/alpha.ts':
    "import { alphaReader } from '@/infrastructure/alpha/reader';\nimport { scanAlpha } from '@/operation/alpha/scan';\nexport const createAlpha = [alphaReader, scanAlpha];\n",
  'app/src/composition/beta.ts': "import { scanBeta } from '@/operation/beta/scan';\nexport const createBeta = scanBeta;\n",
  'app/src/operation/alpha/scan.ts': 'export const scanAlpha = 1;\n',
  'app/src/operation/beta/scan.ts': 'export const scanBeta = 2;\n',
  'app/src/infrastructure/alpha/reader.ts':
    "export const alphaReader = (q: Q, now: string) => q.lte('due_at', now).gt('starts_at', now);\n",
};

/** alpha / beta の宣言(走査の実装・起こすイベント・「いつ」の列)。 */
function alpha(overrides: Partial<NonNullable<JobDecl['schedule']>> = {}): JobDecl {
  return scheduledJob('scan_alpha', {
    endpoint: '/api/alpha/run',
    implementation: 'app/src/operation/alpha/scan.ts',
    fires: 'thing.alpha_due',
    dueFrom: 'thing.due_at',
    ...overrides,
  });
}

/** beta の宣言(読み取り口は無いので due_from は持たない)。 */
function beta(overrides: Partial<NonNullable<JobDecl['schedule']>> = {}): JobDecl {
  return scheduledJob('scan_beta', {
    endpoint: '/api/beta/run',
    implementation: 'app/src/operation/beta/scan.ts',
    fires: 'thing.beta_due',
    ...overrides,
  });
}

/** 走査の宣言(actions/README.md の `scans`)。 */
function actionsWith(...scans: readonly ReturnType<typeof scanDecl>[]): ActionSpecModel {
  return { actions: [], unhandled: [], scans, unscanned: [], testTagBaseline: [] };
}

/** 既定で alpha / beta の走査を宣言した actions。 */
const SCANS = actionsWith(
  scanDecl('thing.alpha_due', 'app/src/operation/alpha/scan.ts'),
  scanDecl('thing.beta_due', 'app/src/operation/beta/scan.ts'),
);

/** メッセージの並び。 */
function messages(jobs: readonly JobDecl[], files = TREE, actions: ActionSpecModel | null = SCANS): readonly string[] {
  return verifyEndpointReach({
    jobs: jobModel(jobs),
    actions: actions ?? undefined,
    repoRoot: repo(files),
    roots: TEST_ROOTS,
    layout: TEST_LAYOUT,
  }).map((finding) => finding.message);
}

describe('J2: 起動口と走査の接地', () => {
  it('起動口・fires・due_from が実装に接地していれば違反なし', () => {
    expect(messages([alpha(), beta()])).toEqual([]);
  });

  describe('起動口が呼んでいる import の閉包が implementation に届く', () => {
    it('起動口が別の走査の配線を呼んでいれば、届いた別の実装を名指してエラー', () => {
      const tree = { ...TREE, 'app/src/app/api/beta/run/route.ts': TREE['app/src/app/api/alpha/run/route.ts'] ?? '' };

      const found = messages([alpha(), beta()], tree);

      expect(found).toEqual([
        'ジョブ scan_beta の起動口 app/src/app/api/beta/run/route.ts が呼んでいる import をたどっても implementation ' +
          'app/src/operation/beta/scan.ts に届きません(届いた別の実装: app/src/operation/alpha/scan.ts)',
      ]);
    });

    it('どの宣言済みの実装にも届かない起動口は、別の実装の名指し無しでエラー', () => {
      const tree = { ...TREE, 'app/src/app/api/beta/run/route.ts': 'export const x = 1;\n' };

      const found = messages([beta()], tree);

      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/に届きません$/);
    });

    it('反例に起動口・期待した実装・届いた別の実装を載せる', () => {
      const tree = { ...TREE, 'app/src/app/api/beta/run/route.ts': TREE['app/src/app/api/alpha/run/route.ts'] ?? '' };

      const [finding] = verifyEndpointReach({
        jobs: jobModel([alpha(), beta()]),
        actions: SCANS,
        repoRoot: repo(tree),
        roots: TEST_ROOTS,
        layout: TEST_LAYOUT,
      });

      expect(finding?.counterexample).toEqual({
        job: 'scan_beta',
        route: 'app/src/app/api/beta/run/route.ts',
        implementation: 'app/src/operation/beta/scan.ts',
        reached: 'app/src/operation/alpha/scan.ts',
        imported_but_not_called: 'no',
      });
    });

    describe('起動口が「呼んでいる」import だけを起点にする(両方 import して片方だけ呼ぶ形・使わない import)', () => {
      /** beta の起動口が alpha と beta の配線を両方 import して、呼ぶ(値として使う)のは alpha だけの木。 */
      const bothImported = {
        ...TREE,
        'app/src/app/api/beta/run/route.ts':
          "import { createAlpha } from '@/composition/alpha';\nimport { createBeta } from '@/composition/beta';\nexport const x = createAlpha;\n",
      };

      it('両方を import して片方だけ呼ぶ起動口は、呼んでいない実装に届いたことにならない(import はしているが呼んでいない、と名指す)', () => {
        const found = messages([alpha(), beta()], bothImported);

        expect(found).toEqual([
          'ジョブ scan_beta の起動口 app/src/app/api/beta/run/route.ts が呼んでいる import をたどっても implementation ' +
            'app/src/operation/beta/scan.ts に届きません(import はしているが、呼んでいない)' +
            '(届いた別の実装: app/src/operation/alpha/scan.ts)',
        ]);
      });

      it('反例に「import はしているが呼んでいない」を載せる', () => {
        const [finding] = verifyEndpointReach({
          jobs: jobModel([alpha(), beta()]),
          actions: SCANS,
          repoRoot: repo(bothImported),
          roots: TEST_ROOTS,
          layout: TEST_LAYOUT,
        });

        expect(finding?.counterexample?.['imported_but_not_called']).toBe('yes');
      });

      it('使わない import があるだけの起動口は、その先の実装を持っていても届いたことにならない', () => {
        const unused = {
          ...TREE,
          'app/src/app/api/beta/run/route.ts': "import { createBeta } from '@/composition/beta';\nexport const x = 1;\n",
        };

        expect(messages([beta()], unused)).toHaveLength(1);
      });

      it('呼んでいる側の実装には届く(両方を import して両方を呼ぶ形は緑)', () => {
        const bothCalled = {
          ...TREE,
          'app/src/app/api/beta/run/route.ts':
            "import { createAlpha } from '@/composition/alpha';\nimport { createBeta } from '@/composition/beta';\nexport const x = [createAlpha, createBeta];\n",
        };

        expect(messages([alpha(), beta()], bothCalled)).toEqual([]);
      });

      it('呼ばれていない import の先にしか無い読み取り口の列は、due_from の接地に数えない', () => {
        const unusedReader = {
          ...TREE,
          'app/src/app/api/alpha/run/route.ts':
            "import { createBeta } from '@/composition/beta';\nimport { alphaReader } from '@/infrastructure/alpha/reader';\nexport const x = createBeta;\n",
        };
        const job = alpha({ implementation: 'app/src/operation/beta/scan.ts', fires: 'thing.beta_due', dueFrom: 'thing.due_at' });

        expect(messages([job], unusedReader)).toEqual([
          'ジョブ scan_alpha の due_from thing.due_at の列 due_at が、起動口と実装の import の閉包のどこにも' +
            '期限の比較(lte / lt)の列名として現れません',
        ]);
      });
    });

    it('起動口が実在しない・実装が実在しない行は、J2 本体の指摘に任せてここでは鳴らさない', () => {
      const noRoute = alpha({ endpoint: '/api/ghost/run' });
      const noImpl = beta({ implementation: 'app/src/operation/beta/ghost.ts' });

      expect(messages([noRoute, noImpl]).filter((text) => text.includes('をたどっても'))).toEqual([]);
    });
  });

  describe('fires の走査の実装が scans の実装に届く', () => {
    it('2 本の fires を入れ替えると、どちらも scans の実装に届かずエラー', () => {
      const found = messages([alpha({ fires: 'thing.beta_due' }), beta({ fires: 'thing.alpha_due' })]);

      expect(found).toHaveLength(2);
      expect(found[0]).toContain('ジョブ scan_alpha の fires thing.beta_due の走査は scans では app/src/operation/beta/scan.ts');
      expect(found[1]).toContain('ジョブ scan_beta の fires thing.alpha_due の走査は scans では app/src/operation/alpha/scan.ts');
    });

    it('scans に無いイベントを fires に書くとエラー', () => {
      const found = messages([alpha({ fires: 'thing.ghost' })]);

      expect(found).toEqual(['ジョブ scan_alpha の fires thing.ghost を起こす走査が action_spec の scans にありません']);
    });

    it('scans の実装が、ジョブの実装の import の閉包で届くなら違反なし(同じ実装でなくてよい)', () => {
      const tree = { ...TREE, 'app/src/operation/alpha/scan.ts': "import { inner } from './inner';\nexport const scanAlpha = inner;\n", 'app/src/operation/alpha/inner.ts': 'export const inner = 1;\n' };
      const actions = actionsWith(scanDecl('thing.alpha_due', 'app/src/operation/alpha/inner.ts'));

      expect(messages([alpha()], tree, actions)).toEqual([]);
    });

    it('別の走査にも届く実装なら、届く別の走査を名指す', () => {
      const tree = { ...TREE, 'app/src/operation/alpha/scan.ts': "import { scanBeta } from '@/operation/beta/scan';\nexport const scanAlpha = scanBeta;\n" };
      const actions = actionsWith(scanDecl('thing.alpha_due', 'app/src/operation/alpha/other.ts'), scanDecl('thing.beta_due', 'app/src/operation/beta/scan.ts'));

      expect(messages([alpha()], tree, actions)).toEqual([
        'ジョブ scan_alpha の fires thing.alpha_due の走査は scans では app/src/operation/alpha/other.ts だが、' +
          'ジョブの implementation app/src/operation/alpha/scan.ts はそこに届きません(届く別の走査: thing.beta_due)',
      ]);
    });

    it('action_spec が無い環境では fires と scans の突合を飛ばす', () => {
      expect(messages([alpha({ fires: 'thing.ghost' })], TREE, null)).toEqual([]);
    });
  });

  describe('due_from の列が期限の比較に現れる', () => {
    it('起動口の閉包の読み取り口が lte で絞っていれば違反なし(実装の閉包の外でもよい)', () => {
      expect(messages([alpha({ dueFrom: 'thing.due_at' })])).toEqual([]);
    });

    it('別の列に書き換えると、綴りが読み取り口のどこかに現れていてもエラー(gt の starts_at は期限の比較ではない)', () => {
      const found = messages([alpha({ dueFrom: 'thing.starts_at' })]);

      expect(found).toEqual([
        'ジョブ scan_alpha の due_from thing.starts_at の列 starts_at が、起動口と実装の import の閉包のどこにも' +
          '期限の比較(lte / lt)の列名として現れません',
      ]);
    });

    it('どの読み取り口にも無い列ならエラー', () => {
      expect(messages([alpha({ dueFrom: 'thing.ghost_at' })])).toHaveLength(1);
    });

    it('lt で絞っている列も接地する', () => {
      const tree = { ...TREE, 'app/src/infrastructure/alpha/reader.ts': "export const alphaReader = (q: Q, now: string) => q.lt('due_at', now);\n" };

      expect(messages([alpha()], tree)).toEqual([]);
    });

    it('起動口が無い行(Cron に結線していない)は、実装の閉包だけを探す', () => {
      const tree = { ...TREE, 'app/src/operation/alpha/scan.ts': "export const scanAlpha = (q: Q, now: string) => q.lte('due_at', now);\n" };
      const job: JobDecl = {
        ...notScheduledJob('scan_alpha', 'まだ結線していない', 'app/src/operation/alpha/scan.ts'),
        schedule: { notScheduledReason: 'まだ結線していない', implementation: 'app/src/operation/alpha/scan.ts', scheduler: 'host', dueFrom: 'thing.due_at' },
      };

      expect(messages([job], tree)).toEqual([]);
    });

    it('due_from が {entity}.{field} の形でなければ J2 本体に任せて飛ばす', () => {
      expect(messages([alpha({ dueFrom: 'due_at' })])).toEqual([]);
    });
  });

  describe('置き場の配置を差し替えたとき', () => {
    /** Next.js の木を、架空の配置(`FOREIGN_LAYOUT`)の位置へ写した木(起動口の位置・ソースの根・別名の綴りと行き先が変わる)。 */
    function foreignTree(): Readonly<Record<string, string>> {
      const moved: Record<string, string> = {};
      for (const [file, text] of Object.entries(TREE)) {
        const route = /^app\/src\/app\/(api\/.+)\/route\.ts$/.exec(file);
        const target = route === null ? file.replace(/^app\/src\//, 'app/server_code/') : `app/server_code/endpoints/${route[1] ?? ''}.handler.ts`;
        // 別名の綴りも配置が与える(`@/` → `~srv/`)。写した木の import もその綴りへ直す。
        moved[target] = text.replaceAll("'@/", "'~srv/");
      }
      return moved;
    }
    const foreignJobs = [
      alpha({ implementation: 'app/server_code/operation/alpha/scan.ts' }),
      beta({ implementation: 'app/server_code/operation/beta/scan.ts' }),
    ];
    const foreignScans = actionsWith(
      scanDecl('thing.alpha_due', 'app/server_code/operation/alpha/scan.ts'),
      scanDecl('thing.beta_due', 'app/server_code/operation/beta/scan.ts'),
    );
    const reachWith = (jobs: readonly JobDecl[], files: Readonly<Record<string, string>>) =>
      verifyEndpointReach({ jobs: jobModel(jobs), actions: foreignScans, repoRoot: repo(files), roots: TEST_ROOTS, layout: FOREIGN_LAYOUT });

    it('起動口はその配置の位置から読み、import の閉包はその配置のソースの根から辿る(接地していれば違反なし)', () => {
      expect(reachWith(foreignJobs, foreignTree()).map((finding) => finding.message)).toEqual([]);
    });

    it('起動口が別の走査を呼んでいれば、その配置の位置で名指す(Next.js の位置は出ない)', () => {
      const tree = {
        ...foreignTree(),
        'app/server_code/endpoints/api/beta/run.handler.ts': TREE['app/src/app/api/alpha/run/route.ts'] ?? '',
      };

      const [finding] = reachWith(foreignJobs, tree);

      expect(finding?.counterexample?.['route']).toBe('app/server_code/endpoints/api/beta/run.handler.ts');
      expect(finding?.message).not.toContain('route.ts');
    });

    it('Next.js の位置に起動口があっても、配置が指す位置に無ければ(実在しない口は J2 本体が言うので)ここは何も言わない', () => {
      expect(reachWith(foreignJobs, TREE).map((finding) => finding.message)).toEqual([]);
    });
  });

  describe('見ない環境', () => {
    it('実装の木が実在しない環境(仕様だけのリポジトリ)では何も見ない', () => {
      expect(messages([alpha({ dueFrom: 'thing.ghost_at', fires: 'thing.ghost' })], {})).toEqual([]);
    });

    it('カタログが無ければ何も見ない', () => {
      expect(
        verifyEndpointReach({ jobs: { available: false, catalog: null }, actions: SCANS, repoRoot: repo(TREE), roots: TEST_ROOTS, layout: TEST_LAYOUT }),
      ).toEqual([]);
    });

    it('時刻で起きないジョブは対象外', () => {
      expect(messages([notScheduledJob('scan_alpha', 'まだ結線していない')])).toEqual([]);
    });
  });
});
