import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  APP_FRAME_HOME,
  APP_FRAME_SPELLINGS,
  findPlatformSpellings,
  findTargetSpellings,
  HOST_HOME,
  HOST_SPELLINGS,
  MODULE_SPECIFIER_SPELLINGS,
  PLATFORM_HOME,
  PLATFORM_SPELLINGS,
  TARGET_SPELLINGS,
  targetSpellingProblems,
} from '../../../lib/gates/platform-spellings.js';
import { readTsTree } from '../../../lib/io/read-ts-tree.js';

/**
 * **後段の綴りは、その後段の置き場(`lib/targets/<後段>/`)の外の文字列に書かない**(C28 の続き。プラットフォーム = supabase の綴りと、
 * ホスト = vercel の綴り。後段ごとの綴りの表 `TARGET_SPELLINGS` の 1 行ずつ。
 * 設計メモ framework-modules §20。新しいルール ID は足さない)。
 *
 * 認証・API 層の約束(現在の実行者を返す認証関数・セッション属性の JWT の枝・DB ロールの名前・外に出すスキーマの名前)は、
 * 設定 `PlatformProfile` の値の置き場にだけ綴りを持つ。見るのは `lib/**` の**文字列リテラルとテンプレート文字列の文面**
 * (AST。コメントは見ない)。**免除の口は無い** —— 置き場そのもの(`PLATFORM_HOME`)が唯一の境界で、許可リストも例外の表も無い。
 */

const LIB_DIR = fileURLToPath(new URL('../../../lib/', import.meta.url));
const CLI_DIR = fileURLToPath(new URL('../../../cli/', import.meta.url));
const AUTH_NAME = 'Supabase Auth の名前(認証関数・認証テーブル・認証クライアント)';

/** 本文の写しを作る。 */
function tree(files: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  return new Map(Object.entries(files));
}

/** 見つかった綴りの名前だけを返す。 */
function namesOf(files: Readonly<Record<string, string>>): readonly string[] {
  return findPlatformSpellings(tree(files)).map((hit) => hit.spelling);
}

describe('lib と cli の実物', () => {
  // 母集合は lib の全部と、cli の `.ts`(cli は後段を読んでよいが、綴りを直書きしてよいわけではない。`.mjs` は「見ていないもの」)
  const cliTs = [...readTsTree(CLI_DIR, 'cli/')].filter(([file]) => file.endsWith('.ts'));
  const sources = new Map([...readTsTree(LIB_DIR, 'lib/'), ...cliTs]);

  it('後段の置き場の外に、プラットフォームの綴りは 1 つも無い(基線も免除も持たない)', () => {
    expect(sources.size).toBeGreaterThan(500);
    expect([...sources.keys()].filter((file) => file.startsWith('cli/')).length, 'cli の .ts も母集合に入る').toBeGreaterThan(5);
    expect(findTargetSpellings(sources).map((hit) => `${hit.file}:${hit.line}  ${hit.spelling}  ${hit.text}`)).toEqual([]);
    expect(TARGET_SPELLINGS.map((row) => row.target)).toEqual(['supabase', 'vercel', 'nextjs']);
  });

  it('ホスト(vercel)の置き場の中には Cron の登録ファイルの綴りがある(空振りでない)。置き場の外には 1 つも無い', () => {
    const inside = findPlatformSpellings(sources, HOST_SPELLINGS, /^$/).filter((hit) => HOST_HOME.test(hit.file));
    expect(inside.length).toBeGreaterThan(0);
    expect(findPlatformSpellings(sources, HOST_SPELLINGS, HOST_HOME)).toEqual([]);
  });

  it('アプリの枠(nextjs)の置き場の中には、見張る綴りの全種類がある(空振りでない)。置き場の外には 1 つも無い', () => {
    const inside = findPlatformSpellings(sources, APP_FRAME_SPELLINGS, /^$/).filter((hit) => APP_FRAME_HOME.test(hit.file));
    // `@/app/…` のモジュール指定は、置き場の中でも**文字列としては書かれない**(基準の役割 `source-root` の module に置き場を接いで導く = 綴りの正が 1 本)。
    // 腐っていないことは、下の「パスとして使う形だけを数える」の合成ソース(`@/app/api/x/route` が 1 件に当たる)が固定する。
    // `src/{層}` は、置き場の中でも**文字列としては書かれない**(ソースの根 `src` は `source-root` の置き場、層は別の定数で、接いで導く)。合成ソースで固定する(下)。
    // `e2e` は、置き場の中では**語の単独**(`place: () => 'e2e'`)でしか書かれず、単独の語は数えない(規則は 1 つ)。パスの形は合成ソースで固定する(下)。
    const derivedInHome = ['Route Handler のモジュール指定(app 配下の別名の指定)', 'ソースの根の下の層のディレクトリ(パスとして使う形 `src/{層}`)', 'E2E の置き場のディレクトリ(パスとして使う形 `e2e`)'];
    expect([...new Set(inside.map((hit) => hit.spelling))].sort(), '腐った綴りを残さない').toEqual(
      APP_FRAME_SPELLINGS.map((spelling) => spelling.name)
        .filter((name) => !derivedInHome.includes(name))
        .sort(),
    );
    expect(findPlatformSpellings(sources, APP_FRAME_SPELLINGS, APP_FRAME_HOME)).toEqual([]);
  });

  it('アプリの枠の綴りは、パスとして使う形だけを数える(語の単独の `route.ts` ・`app` の語は数えない)', () => {
    const spelled = (text: string): readonly string[] => findPlatformSpellings(tree({ 'lib/x.ts': `export const A = ${JSON.stringify(text)};\n` }), APP_FRAME_SPELLINGS, /^$/).map((hit) => hit.spelling);
    // 層のディレクトリ(`src/app`)の綴りと Route Handler の綴りの両方に当たる(2 件)。
    expect(spelled('app/src/app/api/x/route.ts')).toHaveLength(2);
    expect(spelled('@/app/api/x/route')).toHaveLength(1);
    expect(spelled('src/composition/inbound/x.ts')).toHaveLength(2);
    expect(spelled('route.ts')).toEqual([]);
    expect(spelled('app')).toEqual([]);
    expect(spelled('@/composition/alpha')).toEqual([]);
  });

  it('画面の器まわりの綴り(page.tsx / proxy.ts / favicon.ico / __screens__)も、パスとして使う形だけを数える', () => {
    const spelled = (text: string): readonly string[] => findPlatformSpellings(tree({ 'lib/x.ts': `export const A = ${JSON.stringify(text)};\n` }), APP_FRAME_SPELLINGS, /^$/).map((hit) => hit.spelling);
    expect(spelled('app/src/app/workshops/[id]/page.tsx')).toHaveLength(2);
    expect(spelled('/page.tsx')).toHaveLength(1);
    expect(spelled('src/proxy.ts')).toHaveLength(1);
    expect(spelled('proxy.ts')).toHaveLength(1);
    expect(spelled('app/src/app/favicon.ico')).toHaveLength(2);
    expect(spelled('app/src/app/__screens__/x.test.tsx')).toHaveLength(2);
    expect(spelled('__screens__')).toHaveLength(1);
    // 文の途中に出る綴り・似た名前は数えない(散文・別のファイル)。
    expect(spelled('page.tsx を作る')).toEqual([]);
    expect(spelled('mypage.tsx')).toEqual([]);
    expect(spelled('reverse_proxy.ts')).toEqual([]);
    expect(spelled('__screens__x')).toEqual([]);
  });

  it('操作・保存点・フォームの置き場の綴り(_actions / _screens / composition/usecase / components/usecase/generated)も、パスとして使う形だけを数える(土台の表が配置に移った後)', () => {
    const spelled = (text: string): readonly string[] => findPlatformSpellings(tree({ 'lib/x.ts': `export const A = ${JSON.stringify(text)};\n` }), APP_FRAME_SPELLINGS, /^$/).map((hit) => hit.spelling);
    expect(spelled('src/app/_actions/usecase')).toHaveLength(2);
    expect(spelled('_actions')).toHaveLength(1);
    expect(spelled('src/app/_screens/generated')).toHaveLength(2);
    expect(spelled('src/composition/usecase/demo/register.ts')).toHaveLength(2);
    expect(spelled('src/components/usecase/generated')).toHaveLength(3);
    expect(spelled('components/usecase/generated/x.tsx')).toHaveLength(2);
    // 似た名前・語の単独・散文の途中は数えない。
    expect(spelled('_actionsx')).toEqual([]);
    expect(spelled('my_screens')).toEqual([]);
    expect(spelled('composition/usecases')).toEqual([]);
    expect(spelled('components/usecase')).toHaveLength(1); // 層の `components` の綴りには当たる(フォームの置き場の綴りには当たらない)
    expect(spelled('_actions を読む')).toEqual([]);
  });

  it('層・E2E・設定の雛形の綴り(部品化 ③-c6。W3 の「層の並びは仕組みが決めている形」の許しの撤回)も、文字列ぜんたいがパスの形のものだけを数える', () => {
    const spelled = (text: string): readonly string[] => findPlatformSpellings(tree({ 'lib/x.ts': `export const A = ${JSON.stringify(text)};\n` }), APP_FRAME_SPELLINGS, /^$/).map((hit) => hit.spelling);
    for (const layer of ['app', 'operation', 'infrastructure', 'composition', 'domain', 'components']) {
      expect(spelled(`src/${layer}`), layer).toContain('ソースの根の下の層のディレクトリ(パスとして使う形 `src/{層}`)');
      expect(spelled(`app/src/${layer}/x.ts`), layer).toContain('ソースの根の下の層のディレクトリ(パスとして使う形 `src/{層}`)');
    }
    // 単独の語は数えない(規則は 1 つ。`components` ・`e2e` は仕様の語としても出る)。パスの形(`/` を含む)だけを数える。
    expect(spelled('components')).toEqual([]);
    expect(spelled('e2e')).toEqual([]);
    expect(spelled('src')).toEqual([]);
    expect(spelled('components/x')).toEqual(['UI 部品の層のディレクトリ(パスとして使う形 `components`)']);
    expect(spelled('e2e/x')).toEqual(['E2E の置き場のディレクトリ(パスとして使う形 `e2e`)']);
    expect(spelled('/e2e')).toEqual(['E2E の置き場のディレクトリ(パスとして使う形 `e2e`)']);
    expect(spelled('app/e2e')).toEqual(['E2E の置き場のディレクトリ(パスとして使う形 `e2e`)']);
    expect(spelled('app/e2e/smoke.spec.mts')).toEqual(['E2E の置き場のディレクトリ(パスとして使う形 `e2e`)']);
    expect(spelled('app/.env.example')).toEqual(['設定の雛形のファイルの名前(パスとして使う形 `.env.example`)']);
    expect(spelled('.env.example')).toEqual(['設定の雛形のファイルの名前(パスとして使う形 `.env.example`)']);
    // 散文に埋まったパス・似た名前・層でない `src` の下は数えない(生成物の本文や案内文は、文面ごと直すと生成物が変わるので扱わない = 限界)。
    for (const prose of ['実装の CSS(app/src/app/_styles/ui.module.css)を読めなかった', 'import { x } from \'@/components/form-row\';', 'src/elsewhere/x.ts', 'src/application', 'e2e を回す', 'e2e2', 'my.env.example', 'components-x']) {
      expect(spelled(prose), prose).toEqual([]);
    }
  });

  it('ソースの根の別名の指定は、アプリの枠の後段の置き場の外の文字列に書けない(後段どうしも。生成器は配置が決めた指定を受け取るだけ。免除の口は無い)', () => {
    // 実物: 後段 nextjs の置き場の外に、別名で始まる指定は 1 つも無い(ほかの後段の通し実行の道具も、配置から引いた指定を使う)。
    expect(findPlatformSpellings(sources, MODULE_SPECIFIER_SPELLINGS, APP_FRAME_HOME)).toEqual([]);
    // 別名の綴りは nextjs の行に載っている(実物の検査 `findTargetSpellings` が見る)。
    const nextjs = TARGET_SPELLINGS.find((row) => row.target === 'nextjs');
    expect(nextjs?.spellings).toEqual([...APP_FRAME_SPELLINGS, ...MODULE_SPECIFIER_SPELLINGS]);
  });

  it('別名の指定を直書きすると赤になる(負例。わざと足す。生成器も、ほかの後段の置き場も。nextjs の置き場の中は数えない)', () => {
    const next = new Map(sources);
    next.set('lib/generate/render/regression.ts', ["export const IMPORT = \"import { x } from '@/x';\";", 'export const HEAD = `@/domain/generated/${name}`;', 'export const PROSE = "説明 `@/components/y` の文";'].join('\n'));
    next.set('lib/targets/supabase/regression.ts', "export const OTHER = \"import { x } from '@/x';\";\n");
    next.set('lib/targets/nextjs/regression.ts', "export const INSIDE = \"import { x } from '@/x';\";\n");
    const found = findTargetSpellings(next).map((hit) => [hit.file, hit.line, hit.spelling]);
    const NAME = 'ソースの根の別名で始まるモジュール指定(import の行・説明文に埋めた引用)';
    expect(found).toEqual([
      ['lib/generate/render/regression.ts', 1, NAME],
      ['lib/generate/render/regression.ts', 2, NAME],
      ['lib/generate/render/regression.ts', 3, NAME],
      ['lib/targets/supabase/regression.ts', 1, NAME],
    ]);
  });

  it('別名の指定の判定: 文字列の頭か引用符・バッククォートの直後だけ(スコープ付きパッケージ・文の途中・コメントは数えない)', () => {
    const spelled = (code: string): number =>
      findPlatformSpellings(tree({ 'lib/x.ts': code }), MODULE_SPECIFIER_SPELLINGS, APP_FRAME_HOME).length;
    expect(spelled("export const A = '@/x';\n")).toBe(1);
    expect(spelled("export const A = \"import y from '@/x';\";\n")).toBe(1);
    expect(spelled('export const A = `@/${name}`;\n')).toBe(1);
    expect(spelled("export const A = '@kaninabe/runtime/domain';\n")).toBe(0);
    expect(spelled("export const A = 'a@/x';\n")).toBe(0);
    expect(spelled("export const A = 'mail me (@/x)';\n")).toBe(0);
    expect(spelled("// import y from '@/x'\nexport const A = 1;\n")).toBe(0);
    // 後段 nextjs の置き場の中は数えない・外は数える(同じ文字列で、置き場の内外だけが違う)。
    expect(findPlatformSpellings(tree({ 'lib/targets/nextjs/x.ts': "export const A = '@/x';\n" }), MODULE_SPECIFIER_SPELLINGS, APP_FRAME_HOME)).toEqual([]);
    expect(findPlatformSpellings(tree({ 'lib/targets/supabase/x.ts': "export const A = '@/x';\n" }), MODULE_SPECIFIER_SPELLINGS, APP_FRAME_HOME)).toHaveLength(1);
  });

  it('層・E2E・設定の雛形の綴りを置き場の外に直書きすると赤になる(わざと足す)', () => {
    const next = new Map(sources);
    next.set('lib/generate/regression.ts', "export const SRC = 'app/src/operation';\nexport const E2E = join(root, 'app/e2e');\n");
    next.set('lib/config/regression.ts', "export const TEMPLATE = 'app/.env.example';\n");
    const found = findTargetSpellings(next).map((hit) => [hit.file, hit.spelling]);
    expect(found).toEqual([
      ['lib/config/regression.ts', '設定の雛形のファイルの名前(パスとして使う形 `.env.example`)'],
      ['lib/generate/regression.ts', 'ソースの根の下の層のディレクトリ(パスとして使う形 `src/{層}`)'],
      ['lib/generate/regression.ts', 'E2E の置き場のディレクトリ(パスとして使う形 `e2e`)'],
    ]);
  });

  it('単語ごとに分けたパスの組み立て(join / joinPath / path.join / path.resolve / …Path の連続する文字列リテラルの引数)も、つないだ形で後段の綴りに当てる', () => {
    const spelledIn = (code: string): readonly (readonly [number, string])[] =>
      findPlatformSpellings(tree({ 'lib/x.ts': code }), APP_FRAME_SPELLINGS, /^$/).map((hit) => [hit.line, hit.spelling] as const);
    const SRC = 'ソースの根の下の層のディレクトリ(パスとして使う形 `src/{層}`)';
    expect(spelledIn("export const A = join('src', 'operation');\n")).toEqual([[1, SRC]]);
    expect(spelledIn("export const A = joinPath(roots.app, 'src', 'operation', '__tests__');\n")).toEqual([[1, SRC]]);
    expect(spelledIn("export const A = path.join(x, 'app', '_actions');\n")).toEqual([[1, 'Server Action の置き場のディレクトリ(パスとして使う形 `_actions`)']]);
    expect(spelledIn("export const A = path.posix.resolve('a', 'src', 'domain');\n")).toEqual([[1, SRC]]);
    expect(spelledIn("export const A = appPath(roots, 'src', 'domain');\n")).toEqual([[1, SRC]]);
    // 連続は非リテラルの引数で切れる・空文字の段は無いものとして飛ばす・複数行の呼び出しは先頭の引数の行を指す。
    expect(spelledIn("export const A = join('src', dir, 'operation');\n")).toEqual([]);
    expect(spelledIn("export const A = join('', 'e2e');\n")).toEqual([]);
    expect(spelledIn("export const A = join(\n  root,\n  'src',\n  'infrastructure',\n);\n")).toEqual([[3, SRC]]);
    expect(spelledIn("export const A = join('src', 'operation', dir, 'e2e', 'smoke');\n").map(([, name]) => name)).toEqual([SRC, 'E2E の置き場のディレクトリ(パスとして使う形 `e2e`)']);
    // 1 つの引数がすでにパスの形で当たっているなら、同じ箇所を 2 回言わない。
    expect(spelledIn("export const A = join('app/src/operation', 'x');\n")).toHaveLength(1);
    // 単独の語・パスを組む口でない呼び出し・配列の join は数えない。
    expect(spelledIn("export const A = joinPath(roots.app, 'src');\n")).toEqual([]);
    expect(spelledIn("export const A = join('components');\n")).toEqual([]);
    expect(spelledIn("export const A = lines('src', 'operation');\n")).toEqual([]);
    expect(spelledIn("export const A = parts.join('/');\n")).toEqual([]);
    // テンプレートの補間の間の断片も、断片ごとに同じ綴りに当てる。
    expect(spelledIn('export const A = `${root}/src/operation`;\n')).toEqual([[1, SRC]]);
    expect(spelledIn('export const A = `${root}/src/${layer}/x`;\n')).toEqual([]);
  });

  it('単語ごとに分けた組み立てを置き場の外に足すと赤になる(わざと足す)', () => {
    const next = new Map(sources);
    next.set('lib/generate/regression.ts', "export const A = join('src', 'operation');\nexport const B = path.join(root, 'app', '_actions');\n");
    const found = findTargetSpellings(next).map((hit) => [hit.file, hit.line, hit.spelling]);
    expect(found).toEqual([
      ['lib/generate/regression.ts', 1, 'ソースの根の下の層のディレクトリ(パスとして使う形 `src/{層}`)'],
      ['lib/generate/regression.ts', 2, 'Server Action の置き場のディレクトリ(パスとして使う形 `_actions`)'],
    ]);
  });

  it('置き場の中には綴りがある(検査が空振りでない: 置き場を外すと拾う)。置き場は 1 つだけで、その外は空', () => {
    expect([...sources.keys()].filter((file) => PLATFORM_HOME.test(file)).length).toBeGreaterThan(0);
    const inside = findPlatformSpellings(sources, PLATFORM_SPELLINGS, /^$/).filter((hit) => PLATFORM_HOME.test(hit.file));
    const kinds = new Set(inside.map((hit) => hit.spelling));
    // スキーマ名は SQL の文脈(修飾名・関数呼び出し・schema の宣言)だけを数えるので、値の置き場(名前そのものを持つ)には出ない。
    // その形の検出は下の「綴りごと」の合成ソースが固定する。
    const expected = PLATFORM_SPELLINGS.filter((spelling) => !spelling.name.startsWith('外に出すスキーマ名')).map((spelling) => spelling.name);
    expect([...kinds].sort(), '見張る綴り(スキーマ名を除く)の全種類が置き場に実在する(腐った綴りを残さない)').toEqual(expected.sort());
  });

  it('わざと 1 本足すと赤になる(置き場の外の生成器に直書きした形)', () => {
    const next = new Map(sources);
    next.set('lib/sql/regression.ts', "export const EXECUTOR = 'service_role';\n");
    next.set('cli/regression.ts', "export const KEY = 'SUPABASE_SERVICE_ROLE_KEY';\n");
    next.set('lib/job/regression.ts', "export const CONFIG = 'app/vercel.json';\n");
    next.set('lib/generate/regression.ts', 'export const route = (url: string) => `app${url}/route.ts`;\n');
    const found = findTargetSpellings(next);
    expect(found.map((hit) => [hit.file, hit.spelling])).toEqual([
      ['cli/regression.ts', '内部実行の DB ロール名'],
      ['lib/generate/regression.ts', 'Route Handler のファイルの名前(パスとして使う形 `…/route.ts`)'],
      ['lib/job/regression.ts', 'ホストの Cron の登録ファイルの名前(パスとして使う形)'],
      ['lib/sql/regression.ts', '内部実行の DB ロール名'],
    ]);
  });
});

describe('後段の置き場と綴りの表の対応(新しい後段を足す日に表の 1 行を忘れない)', () => {
  const files = (...dirs: string[]): string[] => dirs.map((dir) => `lib/targets/${dir}/target.ts`);
  const table = [
    { target: 'a', home: /^lib\/targets\/a\//, spellings: [] },
    { target: 'b', home: /^lib\/targets\/b\//, spellings: [] },
  ];

  it('実物: lib/targets/ の各ディレクトリに表の行があり、表の各行に置き場がある', () => {
    const sources = readTsTree(LIB_DIR, 'lib/');
    expect([...sources.keys()].filter((file) => file.startsWith('lib/targets/')).length).toBeGreaterThan(0);
    expect(targetSpellingProblems(sources.keys())).toEqual([]);
  });

  it('置き場があるのに表に行が無ければ赤(その後段の綴りを外に書いても見張られないため)', () => {
    expect(targetSpellingProblems(files('a', 'b', 'c'), table)).toEqual(['後段の置き場 lib/targets/c/ に、綴りの表(TARGET_SPELLINGS)の行がありません']);
  });

  it('表に行があるのに置き場が無ければ赤(腐った行を残さない)', () => {
    expect(targetSpellingProblems(files('a'), table)).toEqual(['綴りの表(TARGET_SPELLINGS)の行 b に対応する後段の置き場 lib/targets/b/ がありません']);
  });

  it('表の行の置き場の正規表現が自分の置き場に当たらなければ赤(行があっても境界が働かない)', () => {
    const wrong = [{ target: 'a', home: /^lib\/targets\/other\//, spellings: [] }];
    expect(targetSpellingProblems(files('a'), wrong)).toEqual(['綴りの表(TARGET_SPELLINGS)の行 a の置き場(home)が lib/targets/a/ に当たりません']);
  });

  it('後段の置き場の外のファイルは見ない。そろっていれば空', () => {
    expect(targetSpellingProblems([...files('a', 'b'), 'lib/sql/x.ts', 'cli/select-targets.ts'], table)).toEqual([]);
  });
});

describe('わざと壊す確認: 綴りごと', () => {
  it('Supabase Auth の名前: 認証関数・認証テーブル・認証クライアントの口', () => {
    expect(namesOf({ 'lib/a.ts': "export const a = '(select auth.uid())';" })).toEqual([AUTH_NAME]);
    expect(namesOf({ 'lib/a.ts': 'export const a = `select auth.jwt() ->> ${key}`;' })).toEqual([AUTH_NAME]);
    expect(namesOf({ 'lib/a.ts': "export const a = 'references auth.users (id)';" })).toEqual([AUTH_NAME]);
    expect(namesOf({ 'lib/a.ts': "export const a = 'await client.auth.admin.createUser({})';" })).toEqual([AUTH_NAME]);
    expect(namesOf({ 'lib/a.ts': "export const a = 'await client.auth.signInWithPassword({})';" })).toEqual([AUTH_NAME]);
    expect(namesOf({ 'cli/a.ts': "export const a = 'select auth.role()';" })).toEqual([AUTH_NAME]);
  });

  it('Supabase Auth の名前の列挙: 新しめの口(getClaims・reauthenticate・resend・linkIdentity ほか)・OAuth / SAML / SSO / MFA の表・flow_state', () => {
    for (const name of ['getClaims', 'reauthenticate', 'resend', 'linkIdentity', 'unlinkIdentity', 'getUserIdentities', 'oauth', 'oauth_clients', 'flow_state', 'mfa', 'mfa_factors', 'mfaChallenge', 'saml_providers', 'sso_domains']) {
      expect(namesOf({ 'lib/a.ts': `export const a = 'client.auth.${name}()';` }), name).toEqual([AUTH_NAME]);
    }
  });

  it('見ていないもの(限界): テンプレート文字列の補間で名前を組み立てる形・列挙に無い名前は見ない(検査の冒頭に書いてある)', () => {
    expect(namesOf({ 'lib/a.ts': 'export const a = `auth.${name}`;' })).toEqual([]);
    expect(namesOf({ 'lib/a.ts': "export const a = 'auth.' + name;" })).toEqual([]);
    expect(namesOf({ 'lib/a.ts': "export const a = 'auth.someFutureName()';" })).toEqual([]);
  });

  it('`auth.` の下の製品・仕様の語(ファイル名・仕様の要素 id)は誤検出にしない', () => {
    const source = [
      "export const file = 'auth.md';",
      "export const path = 'docs/specs/backend/auth.md';",
      "export const ts = 'auth.ts';",
      "export const el = 'auth.axis';",
      "export const el2 = 'auth.condition';",
      "export const el3 = 'auth.implementation';",
      "export const prose = '値は auth.md の axes を見る';",
    ].join('\n');
    expect(namesOf({ 'lib/a.ts': source })).toEqual([]);
  });

  it('service_role は大文字小文字を問わない(環境変数名の形も)', () => {
    expect(namesOf({ 'lib/a.ts': "export const a = 'SUPABASE_SERVICE_ROLE_KEY';" })).toEqual(['内部実行の DB ロール名']);
    expect(namesOf({ 'lib/a.ts': "export const a = 'Service_Role';" })).toEqual(['内部実行の DB ロール名']);
  });

  it('セッション属性が載る JWT の枝', () => {
    expect(namesOf({ 'lib/a.ts': "export const a = 'app_metadata';" })).toEqual(['セッション属性が載る JWT の枝']);
  });

  it('DB ロール名: 内部実行 / 一般利用者(SQL の列挙・文中・単独のどの形でも)', () => {
    expect(namesOf({ 'lib/a.ts': "export const a = 'grant execute on function f() to service_role;';" })).toEqual(['内部実行の DB ロール名']);
    expect(namesOf({ 'lib/a.ts': "export const a = 'anon';" })).toEqual(['一般利用者の DB ロール名']);
    expect(namesOf({ 'lib/a.ts': "export const a = 'revoke all on t from anon, authenticated;';" })).toEqual(['一般利用者の DB ロール名']);
    expect(namesOf({ 'lib/a.ts': 'export const a = `to authenticated`;' })).toEqual(['一般利用者の DB ロール名']);
  });

  it('外に出すスキーマ名は SQL の文脈だけ(修飾名の前半・関数呼び出し・schema の宣言)', () => {
    expect(namesOf({ 'lib/a.ts': 'export const a = `select * from api.${name}(`;' })).toEqual(['外に出すスキーマ名(SQL の文脈)']);
    expect(namesOf({ 'lib/a.ts': "export const a = 'select api.actor_id()';" })).toEqual(['外に出すスキーマ名(SQL の文脈)']);
    expect(namesOf({ 'lib/a.ts': "export const a = 'alter function f set schema api';" })).toEqual(['外に出すスキーマ名(SQL の文脈)']);
    expect(namesOf({ 'lib/a.ts': "export const a = \"db: { schema: 'api' }\";" })).toEqual(['外に出すスキーマ名(SQL の文脈)']);
  });

  it('テンプレート文字列は断片ごとに見る(式の前後どちらにあっても)', () => {
    expect(namesOf({ 'lib/a.ts': 'export const a = `${x} to service_role`;' })).toEqual(['内部実行の DB ロール名']);
    expect(namesOf({ 'lib/a.ts': 'export const a = `to ${x} and app_metadata`;' })).toEqual(['セッション属性が載る JWT の枝']);
  });
});

describe('わざと壊す確認: 誤検出にしない形', () => {
  it('コメント・識別子・型の名前・正規表現は文字列ではないので見ない', () => {
    const source = [
      '// service_role と auth.uid() と anon の説明',
      '/** app_metadata が載る枝。 */',
      'const authenticated = 1;',
      'type Anon = { anon: string };',
      'export const pattern = /service_role/;',
      'export const used = authenticated;',
    ].join('\n');
    expect(namesOf({ 'lib/a.ts': source })).toEqual([]);
  });

  it('別の意味で同じ語が出る形は見ない(種別の語・仕様の種類名・読み取りの種類名・ファイル名・生成物のキー名)', () => {
    const source = [
      "export const kind = 'authenticated_default';",
      "export const spec = 'api';",
      "export const reading = 'api.view';",
      "export const file = 'backend/surface.md';",
      "export const key = '    authenticated: GLOBAL_ROLES.authenticated,';",
      "export const prose = 'authenticated_default のロール';",
    ].join('\n');
    expect(namesOf({ 'lib/a.ts': source })).toEqual([]);
  });

  it('置き場の中のファイルは数えない(唯一の境界)。外の同名のファイルは数える', () => {
    expect(findPlatformSpellings(tree({ 'lib/targets/supabase/x.ts': "export const a = 'service_role';" }))).toEqual([]);
    expect(findPlatformSpellings(tree({ 'lib/targets/other/x.ts': "export const a = 'service_role';" })).map((hit) => hit.file)).toEqual(['lib/targets/other/x.ts']);
  });

  it('行と文面を返す(直す場所が読める)', () => {
    const found = findPlatformSpellings(tree({ 'lib/a.ts': "\n\nexport const a = 'to service_role;';" }));
    expect(found).toEqual([{ file: 'lib/a.ts', line: 3, spelling: '内部実行の DB ロール名', text: 'to service_role;' }]);
  });

  it('拡張子の違う木(`.mts`)も同じ', () => {
    expect(namesOf({ 'lib/a.mts': "export const a = 'service_role';" })).toEqual(['内部実行の DB ロール名']);
  });
});

describe('後段ごとの綴りの表(ホスト vercel)', () => {
  const hostNames = (files: Readonly<Record<string, string>>): readonly string[] => findTargetSpellings(tree(files)).map((hit) => hit.spelling);
  const CONFIG_FILE = 'ホストの Cron の登録ファイルの名前(パスとして使う形)';

  it('Cron の登録ファイルの名前を、パスとして使う形(単独・パスの末尾・テンプレートの断片)で書くと赤', () => {
    expect(hostNames({ 'lib/a.ts': "export const f = 'vercel.json';" })).toEqual([CONFIG_FILE]);
    expect(hostNames({ 'lib/a.ts': "export const f = 'app/vercel.json';" })).toEqual([CONFIG_FILE]);
    expect(hostNames({ 'lib/a.ts': 'export const f = `${app}/vercel.json`;' })).toEqual([CONFIG_FILE]);
    expect(hostNames({ 'cli/a.ts': "export const f = 'vercel.json';" })).toEqual([CONFIG_FILE]);
  });

  it('散文の中の綴り(文の途中)は見ない(ハンドブックの章の文面は、直すと生成物が変わるので仕様の中立化で扱う)', () => {
    expect(hostNames({ 'lib/a.ts': "export const prose = 'cron の登録(vercel.json と migration)と突き合わせる';" })).toEqual([]);
    expect(hostNames({ 'lib/a.ts': "export const other = 'myvercel.json';" })).toEqual([]);
  });

  it('コメント・識別子は見ない。ホストの置き場の中は数えない', () => {
    expect(hostNames({ 'lib/a.ts': "// app/vercel.json を読む\nexport const vercelJson = 1;" })).toEqual([]);
    expect(hostNames({ 'lib/targets/vercel/job/x.ts': "export const f = 'vercel.json';" })).toEqual([]);
  });

  it('後段どうしでも同じ: プラットフォームの置き場にホストの綴りがあれば赤・ホストの置き場にプラットフォームの綴りがあれば赤', () => {
    expect(hostNames({ 'lib/targets/supabase/x.ts': "export const f = 'vercel.json';" })).toEqual([CONFIG_FILE]);
    expect(hostNames({ 'lib/targets/vercel/x.ts': "export const r = 'service_role';" })).toEqual(['内部実行の DB ロール名']);
  });
});
