/**
 * **接続層の道は 1 つ**(保証 `fw_connection_path_closed`。fix27 項目 C。差分点検 fix26 14 回目 E14-1・M14-1 の直し)の見張り。
 *
 * 約束: RPC と表の書き込みの道は、やり直しの口(`retryRollbacks` / `retryTableWrites`)を通った型の印つきの口だけである。枠の adapter の
 * 公開の口は、どれも生の `rpc`・`schema`・`from` の書き込みを返さず受け取らず、生の口の型(`RawRpc` / `RawTableWrite`)は外から名指せない。
 *
 * 見張る相手は `framework/adapters/*` の**全部**である(名指した 2 口だけを見ていた製品の試験の後継。adapter を足すと、閉じた表が
 * 無いだけで赤)。照らしの本体は `@kaninabe/adapter-postgrest/testing/closed-surface`(型検査器で入口の全部の口を数え、全部の多重定義と
 * 上限の深さまでたどって規則 `RawPathRule` に掛ける。上限で読み切れない口は、表の理由つきの行が無ければ赤)で、ここは呼ぶだけである。
 * 負例は中身を差し替えた作り物の adapter で、照らしが見落とさないことを固定する。DB は使わない。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SURFACE_DEPTH_LIMIT, SURFACE_PROBE, SURFACE_TABLE, closedSurfaceProblems, expectedErrorProblems } from '@kaninabe/adapter-postgrest/testing/closed-surface';
import { detectRepoRoot } from '../../lib/io/paths.js';

/** リポジトリのルート。 */
const REPO_ROOT = detectRepoRoot(import.meta.dirname);

/** adapter パッケージの置き場。 */
const ADAPTERS_ROOT = join(REPO_ROOT, 'framework', 'adapters');

/** adapter パッケージの根の全部(`package.json` を持つディレクトリ)。 */
const ADAPTER_DIRS: readonly string[] = readdirSync(ADAPTERS_ROOT)
  .map((name) => join(ADAPTERS_ROOT, name))
  .filter((dir) => existsSync(join(dir, 'package.json')));

/** 接続層に触る adapter か(PostgREST の adapter そのもの・それに依存する・認証基盤のライブラリに依存する)。探りを必須にする。 */
function touchesConnection(dir: string): boolean {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { readonly name: string; readonly dependencies?: Readonly<Record<string, string>> };
  const deps = Object.keys(manifest.dependencies ?? {});
  return manifest.name === '@kaninabe/adapter-postgrest' || deps.some((dep) => dep === '@kaninabe/adapter-postgrest' || dep.startsWith('@supabase/'));
}

/** 作り物の adapter の根(実在しない置き場。中身は全部差し替える。型検査の設定と依存の解決は、置き場の親の adapter の隣に置いて借りる)。 */
function fakeDirOf(host: string): string {
  return join(ADAPTERS_ROOT, host, '__fake_adapter__');
}

/** PostgREST の adapter の隣の作り物(ベンダーの依存を持たない)。 */
const FAKE_DIR = fakeDirOf('postgrest');

/** 作り物の adapter の中身(入口の本文と表の本文を受け取り、package.json・tsconfig と合わせて差し替えにする)。 */
function fakeAdapter(index: string, table: string, extraExports: Readonly<Record<string, unknown>> = {}, host = 'postgrest'): Readonly<Record<string, string>> {
  const dir = fakeDirOf(host);
  return {
    [join(dir, 'package.json')]: JSON.stringify({ name: '@kaninabe/fake', exports: { '.': { test: './src/index.ts' }, ...extraExports } }),
    [join(dir, 'tsconfig.json')]: readFileSync(join(ADAPTERS_ROOT, host, 'tsconfig.json'), 'utf8'),
    [join(dir, 'src/index.ts')]: index,
    [join(dir, SURFACE_TABLE)]: table,
  };
}

/**
 * 入口の本文から、全部の口を正しく載せた表を作る(`export declare function 名前` / `export const 名前` は値の口、
 * `export declare class 名前` も値の口、`export interface 名前` / `export type 名前` は型の口)。表の書き方ではなく照らしの走査を試す負例・正例に使う。
 *
 * @param index - 入口の本文
 * @param unread - 読まなくてよい住所の行(住所 → 理由)
 * @param declarations - 読まなくてよい宣言の行(置き場#名前 → 理由)
 * @returns 表の本文
 */
function tableFor(index: string, unread: Readonly<Record<string, string>> = {}, declarations: Readonly<Record<string, string>> = {}): string {
  const values = [...new Set([...index.matchAll(/^export (?:declare function|declare class|const) (\w+)/gm)].map((match) => match[1]))];
  const types = [...new Set([...index.matchAll(/^export (?:interface|type) (\w+)/gm)].map((match) => match[1]))];
  const rows = [...values.map((name) => `    ${name}: typeof Root.${name};`), ...types.map((name) => `    ${name}: Root.${name};`)];
  const unreadRows = Object.entries(unread).map(([address, reason]) => `    ${JSON.stringify(address)}: ${JSON.stringify(reason)};`);
  const unreadBlock = unreadRows.length === 0 ? '' : `export interface UnreadAddresses {\n  '.': {\n${unreadRows.join('\n')}\n  };\n}\n`;
  const declarationRows = Object.entries(declarations).map(([key, reason]) => `  ${JSON.stringify(key)}: ${JSON.stringify(reason)};`);
  const declarationBlock = declarationRows.length === 0 ? '' : `export interface UnreadDeclarations {\n${declarationRows.join('\n')}\n}\n`;
  return `${ROOT_IMPORT}\nexport interface PublicSurface {\n  '.': {\n${rows.join('\n')}\n  };\n}\n${unreadBlock}${declarationBlock}`;
}

/** 走査の負例・正例を 1 つの作り物で照らす(深さの上限は既定か、指定)。 */
function walkProblems(index: string, options: { readonly unread?: Readonly<Record<string, string>>; readonly declarations?: Readonly<Record<string, string>>; readonly depthLimit?: number; readonly host?: string } = {}): string[] {
  const host = options.host ?? 'postgrest';
  return closedSurfaceProblems({
    packageDir: fakeDirOf(host),
    files: fakeAdapter(index, tableFor(index, options.unread, options.declarations), {}, host),
    ...(options.depthLimit === undefined ? {} : { depthLimit: options.depthLimit }),
  });
}

/** 生の道の文(口の名前と住所)。 */
function rawAt(name: string, address: string): string {
  return `.: 口 ${name} が生の道(rpc・schema・from の書き込み)に届く(${address})`;
}

/**
 * 作り物の中の型の import の 1 行(行き先を値で差し込む。配布の木の見張りが、作り物の本文の中の行き先を本物の import と数えないように)。
 *
 * @param names - 取り込む名前
 * @param target - 行き先
 * @returns import の行
 */
function typeImport(names: string, target: string): string {
  return `import type ${names} from ${JSON.stringify(target)};`;
}

/** 作り物の表が入口を読む行。 */
const ROOT_IMPORT = typeImport('* as Root', ['..', 'index'].join('/'));

/** 生の道を持つ形と、持たない形を並べた入口(負例と正例を 1 枚に)。 */
const LEAKY_INDEX = `
${typeImport('{ RpcSource, TableWriteSource }', ['..', '..', 'src', 'index'].join('/'))}
export interface Bare { rpc(name: string): Promise<unknown> }
export declare function createAdminClient(): { rpc(name: string): Promise<unknown>; from(t: string): { select(): unknown } };
export declare function schemaOf(): { schema(name: string): unknown };
export declare function writer(): { from(t: string): { select(): unknown; insert(row: object): unknown } };
export declare function takesBare(client: Bare): void;
export declare function untyped(): any;
export declare function retried(): RpcSource;
export declare function writes(): TableWriteSource;
export declare function storage(): { from(bucket: string): { update(path: string): unknown; download(path: string): unknown } };
export declare function options(): { db: { schema: 'api' } };
export declare function takesAnything(value: any): void;
export const LIMIT = 3;
`;

/** {@link LEAKY_INDEX} の全部の口を正しく載せた表。 */
const LEAKY_TABLE = `
${ROOT_IMPORT}
export interface PublicSurface {
  '.': {
    Bare: Root.Bare;
    createAdminClient: typeof Root.createAdminClient;
    schemaOf: typeof Root.schemaOf;
    writer: typeof Root.writer;
    takesBare: typeof Root.takesBare;
    untyped: typeof Root.untyped;
    retried: typeof Root.retried;
    writes: typeof Root.writes;
    storage: typeof Root.storage;
    options: typeof Root.options;
    takesAnything: typeof Root.takesAnything;
    LIMIT: typeof Root.LIMIT;
  };
}
`;

/** 正しい 1 口だけの入口。 */
const CLEAN_INDEX = 'export const LIMIT = 3;\nexport interface Shape { readonly n: number }\n';

/** {@link CLEAN_INDEX} の正しい表。 */
const CLEAN_TABLE = `${ROOT_IMPORT}\nexport interface PublicSurface {\n  '.': {\n    LIMIT: typeof Root.LIMIT;\n    Shape: Root.Shape;\n  };\n}\n`;


/** 読まなくてよい理由の作り物(10 文字以上)。 */
const REASON = '作り物の奥は試しのために読まなくてよい';

/** 上限の深さの手前と奥を作るための小さな上限。 */
const SMALL = 3;

/** 上限で読み切れない文。 */
function unreadAt(name: string, address: string, limit: number = SURFACE_DEPTH_LIMIT): string {
  return `.: 口 ${name} は ${limit} 段で読み切れない(${address} ほか、のべ 1 か所。読まなくてよいなら UnreadAddresses に理由つきの行が要る)`;
}

/** 4 段より深い所まで続く作り物(上限 {@link SMALL} の奥に関数がある)。 */
const FAR = 'export declare function far(): { readonly a: { readonly b: { readonly c: { d(): void } } } };\n';

/** 走査の負例と正例(多重定義・深さ・上限と表の行・循環・値だけの型・解けない型・ベンダーの型)。 */
const WALK_CASES: readonly { readonly name: string; readonly index: string; readonly unread?: Readonly<Record<string, string>>; readonly depthLimit?: number; readonly host?: string; readonly expected: readonly unknown[] }[] = [
  {
    name: '多重定義の 1 本目だけが生の道を返す(関数)',
    index: 'export declare function overloaded(id: string): { rpc(name: string): unknown };\nexport declare function overloaded(id: number): number;\n',
    expected: [rawAt('overloaded', 'overloaded@1()')],
  },
  {
    name: '多重定義の 1 本目だけが生の道を返す(メソッド)',
    index: "export interface Port { open(kind: 'raw'): { schema(name: string): unknown }; open(kind: 'safe'): number }\n",
    expected: [rawAt('Port', 'Port.open@1()')],
  },
  {
    name: '多重定義の 1 本目だけが生の道を受け取る',
    index: 'export declare function accepts(client: { rpc(name: string): unknown }): void;\nexport declare function accepts(id: number): void;\n',
    expected: [rawAt('accepts', 'accepts@1(0)')],
  },
  {
    name: '多重定義の 1 本目だけの from が書き込みの組み立てを返す',
    index: "export declare function opener(): { from(t: 'w'): { select(): unknown; upsert(): unknown }; from(t: 'r'): { select(): unknown } };\n",
    expected: [rawAt('opener', 'opener()')],
  },
  {
    name: '4 段目より深い所に生の道がある',
    index: 'export declare function deep(): { readonly a: { readonly b: { c(): { rpc(name: string): unknown } } } };\n',
    expected: [rawAt('deep', 'deep().a.b.c()')],
  },
  {
    name: 'auth.admin のような深い住所から表の書き込みに届く(作り物)',
    index: 'export declare function createClient(): { readonly auth: { readonly admin: { readonly db: { from(t: string): { select(): unknown; delete(): unknown } } } } };\n',
    expected: [rawAt('createClient', 'createClient().auth.admin.db')],
  },
  { name: '上限を超えた口が表に無い', index: FAR, depthLimit: SMALL, expected: [unreadAt('far', 'far().a.b', SMALL)] },
  { name: '上限を超えた口の手前の住所が表にある', index: FAR, depthLimit: SMALL, unread: { 'far().a': REASON }, expected: [] },
  { name: '上限を超えた口そのものの住所が表にある', index: FAR, depthLimit: SMALL, unread: { 'far().a.b': REASON }, expected: [] },
  {
    name: '表の行の名前が住所の途中で切れている(別の欄の頭)',
    index: FAR,
    depthLimit: SMALL,
    unread: { 'far().a.bb': REASON },
    expected: [unreadAt('far', 'far().a.b', SMALL), '.: 読まなくてよい住所 far().a.bb に当たる読み切れない住所が無い'],
  },
  { name: '上限の中で読み切れる口に表の行がある(当たる住所が無い)', index: FAR, unread: { 'far().a': REASON }, expected: ['.: 読まなくてよい住所 far().a に当たる読み切れない住所が無い'] },
  {
    name: '表の行の理由が短い',
    index: FAR,
    depthLimit: SMALL,
    unread: { 'far().a': '短い' },
    expected: ['.: 読まなくてよい住所 far().a に理由(10 文字以上の文字列)が無い', unreadAt('far', 'far().a.b', SMALL)],
  },
  {
    name: '表の行の奥でも生の道は名指す(行が受けるのは読み切れないことだけ)',
    index: 'export declare function far2(): { readonly a: { readonly b: { rpc(name: string): unknown; readonly c: { d(): void } } } };\n',
    depthLimit: SMALL,
    unread: { 'far2().a': REASON },
    expected: [rawAt('far2', 'far2().a.b')],
  },
  { name: '上限の奥が値だけなら読み切れる', index: 'export declare function data(): { readonly a: { readonly b: { readonly c: { readonly d: string; readonly e: readonly number[] } } } };\n', depthLimit: SMALL, expected: [] },
  { name: '値だけの再帰の型は読み切れる', index: 'export type Json = string | number | null | readonly Json[] | { readonly [key: string]: Json };\nexport declare function json(): Json;\n', depthLimit: SMALL, expected: [] },
  { name: '関数を持つ再帰の型は循環で止まって読み切れる', index: 'export interface Chain { next(): Chain; also(other: Chain): Promise<Chain>; readonly value: number }\n', expected: [] },
  { name: '型検査器が解けない型は読み切れない', index: 'export declare function broken(): Missing;\n', expected: [unreadAt('broken', 'broken()')] },
  // C27-2: 口が渡す any はどの段でも読み切れない(受け取る any は数えない)。
  { name: '戻り値の欄の any(2 段目。差分点検 fix27 E2)', index: 'export declare function deps(): { client: any };\n', expected: [unreadAt('deps', 'deps().client')] },
  { name: '内側の型の欄の any(3 段目)', index: 'interface Inner { client: any }\nexport declare function deps(): { inner: Inner };\n', expected: [unreadAt('deps', 'deps().inner.client')] },
  { name: 'コールバックに渡す any(向きが 2 回返って渡す側)', index: 'export declare function withAny(fn: (client: any) => void): void;\n', expected: [unreadAt('withAny', 'withAny(0)(0)')] },
  { name: '受け取る欄の any は数えない', index: 'export declare function takes(value: { client: any }): void;\n', expected: [] },
  { name: '渡す any も表の行の奥なら受ける', index: 'export declare function deps(): { bag: { client: any } };\n', unread: { 'deps().bag': REASON }, expected: [] },
  // C27-3: export したクラスの protected の欄は継承の先から届く。private と #名前 は届かない。
  { name: 'クラスの protected の欄が生の道(差分点検 fix27 F2)', index: 'interface R { rpc(n: string): Promise<unknown> }\nexport declare class Repo { protected readonly client: R; constructor(); }\n', expected: [rawAt('Repo', 'Reponew().client')] },
  { name: 'クラスの protected static の欄が生の道', index: 'interface R { rpc(n: string): Promise<unknown> }\nexport declare class Repo { protected static readonly client: R; }\n', expected: [rawAt('Repo', 'Repo.client')] },
  { name: '継承した protected の欄も届く', index: 'interface R { rpc(n: string): Promise<unknown> }\ndeclare class Base { protected readonly client: R }\nexport declare class Repo extends Base { constructor(); }\n', expected: [rawAt('Repo', 'Reponew().client')] },
  { name: 'クラスの private の欄は外から届かない', index: 'interface R { rpc(n: string): Promise<unknown> }\nexport declare class Repo { private readonly client: R; constructor(); }\n', expected: [] },
  { name: '関数が返したインスタンスの protected は継承できないので届かない', index: 'interface R { rpc(n: string): Promise<unknown> }\ndeclare class Hidden { protected readonly client: R }\nexport declare function make(): Hidden;\n', expected: [] },
  {
    name: 'ベンダーの生の接続層を返す・型の印の無い rpc を受け取る(E14-1 の最小の反例)',
    index: `${typeImport('{ SupabaseClient }', ['@supabase', 'supabase-js'].join('/'))}\nexport declare function createAdminClient(): SupabaseClient;\nexport declare function takesBareRpc(client: { rpc(name: string): unknown }): void;\n`,
    host: 'supabase-session',
    // 生の接続層の奥(Realtime の再帰の型)は上限で読み切れないことも名指す(閉じる側。行で受けない限り赤)。
    expected: [rawAt('createAdminClient', 'createAdminClient()'), expect.stringContaining(`.: 口 createAdminClient は ${SURFACE_DEPTH_LIMIT} 段で読み切れない(createAdminClient().`), rawAt('takesBareRpc', 'takesBareRpc(0)')],
  },
];

describe('接続層の道は 1 つ(adapter の公開の口の閉じた照らし)', () => {
  // @spec framework-guarantee-catalog @tc TC-FW-CONNPATH-001
  it('framework/adapters の全部の adapter が閉じた表を持ち、全部の入口の全部の口が載り、どの口も生の道を返さず受け取らない。接続層に触る adapter は探りの全行が書いた番号の誤りで落ちる', () => {
    const names = ADAPTER_DIRS.map((dir) => dir.slice(ADAPTERS_ROOT.length + 1));
    expect(names).toEqual(expect.arrayContaining(['postgrest', 'supabase-session']));
    for (const dir of ADAPTER_DIRS) {
      expect(closedSurfaceProblems({ packageDir: dir }), dir).toEqual([]);
      if (!touchesConnection(dir)) continue;
      expect(existsSync(join(dir, SURFACE_PROBE)), `${dir} に探り ${SURFACE_PROBE} が無い`).toBe(true);
      expect(expectedErrorProblems({ packageDir: dir, file: join(dir, SURFACE_PROBE) }), dir).toEqual([]);
    }
  });

  // @spec framework-guarantee-catalog @tc TC-FW-CONNPATH-002
  it('照らしは生の道を名指し、表の抜け・余り・指し違い・書き方の違い・入口の抜けを赤にする(正しい形は赤にしない)', () => {
    const leaky = closedSurfaceProblems({ packageDir: FAKE_DIR, files: fakeAdapter(LEAKY_INDEX, LEAKY_TABLE) });
    expect(leaky.sort()).toEqual(
      // 口が渡す any は、浅い段なら生の道としても、どの段でも読み切れないとしても名指す(C27-2)。
      [rawAt('Bare', 'Bare'), rawAt('createAdminClient', 'createAdminClient()'), rawAt('schemaOf', 'schemaOf()'), rawAt('takesBare', 'takesBare(0)'), rawAt('untyped', 'untyped()'), unreadAt('untyped', 'untyped()'), rawAt('writer', 'writer()')].sort(),
    );
    expect(closedSurfaceProblems({ packageDir: FAKE_DIR, files: fakeAdapter(CLEAN_INDEX, CLEAN_TABLE) })).toEqual([]);
    const unlisted = CLEAN_TABLE.replace('    Shape: Root.Shape;\n', '');
    expect(closedSurfaceProblems({ packageDir: FAKE_DIR, files: fakeAdapter(CLEAN_INDEX, unlisted) })).toEqual(['.: 口 Shape が表に載っていない']);
    const extra = CLEAN_TABLE.replace('    Shape: Root.Shape;\n', '    Shape: Root.Shape;\n    Gone: number;\n');
    expect(closedSurfaceProblems({ packageDir: FAKE_DIR, files: fakeAdapter(CLEAN_INDEX, extra) })).toEqual(['.: 表の Gone は口に無い']);
    const misnamed = CLEAN_TABLE.replace('    Shape: Root.Shape;', '    Shape: Root.Shape;\n    Other: Root.Shape;');
    expect(closedSurfaceProblems({ packageDir: FAKE_DIR, files: fakeAdapter(`${CLEAN_INDEX}export type Other = number;\n`, misnamed) })).toEqual(['.: 表の Other は別の口 Shape を指す']);
    const wrongForm = CLEAN_TABLE.replace('typeof Root.LIMIT', 'Root.Shape');
    expect(closedSurfaceProblems({ packageDir: FAKE_DIR, files: fakeAdapter(CLEAN_INDEX, wrongForm) })).toEqual(['.: 表の LIMIT は別の口 Shape を指す', '.: 表の LIMIT は値の口なので typeof で書く']);
    const missingEntry = fakeAdapter(CLEAN_INDEX, CLEAN_TABLE, { './more': { test: './src/index.ts' } });
    expect(closedSurfaceProblems({ packageDir: FAKE_DIR, files: missingEntry })).toEqual(['入口: 口 ./more が表に載っていない']);
    const noTable = fakeAdapter(CLEAN_INDEX, CLEAN_TABLE);
    expect(closedSurfaceProblems({ packageDir: FAKE_DIR, tableFile: join(FAKE_DIR, 'src/__tests__/elsewhere.ts'), files: noTable })).toEqual([`閉じた表 ${join(FAKE_DIR, 'src/__tests__/elsewhere.ts')} がありません`]);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-CONNPATH-003
  it('期待した誤りの番号の照らしは、別の番号で落ちる行・落ちない行・番号の無い印・印の無い行の誤り・番号のほかの誤りを全部赤にする', () => {
    const probe = join(FAKE_DIR, 'src/__tests__/probe.ts');
    const files = (text: string): Readonly<Record<string, string>> => ({ ...fakeAdapter(CLEAN_INDEX, CLEAN_TABLE), [probe]: text });
    const run = (text: string): string[] => expectedErrorProblems({ packageDir: FAKE_DIR, file: probe, files: files(text) });
    const good = "const box: { readonly n: number } = { n: 1 };\n// @ts-expect-error TS2339 無い欄は読めない。\nvoid box.m;\n";
    expect(run(good)).toEqual([]);
    expect(run(good.replace('TS2339', 'TS2322'))).toEqual(['probe.ts:2 は TS2322 で落ちない(実際: TS2339)']);
    expect(run(good.replace('TS2339 ', ''))).toEqual(['probe.ts:2 の @ts-expect-error に誤りの番号(TSxxxx)が無い', 'probe.ts に番号つきの @ts-expect-error が 1 つも無い', expect.stringContaining('印の無い行の誤り: probe.ts:3 TS2339')]);
    expect(run(good.replace('void box.m;', 'void box.n;'))).toEqual(['probe.ts:2 は TS2339 で落ちない(実際: 誤り無し)']);
    expect(run(`${good}const wrong: string = 1;\n`)).toEqual([expect.stringContaining('印の無い行の誤り: probe.ts:4 TS2322')]);
    expect(run(good.replace('void box.m;', 'void [box.m, missingName];'))).toEqual(['probe.ts:2 は TS2339 のほかに TS2304 でも落ちる']);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-CONNPATH-005
  it('照らしは exports の全部の鍵を数え、test 条件の無い入口(文字列・types / default・入れ子)も型の入口を解いて照らし、解けない鍵は赤にする(差分点検 fix27 C27-1)', () => {
    const raw = 'interface R { rpc(n: string): Promise<unknown> }\nexport declare function createRaw(): R;\n';
    const run = (entry: unknown, table = CLEAN_TABLE): string[] => closedSurfaceProblems({ packageDir: FAKE_DIR, files: { ...fakeAdapter(CLEAN_INDEX, table, { './raw': entry }), [join(FAKE_DIR, 'src/raw.ts')]: raw } });
    const forms: readonly (readonly [string, unknown])[] = [
      ['文字列の入口', './src/raw.ts'],
      ['types と default だけ', { types: './src/raw.ts', default: './src/raw.ts' }],
      ['入れ子の条件', { import: { test: './src/raw.ts', default: './dist/raw.js' } }],
      ['require だけ', { require: './src/raw.ts' }],
    ];
    const rawTable = CLEAN_TABLE.replace(ROOT_IMPORT, `${ROOT_IMPORT}\n${typeImport('* as Raw', ['..', 'raw'].join('/'))}`).replace('  };\n}\n', '  };\n  \'./raw\': {\n    createRaw: typeof Raw.createRaw;\n  };\n}\n');
    for (const [name, entry] of forms) {
      expect(run(entry), name).toEqual(['入口: 口 ./raw が表に載っていない']);
      expect(run(entry, rawTable), name).toEqual(['./raw: 口 createRaw が生の道(rpc・schema・from の書き込み)に届く(createRaw())']);
    }
    const unresolvable: readonly (readonly [string, unknown])[] = [
      ['型検査器が当てない条件だけ', { node: './src/raw.ts' }],
      ['型のファイルを指さない', { default: './dist/raw.js' }],
      ['ファイルが無い', { types: './src/gone.ts' }],
      ['配列', ['./src/raw.ts']],
    ];
    for (const [name, entry] of unresolvable) expect(run(entry), name).toEqual(['入口: 口 ./raw が表に載っていない', expect.stringContaining('入口 ./raw の型の入口を解けない')]);
    const wildcard = closedSurfaceProblems({ packageDir: FAKE_DIR, files: fakeAdapter(CLEAN_INDEX, CLEAN_TABLE, { './*': './src/*.ts' }) });
    expect(wildcard).toEqual(['入口: 口 ./* が表に載っていない', expect.stringContaining('入口 ./* の型の入口を解けない')]);
    expect(run(null)).toEqual([]);
    const sugar = { ...fakeAdapter(CLEAN_INDEX, CLEAN_TABLE), [join(FAKE_DIR, 'package.json')]: JSON.stringify({ name: '@kaninabe/fake', exports: './src/index.ts' }) };
    expect(closedSurfaceProblems({ packageDir: FAKE_DIR, files: sugar })).toEqual([]);
    const sugarConditions = { ...fakeAdapter(CLEAN_INDEX, CLEAN_TABLE), [join(FAKE_DIR, 'package.json')]: JSON.stringify({ name: '@kaninabe/fake', exports: { types: './src/index.ts' } }) };
    expect(closedSurfaceProblems({ packageDir: FAKE_DIR, files: sugarConditions })).toEqual([]);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-CONNPATH-006
  it('型引数を持つ口は、表が書いた型引数の 1 点だけでなく宣言の型(型の引数を制約の上限)でもたどり、上限を解けない条件型は読み切れない(差分点検 fix27 C27-4)', () => {
    const index = 'interface Raw2 { rpc(n: string): Promise<unknown> }\nexport type Pick2<T> = T extends 1 ? Raw2 : { ok: true };\nexport interface Holder<C extends Raw2 | number> { readonly value: C }\nexport declare function make<K extends 1 | 2>(k: K): K extends 1 ? Raw2 : number;\n';
    const table = `${ROOT_IMPORT}\nexport interface PublicSurface {\n  '.': {\n    Pick2: Root.Pick2<2>;\n    Holder: Root.Holder<number>;\n    make: typeof Root.make<2>;\n  };\n}\n`;
    expect(closedSurfaceProblems({ packageDir: FAKE_DIR, files: fakeAdapter(index, table) })).toEqual([rawAt('Pick2', 'Pick2'), rawAt('Holder', 'Holder.value'), rawAt('make', 'make()')]);
    // 制約が循環して型検査器が上限を解けない条件型は、枝を読めないので読み切れない(表の明示の行があるときだけ通す)。
    // 型の口として表が型引数を当てると、型検査器はその展開も深すぎると落とす(表の誤りとしても赤)。
    const loop = 'type Loop<T> = T extends string ? Loop<T> : Loop<T>;\nexport declare function looped<T>(value: T): Loop<T>;\n';
    expect(walkProblems(loop)).toEqual([unreadAt('looped', 'looped()')]);
    expect(walkProblems(loop, { unread: { 'looped()': REASON } })).toEqual([]);
    const loopType = `${ROOT_IMPORT}\nexport interface PublicSurface {\n  '.': {\n    Loop: Root.Loop<number>;\n  };\n}\n`;
    expect(closedSurfaceProblems({ packageDir: FAKE_DIR, files: fakeAdapter(`export ${loop.split('\n')[0]}\n`, loopType) })).toEqual([expect.stringContaining('TS2589'), unreadAt('Loop', 'Loop')]);
    const benign = 'export type Box<T> = { readonly value: T };\n';
    expect(closedSurfaceProblems({ packageDir: FAKE_DIR, files: fakeAdapter(benign, `${ROOT_IMPORT}\nexport interface PublicSurface {\n  '.': {\n    Box: Root.Box<number>;\n  };\n}\n`) })).toEqual([]);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-CONNPATH-007
  it('宣言の行(置き場#名前)は、その宣言の中の読み切れないものだけを受け、同じ名前の別の宣言・宣言の外の any・行の中の生の道・当たらない行・理由の短い行は赤にする', () => {
    const bag = 'interface Bag { readonly [key: string]: any }\nexport declare function bag(): { readonly meta: Bag };\n';
    const own = { './src/index.ts#Bag': REASON };
    expect(walkProblems(bag)).toEqual([unreadAt('bag', 'bag().meta[]')]);
    expect(walkProblems(bag, { declarations: own })).toEqual([]);
    // 同じ名前の別の置き場の宣言は受けない(受けない行は当たらない行としても赤)。
    expect(walkProblems(bag, { declarations: { './src/other.ts#Bag': REASON } })).toEqual([unreadAt('bag', 'bag().meta[]'), 'UnreadDeclarations: 読まなくてよい宣言 ./src/other.ts#Bag に当たる読み切れない所が無い']);
    expect(walkProblems(bag, { declarations: { '@vendor/pkg/types.d.ts#Bag': REASON } })).toEqual([unreadAt('bag', 'bag().meta[]'), 'UnreadDeclarations: 読まなくてよい宣言 @vendor/pkg/types.d.ts#Bag に当たる読み切れない所が無い']);
    // 宣言の外の any は赤のまま。
    const outside = 'interface Bag { readonly [key: string]: any }\nexport declare function both(): { readonly meta: Bag; readonly other: any };\n';
    expect(walkProblems(outside, { declarations: own })).toEqual([unreadAt('both', 'both().other')]);
    // 行の中でも生の道は名指す。
    const leaky = 'interface Bag { readonly [key: string]: unknown; readonly client: { rpc(name: string): unknown } }\nexport declare function bag(): { readonly meta: Bag };\n';
    expect(walkProblems(leaky, { declarations: own })).toEqual([rawAt('bag', 'bag().meta.client'), 'UnreadDeclarations: 読まなくてよい宣言 ./src/index.ts#Bag に当たる読み切れない所が無い']);
    // 当たらない行・理由の短い行・形の崩れた行。
    expect(walkProblems(CLEAN_INDEX, { declarations: { './src/index.ts#Shape': REASON } })).toEqual(['UnreadDeclarations: 読まなくてよい宣言 ./src/index.ts#Shape に当たる読み切れない所が無い']);
    expect(walkProblems(bag, { declarations: { './src/index.ts#Bag': '短い' } })).toEqual(['UnreadDeclarations: 読まなくてよい宣言 ./src/index.ts#Bag に理由(10 文字以上の文字列)が無い', unreadAt('bag', 'bag().meta[]')]);
    expect(walkProblems(bag, { declarations: { Bag: REASON } })).toEqual(['UnreadDeclarations の Bag は「置き場#名前」の形で書く', unreadAt('bag', 'bag().meta[]')]);
  });

  // @spec framework-guarantee-catalog @tc TC-FW-CONNPATH-004
  it('照らしは全部の多重定義と上限の深さまでたどり、上限で読み切れない口は表の理由つきの行が無ければ赤にする(多重定義の 1 本目・4 段目より深い所・auth.admin の作り物・行の有無と形・循環・値だけの型・解けない型・ベンダーの型・どの段の渡す any・クラスの protected の欄)', () => {
    for (const { name, index, unread, depthLimit, host, expected } of WALK_CASES) {
      const options = { ...(unread === undefined ? {} : { unread }), ...(depthLimit === undefined ? {} : { depthLimit }), ...(host === undefined ? {} : { host }) };
      expect(walkProblems(index, options), name).toEqual(expected);
    }
  });
});
