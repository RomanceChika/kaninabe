/**
 * 「何を設定すると何が変わるか(設定と連携)」の章の HTML 版。
 *
 * 中身は `config-lower.ts` / `config-crypto.ts` の行と語で、骨格は `layer-chapter.ts`。
 * 上段は設定 1 本 = 1 行と、値の性質の語・要求度の語の宣言。連携・置き場・実装と雛形との対応・暗号の目録・ログの目録は下段に畳む。
 * **値そのものはどこにも出さない**(出すのは名前・性質・要求度・挙動だけ)。
 *
 * 下段の表の行は共有の行(`config-lower.ts` の `configLowerRows`・`config-crypto.ts` の `cryptoInventoryRows`)をそのまま使い、セルの中の `` `識別子` `` だけを等幅の字にする
 * (行の正を 2 つに分けない。セルの文字列は出力の口が逃がすので、記法として読むのはバッククォートだけ)。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import type { ConfigCatalogSpec, ConfigTermDecl, ConfigVariableDecl } from '../../../../model/config/types.js';
import { acceptCounts, acceptItems } from '../../../../semantics/reading-load.js';
import { configUnits, type LayerUnit } from '../../../../semantics/reading-layers.js';
import { collectSigns } from '../../../prose.js';
import { configFile } from '../../config-body.js';
import { configLowerTables, termLabels } from '../config-lower.js';
import { bearerPlacesOf } from '../config-crypto.js';
import { pendingFindings, pendingOfChapter } from '../finding-placement.js';
import { splitExamples } from '../prose-example.js';
import { bookLayout } from '../face-scope.js';
import { specRelative } from '../face-sign.js';
import { bold, dash, fold, inline, kv, mono, pts, valueOf } from './face-parts.js';
import { axiomRow, items, layerChapter, type Outline } from './layer-chapter.js';
import { el, join, type Child, type Html } from './markup.js';
import { table, type ChapterBody } from './chapter-parts.js';

/** 章の題。 */
export const CONFIG_TITLE = '何を設定すると何が変わるか(設定と連携)';

/** 共有の表のセル(`config-lower.ts`)を HTML にする(`inline` の別名)。 */
export const tableCell = inline;

/** 語の表示(表示名 + 内部名)。 */
function named(label: string | undefined, id: string): Html {
  return label === undefined ? mono(id) : join([`${label} `, mono(id)]);
}

/** 設定 1 本の行。値は出さない。 */
function variableRow(decl: ConfigVariableDecl, unit: LayerUnit, labels: ReadonlyMap<string, string>): Html {
  const summary = splitExamples(decl.summary);
  const absence = splitExamples(decl.absence);
  const examples = [...summary.examples, ...absence.examples];
  return axiomRow(
    mono(decl.id),
    [
      kv('決まること', summary.body),
      kv('例外', `未設定のとき: ${absence.body}`),
      examples.length === 0 ? null : kv('例', valueOf(examples)),
      kv(
        '仕様の語',
        valueOf([
          join(['値の性質 ', named(labels.get(`kind:${decl.kind}`), decl.kind)]),
          join(['要求度 ', named(labels.get(`requirement:${decl.requirement}`), decl.requirement)]),
        ]),
      ),
    ],
    unit.elements,
  );
}

/** 設定の行を、要求度の語ごとにまとめて並べる。 */
function variableRows(catalog: ConfigCatalogSpec, units: ReadonlyMap<string, LayerUnit>, labels: ReadonlyMap<string, string>): Child[] {
  const order = [...new Set([...catalog.vocabulary.requirement.map((term) => term.id), ...catalog.variables.map((decl) => decl.requirement)])];
  return order.flatMap((requirement) => {
    const group = catalog.variables.filter((decl) => decl.requirement === requirement);
    if (group.length === 0) return [];
    return [
      el('p', { class: 'bf-group' }, labels.get(`requirement:${requirement}`) ?? requirement, el('small', null, `${requirement} · ${group.length} 本`)),
      ...group.map((decl) => {
        const unit = units.get(decl.id);
        return unit === undefined ? null : variableRow(decl, unit, labels);
      }),
    ];
  });
}

/** 語の行。 */
function termRow(axis: 'kind' | 'requirement', term: ConfigTermDecl, unit: LayerUnit, catalog: ConfigCatalogSpec): Html {
  const using = catalog.variables.filter((decl) => decl[axis] === term.id).length;
  return axiomRow(
    mono(term.id),
    [kv('決まること', term.label === undefined ? dash() : term.label), kv('補足', `この語を選んでいる設定は ${using} 本`)],
    unit.elements,
    `${axis}-${term.id}`,
  );
}

/** 値の性質の語と要求度の語の宣言。 */
function vocabulary(catalog: ConfigCatalogSpec, units: readonly LayerUnit[], outline: Outline): Child[] {
  const unitOf = new Map(units.filter((unit) => unit.kind === 'vocabulary').map((unit) => [unit.id, unit] as const));
  const rows = (axis: 'kind' | 'requirement', title: string): Child[] => [
    el('p', { class: 'bf-group' }, title, el('small', null, `${catalog.vocabulary[axis].length} 語`)),
    ...catalog.vocabulary[axis].map((term) => {
      const unit = unitOf.get(`${axis}:${term.id}`);
      return unit === undefined ? null : termRow(axis, term, unit, catalog);
    }),
  ];
  return [
    outline.h3('vocabulary', `値の性質と要求度の語(${catalog.vocabulary.kind.length + catalog.vocabulary.requirement.length})`),
    pts(
      [
        '設定の値の性質と要求度は、ここで宣言した語から選ぶ',
        '値の性質は、公開してよいか、漏れたら作り直しが要るかを決める',
        '要求度は、無いと止まるか、縮退して動くかを決める',
        '語の意味は、このアプリの事情として、仕様が宣言する。人が判定する',
        '機械が保証するのは、行が語を選んでいることだけ',
      ],
      true,
    ),
    ...rows('kind', '値の性質の語'),
    ...rows('requirement', '要求度の語'),
  ];
}

/**
 * 設定の章の本文と目次。設定カタログが読めていなければ、その旨の 1 行だけ。
 *
 * @param countKey 章の数の鍵(`chapters.ts` の章のファイル)
 * @param file 書き出すファイル(リポジトリルート相対)
 */
export function configChapter(model: SpecModel, ctx: GenerateContext, catalog: ConfigCatalogSpec | null, countKey: string, file: string): ChapterBody {
  if (catalog === null) {
    return {
      body: join([el('h1', null, CONFIG_TITLE), el('p', null, 'まだ設定カタログを読めていない(スキーマエラーを直すと、ここに一覧が生成される)。')]),
      headings: [],
    };
  }
  const units = configUnits(catalog);
  const declarations = new Map(units.filter((unit) => unit.kind === 'declaration').map((unit) => [unit.id, unit] as const));
  const labels = termLabels(catalog);
  const specFile = configFile(ctx.roots);
  const all = pendingFindings(ctx);
  const accepted = acceptItems(acceptCounts([], [], [], [], [], catalog.variables)).filter((item) => item.file === specFile);
  const kinds = catalog.vocabulary.kind.length;
  const requirements = catalog.vocabulary.requirement.length;
  const tables = configLowerTables(catalog, {
    external: ctx.external?.catalog,
    sessionToken: ctx.platform.sessionToken,
    bearerPlaces: bearerPlacesOf(model),
  });
  const lower = tables.map((entry) =>
    fold(
      entry.fold,
      entry.rows.length === 0
        ? []
        : [
            entry.note === undefined ? null : el('p', null, tableCell(entry.note)),
            table(
              entry.headers,
              entry.rows.map((row) => row.map(tableCell)),
            ),
          ],
    ),
  );
  const count = tables.reduce((sum, entry) => sum + entry.rows.length, 0);
  return layerChapter(model, ctx, {
    title: CONFIG_TITLE,
    countKey,
    file,
    crumb: {
      layer: '設定の章',
      count: `設定は ${catalog.variables.length} 本`,
    },
    intro: [
      'このシステムが外部と繋がるための設定は、この一覧に載っているものが全部',
      '各行は、設定しなかったらどうなるかまで宣言する',
      '未設定でも動くものと、未設定だと止まるものを、読み分けられる',
      join(['実装が読む環境変数と雛形の両方と、双方向に突き合わせる。ここに無い設定を実装がこっそり読むことはできない。', mono('verify'), ' の K1 と K2 が落とす']),
      '値そのものはここには無い。秘密であり、環境ごとに違う',
      '出すのは、何を設定する必要があり、無いとどうなるか、という保証の側だけ',
    ],
    axiomBreakdown: `設定 ${catalog.variables.length} 本、値の性質の語 ${kinds}、要求度の語 ${requirements}`,
    upperBullets: [
      '設定 1 本が 1 行。何を制御するか、未設定のとき、値の性質、要求度を並べる',
      '値の性質の語と要求度の語の宣言も公理',
      '人が判定するのは、無いときの挙動が安全側かどうか',
      '機械が保証するのは、実装と雛形との対応と、語の実在だけ',
    ],
    upper: (outline) => [outline.h3('variables', `設定(${catalog.variables.length})`), variableRows(catalog, declarations, labels), vocabulary(catalog, units, outline)],
    accept: {
      groups:
        accepted.length === 0
          ? []
          : [
              {
                kind: join(['雛形に載せない設定(', mono('not_in_template_reason'), ')']),
                items: accepted,
              },
            ],
      pending: all === null ? null : pendingOfChapter(all, model, ctx.roots, countKey, bookLayout(model, ctx)),
      signsDecision: collectSigns(ctx.specSources?.get(specFile) ?? '').length,
      signFiles: [specFile],
      signPlaces: '設定の仕様',
    },
    reasonedWords: `雛形に載せない理由(not_in_template_reason) ${accepted.length} 件`,
    lower,
    derived: {
      count,
      lines: [
        `連携の表 ${catalog.vocabulary.used_by.length} 行、置き場の表 ${catalog.vocabulary.target.length} 行、実装と雛形との対応の表 ${catalog.variables.length} 行` +
          (catalog.logging === undefined ? '' : '、ログの目録・事象・欄の表'),
        '実装と雛形との対応は、verify の K1 と K2 が双方向に見る',
      ],
    },
    originRows: [
      [
        bold('章の範囲'),
        items([
          join(['設定カタログ ', mono(specRelative(specFile, ctx)), ' の 1 枚。ブロックは 1 つ']),
          `設定 ${catalog.variables.length} 本、値の性質の語 ${kinds}、要求度の語 ${requirements}`,
          bold('この章で「全部」と言うのは、このカタログに載っている設定だけ'),
        ]),
      ],
      [
        bold('公理の数え方'),
        items([
          '数える単位は宣言 1 つ',
          '設定 1 本は、何を制御するかと、未設定のときをまとめて 1 本',
          '値の性質の語と要求度の語は、1 語を 1 本',
          '連携の語・調達の語・置き場の語は、設定の行から導ける対応なので数えない。下段の表に出す',
          join([bold('設定の値は、単位にも表にも持たない'), '。出すのは名前・性質・要求度・挙動だけ']),
        ]),
      ],
    ],
  });
}
