
import { specPath } from '../../../model/product/paths.js';
import type { ScreenSpec } from '../../../model/screen/types.js';
import type { UxPrincipleDecl, UxPrinciplesSpec } from '../../../model/ux-principles/types.js';
import { UX_PRINCIPLE_ADVISORY } from '../../../model/ux-principles/types.js';
import { cell } from '../../../gen-kit/state-machine-table.js';
import type { ProductRoots } from '../../../model/product/types.js';

/** 章の題。 */
export const UX_TITLE = 'UX 原則';

/** 節の見出し・表の見出し・原則が無いときの文(定型)。 */
export const UX_WORDS = {
  principles: '原則・見張る検査・閾値',
  principleHeaders: ['原則', '内容', '見張る検査', '閾値(目安)', '何から判定するか'],
  noPrinciples: 'まだ原則の宣言が無い(台帳に行を足すと、ここに一覧が生成される)。',
  accept: '画面ごとの受け入れ(原則から外れてよい場所)',
  acceptHeaders: ['画面', '原則', '対象', '理由'],
  noAccept: '受け入れは 1 件も無い(どの画面も原則の範囲に収まっている)。',
  self: '(画面そのもの)',
} as const;

/** ページの導入(定型)。 */
export const LEAD =
  '画面と操作の使いやすさについて、このシステムが守ると決めた経験則の**全部**である。' +
  '経験則は「その UI は使いやすいか」という正解が一意でない問いなので、`npm run verify` の指摘はすべて warning であり、' +
  '外れてよいと決めた場所は**画面ごとに理由つきで受け入れる**(各 screen_spec の `ux:`)。' +
  '下の表の閾値を変えるときは台帳を書き換える(検査のコードは触らない)。';

/** 閾値の読み方(定型)。 */
export const BUDGET_NOTE =
  '閾値は**目安の個数**で、超えたときだけ指摘する(ちょうどは指摘しない)。7 という数そのものに理論的な必然性は無く、' +
  '業務用の管理画面で一覧性が価値になるなら上げ、初見の利用者が触る導線なら下げてよい。';

/** 原則の表の行(宣言順。セルは共有の文)。 */
export function principleRows(spec: UxPrinciplesSpec): string[][] {
  return spec.principles.map((principle) => [
    cell(`\`${principle.id}\``),
    cell(principle.statement),
    cell(enforcer(principle)),
    cell(principle.budget === undefined ? '—' : `${principle.budget.limit}`),
    cell(principle.derives.length === 0 ? '—' : principle.derives.join(' / ')),
  ]);
}

/** 見張る検査の表示(advisory は「検査していない」と正直に出す)。 */
function enforcer(principle: UxPrincipleDecl): string {
  return principle.enforcedBy === UX_PRINCIPLE_ADVISORY
    ? '検査していない(規約とレビュー)'
    : `\`${principle.enforcedBy}\``;
}

/** 受け入れの事実(画面名順。受け入れが無い画面は載せない)。 */
export interface AcceptanceFacts {
  readonly count: number;
  readonly screenCount: number;
  /** 1 受け入れ = 1 行。`cells` は [画面名, 原則, 対象, 理由] の共有の文(画面名は素の字)。 */
  readonly rows: readonly { readonly screen: ScreenSpec; readonly cells: readonly string[] }[];
}

/** 受け入れの事実。無ければ null。 */
export function acceptanceFacts(screens: readonly ScreenSpec[]): AcceptanceFacts | null {
  const withUx = screens.filter((screen) => screen.ux.length > 0).sort((a, b) => a.name.localeCompare(b.name));
  if (withUx.length === 0) return null;
  return {
    count: withUx.reduce((sum, screen) => sum + screen.ux.length, 0),
    screenCount: withUx.length,
    rows: withUx.flatMap((screen) =>
      screen.ux.map((decl) => ({
        screen,
        cells: [screen.name, cell(`\`${decl.principle}\``), cell(decl.subject === '' ? UX_WORDS.self : `\`${decl.subject}\``), cell(decl.reason)],
      })),
    ),
  };
}

/** 受け入れの件数の 1 行(定型)。 */
export function acceptanceLead(facts: AcceptanceFacts): string {
  return (
    `受け入れは **${facts.count} 件**(${facts.screenCount} 画面)。指摘が出なくなった受け入れは \`npm run verify\` の U0 が警告するので、` +
    'この表の全行が「いま指摘が出ていて、人が理由つきで受け入れたもの」である。'
  );
}

/** 画面の仕様ファイル(リポジトリルート相対)。 */
export function screenSpecFile(roots: ProductRoots, screen: ScreenSpec): string {
  return specPath(roots, `frontend/screens/${screen.relPath}`);
}
