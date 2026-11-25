/**
 * 有料の口の Route Handler が共通の入口 `runPaidEntry` を構文木の形で使っているかの走査(`paid-entry-scan.ts`)のテスト。
 *
 * 形ごとに「通る形(正例)」と「止める形(負例)」を表で固定する。名前でなく束縛で見る: 別名の import は通り、同名のローカル関数・隠した名前・
 * 別モジュールの同名・名前空間の import は通らない。有料の連携に届く束縛は `handler` の外で使えない(引数・上位・動的 import・再輸出・副作用 import も)。
 */

import { describe, expect, it } from 'vitest';
import { paidEntryShape } from '../../../lib/external/paid-entry-scan.js';
import type { PaidEntryShape } from '../../../lib/external/paid-entry-scan.js';

/** 生成した定数表のモジュール。 */
const TABLE_MODULE = '@/domain/generated/paid-entries';

/** 生成した束のモジュール。 */
const BINDINGS_MODULE = '@/domain/generated/runtime-bindings';

/** 認証の組み立ての根のモジュール。 */
const AUTH_MODULE = '@/composition/auth';

/** この口の URL。 */
const URL_PATH = '/api/ai/x';

/** 指定子の分類: 有料の連携に届くのは composition/ai、枠の RPC を呼ぶのは composition/ai-quota。 */
const CLASS_OF = (specifier: string): { paid: boolean; meter: boolean } => ({
  paid: specifier === '@/composition/ai' || specifier === '@/composition/both',
  meter: specifier === '@/composition/ai-quota' || specifier === '@/composition/both',
});

/** import の並び(差し替えられる)。 */
const IMPORTS = [
  "import { runPaidEntry } from '@kaninabe/runtime/http/paid-entry';",
  "import { refuseCrossOrigin } from '@kaninabe/runtime/http/request-origin';",
  "import { authorizeRole, securityLogger } from '@/composition/auth';",
  "import { createAnswer } from '@/composition/ai';",
  "import { consumeQuota } from '@/composition/ai-quota';",
  "import { parseBody } from '@/domain/ai/request-limits';",
  "import { BROWSER_DEFENSE } from '@/domain/generated/browser-defense';",
  `import { PAID_ENTRIES } from '${TABLE_MODULE}';`,
  `import { runtimeBindings } from '${BINDINGS_MODULE}';`,
];

/** 健全なオプションの各項。 */
const OPTIONS = {
  operation: "operation: 'answer',",
  maxBodyBytes: `maxBodyBytes: PAID_ENTRIES['${URL_PATH}'].maxBodyBytes,`,
  authorize: `authorize: authorizeRole(PAID_ENTRIES['${URL_PATH}'].role),`,
  bindings: 'bindings: runtimeBindings,',
  role: `role: PAID_ENTRIES['${URL_PATH}'].role,`,
  logger: 'logger: securityLogger(),',
  parse: 'parse: parseBody,',
  consume: 'consume: (actorId) => consumeQuota()(actorId),',
  handler: 'handler: async ({ value }) => Response.json(await createAnswer()(value)),',
};

/** 口のソースを組む(オプションの各項・import・本体・前後の文を差し替えられる)。 */
function source(over: Partial<typeof OPTIONS> & { imports?: readonly string[]; body?: string; before?: string; after?: string; prefix?: readonly string[] } = {}): string {
  const options = { ...OPTIONS, ...over };
  const entries = [options.operation, options.maxBodyBytes, options.authorize, options.bindings, options.role, options.logger, options.parse, options.consume, options.handler].filter((line) => line !== '');
  const call = over.body ?? `return runPaidEntry(request, {\n    ${entries.join('\n    ')}\n  });`;
  return [
    ...(over.imports ?? IMPORTS),
    '',
    over.before ?? '',
    'export async function POST(request: Request): Promise<Response> {',
    ...(over.prefix ?? ['  const refused = refuseCrossOrigin(request, BROWSER_DEFENSE);', '  if (refused !== null) return refused;']),
    `  ${call}`,
    '}',
    over.after ?? '',
  ].join('\n');
}

/** 判定する。 */
function shape(text: string, method = 'POST', mfaResolverModule: string | null = null): PaidEntryShape {
  return paidEntryShape('route.ts', text, method, { tableModule: TABLE_MODULE, bindingsModule: BINDINGS_MODULE, mfaResolverModule, loggerModule: AUTH_MODULE, endpoint: URL_PATH, classOf: CLASS_OF });
}

/** import の 1 行を差し替える(元の行の一部で探す)。 */
function swapImport(part: string, replacement: string): readonly string[] {
  return IMPORTS.map((line) => (line.includes(part) ? replacement : line));
}

describe('paidEntryShape 正例', () => {
  it('出どころの確認のあと、最後の文で runPaidEntry を返し、上限・役を生成した表から読み、枠の消費は meter を呼ぶ束縛、有料の処理は handler の中だけ', () => {
    expect(shape(source())).toBe('wrapped');
  });

  it('メソッド記法の handler・await 付き・出どころの確認の ?? の右側でもよい', () => {
    const method = source({ handler: 'async handler({ value }) { return Response.json(await createAnswer()(value)); },' });
    expect(shape(method)).toBe('wrapped');

    const coalesced = source({
      prefix: [],
      body: `return refuseCrossOrigin(request, BROWSER_DEFENSE) ?? (await runPaidEntry(request, { ${Object.values(OPTIONS).join(' ')} }));`,
    });
    expect(shape(coalesced)).toBe('wrapped');
  });

  it('矢印関数の本体が式でもよい(const POST = (request) => runPaidEntry(…))', () => {
    const text = [
      ...IMPORTS,
      `export const POST = (request: Request) => runPaidEntry(request, { ${Object.values(OPTIONS).join(' ')} });`,
    ].join('\n');
    expect(shape(text)).toBe('wrapped');
  });

  it('別名の import(runPaidEntry as run・PAID_ENTRIES as TABLE)でもよい', () => {
    const imports = swapImport('paid-entry', "import { runPaidEntry as run } from '@kaninabe/runtime/http/paid-entry';").map((line) =>
      line.replace('{ PAID_ENTRIES }', '{ PAID_ENTRIES as TABLE }'),
    );
    const text = source({
      imports,
      body: `return run(request, { ${Object.values(OPTIONS).join(' ').replaceAll('PAID_ENTRIES', 'TABLE')} });`,
    });
    expect(shape(text)).toBe('wrapped');
  });

  it('有料の連携に届く名前でも、handler の外で同名の引数に隠されていれば束縛を使ったことにならない', () => {
    expect(shape(source({ after: 'function other(createAnswer: () => void) { return createAnswer(); }' }))).toBe('wrapped');
  });

  it('入口の名前を入れ子ブロックの var で隠した(関数スコープ)なら本物の runPaidEntry を呼んだことにならない', () => {
    const body = 'if (true) { var runPaidEntry = (_r: Request, _o: unknown) => Response.json({}); }\n  return runPaidEntry(request, {});';
    expect(shape(source({ body }))).toBe('not-wrapped');
  });

  it('型だけの import は束縛ではない(有料の連携に届くモジュールの型を handler の外で使ってよい)', () => {
    const imports = [...IMPORTS, "import type { Answer } from '@/composition/ai';"];
    expect(shape(source({ imports, after: 'export type Reply = Answer;' }))).toBe('wrapped');
  });

  it('handler の中の動的 import は有料の処理の一部として認める', () => {
    const text = source({ handler: "handler: async () => { const mod = await import('@/composition/ai'); return Response.json(mod); }," });
    expect(shape(text)).toBe('wrapped');
  });

  it('名前を引用符で書いても、重複が無ければ同じ鍵として読む(境界: 字面でなく名前で数える)', () => {
    const quoted = source({ bindings: "'bindings': runtimeBindings,", maxBodyBytes: `"maxBodyBytes": PAID_ENTRIES['${URL_PATH}'].maxBodyBytes,` });
    expect(shape(quoted)).toBe('wrapped');
  });

  it.each([
    ['M()(id)(既定)', 'consume: (actorId) => consumeQuota()(actorId),'],
    ['M(id)', 'consume: (actorId) => consumeQuota(actorId),'],
    ['async と await', 'consume: async (actorId: string) => await consumeQuota()(actorId),'],
    ['M そのもの', 'consume: consumeQuota,'],
    ['M()', 'consume: consumeQuota(),'],
    ['括弧つき', 'consume: ((actorId) => (consumeQuota()(actorId))),'],
  ])('枠の消費の許可表の形: %s', (_title, consume) => {
    expect(shape(source({ consume }))).toBe('wrapped');
  });

  it('認可は authorizeRole の別名の import でもよい(束縛で見る)', () => {
    const aliased = swapImport("'@/composition/auth'", "import { authorizeRole as gate, securityLogger } from '@/composition/auth';");
    expect(shape(source({ imports: aliased, authorize: `authorize: gate(PAID_ENTRIES['${URL_PATH}'].role),` }))).toBe('wrapped');
  });

  it('ログの口は別名の import・await なしの呼び出しの括弧つきでもよい', () => {
    const aliased = swapImport("'@/composition/auth'", "import { authorizeRole, securityLogger as forwardLog } from '@/composition/auth';");
    expect(shape(source({ imports: aliased, logger: 'logger: (forwardLog()),' }))).toBe('wrapped');
  });

  it('GET など別のメソッドを見る(メソッドごとに判定する)', () => {
    const text = `${source()}\nexport async function GET(request: Request): Promise<Response> {\n  return new Response('x');\n}`;
    expect(shape(text, 'POST')).toBe('wrapped');
    expect(shape(text, 'GET')).toBe('not-wrapped');
  });
});

describe('paidEntryShape 負例', () => {
  /** [題, ソース, 期待する形]。 */
  const BAD: readonly (readonly [string, string, PaidEntryShape])[] = [
    ['メソッドが無い', "export const dynamic = 'force-dynamic';", 'body-unreadable'],
    ['要求を受けない', source().replace('(request: Request)', '()'), 'body-unreadable'],
    ['要求が分割代入の引数', source().replace('request: Request', '{ headers }: Request'), 'body-unreadable'],
    ['共通の入口を呼ばない(自前の処理)', source({ body: 'return Response.json(await createAnswer()(await request.json()));' }), 'not-wrapped'],
    [
      '入口が別のモジュールの同名の関数(局所の偽物)',
      source({ imports: swapImport('paid-entry', "import { runPaidEntry } from './fake-paid-entry';") }),
      'not-wrapped',
    ],
    [
      '入口が同じファイルの同名の関数(import していない)',
      source({ imports: IMPORTS.filter((line) => !line.includes('paid-entry')), before: 'async function runPaidEntry(r: Request, o: unknown) { return Response.json([r, o]); }' }),
      'not-wrapped',
    ],
    [
      '入口の名前を関数の中で隠した',
      source({ body: `const runPaidEntry = (r: Request, o: { handler: () => Promise<Response> }) => o.handler();\n  return runPaidEntry(request, { ${Object.values(OPTIONS).join(' ')} });` }),
      'not-wrapped',
    ],
    [
      '入口を名前空間の import で呼ぶ(束縛を名前で追わない)',
      source({
        imports: swapImport('paid-entry', "import * as paid from '@kaninabe/runtime/http/paid-entry';"),
        body: `return paid.runPaidEntry(request, { ${Object.values(OPTIONS).join(' ')} });`,
      }),
      'not-wrapped',
    ],
    [
      '入口を呼んだ結果を受けて、最後の文が別のもの',
      source({ body: `const response = await runPaidEntry(request, { ${Object.values(OPTIONS).join(' ')} });\n  console.info('done');\n  return response;` }),
      'not-wrapped',
    ],
    ['入口の第 1 引数がメソッドの受けた要求でない', source({ body: `return runPaidEntry(new Request('http://x'), { ${Object.values(OPTIONS).join(' ')} });` }), 'request-not-passed'],
    ['入口の第 1 引数が別の識別子(要求の別名)', source({ body: `const other = request;\n  return runPaidEntry(other, { ${Object.values(OPTIONS).join(' ')} });` }), 'request-not-passed'],
    ['入口の第 1 引数が無い', source({ body: 'return runPaidEntry();' }), 'request-not-passed'],
    ['第 2 引数が変数', source({ body: 'const options = {};\n  return runPaidEntry(request, options);' }), 'options-unreadable'],
    ['第 2 引数が無い', source({ body: 'return runPaidEntry(request);' }), 'options-unreadable'],
    ['第 2 引数がスプレッドを含む', source({ body: `return runPaidEntry(request, { ...base, ${Object.values(OPTIONS).join(' ')} });` }), 'options-unreadable'],
    ['第 2 引数が算出キーを含む', source({ body: `return runPaidEntry(request, { [key]: 1, ${Object.values(OPTIONS).join(' ')} });` }), 'options-unreadable'],
    // 点検 4 回目 B4-2 の probe1 / probe2: 引用符つきの同名を後ろに足すと、実行時は後勝ちで手書きの値が渡る(型の重複の指摘は @ts-expect-error で黙る)。
    ['束を引用符つきの同名で後から上書きする', source({ handler: `${OPTIONS.handler}\n    // @ts-expect-error -- 試験用の差し替え\n    'bindings': { roleTables: runtimeBindings.roleTables },` }), 'options-unreadable'],
    ['束を二重引用符の同名で上書きする', source({ handler: `${OPTIONS.handler}\n    "bindings": { roleTables: runtimeBindings.roleTables },` }), 'options-unreadable'],
    ['引用符つきの束が先で、識別子の束が後(順によらない)', source({ bindings: "'bindings': { roleTables: tables },\n    bindings: runtimeBindings," }), 'options-unreadable'],
    ['識別子どうしの重複(後の値が勝つ)', source({ handler: `${OPTIONS.handler}\n    maxBodyBytes: 1e9,` }), 'options-unreadable'],
    ['省略記法の同名で上書きする', source({ handler: `${OPTIONS.handler}\n    bindings,` }), 'options-unreadable'],
    ['メソッド記法の同名で上書きする', source({ handler: `${OPTIONS.handler}\n    consume() { return Promise.resolve('used'); },` }), 'options-unreadable'],
    ['数の鍵の書き方違い(1 と 1.0)も同じ名前', source({ handler: `${OPTIONS.handler}\n    1: 'a',\n    1.0: 'b',` }), 'options-unreadable'],
    ['上限が生の数', source({ maxBodyBytes: 'maxBodyBytes: 262144,' }), 'limit-not-generated'],
    ['上限が無い', source({ maxBodyBytes: '' }), 'limit-not-generated'],
    ['上限が別の口の値', source({ maxBodyBytes: "maxBodyBytes: PAID_ENTRIES['/api/other'].maxBodyBytes," }), 'limit-not-generated'],
    ['上限の欄が違う(role を上限に渡す)', source({ maxBodyBytes: `maxBodyBytes: PAID_ENTRIES['${URL_PATH}'].role,` }), 'limit-not-generated'],
    [
      '上限の表が別のモジュールの同名',
      source({ imports: swapImport('paid-entries', "import { PAID_ENTRIES } from '@/lib/my-table';") }),
      'limit-not-generated',
    ],
    ['役が生の文字列', source({ authorize: "authorize: authorizeRole('member')," }), 'role-not-generated'],
    ['役を渡さない呼び出し', source({ authorize: 'authorize: authorizeRole(),' }), 'role-not-generated'],
    ['認可が関数の参照', source({ authorize: 'authorize: authorizeEverybody,' }), 'role-not-generated'],
    ['認可が無い', source({ authorize: '' }), 'role-not-generated'],
    ['多要素認証の段の束が無い(段を外せる)', source({ bindings: '' }), 'bindings-not-generated'],
    ['束が手書きの値(mfa を持たないオブジェクト)', source({ bindings: 'bindings: { roleTables: tables },' }), 'bindings-not-generated'],
    ['束が生成物でない同名(別モジュールの runtimeBindings)', source({ imports: swapImport('runtime-bindings', "import { runtimeBindings } from '@/lib/mine';") }), 'bindings-not-generated'],
    ['束が生成物の別の名前の import', source({ imports: swapImport('runtime-bindings', `import { other } from '${BINDINGS_MODULE}';`), bindings: 'bindings: other,' }), 'bindings-not-generated'],
    ['束を展開して mfa を落とす', source({ bindings: 'bindings: { ...runtimeBindings, mfa: undefined },' }), 'bindings-not-generated'],
    ['口の役が生の文字列', source({ role: "role: 'member'," }), 'role-option-not-generated'],
    ['口の役が無い', source({ role: '' }), 'role-option-not-generated'],
    ['口の役が別の口の値', source({ role: "role: PAID_ENTRIES['/api/other'].role," }), 'role-option-not-generated'],
    // 点検 4 回目 B4-3: 拒否の行の出力口は認証の組み立ての根の securityLogger()(ホストの外への転送に載る口)。
    ['ログの口が無い(標準出力だけ)', source({ logger: '' }), 'logger-not-wired'],
    ['ログの口が関数の参照(呼んでいない)', source({ logger: 'logger: securityLogger,' }), 'logger-not-wired'],
    ['ログの口が手書きの値', source({ logger: 'logger: { write: () => undefined },' }), 'logger-not-wired'],
    ['ログの口が標準出力の口', source({ imports: [...IMPORTS, "import { stdoutLogger } from '@kaninabe/runtime/security-log';"], logger: 'logger: stdoutLogger,' }), 'logger-not-wired'],
    ['ログの口に引数を渡す(差し替えの口を使う)', source({ logger: 'logger: securityLogger(other),' }), 'logger-not-wired'],
    [
      'ログの口が認証の組み立ての根でない同名',
      source({ imports: [...swapImport("'@/composition/auth'", "import { authorizeRole } from '@/composition/auth';"), "import { securityLogger } from '@/lib/fake-log';"] }),
      'logger-not-wired',
    ],
    ['ログの口を引用符つきの同名で上書きする', source({ handler: `${OPTIONS.handler}\n    'logger': { write: () => undefined },` }), 'options-unreadable'],
    ['枠の消費が meter を呼ばない', source({ consume: "consume: () => Promise.resolve('used')," }), 'meter-not-called'],
    ['枠の消費が meter でないモジュールの束縛', source({ consume: 'consume: (actorId) => authorizeRole(actorId),' }), 'meter-not-called'],
    ['枠の消費が無い', source({ consume: '' }), 'meter-not-called'],
    // 点検 5 回目 B5-2(探り台本 B/probe1・probe4〜7): 役を捨てる手書きの認可と、meter を参照するだけの消費は、tsc・ESLint を通っても赤。
    ['認可が役を捨てる即時呼び出し(probe1)', source({ authorize: `authorize: ((_role: string) => async () => ({ kind: 'ok' as const, actorId: 'anyone' }))(PAID_ENTRIES['${URL_PATH}'].role),` }), 'role-not-generated'],
    ['認可が役を受けて決め打ちを返す即時呼び出し(probe6・probe7)', source({ authorize: `authorize: ((role: string) => () => Promise.resolve({ kind: 'ok' as const, actorId: role }))(PAID_ENTRIES['${URL_PATH}'].role),` }), 'role-not-generated'],
    ['認可が役の評価と自前の関数の && (probe1)', source({ authorize: `authorize: String(PAID_ENTRIES['${URL_PATH}'].role) && (async () => ({ kind: 'ok' as const, actorId: 'x' })),` }), 'role-not-generated'],
    ['認可が根でないモジュールの同名 authorizeRole', source({ imports: [...swapImport("'@/composition/auth'", "import { securityLogger } from '@/composition/auth';"), "import { authorizeRole } from '@/lib/fake-auth';"] }), 'role-not-generated'],
    ['認可の authorizeRole を関数の中で隠す', source({ body: `const authorizeRole = (_r: string) => async () => ({ kind: 'ok' as const, actorId: 'x' });\n  return runPaidEntry(request, { ${Object.values(OPTIONS).join(' ')} });` }), 'role-not-generated'],
    ['認可が根の別の関数(役を渡していても)', source({ imports: swapImport("'@/composition/auth'", "import { authorizeRole, securityLogger, authorizeAnyone } from '@/composition/auth';"), authorize: `authorize: authorizeAnyone(PAID_ENTRIES['${URL_PATH}'].role),` }), 'role-not-generated'],
    ['認可が authorizeRole の結果をさらに包む', source({ authorize: `authorize: wrap(authorizeRole(PAID_ENTRIES['${URL_PATH}'].role)),` }), 'role-not-generated'],
    ['認可が authorizeRole の参照(呼ばない)', source({ authorize: 'authorize: authorizeRole,' }), 'role-not-generated'],
    ['枠の消費が meter を参照するだけ(void とカンマ。probe1)', source({ consume: "consume: async () => (void consumeQuota, 'used' as const)," }), 'meter-not-called'],
    ['枠の消費が条件つきで meter を呼ぶ(probe6・probe7)', source({ consume: "consume: (actorId) => (actorId === '' ? consumeQuota()(actorId) : Promise.resolve('used' as const))," }), 'meter-not-called'],
    ['枠の消費が meter を呼ぶが別の実行者を渡す', source({ consume: "consume: (_actorId) => consumeQuota()('someone')," }), 'meter-not-called'],
    ['枠の消費が meter を呼ぶが引数を渡さない', source({ consume: 'consume: () => consumeQuota()(),' }), 'meter-not-called'],
    ['枠の消費が meter の結果を捨てて決め打ちを返す', source({ consume: "consume: async (actorId) => { await consumeQuota()(actorId); return 'used' as const; }," }), 'meter-not-called'],
    ['枠の消費が meter の結果を || で上書きする', source({ consume: "consume: (actorId) => consumeQuota()(actorId) || Promise.resolve('used' as const)," }), 'meter-not-called'],
    ['枠の消費が meter の結果に .then を付ける', source({ consume: "consume: (actorId) => consumeQuota()(actorId).then(() => 'used' as const)," }), 'meter-not-called'],
    ['枠の消費がメソッド記法', source({ consume: 'consume(actorId) { return consumeQuota()(actorId); },' }), 'meter-not-called'],
    ['枠の消費の meter の名前を引数で隠す', source({ consume: "consume: (consumeQuota) => consumeQuota()(consumeQuota)," }), 'meter-not-called'],
    ['枠の消費が meter に引数つきで作った関数', source({ consume: "consume: (actorId) => consumeQuota('free')(actorId)," }), 'meter-not-called'],
    ['handler が関数の参照', source({ handler: 'handler: answer,' }), 'handler-not-inline'],
    ['handler が無い', source({ handler: '' }), 'handler-not-inline'],
    ['有料の連携に届く束縛を最上位で使う', source({ after: 'const warm = createAnswer();' }), 'paid-outside-handler'],
    // 認可は authorizeRole(PAID_ENTRIES[口].role) の 1 式だけ(許可表)。引数を足した形は有料の束縛を使う前に赤。
    ['有料の連携に届く束縛を認可の引数で使う', source({ authorize: `authorize: authorizeRole(PAID_ENTRIES['${URL_PATH}'].role, createAnswer()),` }), 'role-not-generated'],
    ['有料の連携に届く束縛を形の検査で使う', source({ parse: 'parse: (body) => { createAnswer(); return parseBody(body); },' }), 'paid-outside-handler'],
    // 枠の消費は meter を呼ぶ 1 式だけ(許可表)。ブロックの本体は有料の束縛の有無によらず赤。
    ['有料の連携に届く束縛を枠の消費の中で使う', source({ consume: 'consume: (actorId) => { createAnswer(); return consumeQuota()(actorId); },' }), 'meter-not-called'],
    ['有料の連携に届く束縛を入口を呼ぶ前に使う', source({ body: `const answer = createAnswer();\n  return runPaidEntry(request, { ${Object.values(OPTIONS).join(' ')} });` }), 'paid-outside-handler'],
    ['有料の連携に届く束縛を再輸出する', source({ after: "export { createAnswer } from '@/composition/ai';" }), 'paid-outside-handler'],
    ['有料の連携に届くモジュールを副作用 import する', source({ imports: [...IMPORTS, "import '@/composition/ai';"] }), 'paid-outside-handler'],
    ['有料の連携に届くモジュールを handler の外で動的に読む', source({ after: "const lazy = () => import('@/composition/ai');" }), 'paid-outside-handler'],
    [
      '枠の消費と有料の連携の両方に届くモジュールの束縛を handler の外(consume)で使う',
      source({ imports: [...IMPORTS, "import { both } from '@/composition/both';"], consume: 'consume: (actorId) => both(actorId),' }),
      'paid-outside-handler',
    ],
  ];

  it.each(BAD)('%s → %s', (_title, text, expected) => {
    expect(shape(text)).toBe(expected);
  });
});

describe('paidEntryShape 多要素認証を要求する製品(resolveMfa の配線)', () => {
  const IMPORTS_MFA = [...IMPORTS.filter((line) => !line.includes("'@/composition/auth'")), `import { authorizeRole, resolveSessionMfa, securityLogger } from '${AUTH_MODULE}';`];
  const withResolver = (extra: string, imports: readonly string[] = IMPORTS_MFA): string => source({ imports, role: `${OPTIONS.role}\n    ${extra}` });
  const mfaShape = (text: string): PaidEntryShape => shape(text, 'POST', AUTH_MODULE);

  it('resolveMfa に認証の組み立ての根の resolveSessionMfa を渡していれば通る(別名の import でもよい)', () => {
    expect(mfaShape(withResolver('resolveMfa: resolveSessionMfa,'))).toBe('wrapped');
    const aliased = IMPORTS_MFA.map((line) => line.replace('resolveSessionMfa', 'resolveSessionMfa as sessionMfa'));
    expect(mfaShape(withResolver('resolveMfa: sessionMfa,', aliased))).toBe('wrapped');
  });

  it('resolveMfa を引用符つきの同名で決め打ちに上書きする → options-unreadable(probe1 の形)', () => {
    for (const quoted of ["'resolveMfa'", '"resolveMfa"']) {
      expect(mfaShape(withResolver(`resolveMfa: resolveSessionMfa,\n    ${quoted}: async () => true,`)), quoted).toBe('options-unreadable');
    }
  });

  it.each([
    ['resolveMfa を渡さない', source({ imports: IMPORTS_MFA })],
    ['決め打ちの解決(常に済ませたことにする)', withResolver('resolveMfa: () => Promise.resolve(true),')],
    ['認証の組み立ての根でない同名', withResolver('resolveMfa: resolveSessionMfa,', [...IMPORTS_MFA.slice(0, 2), "import { resolveSessionMfa } from '@/lib/fake';", ...IMPORTS_MFA.slice(2)].filter((line) => !line.includes('authorizeRole, resolveSessionMfa')).concat("import { authorizeRole } from '@/composition/auth';"))],
    ['別の関数の参照', withResolver('resolveMfa: authorizeRole,')],
  ])('%s → mfa-resolver-not-wired', (_title, text) => {
    expect(mfaShape(text)).toBe('mfa-resolver-not-wired');
  });

  it('要求しない製品(mfaResolverModule が null)は resolveMfa を求めない', () => {
    expect(shape(source())).toBe('wrapped');
  });
});

describe('paidEntryShape 本体の文の並びの許可表(点検 6 回目 B6-1)', () => {
  const call = `runPaidEntry(request, { ${Object.values(OPTIONS).join(' ')} })`;

  it.each([
    ['入口だけ', [], `return ${call};`],
    ['関門 ?? 入口(1 文)', [], `return refuseCrossOrigin(request, BROWSER_DEFENSE) ?? (await ${call});`],
    ['const 関門 + return r ?? 入口(2 文)', ['  const refused = refuseCrossOrigin(request, BROWSER_DEFENSE);'], `return refused ?? ${call};`],
    ['const 関門 + if 返す + 入口(3 文)', ['  const refused = refuseCrossOrigin(request, BROWSER_DEFENSE);', '  if (refused !== null) { return refused; }'], `return await ${call};`],
  ])('通る: %s', (_title, prefix, body) => {
    expect(shape(source({ prefix, body }))).toBe('wrapped');
  });

  it.each([
    [
      '探り台本 probe1: ヘッダで分岐してテンプレートの動的 import で有料の処理を返す',
      undefined,
      `const preview = request.headers.get('x-preview-key');\n  if (preview !== null) {\n    const area = 'tutorial';\n    const wiring = (await import(\`@/composition/\${area}/ai\`)) as { run: () => Promise<unknown> };\n    return Response.json(await wiring.run());\n  }\n  return ${call};`,
    ],
    ['入口の前でログを書く', undefined, `console.log(request.url);\n  return ${call};`],
    ['入口の前で本文を読む', undefined, `await request.clone().text();\n  return ${call};`],
    ['?? の左が関門でない任意の式', [], `return (await bypass(request)) ?? ${call};`],
    ['関門の引数に副作用', [], `return refuseCrossOrigin(request, (sideEffect(), BROWSER_DEFENSE)) ?? ${call};`],
    ['関門の結果を捨てる(2 文)', ['  const refused = refuseCrossOrigin(request, BROWSER_DEFENSE);'], `return ${call};`],
    ['関門の結果の名前が別(2 文)', ['  const refused = refuseCrossOrigin(request, BROWSER_DEFENSE);'], `return other ?? ${call};`],
    ['if の後に別の文(4 文)', undefined, `void 0;\n  return ${call};`],
    ['if に else がある', ['  const refused = refuseCrossOrigin(request, BROWSER_DEFENSE);', '  if (refused !== null) return refused; else void 0;'], `return ${call};`],
    ['let で関門の結果を受ける', ['  let refused = refuseCrossOrigin(request, BROWSER_DEFENSE);', '  if (refused !== null) return refused;'], `return ${call};`],
    ['関門が別モジュールの同名', ['  const refused = refuseCrossOrigin2(request, BROWSER_DEFENSE);', '  if (refused !== null) return refused;'], `return ${call};`],
  ])('赤: %s → extra-statements', (_title, prefix, body) => {
    expect(shape(source({ ...(prefix === undefined ? {} : { prefix }), body }))).toBe('extra-statements');
  });

  it('矢印関数の式の本体も、?? の左は関門だけ', () => {
    const arrow = (expression: string): string => [...IMPORTS, `export const POST = (request: Request) => ${expression};`].join('\n');
    expect(shape(arrow(`refuseCrossOrigin(request, BROWSER_DEFENSE) ?? ${call}`))).toBe('wrapped');
    expect(shape(arrow(`bypass(request) ?? ${call}`))).toBe('extra-statements');
  });
});

describe('paidEntryShape 残りのオプションの値の許可表(点検 7 回目 B7-1)', () => {
  it.each([
    ['invariant を字句で足す', { handler: `${OPTIONS.handler} invariant: 'INV-1',` }],
    ['operation を置換なしのテンプレートで', { operation: 'operation: `answer`,' }],
    ['parse を別名の import で', { parse: 'parse: parseAlias,', imports: [...IMPORTS, "import { parseBody as parseAlias } from '@/domain/ai/request-limits';"] }],
  ])('通る: %s', (_title, over) => {
    expect(shape(source(over))).toBe('wrapped');
  });

  it.each([
    ['B7-1 の反例: operation に await した呼び出し', { operation: 'operation: await previewOperation(request),', imports: [...IMPORTS, "import { previewOperation } from '@/composition/preview-hook';"] }],
    ['operation に呼び出し(await なし)', { operation: "operation: pick('answer'),", imports: [...IMPORTS, "import { pick } from '@/composition/pick';"] }],
    ['operation が変数', { operation: 'operation: OPERATION,', before: "const OPERATION = 'answer';" }],
    ['operation に置換つきのテンプレート', { operation: 'operation: `${request.method}`,' }],
    ['operation が無い', { operation: '' }],
    ['invariant に呼び出し', { handler: `${OPTIONS.handler} invariant: await hook(request),`, imports: [...IMPORTS, "import { hook } from '@/composition/hook';"] }],
    ['parse を呼んで作る', { parse: 'parse: makeParser(request),', imports: [...IMPORTS, "import { makeParser } from '@/domain/ai/request-limits';"] }],
    ['parse がその場の関数(本文を読む前に評価はされないが許可表の外)', { parse: 'parse: (body) => parseBody(body),' }],
    ['parse がローカルの関数', { parse: 'parse: localParse,', before: 'const localParse = (body: unknown) => body;' }],
    ['parse が無い', { parse: '' }],
    ['許可表の外の鍵', { handler: `${OPTIONS.handler} preview: await hook(request),`, imports: [...IMPORTS, "import { hook } from '@/composition/hook';"] }],
    ['許可表の外の鍵(値は字句)', { handler: `${OPTIONS.handler} note: 'x',` }],
  ])('赤: %s → option-not-allowed', (_title, over) => {
    expect(shape(source(over))).toBe('option-not-allowed');
  });
});
