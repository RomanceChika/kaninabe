/**
 * 集約の章末の「数の出どころ」の行(HTML 版)。本文に出た数を、どこから・どう数えたかで説明する。
 *
 * 読む量の 4 枚・本文の項目・この表が同じ集計(`face-facts.ts`)から出るので、数は食い違わない。数えられないものは「未集計」と書く。
 * 検証の結果に依る行(必読・受け入れ)は `verified` の印を付ける。
 */

import type { AggregateSpecs } from '../../../../model/types.js';
import { aggregateWeights } from '../face-scope.js';
import { aggregateLabel, type FaceFacts } from '../face-facts.js';
import { ownAxiomCount, readingTotals, testTotal } from '../face-totals.js';
import { summaryGapsOf } from '../summary-gaps.js';
import type { DomainEnv } from './aggregate-env.js';
import { bold, mono, verified } from './face-parts.js';
import { items } from './layer-chapter.js';
import { join, type Child } from './markup.js';

/** 集約の表示名の並び(読点区切り)。 */
function names(list: readonly AggregateSpecs[]): string {
  return list.map(aggregateLabel).join('、');
}

/** 章の範囲・必読・写した公理(数の出どころの前半)。 */
function scopeRows(env: DomainEnv, facts: FaceFacts): (readonly [Child, Child])[] {
  const entity = facts.specs.entity?.entity ?? facts.specs.name;
  const everyone = [...env.model.aggregates.values()].flatMap((specs) => (specs.invariants?.invariants ?? []).filter((invariant) => invariant.entities.includes(entity)));
  const ownTotal = ownAxiomCount(facts);
  const reading = readingTotals(facts);
  return [
    [
      bold('章の範囲'),
      items([
        `受け入れ・テスト・公理を配る単位を 1 つに揃えた。入るのは ${facts.usecases.length === 0 ? 2 : 3} つ`,
        `1 つめ ${aggregateLabel(facts.specs)}の表と、操作仕様 ${facts.actions.length} 本(節に畳んだ従属の分を含む)`,
        `2 つめ 節に畳んだ従属 ${facts.basis.folded.length} つ${facts.basis.folded.length === 0 ? '' : `(${names(facts.basis.folded)})`}`,
        ...(facts.usecases.length === 0 ? [] : [`3 つめ タスク ${facts.usecases.length} 本。保存点の手順がすべて範囲の集約の操作であるもの`]),
        `範囲の集約は ${names(facts.scope)}`,
        bold('この章で「全部」と言うのは、この範囲の下だけ'),
      ]),
    ],
    [
      verified([bold(`必読 ${reading.required}`)]),
      verified(
        [
          items([
            join([bold('必読 = 公理 + 受け入れ'), `。公理 ${reading.axioms} 本に、受け入れ ${reading.accept} 件を足した`]),
            `読み手ごとに分ける。業務 ${reading.byReader.business.required}、開発者 ${reading.byReader.developer.required}`,
            '読み手は項目の種類で決まる。公理とタスクの受け入れ宣言の理由は業務、表の手書き・定型外の操作・確認の上書き・リントの受け入れ・構造の警告は開発者',
            join([bold('数える公理は 5 種類'), '。不変条件の言明・アクセスの宣言・状態の意味・要約の文・計算の例の表']),
            `不変条件は、この章の ${ownTotal} 本(${facts.own.map((group) => `${aggregateLabel(group.specs)} ${group.invariants.length}`).join('、')})と、写した ${facts.carried.length} 本`,
            join([
              `アクセスの宣言 ${reading.axiomParts.access} 行は、表の行で数える。読む(`,
              mono('reads'),
              '。内部実行のロールを除く)は集約 × 役の表の 1 集約を 1 行、作る・書く・消す(',
              mono('creates'),
              '・',
              mono('writes'),
              '・',
              mono('deletes'),
              ')は、書ける欄と条件が同じ宣言の役を 1 行にまとめた行',
            ]),
            join(['アクセスの数え方は、判断ポイントの台帳(宣言 1 本を 1 件)と違う。', mono('filters'), ' と ', mono('when'), ' の意図は、行の中で読む']),
            join([
              `状態の意味 ${reading.axiomParts.states} つは、`,
              mono('summary'),
              ` を持つ状態の数。要約の文 ${reading.axiomParts.summaries} 本は、章頭の 1 文と節の要約のうち書かれているもの`,
            ]),
            join([
              `計算の例の表 ${reading.axiomParts.examples} 行は、`,
              mono('computes'),
              ' の ',
              mono('examples'),
              ' の行の数。1 行は「この入力ならこの値」の主張 1 つで、',
              bold('式の代わりに人が業務の規則と照らして判定する'),
              '。生成したテストが純関数との一致を保証する',
            ]),
            join([
              '計算される欄(',
              mono('computes'),
              ')の宣言は数えない。宣言は欄と純関数の名前しか持たず、',
              bold('式は DSL の外'),
              'にある。下段の参照に「欄 → 純関数」の表で出す',
            ]),
            join([bold('invariant は全部 必読'), '。', mono('statement'), ' と ', mono('formal'), ' が同じ意味かどうかは人の判断']),
            '短い形で出した一意性も、読み方の印は必読のまま',
            '写した公理は、原本の章でも必読。章をまたぐと二重に数える',
            `状態の表示名とイベントの呼び名は、段に畳まれて出る。別には数えない。段の数は ${facts.specs.stateMachines.reduce((sum, machine) => sum + machine.states.length, 0)}`,
            `標識は数に入れない(単位が違う)。公理の側 ${facts.signs.axiom} 本は上段の公理の下、受け入れの側 ${facts.signs.decision} 本は受け入れの下に置いた`,
          ]),
        ],
        true,
      ),
    ],
    [
      bold(`写した公理 ${facts.carried.length}`),
      items([
        join([mono('entities'), ' に ', mono(entity), ` を含む公理は、全部で ${everyone.length} 本`]),
        `そのうち範囲の中の ${everyone.length - facts.carried.length} 本を除いた ${facts.carried.length} 本を、全部写す`,
        '絞り込みはしない',
      ]),
    ],
  ];
}

/** 変更・受け入れ・参照・遷移・執行点・テスト(数の出どころの中盤)。 */
function countRows(facts: FaceFacts): (readonly [Child, Child])[] {
  const reading = readingTotals(facts);
  const { handwritten, manual, accepted, overrides } = facts.accept;
  return [
    [
      bold('変更'),
      items(
        facts.changes === null
          ? [
              '前回読了は読者の状態で、仕様にも差分の道具にも無い',
              join(['基点は引数で受ける。', mono('npm run generate -- --base <ref>'), ' で渡す。渡さなければ数えない(0 とは書かない)']),
              join(['数えるのは公理の側だけ。不変条件の言明・状態の表示名・イベントの呼び名で、', mono('spec:diff'), ' の「公理の側」と同じ元']),
              '権限・見える行・公開される欄などは導出の側。数えない',
            ]
          : [
              join(['基点 ', mono(facts.changes.ref), ` と比べた、この章の範囲の公理の側の動き ${facts.changes.items.length} か所`]),
              '不変条件は、範囲の公理と写した公理。状態の表示名とイベントの呼び名は、範囲の状態機械',
              '導出の側(権限・見える行など)は数えない',
            ],
      ),
    ],
    [
      verified([bold(`受け入れ ${reading.accept}`)]),
      verified(
        [
          items([
            join([
              `理由つき ${reading.reasoned} 件 = 手書き(`,
              mono('handwritten'),
              `) ${handwritten.length} + 定型外(`,
              mono('runner'),
              `) ${manual.length} + 確認の上書きとリント(`,
              mono('ux'),
              '・',
              mono('exceptions'),
              `) ${overrides.length} + `,
              mono('accept:'),
              ` ${accepted.length}`,
            ]),
            reading.pending === null
              ? 'まだ通していない分は未集計。検証の結果が渡されていない'
              : `まだ通していない ${reading.pending} 件 = 検証器の警告のうち未分類。場所のファイルが、範囲の仕様ファイルに入るものを配る`,
            join(['全文は ', mono('npm run verify'), ' の出力。章に出すのは ID・場所・対処の 1 行']),
            join(['場所を持たない警告・範囲の外の警告は、ここに数えない。', mono('review-guide'), ' に出る']),
          ]),
        ],
        true,
      ),
    ],
    [
      bold(`参照 ${reading.derived}`),
      items([
        `導出の件数 = 遷移 ${facts.transitions} + 執行点 ${facts.enforcementOwn + facts.enforcementCarried} + テスト ${testTotal(facts.tests)} + ジョブ ${facts.jobs}`,
        `マトリクスの ${facts.matrixCells} マスは、遷移を状態で割った表なので数に足さない`,
        join(['ジョブは、章の遷移の ', mono('effects'), ' が積むジョブ(カタログにあるもの)']),
      ]),
    ],
    [
      bold(`遷移 ${facts.transitions} / マトリクス ${facts.matrixCells}`),
      items([join([`状態機械 ${facts.specs.stateMachines.length} 本の `, mono('events'), ' を数えた']), 'マトリクスは状態の数 × イベントの数を、機械ごとに足した']),
    ],
    [bold(`執行点 ${facts.enforcementOwn} / 写した分 ${facts.enforcementCarried}`), items([join(['公理の ', mono('enforced_by'), ' の要素数'])])],
    [
      bold(`テスト ${testTotal(facts.tests)}`),
      items([join(['仕様の ', mono('test_cases'), ' の行数']), `範囲の操作仕様・テーブル仕様・タスクを数えた(${facts.tests.length} 行)`, 'コード側の注釈は数えていない']),
    ],
  ];
}

/** 重さ・従属・未記入・原文の写し方・色(数の出どころの後半)。 */
function tailRows(env: DomainEnv, facts: FaceFacts, unwritten: number): (readonly [Child, Child])[] {
  const weights = aggregateWeights(env.model, env.ctx);
  const own = weights.find((weight) => weight.name === facts.specs.name);
  const next = weights.filter((weight) => weight.name !== facts.specs.name).slice(0, 2);
  const gaps = summaryGapsOf(facts.scope);
  return [
    [
      bold(`重さ ${facts.rank} 位`),
      items([
        ...(own === undefined ? [] : [join([`参照グラフの入次数 ${own.inDegree} と、公理 ${own.invariants}、操作仕様 ${own.operations} を足して `, bold(String(own.total))])]),
        ...(next.length === 0 ? [] : [`次は ${next.map((weight) => `${weight.name} ${weight.total}`).join('、')}`]),
        '同点のときは、入次数、公理、操作、名前の辞書順で決める',
        '従属する集約の重さは親に足さない。章は、章を持つ集約だけを重い順に並べる',
      ]),
    ],
    [
      bold('従属'),
      items([
        join([mono('on delete cascade'), ` で親の表につながる集約を数えた。連なる先も含めて ${facts.basis.cascading.length} つ`]),
        `そのうち、作るロールも消すロールも、生きている親の行を動かす人であるものが ${facts.basis.folded.length} つ。節に畳む`,
        '内部実行のロールは人ではないので比べない。親の候補が 2 つ残るときは、入次数の多いほうを親にする',
      ]),
    ],
    [
      bold('(まだ書かれていない)'),
      items([
        join([`この章に ${unwritten} か所。仕様に `, mono('summary'), ' を書けば消える']),
        `内訳 章頭の 1 文 ${gaps.entity}、節の要約 ${gaps.machines}、段の場面 ${gaps.states}`,
        `書く場所は ${gaps.places} か所。レビューの手引きが章ごとの未記入を数える`,
      ]),
    ],
    [
      bold('原文の写し方'),
      items([
        join(['公理の ', mono('statement'), ' は', bold('原文のまま'), '、折りたたみ「原文」に全文を置く']),
        '全角の括弧を半角に直さず、語順も詰めない',
        '主文・例外・補足への分解は、文字の切り出しだけ。言い換えない',
      ]),
    ],
    [
      bold('色とフォント'),
      items([
        join(['色・余白・字の大きさはトークンから引く。読み方の印の 4 組は ', mono('color-mark-*')]),
        '読み方の印は色と記号の 2 重で区別する。悪い知らせの状態のピルは、状態バッジの critical を使う',
      ]),
    ],
  ];
}

/**
 * 「数の出どころ」の表の行。
 *
 * @param unwritten 本文に出た「(まだ書かれていない)」の数(仕様から数えた未記入と合うことを構造テストが見る)
 */
export function originRows(env: DomainEnv, unwritten: number): (readonly [Child, Child])[] {
  return [...scopeRows(env, env.facts), ...countRows(env.facts), ...tailRows(env, env.facts, unwritten)];
}
