/**
 * 仕様ファイル 1 枚 → その意味が載る章のページの割り付け。
 *
 * 章立て(`chapters.ts` の `bookChapters`)が「どの章があるか」を決め、ここは仕様ファイル
 * 1 枚から章を引く判定を持つ(割り付けの正は章立てと同じ 1 本である)。**仕様の木の位置は製品の宣言から来る**ので、
 * この判定が持っていた `/^docs\\/specs\\/domain\\/…/` のような正規表現は外へ出した(W3)。
 */

import type { SpecModel } from '../../../model/types.js';
import { specPath } from '../../../model/product/paths.js';
import type { SignHost } from '../../../semantics/reading-sign.js';
import type { ProductRoots } from '../../../model/product/types.js';
import { bookFile, dataPage, usecasesPage } from './chapters.js';
import type { BookLayout } from './face-scope.js';
import {
  DOMAIN_SECTIONS,
  TABLE_SECTION,
  TAIL_SECTION,
  TASK_SECTION,
  VISIBILITY_SECTIONS,
} from './sections.js';

/** ブロック = 章の 1 節と仕様ファイル 1 枚の組の、「章の 1 節」の側(章のファイルと節の名前)。 */
export interface Block {
  /** 章ページのファイル(リポジトリルート相対)。 */
  readonly chapter: string;
  /** 節の名前(`sections.ts`。章が出す見出しと同じ綴り)。 */
  readonly section: string;
}

/** 集約のディレクトリの中のファイル名 → その標識が載る節。 */
const DOMAIN_FILE_SECTIONS: Readonly<Record<string, string>> = {
  'entity.md': DOMAIN_SECTIONS.head,
  'states.md': DOMAIN_SECTIONS.lifecycle,
  'access.md': DOMAIN_SECTIONS.visibility,
  'invariants.md': DOMAIN_SECTIONS.invariants,
};

/**
 * 仕様ファイル 1 枚が載るブロック(章のファイルと節)を返す。**標識と判断ポイントを数える単位は
 * これ 1 つだけ**で、章の合計も節ごとの数も手引きの数も、この写像から出る。
 *
 * - ドメイン仕様 → その集約の章。`entity.md` は章の頭(集約そのものの説明)、`states.md` はライフサイクル、
 *   `access.md` は誰に見えるか、`invariants.md` は不変条件の節
 * - action_spec → その集約の章の操作の節(操作の標識はライフサイクルの文脈でこそ読める)
 * - ロールの仕様 → 「誰に何が見えるか」の章のロールの節
 * - query_spec → 「誰に何が見えるか」の章の読み取り経路の節
 * - surface_spec(外から届く surface) → 「誰に何が見えるか」の章の surface の節
 * - data_table → 「データの置き場」の章
 * - notification_spec / job_spec / config_spec / auth_spec / guarantee_spec / external_spec → 各カタログの章
 * - screen_spec / chrome_spec → 「画面」の章
 * - design_token → 「デザイン」の章
 * - ux_principles_spec → 「UX 原則」の章
 * - usecase_spec → 「タスク」の章
 *
 * 割り付けられないファイル(未知のパス)は null。標識や判断ポイントを持つのに null のファイルは
 * `generate` のエラーになる(`block-check.ts`)。
 *
 * 従属する集約(親の章の節に畳むもの)の仕様ファイルと操作は、親の章に載る。集約に結ばれたテーブル仕様も、
 * その集約の章に載る(`layout` が畳むとき)。畳まないとき(`layout` が無いとき)は、集約ごとの章と「データの置き場」。
 *
 * @param file 仕様ファイル(リポジトリルート相対)
 * @param model ドメイン仕様全体(actions のディレクトリ名 = エンティティ名を集約へ引き当てる)
 * @param layout 章の立て方(従属の畳み込みと、集約の表の行き先。省略すると畳まない)
 */
export function blockOf(file: string, model: SpecModel, roots: ProductRoots, layout?: BookLayout): Block | null {
  const chapterOfAggregate = (name: string): string => bookFile(roots, `domain/${layout?.chapterOf(name) ?? name}.md`);
  const domain = firstSegmentUnder(file, specPath(roots, 'domain'));
  if (domain !== null) {
    // 集約のディレクトリ直下の 4 ファイルだけが節を持つ(それ以外は未知のファイル)。
    const name = file.slice(file.lastIndexOf('/') + 1);
    const section = DOMAIN_FILE_SECTIONS[name];
    const direct = file === specPath(roots, 'domain', domain, name);
    return section === undefined || !direct ? null : { chapter: chapterOfAggregate(domain), section };
  }
  if (file === specPath(roots, 'domain/roles.md')) {
    return { chapter: bookFile(roots, 'visibility.md'), section: VISIBILITY_SECTIONS.roles };
  }
  const action = firstSegmentUnder(file, specPath(roots, 'backend/actions'));
  if (action !== null) {
    const aggregate = aggregateOfEntity(model, action);
    return aggregate === null ? null : { chapter: chapterOfAggregate(aggregate), section: DOMAIN_SECTIONS.operations };
  }
  const tail = (name: string): Block => ({ chapter: bookFile(roots, name), section: TAIL_SECTION });
  if (file.startsWith(specPath(roots, 'backend/queries/'))) {
    return { chapter: bookFile(roots, 'visibility.md'), section: VISIBILITY_SECTIONS.queries };
  }
  if (file === specPath(roots, 'backend/surface.md')) {
    return { chapter: bookFile(roots, 'visibility.md'), section: VISIBILITY_SECTIONS.surface };
  }
  if (file.startsWith(specPath(roots, 'backend/data/tables/'))) {
    const aggregate = layout?.tableAggregateOf(file);
    return { chapter: aggregate === undefined ? dataPage(roots) : chapterOfAggregate(aggregate), section: TABLE_SECTION };
  }
  if (file === specPath(roots, 'backend/notifications.md')) return tail('notifications.md');
  if (file === specPath(roots, 'backend/jobs.md')) return tail('jobs.md');
  if (file === specPath(roots, 'backend/config.md')) return tail('config.md');
  if (file === specPath(roots, 'backend/auth.md')) return tail('auth.md');
  if (file === specPath(roots, 'backend/guarantees.md')) return tail('guarantees.md');
  if (file === specPath(roots, 'backend/external.md')) return tail('external.md');
  if (file.startsWith(specPath(roots, 'frontend/screens/')) || file.startsWith(specPath(roots, 'frontend/chrome/'))) {
    return tail('screens.md');
  }
  if (file.startsWith(specPath(roots, 'frontend/design/'))) return tail('design.md');
  if (file === specPath(roots, 'frontend/ux-principles.md')) return tail('ux-principles.md');
  if (file.startsWith(specPath(roots, 'frontend/usecases/'))) {
    return { chapter: usecasesPage(roots), section: TASK_SECTION };
  }
  return null;
}

/** 集約のディレクトリの中のファイル名 → 標識が付く仕様の種類(公理の側の 4 ファイル)。 */
const DOMAIN_FILE_HOSTS: Readonly<Record<string, SignHost>> = {
  'entity.md': 'entity',
  'states.md': 'states',
  'access.md': 'access',
  'invariants.md': 'invariants',
};

/**
 * 仕様ファイル 1 枚が、標識の付く**仕様の種類**のどれか(`blockOf` と同じ割り付けの別の見方)。
 *
 * 標識が公理の注記(公理の側)か、導出の置き場で下した判断の記録(受け入れの側)かは、この種類で決まる
 * (`semantics/reading-sign.ts` の `signClassOf`)。割り付けられないファイルは null。
 *
 * @param file 仕様ファイル(リポジトリルート相対)
 * @param model ドメイン仕様全体
 */
export function signHostOf(file: string, model: SpecModel, roots: ProductRoots): SignHost | null {
  const block = blockOf(file, model, roots);
  if (block === null) return null;
  const name = file.slice(file.lastIndexOf('/') + 1);
  if (file === specPath(roots, 'domain/roles.md')) return 'roles';
  if (firstSegmentUnder(file, specPath(roots, 'domain')) !== null) return DOMAIN_FILE_HOSTS[name] ?? null;
  if (firstSegmentUnder(file, specPath(roots, 'backend/actions')) !== null) return 'action';
  if (file.startsWith(specPath(roots, 'backend/queries/'))) return 'query';
  if (file === specPath(roots, 'backend/surface.md')) return 'surface';
  if (file.startsWith(specPath(roots, 'backend/data/tables/'))) return 'table';
  if (file.startsWith(specPath(roots, 'frontend/screens/')) || file.startsWith(specPath(roots, 'frontend/chrome/'))) return 'screen';
  if (file.startsWith(specPath(roots, 'frontend/design/'))) return 'design';
  if (file === specPath(roots, 'frontend/ux-principles.md')) return 'design';
  if (file.startsWith(specPath(roots, 'frontend/usecases/'))) return 'usecase';
  if (file === specPath(roots, 'backend/notifications.md')) return 'notice';
  return 'catalog';
}

/** 標識を数える母集合から外すファイルの種類と、その理由(宣言)。 */
const EXEMPT_KINDS = {
  guide: '案内文書(directory_guide)であり、読み方と置き場の案内が書いてあるだけで、人が下す判断は載っていない',
  template: '雛形(template.*)であり、仕様ではなく書き方の見本である',
  ledger: '用語の台帳(term_ledger)であり、中身は YAML で、表紙の語彙表と用語の検査が見る。本文は読み方の案内である',
} as const;

/** 母集合から外す種類(`EXEMPT_KINDS` の鍵)。 */
export type ExemptKind = keyof typeof EXEMPT_KINDS;

/** 種類の短い呼び名(`generate` の出力 1 行に出す)。 */
export const EXEMPT_KIND_NAMES: Readonly<Record<ExemptKind, string>> = {
  guide: '案内文書',
  template: '雛形',
  ledger: '用語の台帳',
};

/**
 * 標識を数える母集合から外すと**宣言した**ファイルの種類を返す(外さないなら null)。
 *
 * 外すのは 3 種類だけで、種類は `doc_type`(案内文書・用語の台帳)と雛形の名前(`template.*`)で決まる
 * (ファイルの一覧は持たない。README という名前だけでは外さない — `doc_type` を持たない案内は外れず、
 * 標識があればエラーで見える)。
 *
 * @param file 仕様ファイル(リポジトリルート相対)
 * @param source ファイルの生テキスト(`doc_type` を読む)
 */
export function exemptKindOf(file: string, source: string): ExemptKind | null {
  const name = file.slice(file.lastIndexOf('/') + 1);
  if (/^template\..+\.md$/.test(name)) return 'template';
  const docType = /^doc_type:\s*(\S+)/m.exec(source)?.[1];
  if (docType === 'directory_guide') return 'guide';
  if (docType === 'term_ledger') return 'ledger';
  return null;
}

/**
 * 標識を数える母集合から外すと**宣言した**ファイルの理由を返す(外さないなら null)。
 * 外した理由は上の `EXEMPT_KINDS` に書いてあり、外したファイルは「どのブロックにも属さない標識」の
 * エラーにも数えない。
 */
export function exemptionOf(file: string, source: string): string | null {
  const kind = exemptKindOf(file, source);
  return kind === null ? null : EXEMPT_KINDS[kind];
}

/**
 * `under` の直下の 1 段目(ディレクトリ名)を返す。その下に無ければ null。
 *
 * 以前は `/^docs\/specs\/domain\/([a-z0-9_]+)\//` の正規表現で同じことをしていた ——
 * 仕様の木の位置が**正規表現の中に焼き込まれていた**ので、根を宣言に寄せる際に外へ出した。
 */
function firstSegmentUnder(file: string, under: string): string | null {
  const prefix = `${under}/`;
  if (!file.startsWith(prefix)) return null;
  const rest = file.slice(prefix.length);
  const slash = rest.indexOf('/');
  return slash <= 0 ? null : rest.slice(0, slash);
}

/** エンティティ名(または状態機械名)から集約名を引く。見つからなければ null。 */
function aggregateOfEntity(model: SpecModel, entity: string): string | null {
  for (const [name, specs] of model.aggregates) {
    if (specs.entity?.entity === entity) return name;
    if (specs.stateMachines.some((machine) => machine.machine === entity)) return name;
  }
  return null;
}
