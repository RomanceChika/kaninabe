/**
 * 「何が起こりえないか(保証)」の章の HTML 版。
 *
 * 中身は `guarantees-lower.ts` / `mutation-section.ts` の行と語で、骨格は `layer-chapter.ts`。
 * 上段は保証 1 本 = 1 行と、仕組みの保証の読み取り専用の表。下段は対応・執行者の語・テストの表と、変異の目録。
 * **変異の目録は全部入りの `generate` だけが回す**ので、目録の折りたたみ・導出の件数・それを言う文には検証に依る印(`verified`)を付ける。
 */

import type { SpecModel } from '../../../../model/types.js';
import type { GenerateContext } from '../../../../gen-kit/generator.js';
import type { GuaranteeCatalogSpec, GuaranteeDecl } from '../../../../model/guarantee/types.js';
import { guaranteeUnits, type LayerUnit } from '../../../../semantics/reading-layers.js';
import { collectSigns } from '../../../prose.js';
import { guaranteesFile } from '../../guarantee-body.js';
import { FRAMEWORK_GUARANTEES_FILE } from '../../../../io/framework-paths.js';
import { frameworkLedgerOf } from '../../../framework-ledger-context.js';
import { guaranteeLowerTables } from '../guarantees-lower.js';
import { MUTATION_LEAD, MUTATION_NOTE, MUTATION_TITLE, mutationListings, mutationMatrix, mutationParts, scopeNote } from '../mutation-section.js';
import { pendingFindings, pendingOfChapter } from '../finding-placement.js';
import { bookLayout } from '../face-scope.js';
import { specRelative } from '../face-sign.js';
import { bold, fold, inline, kv, mono, verified } from './face-parts.js';
import { axiomRow, items, layerChapter, type Outline } from './layer-chapter.js';
import { el, join, type Child, type Html } from './markup.js';
import { table, type ChapterBody } from './chapter-parts.js';

/** 章の題。 */
export const GUARANTEES_TITLE = '何が起こりえないか(保証)';

/** 状態の表示。 */
function statusText(decl: GuaranteeDecl): string {
  if (decl.status === 'enforced') return `守られている(見張りテスト ${decl.canaries?.length ?? 0} 本)`;
  return `これから(${decl.plannedReason ?? '理由未記入'})`;
}

/** 保証の行を状態ごとにまとめて並べる。 */
function guaranteeRows(catalog: GuaranteeCatalogSpec, units: ReadonlyMap<string, LayerUnit>): Child[] {
  const groups = [
    { title: '守られている', status: 'enforced' as const },
    { title: 'これから', status: 'planned' as const },
  ];
  return groups.flatMap(({ title, status }) => {
    const group = catalog.guarantees.filter((decl) => decl.status === status);
    if (group.length === 0) return [];
    return [
      el('p', { class: 'bf-group' }, title, el('small', null, `${status} · ${group.length} 本`)),
      ...group.map((decl) => {
        const unit = units.get(decl.id);
        return unit === undefined ? null : axiomRow(mono(decl.id), [kv('決まること', decl.label), kv('補足', decl.summary), kv('状態', statusText(decl))], unit.elements);
      }),
    ];
  });
}

/** 仕組みの保証の読み取り専用の表(読めなかったときは読めなかったと名指す。台帳を読んでいないときは出さない)。 */
function frameworkGuarantees(ctx: GenerateContext, outline: Outline): Child[] {
  const input = frameworkLedgerOf(ctx);
  if (input === undefined || input.load.state === 'not_requested') return [];
  const heading = outline.h3('framework', '仕組みの保証(読み取り専用)');
  if (input.load.state === 'blocked') {
    return [heading, el('p', null, '仕組みの保証台帳 ', mono(FRAMEWORK_GUARANTEES_FILE), ` を読めなかった: ${input.load.reason}(`, mono('verify'), ' の Z0 / Z3 が原因を言う)')];
  }
  const catalog = input.load.model.catalog;
  if (catalog === null) return [heading, el('p', null, '仕組みの保証台帳 ', mono(FRAMEWORK_GUARANTEES_FILE), ' を読めなかった。')];
  return [
    heading,
    el(
      'p',
      null,
      '仕組み自身が言い切る事実の目録(',
      mono(FRAMEWORK_GUARANTEES_FILE),
      `。製品が外せない義務で、製品の台帳とは別。保証 ${catalog.guarantees.length} 本)。読み取り専用で、この章の保証の数には入れない。`,
    ),
    table(
      ['保証 ID', '何が起こりえないか', '状態', '見張りテストの本数'],
      catalog.guarantees.map((decl) => [mono(decl.id), decl.label, decl.status, String(decl.canaries?.length ?? 0)]),
    ),
  ];
}

/**
 * 変異の目録の折りたたみ(実測があるときだけ。全部に検証に依る印を付ける)。
 * 実測が無いときも空の印を置く(入口の出力と全部入りの比べ合わせで、印の有無そのものを違いにしない)。
 */
function mutationFold(ctx: GenerateContext): Html {
  if (ctx.mutation?.state !== 'ran') return verified([], true);
  const report = ctx.mutation.report;
  const matrix = mutationMatrix(report, new Set(report.withoutSite));
  return verified(
    [
      fold(
        {
          kind: 'table',
          title: MUTATION_TITLE,
          count: report.operators.length,
          hint: '宣言を機械で壊して、どの検査が赤くなるかを実測した表',
          element: 'guarantee.mutation',
        },
        [
          el('p', null, inline(MUTATION_LEAD)),
          el('p', null, inline(scopeNote(report))),
          table(
            matrix.headers,
            matrix.rows.map((row) => row.map(inline)),
          ),
          el('p', null, inline(MUTATION_NOTE)),
          ...mutationListings(report).flatMap((entry) => [
            el('p', null, inline(entry.prefix)),
            el(
              'ul',
              null,
              entry.lines.map((line) => el('li', null, inline(line))),
            ),
          ]),
        ],
      ),
    ],
    true,
  );
}

/**
 * 保証の章の本文と目次。保証台帳が読めていなければ、その旨の 1 行だけ。
 *
 * @param countKey 章の数の鍵(`chapters.ts` の章のファイル)
 * @param file 書き出すファイル(リポジトリルート相対)
 */
export function guaranteesChapter(model: SpecModel, ctx: GenerateContext, catalog: GuaranteeCatalogSpec | null, countKey: string, file: string): ChapterBody {
  if (catalog === null) {
    return {
      body: join([el('h1', null, GUARANTEES_TITLE), el('p', null, 'まだ保証台帳を読めていない(スキーマエラーを直すと、ここに一覧が生成される)。')]),
      headings: [],
    };
  }
  const units = new Map(guaranteeUnits(catalog).map((unit) => [unit.id, unit] as const));
  const specFile = guaranteesFile(ctx.roots);
  const all = pendingFindings(ctx);
  const enforced = catalog.guarantees.filter((decl) => decl.status === 'enforced').length;
  const planned = catalog.guarantees.length - enforced;
  const tables = guaranteeLowerTables(catalog);
  const mutation = mutationParts(ctx);
  const mutationRows = 'absence' in mutation ? 0 : mutation.rows;
  const base = `対応の表 ${catalog.guarantees.length} 行、執行者の語 ${catalog.vocabulary.enforcer.length} 行、テスト ${catalog.testCases.length} 件`;
  return layerChapter(model, ctx, {
    title: GUARANTEES_TITLE,
    countKey,
    file,
    crumb: {
      layer: '保証の章',
      count: `保証は ${catalog.guarantees.length} 本`,
    },
    intro: [
      '設計で不可能にしたと主張していることは、この一覧に載っているものが全部',
      '主張だけの安全性は許さない。口頭や README の 1 文でしか確認できず、消えても誰も気づかない',
      join(['保証には必ず見張りテストの宣言が付く。無ければ ', mono('verify'), ' の Z0 が落とす']),
      'これからと宣言された保証は、正直に「これから」と出す',
      join(['免除の口は無い。執行に着手するまで ', mono('verify'), ' の Z2 が毎回警告を出し続ける']),
    ],
    axiomBreakdown: `保証 ${catalog.guarantees.length} 本(守られている ${enforced}、これから ${planned})`,
    upperBullets: [
      '保証 1 本が 1 行。何が起こりえないか、どういう保証か、いま守られているかを並べる',
      '人が判定するのは、その性質を本当に守りたいか、主張が大きすぎないか',
      '機械が保証するのは、見張りテストの実在と、執行者の語の実在だけ',
      '誰が守っているかと見張りテストの対応は、下段の表に出す',
    ],
    upper: (outline) => [outline.h3('guarantees', `保証(${catalog.guarantees.length})`), guaranteeRows(catalog, units), frameworkGuarantees(ctx, outline)],
    accept: {
      groups: [],
      pending: all === null ? null : pendingOfChapter(all, model, ctx.roots, countKey, bookLayout(model, ctx)),
      signsDecision: collectSigns(ctx.specSources?.get(specFile) ?? '').length,
      signFiles: [specFile],
      signPlaces: '保証の仕様',
    },
    reasonedWords: '保証台帳に、通した理由を書く欄は無い。これからの理由(planned_reason)は警告として残り続けるので、まだ通していない分に数える',
    lower: [
      ...tables.map((entry) =>
        fold(
          entry.fold,
          entry.rows.length === 0
            ? []
            : [
                table(
                  entry.headers,
                  entry.rows.map((row) => row.map(inline)),
                ),
              ],
        ),
      ),
      mutationFold(ctx),
    ],
    derived: {
      count: tables.reduce((sum, entry) => sum + entry.rows.length, 0) + mutationRows,
      lines: 'absence' in mutation ? [`${base}。${mutation.absence}`] : [`${base}、変異の目録 ${mutationRows} 行`, '変異の目録は実測で、導出に置く'],
      verify: true,
    },
    originRows: [
      [
        bold('章の範囲'),
        items([
          join(['保証台帳 ', mono(specRelative(specFile, ctx)), ' の 1 枚。ブロックは 1 つ']),
          `保証 ${catalog.guarantees.length} 本(守られている ${enforced}、これから ${planned})、執行者の語 ${catalog.vocabulary.enforcer.length}`,
          bold('この章で「全部」と言うのは、この台帳に載っている保証だけ'),
        ]),
      ],
      [
        bold('公理の数え方'),
        items([
          '数える単位は宣言 1 つ。保証 1 本を 1 本',
          '執行者の語・見張りテスト・変異の目録は数えない。下段の表に出す',
          '見張りテストの件数は公理に足さない',
          verified([
            'absence' in mutation
              ? inline(mutation.absence)
              : `変異の目録の「宣言された例外」${mutation.exempted} 件は、操作とテーブルの仕様の理由を引いたもの。受け入れは集約の章が数える`,
          ]),
        ]),
      ],
    ],
  });
}
