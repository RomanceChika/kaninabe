/**
 * 新しい形の章(`docs/book/spec/{集約}.html`)の**語の置き場**。事実の値(区分・自動の判定・発火元の種類)を人の語にする
 * のはこのファイルだけ(設計メモ `plan-generator.md` §0。表示の部品は値をここに渡して語を受け取る)。
 *
 * 語は仕様の構造の名前で、業務の意味を言い切らない(外部レビュー: 「どこからでも」は from の集合だけの指標で、
 * 条件と役は別に読む)。**アプリの語彙は 1 語も持たない。**
 */

import type { Autonomy, EventOrigin } from '../../../../semantics/spec-book/event-origins.js';
import type { StateCategory } from '../../../../semantics/spec-book/lifecycle-facts.js';
import type { OperationKind } from '../../../../semantics/spec-book/access-facts.js';
import type { FollowingKind } from '../../../../semantics/spec-book/lifecycle-followers.js';
import type { InvariantCategory } from '../../../../semantics/spec-book/invariant-facts.js';
import type { ReadScope } from '../../../../model/types-access.js';

/** 状態の区分の語(試作 v3.7〜 の凡例と同じ)。 */
export const CATEGORY_WORDS: Readonly<Record<StateCategory, string>> = {
  start: '始まり',
  progress: '進行中',
  done: '終わり',
  negative: '否定的',
};

/**
 * 自動の判定の語。「自動」と書くのは、結線済みの発火元があり system が起こせる遷移だけ。宣言の上の結線であって、
 * 実際に動いていることの確認ではない(外部レビュー の Q1)。
 */
export const AUTONOMY_WORDS: Readonly<Record<Autonomy, string>> = {
  manual: '人が起こす',
  'auto-only': '自動',
  'auto-or-manual': '自動・人も起こせる',
  'system-unwired': '自動と書けない(システムが起こせると宣言されているが、結線済みの発火元を確認できない)',
  'origin-without-permission': '食い違い(起こす処理があるのに、システムが起こせると宣言されていない)',
  unverified: '確かめていない(発火元の宣言を読めなかった)',
};

/** 発火元 1 つの語。 */
export function originWords(origin: EventOrigin): string {
  if (origin.kind === 'job') return origin.scheduled ? `時刻のジョブ ${origin.id}` : `ジョブ ${origin.id}(時刻に未結線)`;
  if (origin.kind === 'sign_in') return `サインインの分岐 ${origin.id}`;
  return `外から届く連携 ${origin.id}`;
}

/** 本筋の段の番号(「2/6」)。本筋に無い状態は空。 */
export function stepWords(step: number | undefined, steps: number): string {
  return step === undefined || steps < 2 ? '' : `${step}/${steps}`;
}

export const FLOW_WORDS = {
  section: '流れ',
  figureNote: '段の頭の「2/6」は本筋の段の番号(否定的な状態を通らずに届く段を、始まりからの手数の順に数える。枝分かれした段にも続き番号を振るので、必ず通る順ではない)。',
  figureAnywhere: 'どこからでも出る遷移は線にせず、表の下に書く。',
  statesHeaders: ['状態', '区分', '入ると決まるもの(settles)', '場面'],
  transitionsHeaders: ['操作', 'どこから', 'どこへ', '誰が', '自動か', '起こす処理'],
  fromAnywhere: (labels: string) => `終点以外のどの段からでも出る遷移(どこから出るかだけの指標。条件と誰がは表で読む): ${labels}`,
  unwired: (label: string, reason: string | undefined) =>
    reason === undefined ? `「${label}」は自動と書けない(理由の宣言は無い)` : `「${label}」は自動と書けない。理由: ${reason}`,
  anywhereCell: '終点以外のどの段からでも',
  final: '終点',
  none: '—',
} as const;

/** 操作の種類の語。 */
export const OPERATION_WORDS: Readonly<Record<OperationKind, string>> = {
  event: '遷移',
  create: '作る',
  write: '書き換える',
  delete: '消す',
};

/** 理由つきの受け入れの語。 */
export const ACCEPTED_WORDS: Readonly<Record<'self_assign' | 'public' | 'delegate', string>> = {
  self_assign: '自分を割り当ててよい',
  public: '誰でも',
  delegate: '代わりに作ってよい',
};

/** 読める範囲の語(`context` は何の文脈かを添える)。 */
export function scopeWords(scope: ReadScope, entityLabel: (entity: string) => string): string {
  if (scope.kind === 'own') return '自分の分';
  if (scope.kind === 'all') return 'すべて';
  if (scope.kind === 'none') return 'なし';
  return `関わる${entityLabel(scope.entity)}の分`;
}

export const ACCESS_WORDS = {
  canSection: 'できること',
  seeSection: '見える範囲',
  canHeaders: ['操作', '誰が', '書き換えられる欄', '条件(仕様の式)', '理由つきで開けてあるもの'],
  seeHeaders: ['誰が', '範囲', '実行者の属性で絞る', '条件(仕様の式)', 'その役から隠す欄'],
  noOperations: 'この集約に宣言された操作は無い。',
  noReads: 'この集約に宣言された読み取りは無い。',
  filter: (left: string, actorField: string) => `${left} = 実行者の ${actorField}`,
  note: '条件は仕様の式のまま出し、言い換えない。誰がの欄は仕様の宣言の名前で、含意で受け継ぐ役は書かない。誰が以外が同じ規則は 1 行にまとめる。',
} as const;

/** 決めごとの構造の種類の語(業務の意味は言い切らない。外部レビュー の P3)。 */
export const INVARIANT_CATEGORY_WORDS: Readonly<Record<InvariantCategory, string>> = {
  'settle-compute': '計算・確定に関係',
  'into-final': '終点へ入る遷移に関係',
  'hidden-snapshot': '非表示の欄・写し先に関係',
};

export const RULE_WORDS = {
  section: '決めごと',
  headers: ['決めごと', '文', '形式定義', 'ふれる欄', '守る場所', '構造の種類'],
  none: 'この集約に宣言された決めごとは無い。',
  note: '構造の種類は、仕様の構造だけで決めた印。当たっても業務の意味の証明にはならない。当たらないものが大事でないという意味でもない。形式定義の無い決めごとは文だけで読む。',
  noFormal: '文だけ',
} as const;

/** 従う規則の種類の語。 */
export const FOLLOW_KIND_WORDS: Readonly<Record<FollowingKind, string>> = { ...OPERATION_WORDS, read: '読む' };

export const OVERVIEW_WORDS = {
  title: '製品の流れ(新しい形)',
  lead: '新しい形の章(試作の本番化の途中)の入口。集約の章は旧い章と並べて置いている。',
  axisSection: '軸にした流れ',
  axisRule:
    '軸 = ほかの集約が、自分の遷移の条件か権限の条件でその状態を読む数がいちばん多い流れ。仕様に「軸」を言う欄は無く、生成器がこの規則で選ぶ。' +
    '状態を直接読む数であって、業務の従属そのものではない(手順の順・写し・ジョブの連鎖は数えない)。',
  noAxis: 'ほかの集約が状態を条件で読む流れが無いので、軸を置かない。流れは集約ごとに下の一覧で読む。',
  manyAxes: (count: number) => `従う集約の数が同じ流れが ${count} 本あるので、1 本に寄せずに並べる。`,
  axisHeading: (aggregate: string, machine: string) => `### ${aggregate}の \`${machine}\``,
  followers: (names: string) => `従う集約: ${names}`,
  matrixNote: '列は軸の流れの段で、本筋の番号の順に並ぶ。否定的な段は後ろに置く。✓ は、その段で開く規則。条件が段を言わない原子は、開くとみなす。誰が以外が同じ規則は 1 行にまとめる。',
  rowHeaders: ['集約', '規則', '誰が'],
  open: '✓',
  closed: '',
  allSection: '流れの一覧',
  allHeaders: ['集約', '流れ', '本筋の段(始まりからの手数の順)', '従う集約の数'],
  noMachines: 'この製品に状態の流れは無い。',
} as const;
