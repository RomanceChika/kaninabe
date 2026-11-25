/**
 * X8(有料の口の執行)のユニットテスト。
 *
 * 一時ディレクトリに実ファイルを置く(検証器そのものは I/O をせず、読むのは実行口。X6 と同じ扱い)。見るのは 3 点 ——
 *   (a) 有料の連携のアダプタに import の閉包で届く Route Handler が、その連携の `endpoints` に宣言されている
 *   (b) 宣言された口の全メソッドが共通の入口 `runPaidEntry` の形になっている(形ごとの表は `paid-entry-scan.test.ts` が固定。ここは配線を見る)
 *   (c) `meter` の RPC の本文(最後に定義した migration)が役の述語を持ち、原子的に消費する(形ごとの表は `meter-body.test.ts`)
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyPaidEntry } from '../../../../lib/external/verifiers/x8-paid-entry.js';
import type { PaidEntryInput } from '../../../../lib/external/verifiers/x8-paid-entry.js';
import type { CatalogInput } from '../../../../lib/kernel/input-state.js';
import type { DataTableSpecModel } from '../../../../lib/model/data/types.js';
import type { ExternalAuthzDecl } from '../../../../lib/model/external/types.js';
import type { RoleDef } from '../../../../lib/model/types.js';
import { dataTable, dataTableModel } from '../../../helpers/data-builder.js';
import { externalCatalog, integration } from '../../../helpers/external-builder.js';
import type { IntegrationOpts } from '../../../helpers/external-builder.js';
import { role, roleSpec, specModel } from '../../../helpers/model-builder.js';
import { TEST_LAYOUT } from '../../../helpers/platform.js';
import { TEST_ROOTS } from '../../../helpers/product-roots.js';

/** 口の URL。 */
const URL_PATH = '/api/ai/x';

/** 口(Route Handler)の置き場。 */
const ROUTE_FILE = 'app/src/app/api/ai/x/route.ts';

/** アダプタ(有料の連携)の置き場。 */
const ADAPTER = 'app/src/infrastructure/anthropic/chat.ts';

/** 健全な口(共通の入口で包み、上限・役を生成した表から読み、有料の処理は handler の中だけ)。 */
const GOOD_ROUTE = `
import { runPaidEntry } from '@kaninabe/runtime/http/paid-entry';
import { refuseCrossOrigin } from '@kaninabe/runtime/http/request-origin';
import { authorizeRole, securityLogger } from '@/composition/auth';
import { createAnswer } from '@/composition/ai';
import { consumeQuota } from '@/composition/ai-quota';
import { parseBody } from '@/domain/ai/request-limits';
import { BROWSER_DEFENSE } from '@/domain/generated/browser-defense';
import { PAID_ENTRIES } from '@/domain/generated/paid-entries';
import { runtimeBindings } from '@/domain/generated/runtime-bindings';

export async function POST(request: Request): Promise<Response> {
  const refused = refuseCrossOrigin(request, BROWSER_DEFENSE);
  if (refused !== null) return refused;
  return runPaidEntry(request, {
    operation: 'answer',
    maxBodyBytes: PAID_ENTRIES['${URL_PATH}'].maxBodyBytes,
    authorize: authorizeRole(PAID_ENTRIES['${URL_PATH}'].role),
    bindings: runtimeBindings,
    role: PAID_ENTRIES['${URL_PATH}'].role,
    logger: securityLogger(),
    parse: parseBody,
    consume: (actorId) => consumeQuota()(actorId),
    handler: async ({ value }) => Response.json(await createAnswer()(value)),
  });
}
`;

/** 自前の処理の口(共通の入口を使わない)。 */
const SELF_MADE_ROUTE = `
import { createAnswer } from '@/composition/ai';

export async function POST(request: Request): Promise<Response> {
  return Response.json(await createAnswer()(await request.json()));
}
`;

/** 健全な meter の本文(役の述語 → raise → 1 文の upsert)を含む migration。 */
const GOOD_MIGRATION = `
create or replace function api.consume_quota(p_member_id uuid, p_limit integer) returns setof public.ai_usage
language plpgsql security definer set search_path = public as $$
begin
    if not exists (select 1 from public.members a where a.id = p_member_id and a.state in ('active')) then
        raise exception using errcode = 'UC403', message = 'usecase_forbidden:ai.consume';
    end if;
    return query
    insert into public.ai_usage (member_id, used_count) values (p_member_id, 1)
    on conflict (member_id) do update set used_count = public.ai_usage.used_count + 1 where public.ai_usage.used_count < p_limit
    returning *;
end;
$$;
`;

/** 有効メンバーの役(実行者の行の条件つき)。 */
const MEMBER: RoleDef = { ...role('member'), claim: 'member.state', claimValues: ['active'], implies: ['anonymous'] };

/** 実行者の集約の表。 */
const TABLES: CatalogInput<DataTableSpecModel> = {
  state: 'loaded',
  value: dataTableModel([dataTable('members', { entity: 'member' })]),
  findings: [],
};

let root = '';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'x8-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** ファイルを置く。 */
function put(relative: string, body: string): void {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, body);
}

/** 健全な実装の木を置く(口・composition・infrastructure・migration)。 */
function setUp(): void {
  put('app/package.json', JSON.stringify({ name: 'app', dependencies: { '@kaninabe/runtime': '*', next: '*' } }));
  put(ROUTE_FILE, GOOD_ROUTE);
  put('app/src/composition/ai.ts', "import { chat } from '@/infrastructure/anthropic/chat';\nexport const createAnswer = () => chat;\n");
  put('app/src/composition/ai-quota.ts', "import { counter } from '@/infrastructure/quota';\nexport const consumeQuota = () => counter;\n");
  put(ADAPTER, 'export const chat = () => 1;\n');
  put('app/src/infrastructure/quota.ts', "export const counter = (c: { rpc(n: string): void }) => c.rpc('consume_quota');\n");
  put('supabase/migrations/20260101000000_quota.sql', GOOD_MIGRATION);
}

/** 健全な宣言(上書きできる)。 */
function declared(over: IntegrationOpts = {}): IntegrationOpts {
  const authz: ExternalAuthzDecl = { kind: 'role', role: 'member', location: { file: 'external.md' } };
  return { effect: 'read', adapter: ADAPTER, endpoints: [URL_PATH], spend: 'paid', meter: 'consume_quota', authz, ...over };
}

/** 検証する(指摘の文言の並び)。 */
function verify(opts: IntegrationOpts = declared(), over: Partial<PaidEntryInput> = {}): readonly string[] {
  return verifyPaidEntry({
    catalog: externalCatalog([integration('anthropic_chat', opts)]),
    domain: specModel([], roleSpec([role('anonymous'), MEMBER, role('system')])),
    dataTables: TABLES,
    repoRoot: root,
    roots: TEST_ROOTS,
    layout: TEST_LAYOUT,
    ...over,
  }).map((finding) => `${finding.verifier}|${finding.severity}|${finding.message}`);
}

describe('X8 正例', () => {
  it('口が共通の入口で包まれ、meter の本文が役の述語を DB の行で確かめて原子的に消費する実装は指摘なし', () => {
    setUp();

    expect(verify()).toEqual([]);
  });

  it('有料の連携に届かない口は(同じ木にあっても)何も言われない', () => {
    setUp();
    put('app/src/app/api/other/route.ts', "export async function GET(): Promise<Response> { return new Response('ok'); }\n");

    expect(verify()).toEqual([]);
  });

  it('有料の連携が無い・実装の木が無い・spend の無い連携は何も見ない', () => {
    expect(verify()).toEqual([]);
    setUp();
    expect(verify({ effect: 'read', adapter: ADAPTER, endpoints: [URL_PATH] })).toEqual([]);
    expect(verify(declared({ direction: 'inbound', endpoints: undefined }))).toEqual([]);
  });
});

describe('X8 (a) 宣言の無い口', () => {
  it('有料の連携のアダプタに届く Route Handler が endpoints に宣言されていなければ error', () => {
    setUp();
    put('app/src/app/api/ai/other/route.ts', SELF_MADE_ROUTE);

    const found = verify();

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('X8|error|Route Handler app/src/app/api/ai/other/route.ts は有料の連携 anthropic_chat のアダプタに届きますが、その連携の endpoints に宣言されていません');
  });

  it('1 本の URL に結べない口(動的なセグメントの下)でも、アダプタに届けば宣言されていない口として言う', () => {
    setUp();
    put('app/src/app/api/ai/[id]/route.ts', SELF_MADE_ROUTE);

    const found = verify();

    expect(found.some((line) => line.includes('app/src/app/api/ai/[id]/route.ts は有料の連携 anthropic_chat のアダプタに届きますが'))).toBe(true);
  });

  it('宣言された口のファイルが無ければ(口の不在は J2 が言う)何も言わない', () => {
    setUp();

    expect(verify(declared({ endpoints: [URL_PATH, '/api/ai/missing'] }))).toEqual([]);
  });
});

describe('X8 (d) Route Handler でない入口は有料の連携に届かない', () => {
  const REACHING = "import { createAnswer } from '@/composition/ai';\nexport const x = createAnswer;\n";

  // 負例の表: [題, 置き場]
  const BYPASS: readonly (readonly [string, string])[] = [
    ['Server Action', 'app/src/app/_actions/ask.ts'],
    ['ページ', 'app/src/app/tutorial/page.tsx'],
    ['レイアウト', 'app/src/app/tutorial/layout.tsx'],
    ['画面の部品', 'app/src/app/_components/panel.tsx'],
    ['リクエスト前段(proxy)', 'app/src/proxy.ts'],
    ['リクエスト前段(middleware)', 'app/src/middleware.ts'],
    ['B7-6 の反例: 起動と失敗の報告の口(instrumentation)', 'app/src/instrumentation.ts'],
    ['ブラウザの起動の口(instrumentation-client)', 'app/src/instrumentation-client.ts'],
    ['instrumentation の .tsx', 'app/src/instrumentation.tsx'],
    ['宣言されていない別の Cron の口でない入口の部品', 'app/src/app/api/ai/x/helper.ts'],
  ];

  it.each(BYPASS)('負例: %s が有料の連携の composition を import すれば error', (_title, file) => {
    setUp();
    put(file, REACHING);

    const found = verify();

    expect(found).toHaveLength(1);
    expect(found[0]).toContain(`X8|error|${file} は Route Handler ではありませんが、有料の連携 anthropic_chat のアダプタに届きます`);
  });

  it('正例: 届かないモジュール(鍵の有無だけを読む)を使うページ・テスト・コンポーネントのテストは何も言われない', () => {
    setUp();
    put('app/src/composition/availability.ts', 'export const available = () => true;\n');
    put('app/src/app/tutorial/page.tsx', "import { available } from '@/composition/availability';\nexport const p = available;\n");
    put('app/src/app/__tests__/ask.test.ts', REACHING);
    put('app/src/app/_actions/ask.test.ts', REACHING);
    put('app/src/app/_actions/readme.md', REACHING);
    put('app/src/other.ts', REACHING);
    // 枠が呼ぶ名前の許可表の外(根の直下の別名・根の直下でない同名)は入口でない(層の部品)。
    put('app/src/instrumentations.ts', REACHING);
    put('app/src/composition/instrumentation.ts', REACHING);

    expect(verify()).toEqual([]);
  });

  it('配置が生成物のモジュールを引けなくても(空の配置)、入口の走査ができなければ何も言わない', () => {
    setUp();
    put('app/src/app/tutorial/page.tsx', REACHING);

    expect(verify(declared(), { layout: {} })).toEqual([]);
  });
});

describe('X8 (b) 共通の入口', () => {
  it('宣言された口が共通の入口を使わなければ error(メソッド・形を名指す)', () => {
    setUp();
    put(ROUTE_FILE, SELF_MADE_ROUTE);

    const found = verify();

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('X8|error|Route Handler app/src/app/api/ai/x/route.ts(/api/ai/x)は有料の連携 anthropic_chat に届く口ですが、共通の入口で包まれていません');
    expect(found[0]).toContain('POST: 最後の文が `runPaidEntry`');
  });

  it('全メソッドを見る: POST が正しくても、GET が包まれていなければ error(メソッドごとに名指す)', () => {
    setUp();
    put(ROUTE_FILE, `${GOOD_ROUTE}\nexport async function GET(request: Request): Promise<Response> {\n  return Response.json(request.url);\n}\n`);

    const found = verify();

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('GET: 最後の文が `runPaidEntry`');
    expect(found[0]).not.toContain('POST: ');
  });

  it('別のメソッドが有料の処理を handler の外で呼んでも error(束縛の使い方はファイル全体で見る)', () => {
    setUp();
    put(ROUTE_FILE, `${GOOD_ROUTE}\nexport async function GET(request: Request): Promise<Response> {\n  return Response.json(await createAnswer()(request));\n}\n`);

    const found = verify();

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('GET: ');
    expect(found[0]).toContain('POST: 有料の連携に届く束縛を `handler` の外で使っている');
  });

  it('有料の処理を handler の外で使えば error(枠の消費の前に有料の処理に届く)', () => {
    setUp();
    put(ROUTE_FILE, `${GOOD_ROUTE}\nconst warm = createAnswer();\n`);

    const found = verify();

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('有料の連携に届く束縛を `handler` の外で使っている');
  });

  it('上限が生の数・枠の消費が meter を呼ばない、は error', () => {
    setUp();
    put(ROUTE_FILE, GOOD_ROUTE.replace(`PAID_ENTRIES['${URL_PATH}'].maxBodyBytes`, '262144'));
    expect(verify().some((line) => line.includes('生成した定数表の、この口の URL の値'))).toBe(true);

    put(ROUTE_FILE, GOOD_ROUTE.replace('consume: (actorId) => consumeQuota()(actorId),', "consume: () => Promise.resolve('used'),"));
    expect(verify().some((line) => line.includes('宣言した meter の RPC を呼ぶモジュールの束縛 M を呼ぶ 1 式'))).toBe(true);
  });

  it('多要素認証の段: 生成した束・口の役を渡していなければ error(段を外せる口を通さない)', () => {
    setUp();
    put(ROUTE_FILE, GOOD_ROUTE.replace('    bindings: runtimeBindings,\n', ''));
    expect(verify().some((line) => line.includes('`bindings` が、生成した束(`runtimeBindings`)ではない'))).toBe(true);

    put(ROUTE_FILE, GOOD_ROUTE.replace('bindings: runtimeBindings,', 'bindings: { roleTables: runtimeBindings.roleTables },'));
    expect(verify().some((line) => line.includes('`bindings` が、生成した束'))).toBe(true);

    put(ROUTE_FILE, GOOD_ROUTE.replace(`role: PAID_ENTRIES['${URL_PATH}'].role,`, "role: 'member',"));
    expect(verify().some((line) => line.includes('`role` が生成した定数表のこの口の役'))).toBe(true);
  });

  it('拒否の行の出力口: logger が認証の組み立ての根の securityLogger() でなければ error(有料の口の拒否をホストの外への転送に載せる)', () => {
    setUp();
    put(ROUTE_FILE, GOOD_ROUTE.replace('    logger: securityLogger(),\n', ''));
    expect(verify().some((line) => line.includes('`logger` が認証の組み立ての根の `securityLogger()` の呼び出しではない'))).toBe(true);

    put(ROUTE_FILE, GOOD_ROUTE.replace('logger: securityLogger(),', 'logger: { write: () => undefined },'));
    expect(verify().some((line) => line.includes('`logger` が認証の組み立ての根'))).toBe(true);
  });

  it('多要素認証を要求する製品: resolveMfa に resolveSessionMfa を渡していなければ error、渡していれば指摘なし(要求しない製品は求めない)', () => {
    setUp();
    // 要求しない製品(既定)は resolveMfa が無くてよい。
    expect(verify()).toEqual([]);
    const enforced = { mfaEnforced: true } as const;
    const missing = verify(declared(), enforced);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain('多要素認証を要求する製品なのに、`resolveMfa` が認証の組み立ての根の `resolveSessionMfa` ではない');

    const wired = GOOD_ROUTE.replace("import { authorizeRole, securityLogger } from '@/composition/auth';", "import { authorizeRole, resolveSessionMfa, securityLogger } from '@/composition/auth';").replace(
      '    parse: parseBody,',
      '    resolveMfa: resolveSessionMfa,\n    parse: parseBody,',
    );
    put(ROUTE_FILE, wired);
    expect(verify(declared(), enforced)).toEqual([]);

    // 決め打ちの解決は認めない。
    put(ROUTE_FILE, wired.replace('resolveMfa: resolveSessionMfa,', 'resolveMfa: () => Promise.resolve(true),'));
    expect(verify(declared(), enforced)).toHaveLength(1);
  });

  it('meter の RPC 名が宣言と違えば、枠の消費の束縛が meter を呼んでいると認めない', () => {
    setUp();

    expect(verify(declared({ meter: 'consume_other' })).some((line) => line.includes('宣言した meter の RPC を呼ぶモジュールの束縛 M を呼ぶ 1 式'))).toBe(true);
  });

  it('配置が生成物のモジュールを引けなければ(空の配置)口は見ない', () => {
    setUp();
    put(ROUTE_FILE, SELF_MADE_ROUTE);

    expect(verify(declared(), { layout: {} })).toEqual([]);
  });
});

describe('X8 (c) meter の RPC の本文', () => {
  it('役の述語が本文に無ければ error(口の関門を迂回されたとき RPC が落とせない)', () => {
    setUp();
    put('supabase/migrations/20260101000000_quota.sql', GOOD_MIGRATION.replace("and a.state in ('active')", ''));

    const found = verify();

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('X8|error|連携 anthropic_chat の meter(consume_quota)の本文が、宣言した役 member を DB の行で確かめて原子的に消費する形になっていません');
    expect(found[0]).toContain("役の述語 `a.state in ('active')` が本文にありません");
  });

  it('後の migration が述語の無い版で上書きしたら error(最後の定義を読む)', () => {
    setUp();
    put('supabase/migrations/20260102000000_quota_v2.sql', GOOD_MIGRATION.replace("and a.state in ('active')", ''));

    expect(verify()).toHaveLength(1);
  });

  it('定義が migration に無ければ error', () => {
    setUp();
    put('supabase/migrations/20260101000000_quota.sql', 'select 1;');

    const found = verify();

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('meter の RPC consume_quota の定義が migration にありません');
  });

  it('migration の置き場が無ければ本文は見ない', () => {
    setUp();
    rmSync(path.join(root, 'supabase'), { recursive: true });

    expect(verify()).toEqual([]);
  });

  it('役が立てられない(R5-9 が言う)連携の meter の本文は見ない(重ねて言わない)', () => {
    setUp();
    put('supabase/migrations/20260101000000_quota.sql', 'select 1;');

    expect(verify(declared({ authz: { kind: 'role', role: 'nobody', location: { file: 'external.md' } } }))).toEqual([]);
    expect(verify(declared({ authz: undefined }))).toEqual([]);
    expect(verify(declared({ meter: undefined }))).toEqual([]);
  });

  it('実行者の行を読む表が引けなければ(テーブル仕様が阻害)表の字面は見ずに、述語と原子性を見る', () => {
    setUp();
    const blocked: CatalogInput<DataTableSpecModel> = { state: 'blocked', reason: 'load-failed', findings: [] };

    expect(verify(declared(), { dataTables: blocked })).toEqual([]);
    put('supabase/migrations/20260101000000_quota.sql', GOOD_MIGRATION.replaceAll('public.members', 'public.profiles'));
    expect(verify(declared(), { dataTables: blocked })).toEqual([]);
    expect(verify()).toHaveLength(1);
  });
});

describe('X8 (e) 閉包が欠けた入口(字句でない動的 import / require。点検 6 回目 B6-1)', () => {
  /** 探り台本 probe1 の形: 出どころの確認の後、ヘッダで分岐してテンプレートの動的 import で有料の処理を呼ぶ。 */
  const PROBE_ROUTE = GOOD_ROUTE.replace(
    '  if (refused !== null) return refused;\n',
    "  if (refused !== null) return refused;\n  const preview = request.headers.get('x-preview-key');\n  if (preview !== null) {\n    const area = 'ai';\n    const wiring = (await import(`@/composition/${area}`)) as { createAnswer: () => () => unknown };\n    return Response.json(wiring.createAnswer()());\n  }\n",
  );

  it('負例: 宣言された口の本体に字句でない動的 import があれば、閉包が欠けたことと、入口の前の文の両方で error', () => {
    setUp();
    put(ROUTE_FILE, PROBE_ROUTE);

    const found = verify();

    expect(found.some((line) => line.startsWith(`X8|error|Route Handler ${ROUTE_FILE} の import の閉包に、指定子が字句でない`))).toBe(true);
    expect(found.some((line) => line.includes('共通の入口で包まれていません') && line.includes('出どころの確認(`refuseCrossOrigin`)と `return runPaidEntry(…)` 以外の文'))).toBe(true);
  });

  it.each([
    ['ページ', 'app/src/app/guest/page.tsx'],
    ['Server Action', 'app/src/app/_actions/ask.ts'],
    ['リクエスト前段(proxy)', 'app/src/proxy.ts'],
    ['起動・失敗の報告の口(instrumentation。7 回目 B7-6)', 'app/src/instrumentation.ts'],
  ])('負例: %s が字句でない動的 import を持つ補助モジュールを読めば、閉包が欠けたとして error(届く先を字面で決められない)', (_title, file) => {
    setUp();
    put('app/src/composition/preview-draft.ts', "export const preview = async (area: string) => (await import(`@/composition/${area}`)) as unknown;\n");
    put(file, "import { preview } from '@/composition/preview-draft';\nexport const p = preview;\n");

    const found = verify();

    expect(found).toHaveLength(1);
    expect(found[0]).toContain(`X8|error|Route Handler でない入口 ${file} の import の閉包に、指定子が字句でない動的 import / require があります(app/src/composition/preview-draft.ts: \`@/composition/\${area}\`)`);
  });

  it.each([
    ['変数の指定子の動的 import', "export const load = (name: string) => import(name);\n"],
    ['変数の指定子の require', 'export const load = (name: string) => require(name) as unknown;\n'],
  ])('負例: %s も同じ(page から読む)', (_title, body) => {
    setUp();
    put('app/src/composition/loader.ts', body);
    put('app/src/app/guest/page.tsx', "import { load } from '@/composition/loader';\nexport const p = load;\n");

    expect(verify().some((line) => line.includes('Route Handler でない入口 app/src/app/guest/page.tsx の import の閉包に'))).toBe(true);
  });

  it('正例: 字句の動的 import(置換の無いテンプレートを含む)は閉包の辺になり、届く入口は bypass として言われる(欠けたとは言わない)', () => {
    setUp();
    put('app/src/app/guest/page.tsx', 'export const p = async () => (await import(`@/composition/ai`)) as unknown;\n');

    const found = verify();

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('X8|error|app/src/app/guest/page.tsx は Route Handler ではありませんが、有料の連携 anthropic_chat のアダプタに届きます');
  });
});

describe('X8 (f) 素の指定子の許可表(点検 7 回目 B7-2)', () => {
  /** 探り台本の形: package.json の imports の `#comp/*` で有料の連携の配線をページから読む。 */
  const PAGE = 'app/src/app/guest/page.tsx';

  it.each([
    ['B7-2 の反例: package.json の imports の別名(#comp/…)', "import { createAnswer } from '#comp/ai';\nexport const p = createAnswer;\n", '#comp/ai'],
    ['tsconfig の paths の別名(~/…)', "import { createAnswer } from '~/composition/ai';\nexport const p = createAnswer;\n", '~/composition/ai'],
    ['baseUrl に頼る素の綴り', "import { createAnswer } from 'composition/ai';\nexport const p = createAnswer;\n", 'composition/ai'],
    ['自分のパッケージ名の自己参照', "import { createAnswer } from 'app/src/composition/ai';\nexport const p = createAnswer;\n", 'app/src/composition/ai'],
    ['node: の無い組み込み名', "import { join } from 'path';\nexport const p = join;\n", 'path'],
  ])('負例: %s は閉包の欠けとして error(届く先を確かめられない)', (_title, body, specifier) => {
    setUp();
    put(PAGE, body);

    const found = verify();

    expect(found).toEqual([
      expect.stringContaining(`X8|error|Route Handler でない入口 ${PAGE} の import の閉包に、依存のパッケージ・node: の組み込み・配置の別名のどれでもない素の指定子があります(${PAGE}: ${specifier})`),
    ]);
  });

  it('負例: 宣言された口の閉包の先のモジュールにあっても error(口の閉包も欠ける)', () => {
    setUp();
    put('app/src/composition/ai-quota.ts', "import { counter } from '#infra/quota';\nexport const consumeQuota = () => counter;\n");

    expect(verify().some((line) => line.includes(`Route Handler ${ROUTE_FILE} の import の閉包に、依存のパッケージ`) && line.includes('app/src/composition/ai-quota.ts: #infra/quota'))).toBe(true);
  });

  it.each([
    ['依存のパッケージそのもの', "import { a } from 'next';\nexport const p = a;\n"],
    ['依存のパッケージの下のパス', "import { a } from 'next/server';\nexport const p = a;\n"],
    ['スコープつきの依存の下のパス', "import { a } from '@kaninabe/runtime/http/response';\nexport const p = a;\n"],
    ['node: の組み込み', "import { join } from 'node:path';\nexport const p = join;\n"],
    ['配置の別名(届かない先)', "import { a } from '@/domain/x';\nexport const p = a;\n"],
  ])('正例: %s は許可表の内(指摘なし)', (_title, body) => {
    setUp();
    put('app/src/domain/x.ts', 'export const a = 1;\n');
    put(PAGE, body);

    expect(verify()).toEqual([]);
  });

  it('境界: 依存の名前の接頭辞だけが同じ別パッケージ(nextra は next の下ではない)は error', () => {
    setUp();
    put(PAGE, "import { a } from 'nextra';\nexport const p = a;\n");

    expect(verify()).toHaveLength(1);
  });

  it('境界: package.json が無ければ依存は空(どの素の指定子も受けない = fail-closed)', () => {
    setUp();
    rmSync(path.join(root, 'app/package.json'));

    expect(verify().some((line) => line.includes('@kaninabe/runtime/http/paid-entry'))).toBe(true);
  });
});

describe('X8 (g) オプションの値は認可より前に評価される(点検 7 回目 B7-1)', () => {
  it('負例: 探り台本の形(operation: await previewOperation(request))は共通の入口で包まれていないとして error', () => {
    setUp();
    put('app/src/composition/preview-hook.ts', "export async function previewOperation(_request: Request): Promise<'answer'> { return 'answer'; }\n");
    put(ROUTE_FILE, GOOD_ROUTE.replace("operation: 'answer',", 'operation: await previewOperation(request),').replace("import { parseBody }", "import { previewOperation } from '@/composition/preview-hook';\nimport { parseBody }"));

    const found = verify();

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('POST: `runPaidEntry` のオプションに許可表の外の鍵がある、または `operation` / `invariant` が文字列の字句');
  });
});
