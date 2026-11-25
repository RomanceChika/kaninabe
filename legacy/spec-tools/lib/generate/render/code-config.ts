/**
 * 設定カタログ → 道具側の期待表(`app/src/domain/generated/config.ts`)の生成器。
 *
 * カタログが宣言する「何を設定する必要があり、どう調達するか」を**道具が読める形**に写す。
 * `app/scripts/setup-secrets.mts`(本番の秘密投入)はこれを読むだけで動く —— Discord・LINE の
 * ような**アプリ固有の変数名を道具の側に 1 つも書かない**ための生成物であり、
 * notifications.ts / jobs.ts と同じ流儀(仕様 → 生成物 → 道具)である。
 *
 * 道具が読む最小要素だけを写す(`absence` や `not_in_template_reason` は人間向けの文書であり、
 * 何を聞き・どう投入するかの判断には要らない)。語彙(kind / requirement / used_by /
 * provision)はこのアプリの宣言なので、型も**カタログから生成する**(体系側に語の一覧を持たない)。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { ConfigCatalogSpec, ConfigVocabularyAxis } from '../../model/config/types.js';
import { CONFIG_VOCABULARY_AXES } from '../../model/config/types.js';
import type { LiteralValue } from '../../gen-kit/code-emit.js';
import { generatedFile, docComment, generatedHeader, renderLiteral, toPascalCase, tsString } from '../../gen-kit/code-emit.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 期待表の出力先(リポジトリルート相対)。 */
const outputFile = (roots: ProductRoots): string => generatedFile(roots, 'config.ts');

/** 軸ごとの TS 型名(`used_by` → `ConfigUsedBy`)。 */
function axisTypeName(axis: ConfigVocabularyAxis): string {
  return `Config${toPascalCase(axis)}`;
}

/** 語彙 1 軸をユニオン型として出す。 */
function axisType(catalog: ConfigCatalogSpec, axis: ConfigVocabularyAxis): string[] {
  const terms = catalog.vocabulary[axis];
  const union = terms.length === 0 ? 'never' : terms.map((term) => tsString(term.id)).join(' | ');
  return [
    docComment([`${axis} の語彙(カタログの vocabulary.${axis} が正)。`]),
    `export type ${axisTypeName(axis)} = ${union};`,
    '',
  ];
}

/** 設定 1 件を突合(道具の判断)用のリテラルに写す。 */
function variableLiteral(catalog: ConfigCatalogSpec): LiteralValue {
  return catalog.variables.map((decl) => ({
    id: decl.id,
    kind: decl.kind,
    requirement: decl.requirement,
    usedBy: decl.usedBy,
    provision: decl.provision,
    targets: decl.targets,
    summary: decl.summary,
    absence: decl.absence,
    ...(decl.format === undefined || decl.scheme === undefined ? {} : { format: decl.format, scheme: decl.scheme }),
  }));
}

/** 置き場 1 件を道具用のリテラルに写す(`probe` の形がそのまま道具の手になる)。 */
function targetLiteral(catalog: ConfigCatalogSpec): LiteralValue {
  return catalog.vocabulary.target.map((term) => ({
    id: term.id,
    label: term.label ?? term.id,
    probe: probeLiteral(term.probe),
  }));
}

/** `probe` をリテラルに写す(宣言が無い置き場は K0 が落とすので、ここは形を整えるだけ)。 */
function probeLiteral(probe: ConfigCatalogSpec['vocabulary']['target'][number]['probe']): LiteralValue {
  if (probe === undefined) return { kind: 'dotenv', path: '' };
  if (probe.kind === 'dotenv') return { kind: probe.kind, path: probe.path };
  return { kind: probe.kind, argv: probe.argv, ...(probe.cwd === undefined ? {} : { cwd: probe.cwd }) };
}

/** 置き場と probe の型宣言(道具が `kind` で分岐するための値域)。 */
const PROBE_TYPES: readonly string[] = [
  docComment([
    '置き場の名前を列挙する手。**値を返す形は無い** —— カタログの `probe.kind` が',
    '`dotenv`(ファイルのキー名)と `command`(コマンドの出力に名前が出るか)の 2 語に',
    '閉じているので、道具は名前の有無しか知れない(設計メモ §3-1)。',
  ]),
  'export type ConfigProbe =',
  "  | { readonly kind: 'dotenv'; readonly path: string }",
  "  | { readonly kind: 'command'; readonly argv: readonly string[]; readonly cwd?: string };",
  '',
  docComment(['置き場 1 件の宣言(`config:doctor` がこの順で照合する)。']),
  'export interface ConfigTargetDecl {',
  '  readonly id: ConfigTarget;',
  '  readonly label: string;',
  '  readonly probe: ConfigProbe;',
  '}',
  '',
];

/** 期待表のファイル全体を組み立てる。 */
function renderFile(catalog: ConfigCatalogSpec): string {
  return [
    generatedHeader([catalog.location.file]),
    '',
    ...CONFIG_VOCABULARY_AXES.flatMap((axis) => axisType(catalog, axis)),
    ...PROBE_TYPES,
    docComment([
      '設定 1 件の宣言。道具(`app/scripts/setup-secrets.mts` / `app/scripts/config/`)が',
      '「何を聞くか」「どの置き場を照合するか」「無いときの挙動」を機械的に導出するための',
      '要素を持つ —— `not_in_template_reason` は雛形の免除の宣言であり、道具の判断には要らない',
      'ので人間向けの文書(config.md)の側にしかない。',
    ]),
    'export interface ConfigVariableDecl {',
    '  readonly id: string;',
    '  readonly kind: ConfigKind;',
    '  readonly requirement: ConfigRequirement;',
    '  readonly usedBy: readonly ConfigUsedBy[];',
    '  readonly provision: ConfigProvision;',
    '  readonly targets: readonly ConfigTarget[];',
    '  readonly summary: string;',
    '  readonly absence: string;',
    "  /** 値が URL の行だけが持つ(`format: url`)。読み口は `@kaninabe/runtime/url` の `readConfigUrl` で、`scheme` に合わない値を例外にする。 */",
    "  readonly format?: 'url';",
    "  /** `format: url` の行の許すスキーム(`https` = https だけ / `https_or_loopback` = https に加えて自分の機械への http)。 */",
    "  readonly scheme?: 'https' | 'https_or_loopback';",
    '}',
    '',
    docComment([
      'このシステムが設定する変数の**全数**(閉世界)。',
      '',
      '`setup-secrets.mts` はここから `kind: secret` かつ `requirement` が',
      '`tooling_only` 以外の行を拾って対話で聞く(`provision: generate` の行は道具が',
      '生成して聞かない)。`config:doctor` は `targets` を持つ全行を置き場ごとに照合し、',
      '欠けている組に `absence` を添えて出す。アプリ固有の変数名を道具の側に書き写さない',
      'ための生成物であり、カタログ(docs/specs/backend/config.md)を直せば道具の挙動も',
      'そのまま直る。',
    ]),
    `export const CONFIG_VARIABLES: readonly ConfigVariableDecl[] = ${renderLiteral(variableLiteral(catalog))};`,
    '',
    docComment([
      '置き場の**全数**(閉世界)。`config:doctor` はこの並びのまま列を作る。',
      '',
      'どこを・どう覗くかはカタログの宣言(`vocabulary.target[].probe`)であり、道具は',
      '`kind` ごとの読み方だけを持つ —— 置き場の名前もコマンドの綴りも道具の側に無い。',
    ]),
    `export const CONFIG_TARGETS: readonly ConfigTargetDecl[] = ${renderLiteral(targetLiteral(catalog))};`,
    '',
  ].join('\n');
}

/**
 * 設定カタログから道具側の期待表を生成するジェネレーター。
 * 出力は app/src/domain/generated/config.ts の 1 ファイル(全置換)。
 */
export const configExpectationsGenerator: DocGenerator = {
  id: 'code-config',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const catalog = ctx.config?.catalog;
    if (catalog === undefined || catalog === null) return [];
    return [{ file: outputFile(ctx.roots), content: renderFile(catalog), wholeFile: true }];
  },
};
