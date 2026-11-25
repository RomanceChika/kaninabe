/**
 * access_spec の `reads` → 期待 RLS ポリシー表(`app/src/domain/generated/rls-expectations.ts`)
 * の生成器。
 *
 * RLS(第二防衛線)は「アプリを迂回しても仕様外のことが起きない」を DB で保証する層であり、
 * その正はドメイン仕様の `reads` にある。専用の doc_type は作らず、access_spec から
 * 「存在すべき select ポリシー名の完全集合」を生成して、統合テストが `pg_policies` と
 * 突き合わせる方式を採る(2026-08-18 の Phase B 設計)。
 *
 * **計画そのものは `lib/world/rls-plan.ts` が作る。** 名前の規約・刈り込みの規則・宛先ロールは
 * ポリシーの**本文**の生成器(`code-rls-policies`)と同じ 1 つの関数から出る —— 束 ⑳-4a まで
 * ここが独自に名前を作っていたが、名前と本文で別の刈り込みをする余地を残さないためである。
 *
 * 生成する名前の規約(正は ARCH-SP-BE-0001 §RLS の仕様をどこに置くか):
 *   `{table}_select_{role}_{scope}`   scope は own / context / all
 *   - `reads[].filters`(実行者の属性で狭める境界。テナント)があれば `_within_{列}` を宣言順に足す
 *   - `scope: none` は名前を作らない(= そのロールのポリシーは存在してはならない)
 *   - `system` は RLS の対象外(service_role がバイパスする)なので除外する
 *   - **包含による刈り込み**: 同じテーブルに `scope: all` の行があり、その行のロールを
 *     `implies`(ロール階層)で含意するロールの own / context 行は名前を作らない
 *   - 集合は**閉世界**として扱う。ここに無い select ポリシーが DB にあれば、それは仕様に
 *     無い可視性であり、突合テストが落ちる
 *
 * **この表が守るのは「宣言の過不足」だけである。** ポリシーの `USING` 句が仕様どおりかは
 * 同じファイルが出す `rlsPolicyMigrations` / `rlsHelperMigrations`(生成 SQL の在処)を使って
 * `policy-parity` が**意味で**突き合わせる(束 ⑳-4a。生成ファイルをトランザクションで適用して
 * `pg_policies` を読み直し、実 DB のものと比べる)。ARCH-SP-BE-0001 の RLS 節を参照。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import type { AccessSpec, SpecModel } from '../../model/types.js';
import type { DataTableSpec } from '../../model/data/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { boundaryHelperFields, boundaryHelperName, helperName, helperRoles, policyPlans, readPlans, sessionPolicyName } from '../../world/index.js';
import { pluralizeEntity } from '../../model/table-name.js';
import { privilegedRole } from '../../sql/platform-sql.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import type { ProductRoots } from '../../model/product/types.js';

// 複数形化の規則の実体は lib/model/table-name.ts へ移した(T1 と共有するため)。
// 既存の参照(テスト)のためにここからも公開する。
export { pluralizeEntity } from '../../model/table-name.js';

/** 期待ポリシー表の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'rls-expectations.ts');

/**
 * 全 access_spec の `reads` から期待 select ポリシー名の表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/rls-expectations.ts`(ドメイン全体で 1 ファイル・全体生成)。
 */
export const rlsExpectationsGenerator: DocGenerator = {
  id: 'code-rls-expectations',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const accesses = [...model.aggregates.values()]
      .map((specs) => specs.access)
      .filter((access): access is AccessSpec => access !== undefined);
    if (accesses.length === 0) return [];

    const tables = buildTableNames(model);
    const table: Record<string, readonly string[]> = {};
    const conditions: Record<string, string> = {};
    const needed = new Set<string>();
    const neededFields = new Set<string>();
    for (const access of accesses) {
      const name = tables.get(access.entity) ?? pluralizeEntity(access.entity);
      const plans = policyPlans(access, name, model.roles.roles);
      // 許可ポリシーの全数に、ログインセッションの生死を要求する制限ポリシー(表ごとに 1 本)を足す。
      table[name] = [...plans.map((plan) => plan.name), sessionPolicyName(name)];
      for (const plan of plans) {
        if (plan.when !== null) conditions[plan.name] = plan.when;
      }
      for (const role of helperRoles(plans, model.roles.roles)) needed.add(role);
      for (const field of boundaryHelperFields(readPlans(access, name, model.roles.roles))) neededFields.add(field);
    }

    return [
      {
        file: outputFile(ctx.roots),
        content: renderFile({
          table,
          conditions,
          specFiles: accesses.map((access) => access.location.file),
          withFilters: hasFilters(accesses),
          policies: policyMigrations(ctx.dataTables?.tables ?? [], table),
          helpers: helperMigrations(ctx.dataTables?.tables ?? [], { roles: needed, fields: neededFields }),
          privilegedRole: privilegedRole(ctx.platform),
        }),
        wholeFile: true,
      },
    ];
  },
};

/**
 * エンティティ名 → テーブル名の対応を作る。
 * entity_spec に `table:` の宣言があればそれが正、無ければ複数形化の規則で導く。
 */
function buildTableNames(model: SpecModel): ReadonlyMap<string, string> {
  const tables = new Map<string, string>();
  for (const specs of model.aggregates.values()) {
    const entity = specs.entity;
    if (entity === undefined) continue;
    tables.set(entity.entity, entity.table ?? pluralizeEntity(entity.entity));
  }
  return tables;
}

/**
 * 表名 → ポリシーを生成する migration のファイル名(宣言がある表だけ)。
 *
 * @param tables 全 data_table
 * @param expectations 期待表(キーが突合の対象になる表名)
 * @returns 表名 → ファイル名
 */
function policyMigrations(
  tables: readonly DataTableSpec[],
  expectations: Readonly<Record<string, readonly string[]>>,
): Readonly<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const table of tables) {
    if (table.policiesMigration === undefined || expectations[table.table] === undefined) continue;
    found[table.table] = table.policiesMigration;
  }
  return found;
}

/**
 * 補助関数名 → その本文を生成する migration のファイル名(ポリシーが要求するものだけ)。
 *
 * 役の補助関数(`is_{role}`)と境界の補助関数(`actor_{欄}`)の両方を載せる —— どちらも
 * 宣言から本文が決まる生成物であり、実 DB の定義と同じ突合(policy-parity)に掛ける。
 *
 * @param tables 全 data_table
 * @param needed ポリシーが要求するロールと、境界が要求する実行者の欄
 * @returns 関数名 → ファイル名
 */
function helperMigrations(
  tables: readonly DataTableSpec[],
  needed: { readonly roles: ReadonlySet<string>; readonly fields: ReadonlySet<string> },
): Readonly<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const table of tables) {
    for (const fn of table.functions) {
      if (fn.kind !== 'helper' || fn.migration === undefined) continue;
      if (fn.role !== undefined && needed.roles.has(fn.role)) found[helperName(fn.role)] = fn.migration;
      if (fn.actorField !== undefined && needed.fields.has(fn.actorField)) {
        found[boundaryHelperName(fn.actorField)] = fn.migration;
      }
    }
  }
  return found;
}

/** どれか 1 つでも実行者の属性で狭める境界(テナント)を宣言しているか。 */
function hasFilters(accesses: readonly AccessSpec[]): boolean {
  return accesses.some((access) => access.reads.some((rule) => (rule.filters ?? []).length > 0));
}

/** 期待ポリシー表のファイルに載せるもの。 */
interface ExpectationsFile {
  /** テーブル名 → 期待ポリシー名。 */
  readonly table: Readonly<Record<string, readonly string[]>>;
  /** ポリシー名 → そのポリシーが持つ状態の条件(`reads[].when`。持つものだけ)。 */
  readonly conditions: Readonly<Record<string, string>>;
  /** 正になる仕様ファイル。 */
  readonly specFiles: readonly string[];
  /** 実行者の属性で狭める境界を 1 つでも宣言しているか。 */
  readonly withFilters: boolean;
  /** テーブル名 → ポリシーの生成 migration。 */
  readonly policies: Readonly<Record<string, string>>;
  /** 補助関数名 → その本文の生成 migration。 */
  readonly helpers: Readonly<Record<string, string>>;
  /** 内部実行(`system`)にあたる DB のロール名(文面に出る。プラットフォームの設定が決める)。 */
  readonly privilegedRole: string;
}

/**
 * 期待ポリシー表のファイル全体を組み立てる。
 *
 * `_within_{列}` の説明は**境界を宣言しているシステムにだけ**出す —— 生成物は、そのシステムに
 * 実際に現れる形だけを説明する(使っていない語彙の説明が並ぶと、読む人は「これは何だ」と
 * 仕様を探しに行く)。
 *
 * @param file 期待表・正の仕様ファイル・生成 SQL の在処
 * @returns ファイルの全文
 */
function renderFile(file: ExpectationsFile): string {
  return [
    generatedHeader(file.specFiles),
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([
      'テーブルごとの「存在すべき select ポリシー名」の完全集合(閉世界)。',
      '',
      '名前の規約は `{table}_select_{role}_{scope}`(scope は own / context / all)。',
      '加えて、全ての表に制限ポリシー `{table}_session_alive`(ログインセッションの生死を要求する。許可ポリシー全部と論理積)が 1 本ある。',
      ...(file.withFilters
        ? ['reads[].filters(実行者の属性で狭める境界。テナント)があれば `_within_{列}`(親の列なら `_within_{集約}_{列}`)が付く。']
        : []),
      'access_spec の reads で scope: none のロールは名前を持たない(= ポリシーが存在しないことが期待)。',
      `system(${file.privilegedRole})は RLS をバイパスするため対象外。`,
      'scope: all のロールを implies で含意するロールの own / context は、行集合として冗長なので刈り込む。',
      '',
      '統合テストがこの表と pg_policies を突き合わせ、過不足の両方を検出する。',
      'USING 句が仕様どおりかは下の生成 SQL の在処を使って**意味で**突き合わせる。',
    ]),
    `export const rlsSelectExpectations = ${frozen(`${renderLiteral(file.table)} as const`)};`,
    '',
    docComment([
      '同じ表を「テーブル名で引ける形」にしたもの。',
      '',
      '中身は上の定数と同一で、型だけが広い。突合テストはテーブル名を変数で回すため、',
      'リテラル型のままだと呼び出し側でキャストが要る(キャストは型検査を切る操作なので',
      '生成物の側で吸収する)。',
    ]),
    'export const rlsSelectExpectationsByTable: Readonly<Record<string, readonly string[]>> =',
    '  rlsSelectExpectations;',
    '',
    docComment([
      'テーブル名 → そのテーブルの select ポリシー全数を生成した migration のファイル名。',
      '',
      '突合テストはこのファイルを**トランザクションの中で適用して** pg_policies を読み直し、',
      '実 DB のポリシーと qual / roles / cmd を比べて rollback する(正規化は Postgres がやる)。',
      '名前の突合だけでは `..._within_{列}` という名前の `using (true)` が素通りする。',
    ]),
    `export const rlsPolicyMigrations: Readonly<Record<string, string>> = ${frozen(renderLiteral(file.policies))};`,
    '',
    docComment([
      'RLS 補助関数の名前 → その定義を生成した migration のファイル名。',
      '',
      'グローバルに立つロールの根拠(実行者の集約に行がある / その行の欄が真)は、ポリシーの',
      '中から直に書くと実行者の集約のポリシーで再帰するので security definer の関数に逃がす。',
      '関数の定義もロールの宣言から決まるので生成物であり、実 DB の定義と突き合わせる。',
      ...(file.withFilters
        ? [
            '境界(reads[].filters)の右辺の値を実行者自身の行から読む `actor_{欄}` も同じ扱いである',
            '(値の正は実行者の行であり、トークンの属性の写しではない)。',
          ]
        : []),
    ]),
    `export const rlsHelperMigrations: Readonly<Record<string, string>> = ${frozen(renderLiteral(file.helpers))};`,
    '',
    docComment([
      'select ポリシー名 → そのポリシーが持つ**行の状態の条件**(access_spec の reads[].when)。',
      '',
      '条件はポリシー名に出ない(名前に畳めるのは列の名前のような短い語だけで、式ではない)。',
      'それでも**宣言としてここに出す**のは、意味の差分(spec:diff)が「可視性が状態で狭まった /',
      '絞りが外れた」を 1 行で言えるようにするためである —— 名前の出入りだけを見ていると、',
      '条件を落とした変更が「ポリシーを書き出した migration が入れ替わった」としか出ない。',
      '',
      '**述語そのものはここに無い**(SQL は生成 migration が正であり、実 DB との突合は',
      'policy-parity が行う)。ここにあるのは仕様に書かれた式の字面だけである。',
    ]),
    `export const rlsPolicyConditions: Readonly<Record<string, string>> = ${frozen(renderLiteral(file.conditions))};`,
    '',
  ].join('\n');
}
