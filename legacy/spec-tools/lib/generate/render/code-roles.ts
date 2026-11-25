/**
 * role_spec(roles.md)の `kind` 宣言 → グローバルロール対応表(`app/src/domain/generated/roles.ts`)
 * の生成器。
 *
 * 仕組み側のコード(`operation/_template/actor.ts` 等)は「未ログインに対応するロール」
 * 「認証ユーザーの既定ロール」「システムに対応するロール」を**文字列リテラルとして持たない** ——
 * `anonymous` / `member` / `system` のような具体的な語はこのアプリの事情であり、
 * 仕組み側は `kind`(値域)だけを見て、対応するロール ID はこの生成物から引く
 * (dsl-extension-triage.md §軸と語)。
 *
 * 規約どおりファイル I/O はせず、SpecModel から GeneratedSection を返す純粋関数である
 * (scripts-code-quality.md)。
 */

import { ROLE_KINDS, type RoleKind, type SpecModel } from '../../model/types.js';
import { globalRoleId, loginCondition, roleGateTable, roleImplicationTable } from '../../model/role-hierarchy.js';
import type { RowCondition } from '../../model/role-claim.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral, type LiteralValue } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import type { ProductRoots } from '../../model/product/types.js';
import { RUNTIME_PLAN_MODULE } from './runtime-modules.js';

/** 生成物の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'roles.ts');

/**
 * `kind` → 生成物のキー名(仕組み側が引く語)。`_default` の接尾辞を落として短くする
 * (`authenticated_default` → `authenticated`。実行時パッケージの `GlobalRoles` のキー)。
 *
 * @param kind ロールの種別
 * @returns 生成物のキー名
 */
function keyOf(kind: RoleKind): string {
  return kind.replace(/_default$/, '');
}

/**
 * role_spec の `kind` 宣言からグローバルロール対応表を生成するジェネレーター。
 * 出力は `app/src/domain/generated/roles.ts`(全体生成)。
 */
export const globalRolesGenerator: DocGenerator = {
  id: 'code-roles',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    return [{ file: outputFile(ctx.roots), content: renderFile(model), wholeFile: true }];
  },
};

/** `kind` を持つロールが見つからない(検証前・未接地)ときの安全側の値。 */
const UNRESOLVED = '';

/** ファイル全体を組み立てる。 */
function renderFile(model: SpecModel): string {
  const entries: Record<string, LiteralValue> = {};
  for (const kind of ROLE_KINDS) {
    entries[keyOf(kind)] = globalRoleId(model.roles.roles, kind) ?? UNRESOLVED;
  }
  const roleIds: Record<string, string> = {};
  for (const role of model.roles.roles) roleIds[role.id] = role.id;
  const roleLabels: Record<string, string> = {};
  for (const role of model.roles.roles) {
    if (role.label !== undefined) roleLabels[role.id] = role.label;
  }
  const implications: Record<string, LiteralValue> = { ...roleImplicationTable(model.roles.roles) };
  const conditions = conditionLines(model);
  return [
    generatedHeader([model.roles.location.file]),
    '',
    ...(conditions.length === 0 ? [] : [`import type { RunRowCondition } from '${RUNTIME_PLAN_MODULE}';`, '']),
    // ロールの表は認可の先読み・関門・表示名の正なので、値ごと深く凍結する(実行時の書き換えで認可を外させない。9 回目 B9-7)。
    ...DEEP_FREEZE_HELPER,
    '',
    docComment([
      'グローバルロール(role_spec の kind 宣言)→ ロール ID の対応表。',
      '',
      '仕組み側のコードは具体的なロール ID を持たず、この表を経由して引く。',
      '軸(`kind`。未ログイン / 認証ユーザーの既定 / システムの 3 スロット)は仕組みが決め、',
      '語(ロール ID)は roles.md が決める —— ここに載る値はそのアプリの事情である。',
    ]),
    `export const GLOBAL_ROLES = ${frozen(`${renderLiteral(entries)} as const`)};`,
    '',
    docComment([
      '全ロール ID(role_spec の `roles[].id`)の恒等表。',
      '',
      '文脈依存ロール(`binding` を持つロール)は `kind` を持たないため `GLOBAL_ROLES` には',
      '載らないが、仕組み側のコード(ウォーカーのオラクル等)がロール ID を文字列リテラルとして',
      '書かずに済むよう、こちらは全ロールを対象にする(`ROLE_IDS.{ロール ID}` のように',
      'プロパティアクセスで引く)。',
    ]),
    `export const ROLE_IDS = ${frozen(`${renderLiteral(roleIds)} as const`)};`,
    '',
    docComment([
      'ロール ID(`role_spec` の `roles[].id`)→ 人間向けの表示名(`roles[].label`)の対応表。',
      '',
      '`forbidden`(ARCH-BE-0013 のエラー3分類)を人の言葉にする(「この操作は{ロール名}だけが',
      'できます」)ための材料——画面はロール ID をそのまま出す代わりにここを引く。',
      'label を宣言していないロールはキーを持たない(生成物は仕様の写像であり、',
      '無い値を発明しない。呼び側はロール ID へのフォールバックを持つ)。',
    ]),
    `export const ROLE_LABELS = ${frozen(`${renderLiteral(roleLabels)} as const`)};`,
    '',
    docComment([
      'ロール ID → そのロールを持つ主体が**必ず併せ持つ**ロール(`roles[].implies` の推移閉包)。',
      '',
      '実行者に解決されたロールの集合は、この表で閉じてから判断に使う —— `by: [B]` に対して',
      'DB が見るのは `p_actor_roles` の中身だけなので(lib/sql/roles-to-sql.ts)、「A は必ず B である」と',
      '宣言されたロール A の実行者が B を持たずに来ると**DB だけが落とす**。閉包を取る規則は',
      'docs の `lib/model/role-hierarchy.ts` 1 か所にあり、app はその結果であるこの表を読む',
      '(同じ導出を 2 度書かない)。何も含意しないロールはキーを持たない。',
    ]),
    `export const ROLE_IMPLICATIONS: Readonly<Record<string, readonly string[]>> = ${frozen(renderLiteral(implications))};`,
    '',
    ...conditions,
  ].join('\n');
}

/** 条件の 1 つを生成物のリテラルに出せる形にする(`values` が無ければ鍵ごと持たない)。 */
function conditionLiteral(condition: RowCondition): { field: string; values?: string[] } {
  return condition.values === undefined ? { field: condition.field } : { field: condition.field, values: [...condition.values] };
}

/**
 * 行の条件の表(ADR-0018)。**宣言していなければ何も出さない** —— 条件を足していない製品の生成物は 1 バイトも変わらない。
 *
 * - `AUTHENTICATED_WHEN`: 既定のログインロールが立つ実行者の行の条件(`kind: authenticated_default` に併記した `claim`)
 * - `ROLE_GATES`: ロール ID → そのロールが立つために併せて満たす行の条件(`claim` を持つロールを含意する側の、含意の先の条件)
 */
function conditionLines(model: SpecModel): readonly string[] {
  const lines: string[] = [];
  const login = loginCondition(model.roles.roles);
  if (login !== null) {
    lines.push(
      ...docComment([
        '既定のログインロールが立つ実行者の行の条件(`kind: authenticated_default` に併記した `claim`。ADR-0018)。',
        '',
        '行があるだけでは足りず、ログインセッションが運ぶ実行者の行の写しがこの条件を満たすときだけ立つ。',
        '写しは遅れうるので先読みは甘い側に外れうる —— DB の述語が実行者の行を直に読んで必ず落とす。',
      ]).split('\n'),
      `export const AUTHENTICATED_WHEN: RunRowCondition = ${frozen(renderLiteral(conditionLiteral(login)))};`,
      '',
    );
  }
  const gates = roleGateTable(model.roles.roles);
  if (Object.keys(gates).length > 0) {
    const table: Record<string, { field: string; values?: string[] }[]> = {};
    for (const [role, conditions] of Object.entries(gates)) table[role] = conditions.map(conditionLiteral);
    lines.push(
      ...docComment([
        'ロール ID → そのロールが立つために**併せて満たす実行者の行の条件**(ADR-0018 の E2)。',
        '',
        '`claim` を持つロール(行の条件を持つロール)を `implies` している側は、その条件も満たすときだけ立つ。',
        'DB の述語(`自分の根拠 AND 含意の先の行の条件`)の先読みの写しである。',
      ]).split('\n'),
      `export const ROLE_GATES: Readonly<Record<string, readonly RunRowCondition[]>> = ${frozen(renderLiteral(table))};`,
      '',
    );
  }
  return lines;
}
