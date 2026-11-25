/**
 * entity_spec(列)+ access_spec(fields_hidden・reads)+ data_table(RPC の帰属)
 * → API スキーマ期待表(`app/src/domain/generated/api-expectations.ts`)の生成器。
 *
 * 「外から届く surface は仕様の生成物だけ」(docs/design/security-surface-proposal.md §2)を実装する
 * `api` スキーマ(ビュー + RPC + ヘルパ)の期待を閉世界として持つ。migration
 * (`supabase/migrations/*_api_schema.sql`)は手書きだが、その形が仕様と食い違っていないかは
 * この期待表と実 DB を突き合わせる統合テスト(`api-parity.test.ts`)が見る
 * (rls-expectations / rpc-expectations と同じ「生成した期待 ⇔ 実 DB」の流儀)。
 *
 * - **`apiViews`**: access_spec を持つエンティティ(テーブル)ごとに、ビューへ全列挙する列
 *   (entity_spec の `fields`)と、隠す列(`fields_hidden`)を宣言どおりに見せてよいロールの列挙。
 *   `visibleTo` は「その列を読める、`from` に無いロール」= `reads` のうち scope が none でなく、
 *   `system`(RLS バイパス。マスクの条件文の外で無条件に解ける)でもなく、`fields_hidden.from`
 *   にも無いロールである。**ビューの SQL と同じ計画**(`lib/sql/api-views.ts`)から出しており、
 *   期待とビューが別々の導出でずれることは無い。
 * - **`apiInternalViews`**: 内部テーブル(`internal: true`)のビューの閉世界 = **外から完全に
 *   消える側**の全数。`apiViews` と排他ではない —— 列の正が仕組みの設計図にある表
 *   (`framework: jobs`)は両方に載る(列は突き合わせ、surface のロールには 1 つも与えない)。
 *   列の正がどこにも無い表だけが `apiViews` の外に残り、その理由ごと surface_spec の
 *   `hand_written_views` が宣言する(生成器に閉じたハードコードではない)。
 * - **`apiRpcFunctions`**: 全 data_table の `functions` のうち `kind: 'rpc'` の名前の閉世界
 *   (`public` から `api` へ `alter function ... set schema api` で移す対象。中身は不変)。
 * - **`apiHelpers`**: 土台の関数の全部(呼び出し主体の解決 2 本 + ログインセッションの生死 1 本)。仕様からではなく
 *   方式そのものが要求する固定の関数(Supabase 固有点をここに閉じる、という設計上の決定)。
 * - **`apiBaseFunctions`**: その**定義と権限**。名前の実在(`apiHelpers`)だけを見ていた
 *   ので、`api.is_end_user()` が `select true` に書き換わっても全部緑だった —— 土台が生成物に
 *   なった(`lib/sql/api-base.ts`)ことで定義の正が 1 か所に立ったので、`prosrc` の md5 と
 *   `grant execute` の宛先まで突き合わせる(4 題材は空の DB にこれを生成して当てる)。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { pluralizeEntity } from '../../model/table-name.js';
import { maskVisibilities, surfacedAggregates } from '../../sql/api-views.js';
import { frameworkTableColumnNames, isFrameworkTable } from '../../sql/framework-tables.js';
import { usecaseCompositeFunctions } from '../../usecase/composite.js';
import { inboundRpcFunctions } from '../../inbound/inbound-functions.js';
import { apiBaseFunctions, apiBaseGrantees, apiBaseSource } from '../../sql/api-base.js';
import { apiViewAcl } from '../../sql/api-acl.js';
import type { PlatformProfile } from '../../model/product/platform-profile.js';
import { endUserRoles, privilegedRole, surfaceUnsupportedReason } from '../../sql/platform-sql.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 期待表の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'api-expectations.ts');

/** `api` スキーマに置く固定のヘルパ関数(仕様からではなく方式そのものが要求する3本。土台の関数の全部)。 */
function apiHelperNames(platform: PlatformProfile): readonly string[] {
  return apiBaseFunctions(platform).map((fn) => fn.name);
}

/** 土台の 3 本を期待表のリテラルに写す(本文と権限の正は `lib/sql/api-base.ts`)。 */
function baseFunctions(platform: PlatformProfile): LiteralValue {
  return apiBaseFunctions(platform).map((fn) => ({
    name: fn.name,
    returns: fn.returns,
    source: apiBaseSource(fn),
    definer: fn.definer,
    grantees: [...apiBaseGrantees(platform)],
  }));
}

/**
 * 全 access_spec + entity_spec + data_table から API スキーマの期待表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/api-expectations.ts`(全体生成)。
 *
 * **後段が SQL の公開面を API として外へ出す能力を持たない構成(`surfaceExposure: unsupported`)では何も出さない**
 * (未対応の報告は生成の入口 `cli/generate-docs.ts` が言う。黙って緑にしない)。
 */
export const apiExpectationsGenerator: DocGenerator = {
  id: 'code-api-expectations',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    if (surfaceUnsupportedReason(ctx.platform) !== null) return [];
    const pairs = surfacedAggregates(model);
    if (pairs.length === 0) return [];

    const views: Record<string, LiteralValue> = {};
    for (const { access, entity } of pairs) {
      const table = entity.table ?? pluralizeEntity(entity.entity);
      views[table] = {
        columns: entity.fields.map((field) => field.name),
        masked: maskVisibilities(access, table, model.roles.roles).map((mask) => ({
          column: mask.column,
          visibleTo: [...mask.visibleTo],
        })),
      };
    }

    // 複合 RPC(usecase_spec の保存点から生成する関数)も api に置かれるので閉世界に足す。
    const composites = [
      ...usecaseCompositeFunctions({
        domain: model,
        actions: ctx.actions ?? null,
        dataTables: ctx.dataTables,
        usecases: ctx.usecases,
      }),
      ...inboundRpcFunctions({ domain: model, dataTables: ctx.dataTables, external: ctx.external, roots: ctx.roots }),
    ];
    const rpcFunctions = [
      ...new Set([
        ...(ctx.dataTables?.tables ?? []).flatMap((table) =>
          table.functions.filter((fn) => fn.kind === 'rpc').map((fn) => fn.name),
        ),
        ...composites.map((composite) => composite.fn.name),
      ]),
    ].sort((a, b) => a.localeCompare(b));

    // **仕組みが自分で持つ表**の surface も期待に載る(列の正が設計図にあるだけで、ビューの形は同じ)。
    // 載せないと api-parity の閉世界が「宣言に無いビュー」で落ちる。
    for (const table of ctx.dataTables?.tables ?? []) {
      if (table.surfaceMigration === undefined || table.framework === undefined) continue;
      if (!isFrameworkTable(table.framework)) continue;
      views[table.table] = { columns: [...frameworkTableColumnNames(table.framework)], masked: [] };
    }

    // 「surface のロールに何も与えない側」の全数。**手書きかどうかではなく内部テーブルかどうかで
    // 決まる** —— 生成物にした内部テーブル(`api.jobs`)も、外から完全に消えることに変わりは
    // 無い。手書きで残すビューは T12 が `internal: true` だけに絞っているので、そのまま載る。
    const internalViews = [
      ...new Set([
        ...(ctx.surface?.spec?.handWrittenViews ?? []).map((view) => view.table),
        ...(ctx.dataTables?.tables ?? [])
          .filter((table) => table.internal && table.surfaceMigration !== undefined)
          .map((table) => table.table),
      ]),
    ].sort((a, b) => a.localeCompare(b));
    const specFiles = [
      ...new Set([
        ...pairs.map((pair) => pair.access.location.file),
        ...pairs.map((pair) => pair.entity.location.file),
        ...(ctx.dataTables?.tables ?? []).map((table) => table.location.file),
        ...(ctx.surface?.spec === undefined || ctx.surface.spec === null ? [] : [ctx.surface.spec.location.file]),
      ]),
    ].sort((a, b) => a.localeCompare(b));

    // ACL は surface に出るビューと内部テーブルのビューで 1 ビットだけ違う(`api-acl.ts`)。
    const acl: Record<string, LiteralValue> = {};
    for (const view of [...new Set([...Object.keys(views), ...internalViews])].sort((a, b) => a.localeCompare(b))) {
      acl[view] = apiViewAcl(internalViews.includes(view), ctx.platform).map((entry) => ({
        role: entry.role,
        privileges: [...entry.privileges],
      }));
    }

    return [
      {
        file: outputFile(ctx.roots),
        content: renderFile({ views, acl, rpcFunctions, internalViews, specFiles, platform: ctx.platform }),
        wholeFile: true,
      },
    ];
  },
};

/** 期待表の材料(引数の数が増えたので束ねる)。 */
interface ApiExpectationsInput {
  readonly views: Readonly<Record<string, LiteralValue>>;
  readonly acl: Readonly<Record<string, LiteralValue>>;
  readonly rpcFunctions: readonly string[];
  readonly internalViews: readonly string[];
  readonly specFiles: readonly string[];
  /** プラットフォームの設定(外に出すスキーマ・ロール名。文面に出る)。 */
  readonly platform: PlatformProfile;
}

/** 期待表のファイル全体を組み立てる。 */
function renderFile(input: ApiExpectationsInput): string {
  const { views, acl, rpcFunctions, internalViews, specFiles, platform } = input;
  const schema = platform.exposedSchema;
  const readers = endUserRoles(platform).join(' / ');
  return [
    generatedHeader(specFiles),
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([`\`${schema}\` スキーマの 1 ビュー分の期待(全列 + マスク列)。`]),
    'export interface ApiMaskedColumn {',
    '  /** 隠す列名(entity_spec の field 名)。 */',
    '  readonly column: string;',
    '  /**',
    '   * `fields_hidden.from` の外側にいて、かつその行を読めるロール(NOT NULL で値が返る相手)。',
    `   * ${privilegedRole(platform)}(\`system\`)はここに現れない(マスクの CASE が is_end_user() で無条件に解く)。`,
    '   */',
    '  readonly visibleTo: readonly string[];',
    '}',
    '',
    docComment([
      `\`${schema}\` スキーマの 1 ビュー分の期待。`,
      '`columns` はビューに列挙すべき全列(entity_spec の `fields` そのまま。`select *` を使わない)。',
    ]),
    'export interface ApiViewExpectation {',
    '  readonly columns: readonly string[];',
    '  readonly masked: readonly ApiMaskedColumn[];',
    '}',
    '',
    docComment([
      'テーブル名 → API スキーマのビュー期待の完全集合(閉世界)。',
      '',
      '対象は access_spec を持つエンティティと、**仕組みが自分で持つ表**(`framework:` を宣言する',
      '内部テーブル)である。後者は列の正が entity_spec ではなく設計図',
      '(legacy/spec-tools/lib/sql/framework-tables.ts)にあるだけで、ビューの形は同じ —— 列を',
      '宣言順に全部並べ、隠し列を持たない。違うのは権限の 1 ビット(surface のロールに何も与えない)',
      'であり、それは `apiViewAcl` の側に出る。',
      '列の正がどこにも無い内部テーブルだけが、ここに現れずに `apiInternalViews` に残る。',
      '',
      '統合テスト(api-parity.test.ts)がこの表と `pg_views` / `information_schema.columns` /',
      `\`pg_proc\`(schema ${schema})を突き合わせ、過不足の両方を検出する。マスク述語の中身そのもの`,
      '(`can_see_{table}_{column}` の定義)は突き合わせない —— それは列の見張りテスト',
      '(guarantees/hidden-columns-masked.test.ts)が実際のロールで読んで確かめる。',
    ]),
    `export const apiViews: Readonly<Record<string, ApiViewExpectation>> = ${frozen(renderLiteral(views))};`,
    '',
    docComment([
      `\`${schema}\` へ移す RPC 関数名の完全集合(閉世界)。`,
      '',
      '全 data_table の `functions` のうち `kind: \'rpc\'` の名前の和集合。`public` から',
      `\`alter function ... set schema ${schema}\` で移設する対象であり、中身(引数・定義)は変えない`,
      '(rpc-parity がそちらを見る)。トリガ関数・ヘルパ(is_member / is_staff)は `public` に残る',
      '(data-table-parity が見る閉世界の対象外)。',
    ]),
    `export const apiRpcFunctions: readonly string[] = ${frozen(renderLiteral(rpcFunctions))};`,
    '',
    docComment([
      `\`${schema}\` スキーマの固定ヘルパ 3 本。仕様からではなく、API スキーマ方式そのものが要求する`,
      '(Supabase 固有点 — 呼び出し主体の解決とセッションの生死 — をこの 3 本に封じる。設計凍結の不変の約束)。',
    ]),
    `export const apiHelpers: readonly string[] = ${frozen(renderLiteral(apiHelperNames(platform)))};`,
    '',
    docComment([
      '土台の 3 本の**定義と権限**(`lib/sql/api-base.ts` が正)。',
      '',
      '`source` は実 DB の `pg_proc.prosrc` に載る字面そのままである —— 突合は md5 で行う',
      '(api-parity.test.ts)。名前の実在だけを見ていると、呼び出し主体の解決が',
      '`select true` のような無条件の式に書き換わっても全部緑になる。そこは隠し列のマスクと',
      'ビューの `security_invoker` が寄りかかっている 1 点である。',
      '`grantees` は `grant execute` の宛先(これ以外のロールは実行できない)。',
    ]),
    'export interface ApiBaseFunction {',
    `  /** 関数名(\`${schema}\` スキーマ。引数なし)。 */`,
    '  readonly name: string;',
    '  /** 戻り値の型。 */',
    '  readonly returns: string;',
    '  /** `pg_proc.prosrc` と一致する定義の字面。 */',
    '  readonly source: string;',
    '  /** 持ち主の権限で実行する関数か(`security definer`。真なら `search_path` が空であることも突き合わせる)。 */',
    '  readonly definer: boolean;',
    '  /** `grant execute` の宛先(閉世界)。 */',
    '  readonly grantees: readonly string[];',
    '}',
    '',
    `export const apiBaseFunctions: readonly ApiBaseFunction[] = ${frozen(renderLiteral(baseFunctions(platform)))};`,
    '',
    docComment([
      `\`${schema}\` にビューを置く**内部テーブル**(data_table の \`internal: true\`)の閉世界。`,
      '',
      'ここは「生成物かどうか」ではなく「**外から完全に消える側かどうか**」の一覧である ——',
      `surface のロール(${readers})に \`select\` を 1 つも与えないビューの全数であり、`,
      `生成物になった表(\`${schema}.jobs\`)も手書きのまま残る表も同じように並ぶ。`,
      '統合テスト(api-parity.test.ts)はこの一覧に対して「`security_invoker = true` である」',
      'ことと「surface のロールから読めない」ことを名指しで確かめる(ACL の閉世界は別に見る)。',
      '',
      'まだ生成物になっていないビューを宣言するのは surface_spec の `hand_written_views` であり、',
      'そこに書けるのは内部テーブルだけである(T12)—— ドメイン仕様に現れる表をここへ',
      '逃がすことはできない(免除リストにしないための線引き)。',
    ]),
    `export const apiInternalViews: readonly string[] = ${frozen(renderLiteral(internalViews))};`,
    '',
    docComment([
      `\`${schema}\` の全ビューの **ACL の全数**(ビュー → ロール → そのロールが持つべき権限)。`,
      '',
      '正は `lib/sql/api-acl.ts` であり、ビューの migration が出す `grant` と**同じ 1 組**から',
      '生まれる。権限を 1 つも持たないロールも空の配列で載る —— 閉世界の突合',
      '(`api-parity.test.ts` が `relacl` を `aclexplode` で開いて読む)は「宣言に無い権限が',
      '静かに付いている」側を落とすためのものであり、片方向では意味が薄い。',
      'ビューの所有者(`postgres`)は載らない(`relacl` に必ず自分への付与として現れる)。',
    ]),
    'export interface ApiViewAcl {',
    '  /** Postgres のロール名。 */',
    '  readonly role: string;',
    '  /** そのビューで持つべき権限の全数(SQL の語。**空 = 1 つも持たない**)。 */',
    '  readonly privileges: readonly string[];',
    '}',
    '',
    `export const apiViewAcl: Readonly<Record<string, readonly ApiViewAcl[]>> = ${frozen(renderLiteral(acl))};`,
    '',
  ].join('\n');
}
