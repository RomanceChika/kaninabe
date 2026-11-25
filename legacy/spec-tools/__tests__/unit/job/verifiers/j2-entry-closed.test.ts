/**
 * J2(続き)HTTP の入口の閉世界のユニットテスト。
 *
 * 実装の木の全ての入口(Route Handler)が、ジョブの `endpoint`・生成された受信口・認証の `callback`・送信の連携の `endpoints` のどれかに当たること、
 * 1 本の URL に結べない入口が無いこと、宣言した手書きの口(callback・endpoints)の入口が実在することを見る。
 *
 * この検証器だけは I/O を伴う(実装の木を走査するのが仕事)ため、`fixtures/entry-closed-good`(全部の入口が宣言に当たる木)と
 * `fixtures/entry-closed-bad`(宣言に無い入口・動的なセグメントの入口・非公開フォルダの下の入口がある木)をリポジトリルートに見立てて回す。
 * `build` / `coverage` / ドット始まりのディレクトリは git の無視の対象になりうる(リポジトリ直下の `.gitignore` が `coverage/` を無視する)ので、
 * それらを含む木は fixture に置かず、テストごとに一時ディレクトリへ組む。
 */

import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyEntryClosedWorld } from '../../../../lib/job/verifiers/j2-entry-closed.js';
import type { EntryClosedInput } from '../../../../lib/job/verifiers/j2-entry-closed.js';
import { authCallback, authEntry, authModel } from '../../../helpers/auth-builder.js';
import { externalModel, integration } from '../../../helpers/external-builder.js';
import { jobModel, scheduledJob } from '../../../helpers/job-builder.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';
import { putFrameConfig } from '../../../helpers/frame-config.js';
import { blockedInput, loadedInput, UNSELECTED } from '../../../helpers/verify-inputs.js';
import type { WalkFs } from '../../../../lib/io/walk-tree.js';
import type { ExternalCatalogSpec } from '../../../../lib/model/external/types.js';
import type { ProductLayout } from '../../../../lib/model/product/layout.js';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');

/** 全部の入口が宣言に当たる木。 */
const GOOD_ROOT = path.join(FIXTURES, 'entry-closed-good');

/** 宣言に無い入口・動的なセグメントの入口・非公開フォルダの下の入口がある木。 */
const BAD_ROOT = path.join(FIXTURES, 'entry-closed-bad');

/** `app/` を持たない木(仕様だけのリポジトリ)。 */
const SPEC_ONLY_ROOT = path.join(FIXTURES, 'samples', 'library');

/** 良い木の入口を全部宣言した外部連携カタログ(受信口 1 本・手書きの口 1 本)。 */
const EXTERNAL: ExternalCatalogSpec | null = externalModel([
  integration('billing_hook', { direction: 'inbound', signature: 'hmac_sha256', signatureKey: 'K', eventIdTable: 't', emits: 'a.b' }),
  integration('anthropic_chat', { service: 'anthropic', effect: 'read', endpoints: ['/api/ai/tutorial'] }),
]).catalog;

/** 良い木の入口を全部宣言した入力(各テストは一部を差し替える)。 */
function input(overrides: Partial<EntryClosedInput> = {}): EntryClosedInput {
  return {
    jobs: jobModel([scheduledJob('run_due_jobs', { endpoint: '/api/jobs/run' })]),
    external: loadedInput(EXTERNAL ?? failMissing()),
    auth: authModel({ callback: authCallback('/api/auth/callback') }),
    repoRoot: GOOD_ROOT,
    roots: TEST_ROOTS,
    layout: TEST_LAYOUT,
    ...overrides,
  };
}

/** 材料が組めなかったときの失敗(テストの前提が壊れている)。 */
function failMissing(): never {
  throw new Error('テストの前提が壊れています: 外部連携カタログを組めません');
}

/** 指摘の文面だけを並べる。 */
function messages(result: ReturnType<typeof verifyEntryClosedWorld>): string[] {
  return result.findings.map((finding) => finding.message);
}

describe('verifyEntryClosedWorld: 全ての入口が宣言に当たる', () => {
  it('ジョブの endpoint・受信口・認証の callback・送信の連携の endpoints で全部の入口が分類されれば、違反なし(画面の器は入口ではない)', () => {
    const result = verifyEntryClosedWorld(input());

    expect(result).toEqual({ findings: [], status: 'ran', withheld: [], unreadable: [] });
  });

  it('宣言の URL の表記ゆれ(末尾の `/`)は同じ入口として当たる', () => {
    const result = verifyEntryClosedWorld(input({ jobs: jobModel([scheduledJob('run_due_jobs', { endpoint: '/api/jobs/run/' })]) }));

    expect(result.findings).toEqual([]);
  });

  it('ジョブのカタログを採らない製品(ジョブの宣言が無い)でも、同じ判定をする(ジョブの口は未宣言になる)', () => {
    const result = verifyEntryClosedWorld(input({ jobs: { available: false, catalog: null } }));

    expect(messages(result)).toEqual([expect.stringContaining('HTTP の入口 /api/jobs/run(app/src/app/api/jobs/run/route.ts)が、どの宣言にも当たりません')]);
    expect(result.withheld).toEqual([]);
  });
});

describe('verifyEntryClosedWorld: 宣言に当たらない入口', () => {
  it('ジョブの endpoint を消すと、その口は未宣言(出どころの 4 種類を挙げ、直し方に宣言の置き場を示す)', () => {
    const result = verifyEntryClosedWorld(input({ jobs: jobModel([]) }));

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      verifier: 'J2',
      severity: 'error',
      location: { file: 'app/src/app/api/jobs/run/route.ts' },
      counterexample: { url: '/api/jobs/run', file: 'app/src/app/api/jobs/run/route.ts' },
    });
    expect(result.findings[0]?.message).toContain('ジョブの endpoint・受信の連携・認証の口(callback・start・logout)・送信の連携の endpoints のいずれでもない');
    expect(result.findings[0]?.suggestion).toContain('jobs.md');
    expect(result.findings[0]?.suggestion).toContain('auth.md');
    expect(result.findings[0]?.suggestion).toContain('external.md');
  });

  it('認証の callback を宣言しなければ、OAuth の帰り道の口は未宣言(認証仕様が無い環境でも同じ)', () => {
    const noCallback = verifyEntryClosedWorld(input({ auth: authModel({}) }));
    const noAuth = verifyEntryClosedWorld(input({ auth: undefined }));

    for (const result of [noCallback, noAuth]) {
      expect(messages(result)).toEqual([expect.stringContaining('HTTP の入口 /api/auth/callback')]);
    }
  });

  it('送信の連携の endpoints を宣言しなければ、その手書きの口は未宣言。受信の連携が無ければ生成された受信口も未宣言', () => {
    const result = verifyEntryClosedWorld(input({ external: loadedInput(externalModel([]).catalog ?? failMissing()) }));

    expect(messages(result).sort()).toEqual([
      expect.stringContaining('HTTP の入口 /api/ai/tutorial'),
      expect.stringContaining('HTTP の入口 /api/inbound/billing_hook'),
    ]);
  });

  it('外部連携を採っていない(未選択)製品は、受信口も送信の連携の口も事実として無いので、あれば未宣言(判定を保留しない)', () => {
    const result = verifyEntryClosedWorld(input({ external: UNSELECTED }));

    expect(result.withheld).toEqual([]);
    expect(messages(result).sort()).toEqual([
      expect.stringContaining('HTTP の入口 /api/ai/tutorial'),
      expect.stringContaining('HTTP の入口 /api/inbound/billing_hook'),
    ]);
  });

  it('大文字小文字だけ違う宣言は当たらない(置き場は大文字小文字を区別するファイルシステムでは別のディレクトリ)', () => {
    const result = verifyEntryClosedWorld(input({ jobs: jobModel([scheduledJob('run_due_jobs', { endpoint: '/api/Jobs/run' })]) }));

    expect(messages(result)).toContain('HTTP の入口 /api/jobs/run(app/src/app/api/jobs/run/route.ts)が、どの宣言にも当たりません(ジョブの endpoint・受信の連携・認証の口(callback・start・logout)・送信の連携の endpoints のいずれでもない)');
  });

  it('URL のパスとして書けない宣言(`//` を含む)は宣言として数えない(書き誤りは衝突の検査が指す)。その口は未宣言のまま、宣言の入口の実在は問わない', () => {
    const result = verifyEntryClosedWorld(input({ auth: authModel({ callback: authCallback('/api/auth//callback') }) }));

    expect(messages(result)).toEqual([expect.stringContaining('HTTP の入口 /api/auth/callback')]);
  });
});

describe('verifyEntryClosedWorld: 宣言に当たらない入口を持つ木', () => {
  const bad = (overrides: Partial<EntryClosedInput> = {}) =>
    verifyEntryClosedWorld(input({ repoRoot: BAD_ROOT, auth: authModel({}), external: UNSELECTED, ...overrides }));

  it('未宣言の入口・動的なセグメントの下の入口・非公開フォルダの下の入口を、それぞれ別の指摘にする(ファイルの名前順)', () => {
    const result = bad();

    expect(messages(result)).toEqual([
      'HTTP の入口のファイル app/src/app/api/_hidden/route.ts は 1 本の URL に結べません(動的なセグメントの下・ルーティングに使わない名前の下)。どの宣言でも名指せない口です',
      'HTTP の入口のファイル app/src/app/api/items/[id]/route.ts は 1 本の URL に結べません(動的なセグメントの下・ルーティングに使わない名前の下)。どの宣言でも名指せない口です',
      'HTTP の入口 /api/rogue(app/src/app/api/rogue/route.ts)が、どの宣言にも当たりません(ジョブの endpoint・受信の連携・認証の口(callback・start・logout)・送信の連携の endpoints のいずれでもない)',
    ]);
    expect(result.status).toBe('ran');
  });

  it('1 本の URL に結べない入口は、宣言を読めない種類があっても指す(どの宣言を足しても名指せないので、保留しない)。未宣言の判定だけを保留する', () => {
    const result = bad({ external: blockedInput('load-failed') });

    expect(messages(result)).toEqual([
      expect.stringContaining('app/src/app/api/_hidden/route.ts は 1 本の URL に結べません'),
      expect.stringContaining('app/src/app/api/items/[id]/route.ts は 1 本の URL に結べません'),
    ]);
    expect(result.withheld).toEqual([{ input: 'external', state: 'blocked', reason: 'load-failed' }]);
  });

  it('入口の判定を配置の entryOf に頼らない配置(キーに結べるファイルだけが入口)では、1 本の URL に結べない入口は見えない(宣言された範囲の限界)', () => {
    const entry = TEST_LAYOUT['http-entry'];
    if (entry?.classify === undefined) throw new Error('テストの前提が壊れています: 配置が http-entry の逆引きを持たない');
    const layout: ProductLayout = { ...TEST_LAYOUT, 'http-entry': { ...entry, classify: { dir: entry.classify.dir, keyOf: entry.classify.keyOf } } };

    const result = bad({ layout });

    expect(messages(result)).toEqual([expect.stringContaining('HTTP の入口 /api/rogue')]);
  });
});

describe('verifyEntryClosedWorld: 宣言した手書きの口の入口の実在', () => {
  it('認証の callback の入口が無ければ、宣言だけで口が無いとして指す(期待する置き場を示す)', () => {
    const result = verifyEntryClosedWorld(input({ repoRoot: BAD_ROOT, auth: authModel({ callback: authCallback('/api/auth/callback') }), external: UNSELECTED }));

    const missing = result.findings.filter((finding) => finding.message.includes('に対応する Route Handler がありません'));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      verifier: 'J2',
      severity: 'error',
      message: '認証 callback の endpoint /api/auth/callback に対応する Route Handler がありません',
      location: { file: 'docs/specs/backend/auth.md', pointer: 'callback' },
      counterexample: { endpoint: '/api/auth/callback', expected_route: 'app/src/app/api/auth/callback/route.ts' },
    });
  });

  it('サインインの開始・ログアウトの口の入口が無ければ、それぞれを宣言だけで口が無いとして指す', () => {
    const auth = authModel({ start: authEntry('start', '/api/auth/sign-in'), logout: authEntry('logout', '/api/auth/logout') });
    const result = verifyEntryClosedWorld(input({ repoRoot: BAD_ROOT, auth, external: UNSELECTED }));

    expect(messages(result)).toEqual(
      expect.arrayContaining([
        '認証 start の endpoint /api/auth/sign-in に対応する Route Handler がありません',
        '認証 logout の endpoint /api/auth/logout に対応する Route Handler がありません',
      ]),
    );
  });

  it('送信の連携の endpoints の入口が無ければ、連携と URL を名指して指す', () => {
    const external = externalModel([integration('anthropic_chat', { service: 'anthropic', effect: 'read', endpoints: ['/api/ai/missing'] })]).catalog ?? failMissing();

    const result = verifyEntryClosedWorld(input({ external: loadedInput(external) }));

    expect(messages(result)).toContain('外部連携 anthropic_chat の endpoints /api/ai/missing に対応する Route Handler がありません');
  });

  it('ジョブの endpoint と受信口の入口の実在は、ここでは見ない(ジョブは J2 の接地・受信口は生成物の鮮度が見る。重ねない)', () => {
    const jobs = jobModel([scheduledJob('ghost', { endpoint: '/api/ghost/run' })]);
    const external = externalModel([
      integration('ghost_hook', { direction: 'inbound', signature: 'hmac_sha256', signatureKey: 'K', eventIdTable: 't', emits: 'a.b' }),
    ]).catalog ?? failMissing();

    const result = verifyEntryClosedWorld(input({ jobs, external: loadedInput(external), auth: authModel({}) }));

    expect(messages(result).filter((message) => message.includes('に対応する Route Handler がありません'))).toEqual([]);
  });
});

describe('verifyEntryClosedWorld: 宣言を読めないとき・木が無いとき', () => {
  it('外部連携が阻害なら、受信口と送信の連携の口を知れないので、未宣言の判定を保留する(違反を出さず、保留した種類を返す)', () => {
    const result = verifyEntryClosedWorld(input({ external: blockedInput('invalid') }));

    expect(result.findings).toEqual([]);
    expect(result.withheld).toEqual([{ input: 'external', state: 'blocked', reason: 'invalid' }]);
  });

  it('認証仕様がファイルはあるのに構築できなければ(`flow: null`)、保留する。ファイルが無いのは保留しない(認証の口を持たないだけ)', () => {
    const unreadable = verifyEntryClosedWorld(input({ auth: { available: true, flow: null } }));
    const absent = verifyEntryClosedWorld(input({ auth: { available: false, flow: null } }));

    expect(unreadable.withheld).toEqual([{ input: 'auth', state: 'blocked', reason: 'load-failed' }]);
    expect(unreadable.findings).toEqual([]);
    expect(absent.withheld).toEqual([]);
    expect(messages(absent)).toEqual([expect.stringContaining('HTTP の入口 /api/auth/callback')]);
  });

  it('ジョブのカタログがファイルはあるのに構築できなければ(`catalog: null`)、保留する', () => {
    const result = verifyEntryClosedWorld(input({ jobs: { available: true, catalog: null } }));

    expect(result.findings).toEqual([]);
    expect(result.withheld).toEqual([{ input: 'jobs', state: 'blocked', reason: 'load-failed' }]);
  });

  it('読めない種類が複数あれば、全部を保留した種類として返す', () => {
    const result = verifyEntryClosedWorld(input({ external: blockedInput('load-failed'), auth: { available: true, flow: null } }));

    expect(result.withheld.map((gap) => gap.input)).toEqual(['external', 'auth']);
  });

  it('実装の木が実在しなければ(仕様だけのリポジトリ・`roots.app` が null)、見るものが無い(`no_tree`)。違反も保留も無い', () => {
    const specOnly = verifyEntryClosedWorld(input({ repoRoot: SPEC_ONLY_ROOT }));
    const undeclared = verifyEntryClosedWorld(input({ roots: { ...TEST_ROOTS, app: null } }));

    expect(specOnly).toEqual({ findings: [], status: 'no_tree', withheld: [], unreadable: [] });
    expect(undeclared).toEqual({ findings: [], status: 'no_tree', withheld: [], unreadable: [] });
  });

  it('実装の木はあるのに配置が http-entry の逆引きを持たなければ(`no_placement`)、黙って緑にせず状態で返す', () => {
    const { 'http-entry': _entry, ...withoutEntry } = TEST_LAYOUT;

    const result = verifyEntryClosedWorld(input({ layout: withoutEntry }));

    expect(result).toEqual({ findings: [], status: 'no_placement', withheld: [], unreadable: [] });
  });
});

/** テストごとに組む一時の木(`afterEach` で消す)。 */
const made: string[] = [];

afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 一時ディレクトリに実装の木を組む(`files` は実装の木のルーティングの根からの相対パス)。リポジトリルートを返す。 */
function tree(files: readonly string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'j2-entry-closed-'));
  made.push(root);
  putFrameConfig(root);
  for (const file of files) {
    const target = path.join(root, 'app/src/app', file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, 'export {};\n');
  }
  return root;
}

/** 何も宣言していない入力(一時の木に対して、入口が全部未宣言になる)。 */
function bare(repoRoot: string, overrides: Partial<EntryClosedInput> = {}): EntryClosedInput {
  return { jobs: jobModel([]), external: UNSELECTED, auth: authModel({}), repoRoot, roots: TEST_ROOTS, layout: TEST_LAYOUT, ...overrides };
}

describe('verifyEntryClosedWorld: URL のセグメントを一つも飛ばさない走査', () => {
  const FILES = ['api/build/hook/route.ts', 'api/coverage/route.ts', '.well-known/openid/route.ts', '(auth)/api/auth/callback/route.ts'];

  it('`build/` ・`coverage/` ・ドット始まりのディレクトリ・route group の下の宣言の無い入口も、未宣言として指す', () => {
    const result = verifyEntryClosedWorld(bare(tree(FILES)));

    expect(messages(result).sort()).toEqual([
      expect.stringContaining('HTTP の入口 /.well-known/openid(app/src/app/.well-known/openid/route.ts)'),
      expect.stringContaining('HTTP の入口 /api/auth/callback('),
      expect.stringContaining('HTTP の入口 /api/build/hook(app/src/app/api/build/hook/route.ts)'),
      expect.stringContaining('HTTP の入口 /api/coverage(app/src/app/api/coverage/route.ts)'),
    ]);
  });

  it('宣言すれば、それらは緑(宣言を足した側が正しい直し方)', () => {
    const jobs = jobModel([
      scheduledJob('build_hook', { endpoint: '/api/build/hook' }),
      scheduledJob('coverage', { endpoint: '/api/coverage' }),
      scheduledJob('openid', { endpoint: '/.well-known/openid' }),
    ]);

    const result = verifyEntryClosedWorld(bare(tree(FILES), { jobs, auth: authModel({ callback: authCallback('/api/auth/callback') }) }));

    expect(result.findings).toEqual([]);
  });

  it('`node_modules` と出力の名前の下も歩く(名前で飛ばさない。点検 14 回目 C14-1)', () => {
    const result = verifyEntryClosedWorld(bare(tree(['node_modules/pkg/route.ts', 'api/node_modules/x/route.ts', '.next/route.ts'])));

    expect(messages(result)).toHaveLength(3);
  });

  it('走査の根が実在しない木(`app/` はあるがルーティングの根が無い)は、入口が無いだけで落ちない', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'j2-entry-closed-'));
    made.push(root);
    mkdirSync(path.join(root, 'app'), { recursive: true });
    putFrameConfig(root);

    expect(verifyEntryClosedWorld(bare(root))).toEqual({ findings: [], status: 'ran', withheld: [], unreadable: [] });
  });
});

describe('verifyEntryClosedWorld: 宣言した口の不在は、未宣言と同じ走査の結果で判る', () => {
  const external = (urls: readonly string[]): EntryClosedInput['external'] =>
    loadedInput(externalModel([integration('anthropic_chat', { service: 'anthropic', effect: 'read', endpoints: urls })]).catalog ?? failMissing());

  it('route group の下の入口は、宣言した口の実体として数える(置き場の 1 つの綴りだけを見て偽の赤にしない)', () => {
    const root = tree(['(auth)/api/auth/callback/route.ts', 'api/ai/tutorial/route.ts']);

    const result = verifyEntryClosedWorld(bare(root, { auth: authModel({ callback: authCallback('/api/auth/callback') }), external: external(['/api/ai/tutorial']) }));

    expect(result.findings).toEqual([]);
  });

  it('5 回目 C5-4・B5-1: route.ts 以外の綴りの入口は綴りの誤りとして指し、宣言した口の実体には数えない', () => {
    const root = tree(['(auth)/api/auth/callback/route.ts', 'api/ai/tutorial/route.js']);

    const result = verifyEntryClosedWorld(bare(root, { auth: authModel({ callback: authCallback('/api/auth/callback') }), external: external(['/api/ai/tutorial']) }));

    expect(messages(result)).toEqual([
      expect.stringContaining('api/ai/tutorial/route.js は route.ts の綴りではありません'),
      expect.stringContaining('/api/ai/tutorial に対応する Route Handler がありません'),
    ]);
  });

  it('動的なセグメントの下の入口は 1 本の URL に結べないので、宣言した口の実体には数えない(宣言だけで口が無いと指す)', () => {
    const root = tree(['api/[id]/route.ts']);

    const result = verifyEntryClosedWorld(bare(root, { external: external(['/api/[id]']) }));

    expect(messages(result)).toEqual([
      expect.stringContaining('app/src/app/api/[id]/route.ts は 1 本の URL に結べません'),
      '外部連携 anthropic_chat の endpoints /api/[id] に対応する Route Handler がありません',
    ]);
  });
});

describe('verifyEntryClosedWorld: 走査で読めなかった場所は、完全な走査の「指摘 0」と区別する', () => {
  /** 実の fs を包み、指定の絶対パスの読み取りだけを EACCES で失敗させる偽の fs(実の権限は変えない)。 */
  function denying(...denied: readonly string[]): WalkFs {
    const guard = (target: string): void => {
      if (denied.includes(target)) throw Object.assign(new Error(`EACCES: ${target}`), { code: 'EACCES' });
    };
    return {
      list: (dir) => {
        guard(dir);
        return readdirSync(dir);
      },
      isDirectory: (target) => {
        guard(target);
        return statSync(target, { throwIfNoEntry: false })?.isDirectory() ?? false;
      },
    };
  }

  const external = (urls: readonly string[]): EntryClosedInput['external'] =>
    loadedInput(externalModel([integration('anthropic_chat', { service: 'anthropic', effect: 'read', endpoints: urls })]).catalog ?? failMissing());

  it('走査の根が読めない(EACCES)と、unreadable に根を挙げる(読めた分が無いので指摘は 0 だが、完全な走査とは別の結果)', () => {
    const root = tree(['api/rogue/route.ts']);

    const result = verifyEntryClosedWorld(bare(root, { fs: denying(path.join(root, 'app/src/app')) }));

    expect(result).toEqual({ findings: [], status: 'ran', withheld: [], unreadable: ['app/src/app'] });
    expect(messages(verifyEntryClosedWorld(bare(root)))).toEqual([expect.stringContaining('HTTP の入口 /api/rogue')]);
  });

  it('子のディレクトリが読めない(EACCES)と、それを挙げる。読めた部分の未宣言の入口は指す', () => {
    const root = tree(['api/rogue/route.ts', 'api/locked/route.ts']);

    const result = verifyEntryClosedWorld(bare(root, { fs: denying(path.join(root, 'app/src/app/api/locked')) }));

    expect(messages(result)).toEqual([expect.stringContaining('HTTP の入口 /api/rogue')]);
    expect(result.unreadable).toEqual(['app/src/app/api/locked']);
  });

  it('読めなかった場所があるとき、宣言した口の不在は言わない(その口は読めなかった部分にあるかもしれない)。読めたなら言う', () => {
    const root = tree(['api/locked/route.ts']);
    const declared = { auth: authModel({ callback: authCallback('/api/auth/callback') }), external: external(['/api/ai/tutorial']) };

    const unread = verifyEntryClosedWorld(bare(root, { ...declared, fs: denying(path.join(root, 'app/src/app/api/locked')) }));
    const read = verifyEntryClosedWorld(bare(root, declared));

    expect(unread.findings).toEqual([]);
    expect(messages(read)).toEqual(
      expect.arrayContaining(['外部連携 anthropic_chat の endpoints /api/ai/tutorial に対応する Route Handler がありません']),
    );
    expect(read.unreadable).toEqual([]);
  });

  it('真の空の木は、読めなかった場所が無い(unreadable が空)', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'j2-entry-closed-'));
    made.push(root);
    mkdirSync(path.join(root, 'app/src/app'), { recursive: true });
    putFrameConfig(root);

    expect(verifyEntryClosedWorld(bare(root))).toEqual({ findings: [], status: 'ran', withheld: [], unreadable: [] });
  });
});

describe('verifyEntryClosedWorld: メソッドを数えられない export は fail-closed(4 回目 C4-6)', () => {
  /** 一時の木に、本文つきの入口を 1 本置く。 */
  function treeWith(file: string, source: string): string {
    const root = tree([file]);
    writeFileSync(path.join(root, 'app/src/app', file), source);
    return root;
  }

  const declared = (endpoint: string): Partial<EntryClosedInput> => ({ jobs: jobModel([scheduledJob('hook', { endpoint })]) });

  const rows: ReadonlyArray<readonly [string, string, string | null]> = [
    ['分割代入の GET(ログアウトの口の反例の形)', 'const probeMethods = { GET: (r: Request) => new Response() };\nexport const { GET } = probeMethods;\n', 'export const { GET } = probeMethods;'],
    ['配列の分割代入', 'export const [GET] = fns;\n', 'export const [GET] = fns;'],
    ['export * from', "export * from './impl';\n", "export * from './impl';"],
    ['出口の関所で包んだ口は緑', "import { guardRoute } from '@kaninabe/runtime/http/route-guard';\nexport const POST = guardRoute(async () => new Response());\n", null],
    ['関所で包まない名前の関数は error(点検 10 回目 B10-1)', 'export async function POST() { return new Response(); }\n', 'guardRoute で包んでいません'],
    ['名前つきの再輸出は包みを読めないので error', "export { POST } from './impl';\n", 'guardRoute で包んでいません'],
  ];
  it.each(rows)('%s', (_name, source, quoted) => {
    const result = verifyEntryClosedWorld(bare(treeWith('api/hook/route.ts', source), declared('/api/hook')));
    if (quoted === null) {
      expect(result.findings).toEqual([]);
      return;
    }
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ verifier: 'J2', severity: 'error', location: { file: 'app/src/app/api/hook/route.ts' } });
    expect(result.findings[0]?.message).toContain(quoted);
  });

  it('宣言を読めず未宣言の判定を保留しているときも、数えられない export は言う(宣言に依らない事実)', () => {
    const root = treeWith('api/hook/route.ts', 'export const { GET } = o;\n');
    const result = verifyEntryClosedWorld(bare(root, { external: blockedInput('load-failed') }));
    expect(result.withheld).not.toEqual([]);
    expect(messages(result)).toEqual([expect.stringContaining('メソッドを数えられない export')]);
  });

  // 5 回目 C5-4: Next.js は CommonJS の exports.GET を口として配る。
  it.each([
    ['exports.GET = …(C5-4 の反例)', 'exports.POST = impl;\nexports.GET = impl;\n', 'exports.POST = impl;'],
    ['module.exports = …', 'module.exports = { GET: impl };\n', 'module.exports = { GET: impl };'],
    ['Object.assign(exports, …) と ESM の混在', "Object.assign(exports, { GET });\nimport { guardRoute } from '@kaninabe/runtime/http/route-guard';\nexport const POST = guardRoute(async () => new Response());\n", 'Object.assign(exports, { GET });'],
    ['関数の中の exports', "import { guardRoute } from '@kaninabe/runtime/http/route-guard';\nexport const POST = guardRoute(async () => { exports.GET = impl; return new Response(); });\n", 'export const POST = guardRoute('],
    ['require(…)', "import { guardRoute } from '@kaninabe/runtime/http/route-guard';\nconst impl = require('node:path');\nexport const POST = guardRoute(async () => impl());\n", "const impl = require('node:path');"],
  ])('CommonJS: %s は error', (_name, source, quoted) => {
    const result = verifyEntryClosedWorld(bare(treeWith('api/hook/route.ts', source), declared('/api/hook')));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.message).toContain('メソッドを数えられない export');
    expect(result.findings[0]?.message).toContain(quoted);
  });

  it.each([
    ['プロパティの名前としての exports / module(x.exports・{ exports: 1 })', "import { guardRoute } from '@kaninabe/runtime/http/route-guard';\nconst x = { exports: 1, module: 2 };\nexport const POST = guardRoute(async () => new Response(String(x.exports)));\n"],
    ['型だけの import', "import type { NextRequest } from 'next/server';\nimport { guardRoute } from '@kaninabe/runtime/http/route-guard';\nexport const POST = guardRoute(async (_r: NextRequest) => new Response());\n"],
  ])('CommonJS でない: %s は緑', (_name, source) => {
    expect(verifyEntryClosedWorld(bare(treeWith('api/hook/route.ts', source), declared('/api/hook'))).findings).toEqual([]);
  });

  it('未宣言の入口なら、未宣言の指摘と並べて出す', () => {
    const result = verifyEntryClosedWorld(bare(treeWith('api/hook/route.ts', "export * from './impl';\n")));
    expect(messages(result)).toHaveLength(2);
    expect(messages(result)).toEqual(
      expect.arrayContaining([expect.stringContaining('HTTP の入口 /api/hook'), expect.stringContaining('メソッドを数えられない export')]),
    );
  });
});

describe('verifyEntryClosedWorld: Route Handler の実体は route.ts の綴りだけ(5 回目 C5-4・B5-1)', () => {
  const declared: Partial<EntryClosedInput> = { jobs: jobModel([scheduledJob('hook', { endpoint: '/api/hook' })]) };

  it.each([
    ['route.tsx(TypeScript のまま。B5-1 の反例)', 'api/hook/route.tsx'],
    ['route.js(CommonJS の route.js。C5-4 の反例)', 'api/hook/route.js'],
    ['route.jsx', 'api/hook/route.jsx'],
    ['route.mjs', 'api/hook/route.mjs'],
    ['route.cjs', 'api/hook/route.cjs'],
    ['route.mts', 'api/hook/route.mts'],
    ['動的なセグメントの下の route.js(綴りの指摘を先に 1 件だけ)', 'api/[id]/route.js'],
    ['宣言の無い URL の route.tsx(綴りの指摘を先に 1 件だけ)', 'api/other/route.tsx'],
  ])('%s は綴りの誤り(error)', (_name, file) => {
    const result = verifyEntryClosedWorld(bare(tree(['api/hook/route.ts', file]), declared));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ verifier: 'J2', severity: 'error' });
    expect(result.findings[0]?.location?.file.endsWith(`/${file}`)).toBe(true);
    expect(result.findings[0]?.message).toContain('route.ts の綴りではありません');
  });

  it.each([
    ['route.ts は緑', 'api/hook/route.ts'],
    ['似た名前(routes.ts・route-helpers.ts)は入口ではない', 'api/hook/routes.ts'],
  ])('%s', (_name, file) => {
    expect(verifyEntryClosedWorld(bare(tree(['api/hook/route.ts', file]), declared)).findings).toEqual([]);
  });

  it('宣言した口が route.tsx だけなら、綴りの誤りと口の不在を両方言う(閉世界が「口が実在する」と数えない)', () => {
    const result = verifyEntryClosedWorld(bare(tree(['api/hook/route.tsx']), { external: loadedInput(externalModel([integration('anthropic_chat', { service: 'anthropic', effect: 'write', endpoints: ['/api/hook'] })]).catalog ?? failMissing()) }));
    expect(messages(result)).toEqual([
      expect.stringContaining('route.tsx は route.ts の綴りではありません'),
      expect.stringContaining('/api/hook に対応する Route Handler がありません'),
    ]);
  });

  it('配置が受ける綴りを宣言しなければ(entryFileName なし)、綴りは問わない', () => {
    const entry = TEST_LAYOUT['http-entry'];
    if (entry?.classify === undefined) throw new Error('テストの前提が壊れています');
    const { entryFileName: _omitted, ...rest } = entry.classify;
    const layout: ProductLayout = { ...TEST_LAYOUT, 'http-entry': { ...entry, classify: { ...rest, keyOf: (rel: string) => (rel === 'api/hook/route.tsx' ? '/api/hook' : rest.keyOf(rel)) } } };
    expect(verifyEntryClosedWorld(bare(tree(['api/hook/route.tsx']), { ...declared, layout })).findings).toEqual([]);
  });
});
