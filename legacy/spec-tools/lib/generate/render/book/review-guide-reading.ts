/**
 * レビューの手引きの「読む量」の節(必読 N・今回変わった M・受け入れ K を、ブロックごとに・読み手ごとに)。
 *
 * 数の定義は `block-reading.ts`、分類と読み手は `semantics/reading-class.ts`、配り方は `finding-placement.ts` が
 * 正で、ここは並べるだけである。**読み手は項目の種類で決まる**(宣言は増やさない): 公理・タスクの受け入れ宣言の理由・
 * ドメイン仕様の警告は業務、表の手書き・定型外の操作・確認の上書き・リントの受け入れ・構造の
 * 警告は開発者が通した理由と未処理である。1 つのブロックが両方の読み手に数を持つこともある。
 */

import type { SpecModel } from '../../../model/types.js';
import { specPath } from '../../../model/product/paths.js';
import { READER_NAMES, type ReadingClass, type ReadingReader } from '../../../semantics/reading-class.js';
import type { GenerateContext } from '../../../gen-kit/generator.js';
import { cell, markdownTable } from '../../../gen-kit/state-machine-table.js';
import { blockReadings, requiredOf, sumReadings, unplacedReading, type BlockReading, type ReaderLoad } from './block-reading.js';
import { bookChapters, bookFile, relativeHref } from './chapters.js';
import { unplacedCounts } from './finding-placement.js';
import { SECTION_ORDER } from './sections.js';

/** 標識の行き先の言い方。 */
export const SIGN_CLASS_WORDS: Readonly<Record<ReadingClass, string>> = {
  axiom: '公理の側(公理への注記)',
  accepted: '受け入れの側(人が下した判断の記録)',
  derived: '導出',
};

/** 読み手 1 人ぶんの言い方(引けていない欄は「未集計」「—」)。変更は公理の側の差分なので、業務にだけ数がある。 */
export function loadWords(load: ReaderLoad, changed: number | null | undefined): string {
  const accept = load.reasoned + (load.pending ?? 0);
  const pending = load.pending === null ? '未集計' : String(load.pending);
  const change = changed === undefined ? '' : `今回変わった ${changed === null ? '—' : changed}・`;
  return `必読 ${requiredOf(load)}・${change}受け入れ ${accept}(理由つき ${load.reasoned}・まだ通していない ${pending})`;
}

/** 標識の行き先ごとの本数(数えるのは標識を持つブロックすべて)。 */
export function signWords(rows: readonly BlockReading[]): string {
  const sum = (readingClass: ReadingClass): number =>
    rows.filter((reading) => reading.signClass === readingClass).reduce((total, reading) => total + reading.signs, 0);
  return `公理の側 ${sum('axiom')} 本・受け入れの側 ${sum('accepted')} 本(足さない)`;
}

/** 読む量の表の見出し。 */
export const READING_HEADERS = ['章', '節', '仕様ファイル', '必読', '今回変わった', '受け入れ', '標識の行き先'] as const;

/** 読む量の表の 1 行(仕様ファイルは仕様の木からの相対パスで見せ、リンク先はリポジトリルート相対)。 */
export interface ReadingRow {
  readonly title: string;
  readonly section: string;
  readonly file: string;
  readonly shown: string;
  readonly required: string;
  readonly changed: string;
  readonly accept: string;
  readonly signWord: string;
}

/** ブロック 1 行(章の名前は呼び出し側が束ねる)。 */
function row(reading: BlockReading, reader: ReadingReader, title: string, ctx: GenerateContext): ReadingRow {
  const load = reading.byReader[reader];
  const accept = load.reasoned + (load.pending ?? 0);
  const pending = load.pending === null ? '未集計' : String(load.pending);
  const prefix = `${specPath(ctx.roots)}/`;
  const shown = reading.file.startsWith(prefix) ? reading.file.slice(prefix.length) : reading.file;
  const changed = reader === 'business' ? (reading.changed === null ? '—' : String(reading.changed)) : '—';
  return {
    title,
    section: reading.section,
    file: reading.file,
    shown,
    required: String(requiredOf(load)),
    changed,
    accept: `${accept}(理由つき ${load.reasoned}・まだ通していない ${pending})`,
    signWord: reading.signReader === reader && reading.signClass !== null ? SIGN_CLASS_WORDS[reading.signClass] : '—',
  };
}

/** 読み手 1 人ぶんの節のデータ。 */
export interface ReaderData {
  readonly reader: ReadingReader;
  /** 見出し(`読み手の名前(誰が読むか)`)。 */
  readonly heading: string;
  readonly total: string;
  readonly signs: string;
  readonly rows: readonly ReadingRow[];
}

/** 読み手 1 人ぶんの節のデータ(読む量のあるブロックを章の並び・節の並び・ファイルの順に)。 */
export function readerData(reader: ReadingReader, readings: readonly BlockReading[], model: SpecModel, ctx: GenerateContext): ReaderData {
  const chapters = bookChapters(model, ctx);
  const rank = (section: string): number => {
    const index = SECTION_ORDER.indexOf(section);
    return index === -1 ? SECTION_ORDER.length : index;
  };
  const order = (chapter: string): number => {
    const index = chapters.findIndex((candidate) => candidate.file === chapter);
    return index === -1 ? chapters.length : index;
  };
  // 変更は公理の側の差分なので、業務の数にだけ載る。
  const mine = readings.filter(
    (reading) => requiredOf(reading.byReader[reader]) > 0 || (reader === 'business' && (reading.changed ?? 0) > 0),
  );
  const sorted = [...mine].sort(
    (a, b) => order(a.chapter) - order(b.chapter) || rank(a.section) - rank(b.section) || a.file.localeCompare(b.file),
  );
  const title = (chapter: string): string => chapters.find((candidate) => candidate.file === chapter)?.title ?? chapter;
  const total = sumReadings(readings, ctx);
  const who = reader === 'business' ? '業務の判断をする人が読む' : '開発者が読む';
  return {
    reader,
    heading: `${READER_NAMES[reader]}(${who})`,
    total: `合計 ${loadWords(total.byReader[reader], reader === 'business' ? total.changed : undefined)}`,
    signs: `標識 ${signWords(readings.filter((reading) => reading.signReader === reader))}`,
    rows: sorted.map((reading) => row(reading, reader, title(reading.chapter), ctx)),
  };
}

/** 読む量のあるブロックが無いときの 1 行。 */
export const READING_NONE = '読む量のあるブロックは無い';

/** 読み手 1 人ぶんの節。 */
function readerBlocks(
  reader: ReadingReader,
  readings: readonly BlockReading[],
  model: SpecModel,
  ctx: GenerateContext,
): string[] {
  const guide = bookFile(ctx.roots, 'review-guide.md');
  const data = readerData(reader, readings, model, ctx);
  return [
    `### ${data.heading}`,
    data.total,
    data.signs,
    ...(data.rows.length === 0
      ? [READING_NONE]
      : [
          markdownTable(
            [...READING_HEADERS],
            data.rows.map((entry) => [
              cell(entry.title),
              cell(entry.section),
              `[${cell(entry.shown)}](${relativeHref(guide, entry.file)})`,
              entry.required,
              entry.changed,
              entry.accept,
              entry.signWord,
            ]),
          ),
        ]),
  ];
}

/** 「どの章にも配れないもの」の題と導入・無いときの 1 行。 */
export const UNPLACED_HEADING = 'どの章にも配れないもの';
export const UNPLACED_LEAD =
  '場所が仕様の木の外にある警告(ID と件数だけ。文面と場所は `npm run verify` の出力が持つ。位置は生成物に入れない)や、消えて仕様ファイルを引けない公理の側の差分は、どの章のブロックにも入らない。ここに置く';
export const UNPLACED_NONE = '配れなかったものは無い';

/** どの章のブロックにも配れないもの(警告・消えた公理)の行。`` `識別子` `` を含む文。 */
export function unplacedLines(model: SpecModel, ctx: GenerateContext): string[] {
  const unplaced = unplacedReading(model, ctx);
  return [
    ...unplacedCounts(unplaced.pending).map((entry) => `警告 \`${entry.id}\` ${entry.count} 件`),
    ...(unplaced.changes ?? []).map((change) => `公理の側の差分 \`${change.key}\`(${change.kind === 'removed' ? '消えた' : '仕様ファイルを引けない'})`),
    // 検証を回していない文脈(ハンドブックだけを出す入口)で「無い」と言い切らない: 警告が 0 件なのではなく、集めていない。
    ...(ctx.findings === undefined ? ['警告の分は未集計(検証の結果が渡されていない)'] : []),
  ];
}

/** どの章のブロックにも配れないもの。 */
function unplacedBlocks(model: SpecModel, ctx: GenerateContext): string[] {
  const lines = unplacedLines(model, ctx);
  return [`### ${UNPLACED_HEADING}`, UNPLACED_LEAD, ...(lines.length === 0 ? [UNPLACED_NONE] : lines.map((line) => `- ${line}`))];
}

/** 「読む量」の節の題。 */
export const READING_HEADING = '読む量';

/** 数え方の説明(箇条)。 */
export const READING_NOTES: readonly string[] = [
  '- **必読 = 公理 + 受け入れ**。受け入れは、人が理由をつけて通した分と、まだ通していない分(検証器の警告のうち、拡張候補に当たらない未分類のもの)',
  '- 検証器の警告のうち**仕組みの拡張候補**は、仕組みの宿題なので受け入れに数えない(読まなくてよい)。候補ごとの言い分と件数は下の「警告の区分」の節に出る',
  '- **今回変わった**は、基点つきのときの公理の側の差分。基点が無ければ「—」と書き、0 とは書かない',
  '- 0 は「不変条件の言明・状態の表示名・イベントの呼び名・要約の文・計算の例の差分が 0」の意味で、読まなくてよいの意味ではない。access の絞り込みや計算式だけが動いた回も 0 になる(それは導出の側の差分で、`spec:diff` が見る)',
  '- **数える公理は 5 種類**。不変条件の言明・アクセスの宣言(`access_spec` の `reads` と `creates` と `writes` と `deletes`。`filters` / `when` の意図を含む)・状態の意味(`summary` を持つ状態)・要約の文(章頭の 1 文と節の要約)・計算の例の表(`computes[].examples` の行。「この入力ならこの値」の主張で、式の代わりに人が業務の規則と照らして判定する)。**「必読 N」は人が読む量の下限である**(状態の表示名とイベントの呼び名は段に畳まれて出るので、別には数えない)',
  '- **通知・ジョブ・画面・認証・設定・保証の層の公理は、宣言 1 つを 1 本と数える**。通知 1 本・ジョブ 1 本・画面 1 枚・宛先の語 1 語・メンションの語 1 語・失敗したときの語 1 語・条件の軸 1 本(値と持つ行を仕様が直接宣言する軸。主語の軸は数えない)・分岐 1 行・着地 1 つ・関門 1 つ・設定 1 本・値の性質の語 1 語・要求度の語 1 語・保証 1 本(画面の部品の宣言は画面の中で読み、別には数えない)。数える単位は `semantics/reading-layers.ts` の 1 か所で、各章の上段の行もそこから組む。テストの件数は公理に足さない',
  '- **可視性と操作の章は公理を数えない**。アクセスの宣言は集約の章の「誰に見えるか」が、確認の上書き・生成に乗らない理由・手書きの理由は集約の章と表の章の受け入れが、すでに数えている。同じ宣言を二度必読に数えないので、2 章は導出の表と、他の章への案内だけを持つ',
  '- **アクセスの数え方は、判断ポイントの台帳(宣言 1 本を 1 件)と違う**。必読は表の行で数える。読むは集約 × 役の表の集約 1 つを 1 行、作る・書く・消すは書ける欄と条件が同じ宣言の役を 1 行にまとめた行',
  '- 計算される欄(`computes`)の宣言は数えない。宣言は欄と純関数の名前しか持たず、式は DSL の外にある。章の下段(参照)に「欄 → 純関数」の表で出す。例の表(`examples`)は上の公理として数え、章の上段に早見表で出す',
  '- 数えるのはブロック 1 つ(節 × 仕様ファイル 1 枚)を 1 回だけ。章の頭の数は従属を畳んだ範囲で数えるので、章ごとの合計とは合わない',
  '- 標識は、公理に付く注記なら公理の側、操作などの置き場に残された判断なら受け入れの側。数には足さない',
  '- 導出(遷移表・執行点・テスト・ジョブ)は読まなくてよいので、ここには出さない',
];

/** 読み手の分け方の説明(1 行目は地の文、続きは箇条)。 */
export const READER_NOTES: readonly string[] = [
  '読み手は**項目の種類で決まる**(宣言は増やさない)。1 つのブロックが、業務にも開発者にも数を持つことがある。',
  '- **業務**(業務の判断をする人)… 公理・タスクの受け入れ宣言の理由・ドメイン仕様の警告。標識は、ドメインの仕様・ロール・操作・タスク・読み取り経路と外から届く surface(誰に何が見えるか)・画面・通知に付いたもの',
  '- **開発者** … 表の手書きの理由・定型に乗らない操作の理由・確認の上書きとリントの受け入れの理由・雛形に載せない設定の理由・構造の警告(まだ通していない分)。標識は、表・設計・通知以外のカタログ(ジョブ・設定・認証・保証・外部連携)に付いたもの',
];

/**
 * 「読む量」の節を組み立てる。
 *
 * @param model ドメイン仕様全体
 * @param ctx 生成コンテキスト
 */
export function readingSection(model: SpecModel, ctx: GenerateContext): string[] {
  const readings = blockReadings(model, ctx);
  return [
    `## ${READING_HEADING}`,
    READING_NOTES.join('\n'),
    READER_NOTES.join('\n'),
    ...readerBlocks('business', readings, model, ctx),
    ...readerBlocks('developer', readings, model, ctx),
    ...unplacedBlocks(model, ctx),
  ];
}
