/**
 * X8 **有料の口の執行**(ASVS V2.4.1・V15.2.2)— 有料の連携(`spend: paid`)に届く Route Handler は共通の入口で包まれ、
 * 枠を消費する RPC は宣言した役を DB の行で確かめ、消費を原子的に行う。
 *
 * 宣言の検査(R5-7 / R5-9)は「上限・枠・役・RPC を書いてある」までを見る。書いてあっても口が使わなければ嘘である。**定数を import していること**は
 * 執行ではない(本文を先に読み切ってから上限を見る口も、課金してから枠を数える口も、定数は import している)。守りたいのは順序なので、
 * 順序を 1 か所で持つ共通の入口(`runPaidEntry`)に結ぶ。見るのは 3 点である(多要素認証の段 —— ASVS V6.8・保証 `fw_mfa_write_boundary` —— は 2 点目に含む)。
 *
 * | 見ること | なぜ |
 * |---|---|
 * | **有料の連携のアダプタに import の閉包で届く Route Handler** が、その連携の `endpoints` に宣言されている | 宣言の無い口は、上限・枠・役の宣言の外にある(J2 の閉世界の続き。口の存在そのものは J2 が見る) |
 * | 宣言された口の**状態を変える以外も含む全メソッド**が、`runPaidEntry`(本物の import)で包まれ、上限と役を生成した定数表から読み、**多要素認証の段に生成した束(`runtimeBindings`)と口の役を渡し(要求する製品は `resolveMfa` に `resolveSessionMfa`)**、**拒否の行の出力口に認証の組み立ての根の `securityLogger()` を渡し**、`consume` が `meter` の RPC を呼ぶモジュールを使い、**有料の連携に届く束縛を `handler` の中でしか使わない**(`semantics` の走査 `paid-entry-scan.ts`) | 本文を読む前の上限・課金の前の枠の消費・認可の順序は共通の入口が持つ。有料の処理が `handler` の外にあれば順序を迂回できる |
 * | 口と Route Handler でない入口の**import の閉包に、指定子が字句でない動的 import / `require` が無く、素の指定子は製品の `package.json` の依存と `node:` の組み込みだけ**(`semantics/bare-specifiers.ts` の許可表) | 行き先が字面から決まらない import と、束ねる道具が自分のソースに解く素の指定子(`package.json` の `imports` の `#…`・`tsconfig` の `paths` の別名)は閉包から消え、上の 2 行(届くか・handler の外で使うか)の判定が黙って緑になる(点検 6 回目 B6-1・7 回目 B7-2。閉包が欠けたら赤 = fail-closed) |
 * | `meter` の RPC の本文(最後に定義した migration)が、`authz.role` の述語(役の `claim` と、含意の先で行の条件を持つ役の `claim`)を **DB の行で**持ち、最初の書き込みより前に `raise exception` し、消費が 1 文の原子的な更新である(`meter-body.ts`) | 口の関門を忘れても RPC が役を持たない実行者を落とす二重の守り。片方の欠落は赤 |
 *
 * 見るのは構文木と本文の字面の形で、実行して確かめるのは統合テスト(枠を使い切った後に有料の処理が呼ばれない・上限を超えた本文を読まない・役を持たない実行者の消費が拒まれる)である。
 * 実装の木が実在する環境でだけ見る(仕様だけのリポジトリは宣言だけを持てる)。純粋関数で、ファイルの読み取りは `io` の口を通す。
 */

import path from 'node:path';
import { appGrounded, isDirectory, isFile, listEntries } from '../../io/paths.js';
import { tryReadText } from '../../io/read-text.js';
import type { WalkFs } from '../../io/walk-tree.js';
import type { Finding } from '../../kernel/finding.js';
import { makeFinding } from '../../kernel/finding.js';
import { inputValue } from '../../kernel/input-state.js';
import type { CatalogInput } from '../../kernel/input-state.js';
import type { DataTableSpecModel } from '../../model/data/types.js';
import type { ClaimParts } from '../../model/role-claim.js';
import type { ExternalCatalogSpec, OutboundIntegrationDecl } from '../../model/external/types.js';
import { paidRolePlan } from '../../model/paid-authz.js';
import { generatedModuleOf, httpEntryPath, layoutModule, layoutScan, normalizeUrlPath } from '../../model/product/layout.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import type { SpecModel } from '../../model/types.js';
import { foundEntries } from '../../job/verifiers/j2-entry-closed.js';
import type { UnresolvedImport } from '../../semantics/import-closure.js';
import { paidReachOf } from '../paid-reach.js';
import { exportedHttpMethods } from '../../semantics/route-exports.js';
import { nonRouteEntries } from '../non-route-entries.js';
import { latestFunctionBody, meterBodyProblems } from '../meter-body.js';
import type { MigrationText } from '../meter-body.js';
import { MFA_RESOLVER } from '../../model/auth/mfa.js';
import { paidEntryShape, PAID_ENTRY_FUNCTION, PAID_ENTRY_MODULE, RUNTIME_BINDINGS_NAME, SECURITY_LOGGER } from '../paid-entry-scan.js';
import type { PaidEntryShape } from '../paid-entry-scan.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'X8';

/** X8 の入力。 */
export interface PaidEntryInput {
  readonly catalog: ExternalCatalogSpec;
  /** 役の台帳(`authz.role` の述語を引く)。 */
  readonly domain: SpecModel;
  /** テーブル仕様の入力の状態(実行者の行を読む表を引く。使えなければ表の字面は見ない)。 */
  readonly dataTables: CatalogInput<DataTableSpecModel>;
  readonly repoRoot: string;
  readonly roots: ProductRoots;
  readonly layout: ProductLayout;
  /**
   * 製品が多要素認証を要求するか(認証フロー仕様の `mfa` が `require`)。要求するなら、口は `resolveMfa` に認証の組み立ての根の
   * `resolveSessionMfa` を渡す(渡さないと、済ませたセッションも止まる)。省略は要求しない。
   */
  readonly mfaEnforced?: boolean;
  /** 入口の走査が使うファイルシステムの口(省略は実の fs)。 */
  readonly fs?: WalkFs;
}

/** 形が崩れているときの言い分け(違反の文に出る)。 */
const SHAPE_WORDING: Readonly<Record<Exclude<PaidEntryShape, 'wrapped'>, string>> = {
  'body-unreadable': '本体がこのファイルの関数として読めない(再輸出・高階関数の戻り値・分割代入の引数)',
  'not-wrapped': `最後の文が \`${PAID_ENTRY_FUNCTION}\`(${PAID_ENTRY_MODULE} から import したもの)の呼び出しを返していない`,
  'extra-statements':
    '本体に、出どころの確認(`refuseCrossOrigin`)と `return runPaidEntry(…)` 以外の文・式がある(入口の前の文は、見張りのテストが送らないヘッダ・本文・クエリで分岐して認可・上限・枠の外へ出られる。許可表: `return runPaidEntry(…)` / `return refuseCrossOrigin(request, …) ?? runPaidEntry(…)` / `const r = refuseCrossOrigin(request, …); if (r !== null) return r; return runPaidEntry(…)`)',
  'request-not-passed': `\`${PAID_ENTRY_FUNCTION}\` の第 1 引数がメソッドの受けた要求ではない`,
  'options-unreadable': `\`${PAID_ENTRY_FUNCTION}\` の第 2 引数が、スプレッド・算出キー・同じ名前の重複(識別子と引用符つきの名前は同じ鍵。実行時は後勝ちで上書きされる)を含まないその場のオブジェクトではない`,
  'limit-not-generated': '`maxBodyBytes` が生成した定数表の、この口の URL の値(`PAID_ENTRIES[\'…\'].maxBodyBytes`)ではない',
  'role-not-generated': '`authorize` が、認証の組み立ての根の `authorizeRole` を引数 1 つ `PAID_ENTRIES[\'…\'].role` で呼ぶ 1 式ではない(呼び先が手書きの関数・役を捨てる即時呼び出しは、役を渡していても認可にならない)',
  'bindings-not-generated': `\`bindings\` が、生成した束(\`${RUNTIME_BINDINGS_NAME}\`)ではない(多要素認証の段が手書きの値で外れる)`,
  'role-option-not-generated': '`role` が生成した定数表のこの口の役(`PAID_ENTRIES[\'…\'].role`)ではない',
  'mfa-resolver-not-wired': `多要素認証を要求する製品なのに、\`resolveMfa\` が認証の組み立ての根の \`${MFA_RESOLVER}\` ではない`,
  'logger-not-wired': `\`logger\` が認証の組み立ての根の \`${SECURITY_LOGGER}()\` の呼び出しではない(拒否の行が標準出力だけに残り、ホストの外への転送に載らない)`,
  'meter-not-called': '`consume` が、宣言した meter の RPC を呼ぶモジュールの束縛 M を呼ぶ 1 式(`M` / `M()` / `(id) => M(id)` / `(id) => M()(id)`)ではない(参照するだけ・条件つき・ブロックの形は枠を数えずに有料の処理へ進みうる)',
  'handler-not-inline': '`handler` がその場の関数ではない',
  'option-not-allowed':
    '`runPaidEntry` のオプションに許可表の外の鍵がある、または `operation` / `invariant` が文字列の字句・`parse` が import した関数の名前でない(オプションの値は認可より前に評価されるので、呼び出し・`await` を置くと未ログインの要求でも処理が走る。点検 7 回目 B7-1)',
  'paid-outside-handler': '有料の連携に届く束縛を `handler` の外で使っている(枠の消費の前に有料の処理に届きうる)',
};

/** migration を名前順に読む(置き場が無ければ null)。 */
function readMigrations(repoRoot: string, roots: ProductRoots): readonly MigrationText[] | null {
  const dir = path.join(repoRoot, roots.migrations);
  if (!isDirectory(dir)) return null;
  return listEntries(dir)
    .filter((name) => name.endsWith('.sql'))
    .flatMap((name) => {
      const text = tryReadText(path.join(dir, name));
      return text === null ? [] : [{ name, text }];
    });
}

/** 条件ごとの、実行者の行を読む表(data_table の `entity` が一致するもの)。 */
function actorTableOf(dataTables: CatalogInput<DataTableSpecModel>): (condition: ClaimParts) => string | null {
  const model = inputValue(dataTables);
  return (condition) => model?.tables.find((table) => table.entity === condition.entity)?.table ?? null;
}

/** `meter` の RPC の本文の指摘(R5 が役を引けなかった連携は見ない)。 */
function meterFindings(integration: OutboundIntegrationDecl, input: PaidEntryInput, migrations: readonly MigrationText[]): Finding[] {
  const meter = integration.meter;
  const role = integration.authz?.role;
  if (meter === undefined || role === undefined) return [];
  const plan = paidRolePlan(input.domain.roles.roles, role);
  if (plan.problems.length > 0) return [];
  const body = latestFunctionBody(migrations, meter);
  const problems = body === null ? [`meter の RPC ${meter} の定義が migration にありません`] : meterBodyProblems(body, plan.conditions, actorTableOf(input.dataTables));
  if (problems.length === 0) return [];
  return [
    makeFinding(VERIFIER_ID, {
      message: `連携 ${integration.id} の meter(${meter})の本文が、宣言した役 ${role} を DB の行で確かめて原子的に消費する形になっていません: ${problems.join(' / ')}`,
      location: integration.location,
      suggestion:
        `${meter} の本文(最後に定義した migration)で、実行者の行を読んで役の述語を確かめ、満たさなければ \`raise exception\` し、その後に 1 文で消費する。` +
        '口の関門(authorize)を忘れても・迂回されても RPC が役を持たない実行者を落とすための二重の守りである',
      counterexample: { integration: integration.id, meter, role, problems: problems.join(' / ') },
      grounding: 'implementation',
    }),
  ];
}

/** 入口の閉包が欠けている(字句でない指定子・許可表の外の素の指定子を持つ)指摘。 */
function opaqueFindings(entry: string, items: readonly UnresolvedImport[], role: string): Finding[] {
  const opaque = items.filter((item) => item.opaque === true);
  const unlisted = items.filter((item) => item.unlisted === true);
  const listOf = (found: readonly UnresolvedImport[]): string => found.map((item) => `${item.from}: ${item.specifier}`).join(' / ');
  const findings: Finding[] = [];
  if (opaque.length > 0) {
    findings.push(
      makeFinding(VERIFIER_ID, {
        message:
          `${role} ${entry} の import の閉包に、指定子が字句でない動的 import / require があります(${listOf(opaque)})。` +
          '行き先が字面から決まらないので、有料の連携に届くか・共通の入口の外で有料の処理を呼ぶかを確かめられません(閉包が欠けている)',
        location: { file: entry },
        suggestion:
          '指定子を字句(文字列リテラル・置換の無いテンプレート)で書く(`import(\'<モジュール>\')`)。行き先を実行時に選ぶ必要があるなら、' +
          '字句の import を並べた表から選ぶ(ESLint の layer/no-opaque-module-specifier が製品の実行コードで同じ形を止める)',
        counterexample: { entry, imports: listOf(opaque) },
        grounding: 'implementation',
      }),
    );
  }
  if (unlisted.length > 0) {
    findings.push(
      makeFinding(VERIFIER_ID, {
        message:
          `${role} ${entry} の import の閉包に、依存のパッケージ・node: の組み込み・配置の別名のどれでもない素の指定子があります(${listOf(unlisted)})。` +
          'package.json の imports(#…)・tsconfig の paths の別名などは束ねる道具が自分のソースに解くので、有料の連携に届くかを確かめられません(閉包が欠けている。点検 7 回目 B7-2)',
        location: { file: entry },
        suggestion:
          '実装の木の中は相対か配置の別名で import する。外のパッケージなら製品の package.json の dependencies に宣言する。node の組み込みは `node:` を付ける',
        counterexample: { entry, imports: listOf(unlisted) },
        grounding: 'implementation',
      }),
    );
  }
  return findings;
}

/** 宣言の無い口の指摘。 */
function undeclaredRoute(route: string, url: string | null, integration: OutboundIntegrationDecl): Finding {
  return makeFinding(VERIFIER_ID, {
    message:
      `Route Handler ${route} は有料の連携 ${integration.id} のアダプタに届きますが、その連携の endpoints に宣言されていません` +
      '(宣言の無い口は、本文の上限・回数の枠・役の宣言の外で、呼び出しごとにお金を使えます)',
    location: { file: route },
    suggestion: `${integration.id} の endpoints に口の URL${url === null ? '' : `(${url})`}を足し、abuse.max_body_bytes に上限を書く。有料の処理に届かない口にするなら、アダプタへ届く import を消す`,
    counterexample: { route, integration: integration.id },
    grounding: 'implementation',
  });
}

/** 共通の入口を使っていない口の指摘。 */
function unwrappedRoute(route: string, url: string, integration: OutboundIntegrationDecl, broken: readonly { readonly method: string; readonly shape: Exclude<PaidEntryShape, 'wrapped'> }[]): Finding {
  return makeFinding(VERIFIER_ID, {
    message:
      `Route Handler ${route}(${url})は有料の連携 ${integration.id} に届く口ですが、共通の入口で包まれていません: ` +
      broken.map((item) => `${item.method}: ${SHAPE_WORDING[item.shape]}`).join(' / '),
    location: integration.location,
    suggestion:
      `全メソッドの最後の文を \`return ${PAID_ENTRY_FUNCTION}(request, { operation, maxBodyBytes: PAID_ENTRIES['${url}'].maxBodyBytes, authorize: …(PAID_ENTRIES['${url}'].role), parse, consume, handler })\` にする。` +
      `多要素認証の段として \`bindings: ${RUNTIME_BINDINGS_NAME}\`・\`role: PAID_ENTRIES['${url}'].role\`(要求する製品はさらに \`resolveMfa: ${MFA_RESOLVER}\`)を、` +
      `拒否の行の出力口として \`logger: ${SECURITY_LOGGER}()\`(認証の組み立ての根から import する)を足す` +
      `(${PAID_ENTRY_FUNCTION} は ${PAID_ENTRY_MODULE} から import する。有料の処理は handler の中だけに置く)。` +
      '本文を読む前の上限・認可・課金の前の枠の消費の順序を、口ごとに手で書かない',
    counterexample: { route, endpoint: url, integration: integration.id, methods: broken.map((item) => item.method).join(' / '), shapes: broken.map((item) => item.shape).join(' / ') },
    grounding: 'implementation',
  });
}

/** 入口のファイルと、結べる URL(走査で見つけたものと、連携が宣言した口)。 */
function routeFiles(input: PaidEntryInput, paid: readonly OutboundIntegrationDecl[]): ReadonlyMap<string, string | null> {
  const routes = new Map<string, string | null>();
  const scan = layoutScan(input.layout, input.roots.app, 'http-entry');
  if (scan !== null) for (const entry of foundEntries(input.repoRoot, scan, input.fs).entries) routes.set(entry.file, entry.url);
  for (const integration of paid) {
    for (const endpoint of integration.endpoints ?? []) {
      const file = httpEntryPath(input.layout, input.roots, endpoint);
      if (file !== null && isFile(path.join(input.repoRoot, file)) && !routes.has(file)) routes.set(file, endpoint);
    }
  }
  return routes;
}

/** 口 1 本の指摘。 */
function routeFindings(route: string, url: string | null, paid: readonly OutboundIntegrationDecl[], input: PaidEntryInput, modules: { readonly tableModule: string; readonly bindingsModule: string }): Finding[] {
  const adapters = new Map(paid.map((integration) => [integration.adapter, integration]));
  const reach = paidReachOf(input, adapters);
  const findings: Finding[] = [...opaqueFindings(route, reach.opaque(route), 'Route Handler')];
  const source = reach.read(route) ?? '';
  const methods = exportedHttpMethods(route, source);
  for (const integration of reach.reached(route)) {
    const declared = url !== null && (integration.endpoints ?? []).some((endpoint) => normalizeUrlPath(endpoint) === normalizeUrlPath(url));
    if (!declared || url === null) {
      findings.push(undeclaredRoute(route, url, integration));
      continue;
    }
    // meter が無い連携は R5-7 が言う(枠を消費する RPC を名指せないので、consume の束縛は突き合わせられない)。
    if (integration.meter === undefined) continue;
    const classOf = reach.classOf(route, integration.meter);
    const broken = methods.flatMap((method) => {
      const mfaResolverModule = input.mfaEnforced === true ? layoutModule(input.layout, 'auth-composition') ?? '' : null;
      const loggerModule = layoutModule(input.layout, 'auth-composition') ?? '';
      const shape = paidEntryShape(route, source, method, { ...modules, mfaResolverModule, loggerModule, endpoint: url, classOf });
      return shape === 'wrapped' ? [] : [{ method, shape }];
    });
    if (broken.length > 0) findings.push(unwrappedRoute(route, url, integration, broken));
  }
  return findings;
}

/** Route Handler でない入口(Server Action・ページ・前段)が有料の連携に届く指摘。 */
function bypassFindings(input: PaidEntryInput, paid: readonly OutboundIntegrationDecl[]): Finding[] {
  const reach = paidReachOf(input, new Map(paid.map((integration) => [integration.adapter, integration])));
  return nonRouteEntries(input.repoRoot, input.layout, input.roots, input.fs).flatMap((file) => [
    ...opaqueFindings(file, reach.opaque(file), 'Route Handler でない入口'),
    ...reach.reached(file).map((integration) =>
      makeFinding(VERIFIER_ID, {
        message:
          `${file} は Route Handler ではありませんが、有料の連携 ${integration.id} のアダプタに届きます` +
          '(Server Action・ページ・レイアウト・サーバーコンポーネント・リクエスト前段から有料の連携へ行く道は、共通の入口を通らず、本文の上限・枠の消費・役の確認の外です)',
        location: { file },
        suggestion:
          `有料の連携へ行く道は、${integration.id} の endpoints に宣言した Route Handler が runPaidEntry で包んだものだけにする。画面は fetch でその口を叩く。` +
          '画面が必要なのが有料の処理でなく状態(例: 鍵の有無)だけなら、アダプタに届かない別のモジュールに分けてそこから読む',
        counterexample: { entry: file, integration: integration.id },
        grounding: 'implementation',
      }),
    ),
  ]);
}

/** 入口の URL を宣言の綴り(定数表の鍵)に合わせる。 */
function declaredSpelling(url: string | null, paid: readonly OutboundIntegrationDecl[]): string | null {
  if (url === null) return null;
  const all = paid.flatMap((integration) => integration.endpoints ?? []);
  return all.find((endpoint) => normalizeUrlPath(endpoint) === normalizeUrlPath(url)) ?? url;
}

/**
 * X8 が見る相手(有料の連携。実装の木が無ければ見ないので空)。検査そのものと、回ったことを数える側(題材の通し実行の回し直しの回数。差分点検 S27-2)が
 * 同じ 1 つの判定を使う。
 *
 * @param input 外部連携のカタログ・リポジトリルート・根
 */
export function paidEntrySubjects(input: Pick<PaidEntryInput, 'catalog' | 'repoRoot' | 'roots'>): readonly OutboundIntegrationDecl[] {
  if (!appGrounded(input.repoRoot, input.roots.app)) return [];
  return input.catalog.integrations.filter((integration): integration is OutboundIntegrationDecl => integration.direction === 'outbound' && integration.spend === 'paid');
}

/**
 * 有料の口の執行(口が共通の入口で包まれていること・meter の本文)を検証する。
 *
 * @param input カタログ・役の台帳・テーブル仕様・リポジトリ
 * @returns 違反(実装の木が無い・有料の連携が無ければ空)
 */
export function verifyPaidEntry(input: PaidEntryInput): Finding[] {
  const paid = paidEntrySubjects(input);
  if (paid.length === 0) return [];
  const migrations = readMigrations(input.repoRoot, input.roots);
  const meters = migrations === null ? [] : paid.flatMap((integration) => meterFindings(integration, input, migrations));
  const bypass = bypassFindings(input, paid);
  const tableModule = generatedModuleOf(input.layout, input.roots, 'paid-entries');
  const bindingsModule = generatedModuleOf(input.layout, input.roots, 'runtime-bindings');
  if (tableModule === null || bindingsModule === null) return [...meters, ...bypass];
  const routes = [...routeFiles(input, paid)].flatMap(([route, url]) => routeFindings(route, declaredSpelling(url, paid), paid, input, { tableModule, bindingsModule }));
  return [...meters, ...routes, ...bypass];
}
