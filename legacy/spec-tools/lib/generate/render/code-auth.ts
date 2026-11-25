/**
 * 認証フロー仕様 → 実装側の期待表(`app/src/domain/generated/auth.ts`)の生成器。
 *
 * 3 つを写す。
 *   - `SIGN_IN_BRANCHES` … サインインの決定表。app 側のユニットテストが**この表を回して**
 *     `syncMembershipOnSignIn` を駆動し、宣言した着地と実行する操作に一致するかを確かめる。
 *     行が 1 つ増えれば、テストは何も書き足さずにその状況を試す(仕様が増えると検査も増える)。
 *   - `AUTH_LANDING_PATHS` … 着地 ID → 送り先のパス。OAuth コールバックの Route Handler が
 *     **これを import して**リダイレクト先に使う。実装側に着地先の対応表を手で持たない
 *     (持つと仕様と実装が別々に正として並ぶ)。
 *   - `AUTH_ENTRY_PATHS` … 認証の口(帰り道・開始・ログアウト)のパス。ログインとログアウトのフォームの送り先。
 *   - `AUTH_MFA_PATH` … 多要素認証を済ませていない人の送り先(`mfa.to` の画面の route)。**要求を宣言したときだけ**書く。
 *     画面の関門(`mfa.implementation`)と、書き込みの入口が返す `forbidden` の印(`mfaRequired`)を受けた画面が同じ送り先を使う。
 *
 * 着地先のパスは画面仕様の `route` から引く。認証フロー仕様は画面の id しか宣言しておらず、
 * URL は画面の側の事実である(2 か所に書かない)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { AuthAxisDecl, AuthFlowSpec } from '../../model/auth/types.js';
import { GATE_SUBJECTS, subjectAxis } from '../../model/auth/types.js';
import type { ScreenSpecModel } from '../../model/screen/types.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { DEEP_FREEZE_HELPER, generatedFile, docComment, generatedHeader, renderLiteral, tsString } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import type { ProductRoots } from '../../model/product/types.js';
import { CORE_REQUIRED_BASE_DIRS } from '../../model/framework-dirs.js';
import { placedBaseDir } from '../layout-placement.js';
import type { SourceLocation } from '../../kernel/source-location.js';
import type { ProductLayout } from '../../model/product/layout.js';

/** 期待表の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'auth.ts');

/** 宣言した認証の口のパス(宣言順。宣言の無い口は鍵ごと持たない)。 */
function entryPaths(flow: AuthFlowSpec): LiteralValue {
  const paths: Record<string, string> = {};
  for (const [key, decl] of [['callback', flow.callback], ['start', flow.start], ['logout', flow.logout]] as const) {
    if (decl !== undefined) paths[key] = decl.endpoint;
  }
  return paths;
}

/**
 * 分岐 1 行を突合用のリテラルに写す(summary は人間向けなので写さない)。
 *
 * 軸の欄は**宣言順**に並べる —— 体系側は軸の名前を 1 つも知らないので、鍵は `axes[].id` から
 * 来る(かつては `member` / `invitation` / `guild` / `activate` の 4 つを固定で写していた)。
 */
function branchLiteral(flow: AuthFlowSpec): LiteralValue {
  return flow.branches.map((branch) => {
    const values: Record<string, string> = {};
    for (const axis of flow.axes) {
      const value = branch.values[axis.id];
      if (value !== undefined) values[axis.id] = value;
    }
    return { id: branch.id, ...values, runs: branch.runs, lands: branch.lands };
  });
}

/** 軸 ID(スネークケース)を型名の一部(パスカルケース)にする。 */
function pascal(id: string): string {
  return id
    .split('_')
    .map((part) => (part === '' ? '' : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`))
    .join('');
}

/** その軸の値の型名(`kind: enum` の軸だけがユニオン型を持つ)。 */
function axisTypeName(axis: AuthAxisDecl): string {
  return `SignIn${pascal(axis.id)}`;
}

/** その軸が全行で必須か(`when` / `optional` のどちらも宣言していない軸)。 */
function isRequiredAxis(axis: AuthAxisDecl): boolean {
  return axis.when === undefined && axis.optional !== true;
}

/** 軸の doc コメント(表示の文言は仕様の `summary` が正)。 */
function axisComment(axis: AuthAxisDecl): string {
  const scope = isRequiredAxis(axis)
    ? '全行が持つ'
    : axis.when === undefined
      ? '行ごとに任意'
      : `${axis.when.axis}: ${axis.when.value} の行だけが持つ`;
  return `${axis.summary}(${scope}。値は auth.md の axes.${axis.id} が正)。`;
}

/** `SignInBranch` の軸の欄(宣言順。主語の軸は string、enum の軸はユニオン型)。 */
function axisFields(flow: AuthFlowSpec): string[] {
  const subject = subjectAxis(flow);
  return flow.axes.map((axis) => {
    const type = axis.id === subject?.id ? 'string' : axisTypeName(axis);
    const optional = isRequiredAxis(axis) ? '' : '?';
    return `  readonly ${axis.id}${optional}: ${type};`;
  });
}

/** 着地 ID → 送り先パスの対応(画面仕様の route から引く)。 */
function landingPaths(flow: AuthFlowSpec, screens: ScreenSpecModel | undefined): LiteralValue {
  const routes = new Map((screens?.screens ?? []).map((screen) => [screen.id, screen.route]));
  const entries: Record<string, string> = {};
  for (const landing of flow.landings) entries[landing.id] = routes.get(landing.screen) ?? '';
  return entries;
}

/**
 * 関門(`gates`)1 件を突合用のリテラルに写す(summary は人間向けなので写さない)。
 *
 * `implementation`(`パス::関数名`)を分解して持つのは、screenTest 側の静的走査
 * (`app/src/app/__screens__/gate-implementation.test.ts`)が呼び出しの有無を
 * ファイル内容の grep で見るためで、分解の規則を仕様の外にもう一度書かせないためである。
 */
function gateLiteral(flow: AuthFlowSpec): LiteralValue {
  return flow.gates.map((gate) => {
    const [file, symbol] = gate.implementation.split('::');
    return {
      id: gate.id,
      guards: gate.guards,
      ...(gate.role === undefined ? {} : { role: gate.role }),
      implementation: { file: file ?? '', symbol: symbol ?? '' },
    };
  });
}

/**
 * 実装との突合の 1 文(実装の木を宣言していない製品では置き場を示さない)。
 * 実装の木があるのに配置が突合テストの置き場(操作の層のテスト支援の土台)を宣言していなければ、黙って行を消さず前提の失敗で止める(配置の定義の検査が先に止める)。
 *
 * @param roots 製品が宣言した根
 * @param layout 置き場の配置(操作の層のテスト支援の土台 = 突合テストの置き場の宣言元)
 * @param location 認証フロー仕様の位置(置き場を決められないときに指す)
 * @returns doc コメントに足す行(実装の木が無ければ「H1 が見る」までで閉じる)
 */
function syncNote(roots: ProductRoots, layout: ProductLayout, location: SourceLocation): readonly string[] {
  if (roots.app === null) return ['(verify の H1 が見る)。'];
  const base = CORE_REQUIRED_BASE_DIRS.operationTests;
  const support = placedBaseDir(layout, roots, { layer: base.layer, dir: base.dir, what: '認証の期待表の突合テスト', location });
  return ['(verify の H1 が見る)。実装との突合は', `${support}/shared/sign-in-sync.test.ts がこの表を回して行う。`];
}

/** 多要素認証の送り先のパスの宣言(要求の宣言が無ければ空)。 */
function mfaPathLines(flow: AuthFlowSpec, screens: ScreenSpecModel | undefined): readonly string[] {
  const mfa = flow.mfa;
  if (mfa?.kind !== 'require') return [];
  const route = (screens?.screens ?? []).find((screen) => screen.id === mfa.to)?.route ?? '';
  return [
    docComment([
      '多要素認証を済ませていない人の送り先のパス(`mfa.to` の画面の route が正)。',
      '',
      '画面の関門と、書き込みの入口が返す `forbidden` の `mfaRequired` を受けた画面が、同じここへ送る。',
    ]),
    `export const AUTH_MFA_PATH = ${tsString(route)};`,
    '',
  ];
}

/** ユニオン型 1 本(値域の語をそのまま写す)。 */
function unionType(name: string, values: readonly string[], comment: string): string[] {
  const union = values.length === 0 ? 'never' : values.map((value) => tsString(value)).join(' | ');
  return [docComment([comment]), `export type ${name} = ${union};`, ''];
}

/** 期待表のファイル全体を組み立てる。 */
function renderFile(flow: AuthFlowSpec, screens: ScreenSpecModel | undefined, roots: ProductRoots, layout: ProductLayout): string {
  const landingIds = flow.landings.map((landing) => landing.id);
  const subject = subjectAxis(flow);
  const enumAxes = flow.axes.filter((axis) => axis.id !== subject?.id);
  return [
    generatedHeader([flow.location.file]),
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    ...unionType('SignInLanding', landingIds, 'サインインの着地(結末)。実装が返す着地先の語と同じ。'),
    ...enumAxes.flatMap((axis) => unionType(axisTypeName(axis), axis.values ?? [], axisComment(axis))),
    docComment([
      'サインインの分岐 1 行(決定表の 1 行)。',
      '',
      `\`${subject?.id ?? '主語'}\` は${subject?.summary ?? '主語の状態'}(行が無ければ \`${subject?.absent ?? ''}\`)。`,
      '条件が揃えば結末(`lands`)と実行する操作(`runs`)は一意に決まる。',
    ]),
    'export interface SignInBranch {',
    '  readonly id: string;',
    ...axisFields(flow),
    '  readonly runs: readonly string[];',
    '  readonly lands: SignInLanding;',
    '}',
    '',
    docComment([
      'サインインしたときに起きることの**全数**(閉世界)。',
      '',
      `ここに無い状況で着地先が決まることはなく、主語(${subject?.summary ?? '主語の状態'})は全数が尽くされている`,
      // 実装との突合を示せるのは実装の木を宣言した製品だけである(空パスを書かない)。
      ...syncNote(roots, layout, flow.location),
    ]),
    `export const SIGN_IN_BRANCHES: readonly SignInBranch[] = ${frozen(renderLiteral(branchLiteral(flow)))};`,
    '',
    docComment([
      '着地 ID → 送り先のパス(画面仕様の route が正)。',
      '',
      'OAuth コールバックの Route Handler がリダイレクト先に使う。',
    ]),
    `export const AUTH_LANDING_PATHS: Readonly<Record<SignInLanding, string>> = ${frozen(renderLiteral(landingPaths(flow, screens)))};`,
    '',
    docComment([
      '認証の口のパス(`callback` / `start` / `logout` の宣言が正。宣言した口だけを持つ)。',
      '',
      'ログインとログアウトのボタンのフォームが送り先に使う(ブラウザは認証基盤に直接つながない)。',
    ]),
    `export const AUTH_ENTRY_PATHS = ${frozen(`${renderLiteral(entryPaths(flow))} as const`)};`,
    '',
    ...mfaPathLines(flow, screens),
    ...unionType(
      'AuthGateSubject',
      GATE_SUBJECTS,
      '関門が守る対象(画面仕様のどの宣言が関門を呼ぶか)。screen_spec 側の対応は H4 が見る。',
    ),
    docComment([
      '画面に入るときの関門 1 件。実装の呼び出し(`requireSession` / `requireStaff`)を',
      '`パス::関数名` から分解して持つ(screenTest の静的走査がここを読む)。',
      '`role` は `guards: role_gate` のときだけ持つ、画面仕様の `for: [...]` が見るロール ID。',
    ]),
    'export interface AuthGateExpectation {',
    '  readonly id: string;',
    '  readonly guards: AuthGateSubject;',
    '  readonly role?: string;',
    '  readonly implementation: { readonly file: string; readonly symbol: string };',
    '}',
    '',
    docComment([
      '関門の全数(`gates` の写し)。',
      '',
      'screenTest(`app/src/app/__screens__/gate-implementation.test.ts`)が、',
      '`guards` に対応する画面(`screenRoutes` の `requiresAuth` / `forRoles`)の',
      '実装ファイルにこの `implementation.symbol` が呼ばれているかを走査する',
      '(H2 が見る「関門の実装が実在するか」の延長線 — H2 は実在まで、こちらは呼び出しまで)。',
    ]),
    `export const AUTH_GATES: readonly AuthGateExpectation[] = ${frozen(renderLiteral(gateLiteral(flow)))};`,
    '',
  ].join('\n');
}

/**
 * 認証フロー仕様から実装側の期待表を生成するジェネレーター。
 * 出力は app/src/domain/generated/auth.ts の 1 ファイル(全置換)。
 */
export const authExpectationsGenerator: DocGenerator = {
  id: 'code-auth',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const flow = ctx.auth?.flow;
    if (flow === undefined || flow === null) return [];
    return [{ file: outputFile(ctx.roots), content: renderFile(flow, ctx.screens, ctx.roots, ctx.layout), wholeFile: true }];
  },
};
