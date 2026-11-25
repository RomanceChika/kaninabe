/**
 * **製品が実行時パッケージへ渡す宣言の束**(`{生成物の置き場}/runtime-bindings.ts`)の生成器。
 *
 * 実行時パッケージ(`@kaninabe/runtime`)は軸だけを持ち、語を持たない —— ロール ID はその製品の事情
 * であり、仕組み側が直接 import すると**パッケージが利用側の木を読む逆向きの依存**になって
 * 依存として成立しない(ADR-0013 / 設計メモ `docs/design/runtime-package.md` §1-2)。だから
 * **製品が渡す**。渡すものは 1 つの束にまとめる —— 増えても配線の手数が増えず、足し忘れは型で出る。
 *
 * ここが書き出すのは**束そのもの 1 つだけ**である(`runtimeBindings`。実行器が `deps.bindings` で
 * 受ける)。凍った表への参照を持つだけの素のオブジェクトは参照を差し替えられるので、束も `deepFreeze` する(点検 11 回目 A11-2)。表を束ねた口(`globalRole` / `resolveActorRoles`)はここには出さない —— 束ねる相手の
 * `*With` はパッケージの **operation 層**の住人であり、ここで結ぶと「domain がパッケージの
 * operation を import する」向きが生まれて依存ゼロの純粋層という domain の約束が破れる(境界の
 * 要素は層ごとに割れており B8 がこの向きを落とす)。結ぶ場所は呼ぶ側の層、すなわち製品の
 * `operation/shared/actor-roles.ts`(手書きの薄いアダプタ)である。
 *
 * **アプリの語彙は 1 語も無い。** 並ぶのは生成物 `roles.ts` の名前(`GLOBAL_ROLES` /
 * `ROLE_IMPLICATIONS`)だけで、ロール ID そのものはあちらが持つ。
 *
 * 規約どおりファイル I/O はせず、モデルから GeneratedSection を返す純粋関数である。
 */

import type { SpecModel } from '../../model/types.js';
import { loginCondition, roleGateTable } from '../../model/role-hierarchy.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import { DEEP_FREEZE_HELPER, generatedFile, generatedHeader, tsString } from '../../gen-kit/code-emit.js';
import { frozen } from '../../gen-kit/frozen-constants.js';
import type { ProductRoots } from '../../model/product/types.js';
import { specPath } from '../../model/product/paths.js';
import { RUNTIME_BINDINGS_MODULE } from './runtime-modules.js';
import { enforcedMfaScope } from '../../model/auth/mfa.js';
import type { MfaScope } from '../../model/auth/mfa.js';

/** 出力先。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'runtime-bindings.ts');

/**
 * 多要素認証の要求の欄(認証フロー仕様が要求を宣言したときだけ。外す宣言・仕様を持たない製品は欄ごと書かない)。
 *
 * ロール ID は仕様の語のまま書く(`roles.ts` の 3 スロットに入らないロールも要求できるため)。
 */
function mfaLines(scope: MfaScope | null): readonly string[] {
  if (scope === null) return [];
  if (scope.kind === 'all') return ["  mfa: { scope: 'all' },"];
  return [`  mfa: { scope: 'roles', roles: [${scope.roles.map((role) => tsString(role)).join(', ')}] },`];
}

/** 束の中身(行の条件の表は、宣言があるときだけ import して束に渡す。ADR-0018)。 */
function body(model: SpecModel, mfa: MfaScope | null): readonly string[] {
  const names = ['GLOBAL_ROLES', 'ROLE_IMPLICATIONS'];
  const extra: string[] = [];
  if (loginCondition(model.roles.roles) !== null) {
    names.push('AUTHENTICATED_WHEN');
    extra.push('    authenticatedWhen: AUTHENTICATED_WHEN,');
  }
  if (Object.keys(roleGateTable(model.roles.roles)).length > 0) {
    names.push('ROLE_GATES');
    extra.push('    gates: ROLE_GATES,');
  }
  return [
    `import type { RuntimeBindings } from '${RUNTIME_BINDINGS_MODULE}';`,
    `import { ${names.join(', ')} } from './roles';`,
    "import { invariantOfMessage } from './constraint-invariants';",
    '',
    ...DEEP_FREEZE_HELPER,
    '',
    '/**',
    ' * 実行時パッケージへ渡す宣言の束。',
    ' *',
    ' * 配線(Composition Root)が実行器の `deps.bindings` に渡す。実行器はロール ID を 1 つも',
    ' * 持たないので、解決の表はここから受ける。',
    ...(mfa === null ? [] : [' *', ' * `mfa` は認証フロー仕様の多要素認証の要求の写しで、実行器が判断と書き込みの前に見る。']),
    ' */',
    `export const runtimeBindings: RuntimeBindings = ${frozen(
      [
        '{',
        '  roleTables: {',
        '    anonymous: GLOBAL_ROLES.anonymous,',
        '    authenticated: GLOBAL_ROLES.authenticated,',
        '    system: GLOBAL_ROLES.system,',
        '    implications: ROLE_IMPLICATIONS,',
        ...extra,
        '  },',
        '  invariantOfMessage,',
        ...mfaLines(mfa),
        '}',
      ].join('\n'),
    )};`,
    '',
  ];
}

/**
 * 束を生成するジェネレーター。
 *
 * ロールの宣言を持たない仕様(ロールが 1 つも無い製品)では書き出さない —— 渡すものが無い。
 */
export const runtimeBindingsGenerator: DocGenerator = {
  id: 'code-runtime-bindings',

  generate(model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    if (model.roles.roles.length === 0) return [];
    const mfa = enforcedMfaScope(ctx.auth?.flow?.mfa);
    const sources = [specPath(ctx.roots, 'domain/roles.md') ?? 'domain/roles.md'];
    const authFile = ctx.auth?.flow?.location.file;
    const content = [
      generatedHeader(mfa === null || authFile === undefined ? sources : [...sources, authFile]),
      '',
      ...body(model, mfa),
    ].join('\n');
    return [{ file: outputFile(ctx.roots), content, wholeFile: true }];
  },
};
