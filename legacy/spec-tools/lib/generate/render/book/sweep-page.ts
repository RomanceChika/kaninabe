
import { evidenceCell } from '../l2-sweep.js';
import type { L2Row, L2Section } from '../l2-sweep.js';
import { cell } from '../../../gen-kit/state-machine-table.js';

/** 章の題・末尾の節の見出し・対象が無いときの文(定型)。 */
export const SWEEP_WORDS = {
  title: '一通り試すとは何か(L2 網羅台帳)',
  empty: 'まだ対象が無い(仕様に足すと、ここに行が生成される)。',
  tail: '押さえるテストが1本も無い行',
  tailNone: '無し(全行に、確認しているテストが 1 本以上ある)。',
} as const;

/** 章立ての並び(BACKLOG の①〜⑤ + S13〜S15 追加の⑥「状態」)。 */
export const SECTIONS: readonly L2Section[] = ['状態遷移', '状態', '画面 × 操作', '読み取り経路', '通知', 'ジョブ'];

/**
 * グループ固有の追加列の見出し(`L2Row.extra` の値と対応する順序)。
 *
 * 「状態遷移」の「到達」「着地」は S13 / S15 と同じ探索・判定を再利用した事実の書き出しで
 * あり、この章自身は判定しない(合否は S13 / S15 が持つ)。「状態」の「可視性」は S14 と同じ。
 */
const EXTRA_HEADERS: Partial<Record<L2Section, readonly string[]>> = {
  状態遷移: ['到達(S13)', '着地(S15)'],
  状態: ['可視性(S14)'],
};

/** ページの導入(定型)。 */
export const LEAD =
  '「一通り試す」の母集合を仕様から機械的に導いた台帳である。行は 6 種類 —— ' +
  '状態遷移の成立/不成立(state_spec)・状態機械の各状態(state_spec。S13〜S15 追加分)・' +
  '画面が発火する操作(screen_spec の `actions`。S10 と同じ母集合)・' +
  '読み取り経路 × 実行ロール(query_spec)・通知(notification_spec)・ジョブ(job_spec) —— で、' +
  'いずれも `npm run verify` の A / S / N / J 群が使う母集合と同じ切り口である。' +
  '各行の「確認しているテスト」は、対応する仕様の `test_cases`(`covers` / `spec_ids`)から' +
  '機械的に引いたもので、**この章自身は何も判定しない**。' +
  '「状態遷移」の「到達(S13)」「着地(S15)」・「状態」の「可視性(S14)」の 3 列も同じ流儀の' +
  '追加列であり、判定器(S13〜S15)と同じ探索・同じ判定を再利用した**事実の書き出し**にすぎない' +
  '(合否はここでは出さない)。';

/** クエリの行の限界(定型)。 */
export const QUERY_NOTE =
  '**読み取り経路の行の注意**: query_spec の `test_cases` はロールを区別しない書き方の慣習であり' +
  '(`by_role` を使う実例が無い)、同じクエリの証拠は `for` に並ぶ全ロールの行へ同じものが並ぶ。';

/** 通知・ジョブの行の帰属規則(定型。束⑪a)。 */
export const CATALOG_NOTE =
  '**通知・ジョブの行の帰属規則**: 証拠は 2 種類を合わせたものである — ' +
  '`(導出)` は state_spec の `effects` からその通知・ジョブを積む遷移を辿り、action_spec の ' +
  '成功ケース(`covers: [success]`)を引いたもの。`(直接)` はカタログ全体の整合を確かめる ' +
  '`test_cases`(`spec_ids` にカタログ ID だけを挙げる書き方)と、その通知・ジョブ自身の ID を ' +
  '`spec_ids` に挙げる `test_cases` の両方を指す。`source: schedule` / `manual` のジョブは ' +
  '遷移(effects)の裏付けが無いため `(直接)` だけを持ち、それが 1 件も無ければ `npm run verify` の ' +
  'A13 がエラーにする(このスイープ自体は判定しない)。';

/** 章末の一覧の読み方(定型)。 */
export const TAIL_LEAD =
  '上のどの表でも「確認しているテスト」が 0 本だった行である。仕様上は存在する' +
  '(だから母集合に入っている)が、機械の突合ではどのテストとも結び付いていない —— ' +
  '人が手を動かして確かめるか、`test_cases` を書き足すかの対象になる。';

/** グループ 1 つ分の表(見出しと行。セルは共有の文)。対象が無ければ null。 */
export function sectionTable(section: L2Section, rows: readonly L2Row[]): { readonly headers: string[]; readonly rows: string[][] } | null {
  const forSection = rows.filter((row) => row.section === section);
  if (forSection.length === 0) return null;
  const extraHeaders = EXTRA_HEADERS[section] ?? [];
  return {
    headers: ['対象', '確認する観点', '手がかり', ...extraHeaders, '確認しているテスト'],
    rows: forSection.map((row) => [
      cell(row.subject),
      cell(row.aspect),
      cell(row.detail),
      ...(row.extra ?? extraHeaders.map(() => '')).map((value) => cell(value)),
      evidenceCell(row.evidence),
    ]),
  };
}

/** 証拠 0 件の行の 1 行(グループ横断の一覧の項目)。 */
export function tailLine(row: L2Row): string {
  return `[${row.section}] ${row.subject} — ${row.aspect}`;
}
