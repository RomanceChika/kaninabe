/**
 * 設定カタログ(docs/specs/backend/config.md)の本文ブロックの生成器。
 *
 * YAML フロントマターが正であり、本文はそのマトリクスにすぎない(生成は情報を足さない)。
 * 表は 2 つ出す — **設定の全数**(1 行 = 1 環境変数)と、**何と繋がっているか**
 * (`used_by` の語ごとに変数を束ねた連携の一覧)。後者は同じ宣言を別の軸で見た姿であり、
 * 「Discord のために何を設定するのか」を数え直さずに読めるようにするためにある。
 */

import type { SpecModel } from '../../model/types.js';
import type { DocGenerator, GeneratedSection, GenerateContext } from '../../gen-kit/generator.js';
import type { ConfigCatalogSpec, ConfigVocabularyAxis } from '../../model/config/types.js';
import { CONFIG_VOCABULARY_AXES } from '../../model/config/types.js';
import { cell, markdownTable } from '../../gen-kit/state-machine-table.js';
import { specPath } from '../../model/product/paths.js';
import type { ProductRoots } from '../../model/product/types.js';

/** 差し込み先(リポジトリルート相対)。 */
export function configFile(roots: ProductRoots): string {
  return specPath(roots, 'backend/config.md');
}

/** 軸の見出し(語彙の表に出す日本語)。 */
const AXIS_TITLE: Readonly<Record<ConfigVocabularyAxis, string>> = {
  kind: '値の性質(kind)',
  requirement: '要求度(requirement)',
  used_by: '使う先(used_by)',
  provision: '調達のしかた(provision)',
  target: '置き場(target)',
};

/** 語彙の表(このアプリが宣言した語のカタログ)。 */
function vocabularySection(catalog: ConfigCatalogSpec): string {
  const rows = CONFIG_VOCABULARY_AXES.flatMap((axis) =>
    catalog.vocabulary[axis].map((term) => [
      cell(AXIS_TITLE[axis]),
      cell(`\`${term.id}\``),
      cell(term.label ?? '—'),
    ]),
  );
  return ['### 語彙(このカタログが宣言する値域)', '', markdownTable(['軸', '語', '表示名'], rows)].join('\n');
}

/**
 * 置き場の表(値がどこに要るか・名前をどう数えるか)。
 *
 * `probe` は**名前の列挙しか返せない形**であり、値を返す probe は宣言に書けない。
 * その形をそのまま表に出すことで「道具が値を読まない」ことが宣言から読める。
 */
function targetSection(catalog: ConfigCatalogSpec): string {
  const rows = catalog.vocabulary.target.map((term) => {
    const variables = catalog.variables.filter((decl) => decl.targets.includes(term.id));
    return [
      cell(`\`${term.id}\``),
      cell(term.label ?? '—'),
      cell(probeText(term.probe)),
      cell(term.readBy === undefined ? '—' : `\`${term.readBy.path}\`(${term.readBy.kind})`),
      cell(String(variables.length)),
    ];
  });
  return [
    '### 置き場(値がどこに要るか。`config:doctor` が名前だけを照合する先)',
    '',
    markdownTable(['置き場', '何が読むか', '名前の数え方(probe)', 'リポジトリ側の読み口', '本数'], rows),
  ].join('\n');
}

/** `probe` を 1 行で書き出す(値は取れない形であることが読めるように)。 */
function probeText(probe: ConfigCatalogSpec['vocabulary']['target'][number]['probe']): string {
  if (probe === undefined) return '—';
  if (probe.kind === 'dotenv') return `\`${probe.path}\` のキー名(dotenv)`;
  const where = probe.cwd === undefined ? '' : `(\`${probe.cwd}\` で)`;
  return `${where}\`${probe.argv.join(' ')}\` の出力に名前が出るか(command)`;
}

/** 既定の置き場(`requirement` の語が配る値)。行が `targets` を書かないときはこれを引く。 */
function defaultTargetSection(catalog: ConfigCatalogSpec): string {
  const rows = catalog.vocabulary.requirement.map((term) => [
    cell(`\`${term.id}\``),
    cell(
      term.defaultTargets === undefined
        ? '—(この要求度の行は targets を必ず書く)'
        : term.defaultTargets.map((id) => `\`${id}\``).join(', ') || '(どこにも入れない)',
    ),
  ]);
  return [
    '### 置き場の既定(`targets` を書かない行が引く値)',
    '',
    markdownTable(['要求度', '既定の置き場'], rows),
  ].join('\n');
}

/** 設定の全数(実装の参照・雛形と双方向に閉じている)。 */
function variableSection(catalog: ConfigCatalogSpec): string {
  if (catalog.variables.length === 0) return '### 設定の全数\n\nまだ宣言がありません。';
  const rows = catalog.variables.map((decl) => [
    cell(`\`${decl.id}\``),
    cell(decl.kind),
    cell(decl.requirement),
    cell(decl.usedBy.map((term) => `\`${term}\``).join(', ')),
    cell(decl.provision),
    cell(decl.format === undefined ? '—' : `url(${decl.scheme ?? ''})`),
    cell(decl.targets.map((id) => `\`${id}\``).join(', ') || '—'),
    cell(decl.summary),
    cell(decl.absence),
    cell(decl.notInTemplateReason === undefined ? '○' : `—(${decl.notInTemplateReason})`),
  ]);
  return [
    '### 設定の全数(実装の参照と雛形の両方に双方向で閉じている)',
    '',
    markdownTable(
      [
        '環境変数',
        '値の性質',
        '要求度',
        '使う先',
        '調達',
        '値の書式',
        '置き場',
        '何を制御するか',
        '無いとどうなるか',
        '雛形',
      ],
      rows,
    ),
  ].join('\n');
}

/** 連携の一覧(`used_by` の語ごとに変数を束ねた姿)。 */
function integrationSection(catalog: ConfigCatalogSpec): string {
  const rows = catalog.vocabulary.used_by.map((term) => {
    const variables = catalog.variables.filter((decl) => decl.usedBy.includes(term.id));
    return [
      cell(`\`${term.id}\``),
      cell(term.label ?? '—'),
      cell(variables.map((decl) => `\`${decl.id}\``).join(', ') || '—'),
    ];
  });
  return [
    '### 何と繋がっているか(連携。`used_by` を軸に束ね直した同じ宣言)',
    '',
    markdownTable(['使う先', '何のために', '要る設定'], rows),
  ].join('\n');
}

/**
 * 設定カタログの本文ブロックを生成するジェネレーター。
 * 出力は config.md の `config-body` マーカー 1 か所。
 */
export const configBodyGenerator: DocGenerator = {
  id: 'config-body',

  generate(_model: SpecModel, ctx: GenerateContext): GeneratedSection[] {
    const catalog = ctx.config?.catalog;
    if (catalog === undefined || catalog === null) return [];
    return [
      {
        file: configFile(ctx.roots),
        marker: 'config-body',
        content: [
          vocabularySection(catalog),
          targetSection(catalog),
          defaultTargetSection(catalog),
          variableSection(catalog),
          integrationSection(catalog),
        ].join('\n\n'),
      },
    ];
  },
};
