/**
 * migration の**採番**(C23 の 2 つめの判定)。
 *
 * 規約(migrations.md §採番)が「すべきこと」として名指しているのは 1 つである ——
 * **`ls supabase/migrations/ | tail -1` の次の番号を使う**。そこから 2 つの「してはいけない
 * こと」が出る: **連番を日ごとに振り直す**ことと、**一度捨てた欠番を後から埋める**ことである。
 * どちらも「辞書順で最後のファイルの次」という 1 つの規則で言い切れる。
 *
 * この規約は 2026-09 まで執行者を持たなかった(enforcement-matrix の D19 が「採番形式は
 * 未実装」と書いていた)。実際に振り直しが 1 度出ている。
 *
 * ## 判定は「基点の末尾の次に並ぶか」である
 *
 * この変更が**足した**ファイルについて、次の 2 つを見る。
 *
 *   1. **辞書順で基点の末尾より後に並ぶ**こと(Supabase CLI は辞書順に当てる)
 *   2. **6 桁連番が末尾の連番より大きい**こと(日付をまたいでも振り直さない)
 *
 * 足したファイルが 2 本以上あるときは、末尾が 1 本ずつ進む(`a1 > 末尾` かつ `a2 > a1` …)。
 *
 * **「隣どうしだけ」では足りない。** 前後の 1 本ずつと比べる形にすると、**既存の欠番の内側**に
 * 挿したファイルが前後の単調性を保ってしまい必ず素通りする —— このリポジトリには欠番が
 * 8 区間(最大 34 個)残っているので、理論上の穴ではない(独立レビュー 2026-09-23 が実データで
 * 再現した)。欠番を埋めるのは規約が名指しで禁じている行為である(「一度捨てた番号を後から
 * 別の内容で使うと、その番号が何を指すかが履歴の時点によって変わる」)。
 *
 * **「連番の最大」とも比べない。** 歴史には時刻ベースの採番が混入した回があり(`…120003` =
 * 連番 120003)、それが全体の最大である。素朴な max ルールは**以後のすべての追加を赤にする**。
 * 辞書順の末尾と比べれば、その回は「末尾」ではないので影響しない。
 *
 * ## 歴史に残る破れは触らない
 *
 * 破れは 2 件ある —— 時刻ベースの採番が混入した回と、日ごとに振り直した回である。
 * **適用済み migration は書き換えない**(C23 の 1 つめの判定)ので、どちらも改名でしか直せず、
 * 直せない。判定の母集合が「足したファイル」なので、基点どうしの比較は 1 度も起きない ——
 * 免除リストではない(名前を並べた表はどこにも無い)。
 *
 * 判定は純関数であり、git の呼び出しと印字は CLI(`cli/check-migrations.ts`)が持つ
 * (`migration-immutability.ts` と同じ分け方)。
 */

import { migrationDir } from './migration-immutability.js';
import type { ProductRoots } from '../model/product/types.js';

/** ファイル名の形(`{8 桁の日付}{6 桁の連番}_{説明}.sql`)。 */
const FILE_NAME = /^(\d{8})(\d{6})_[a-z0-9_]+\.sql$/;

/** 採番の破れ 1 件。 */
export interface NumberingViolation {
  /** 新しく足したファイル。 */
  readonly file: string;
  /**
   * 破り方。
   *
   * - `末尾より前` … 辞書順で末尾より前に並ぶ(**欠番埋め**・過去日の採番がここに来る)
   * - `連番の逆行` … 辞書順では後ろだが連番が末尾以下(**日ごとの振り直し**がここに来る)
   * - `読めない名前` … 連番を読めないので判定できない
   */
  readonly kind: '末尾より前' | '連番の逆行' | '読めない名前';
  /** 比べた相手(その時点の末尾。`読めない名前` では無い)。 */
  readonly tail?: string;
}

/**
 * ファイル名から 6 桁連番を読む。
 *
 * @param path migration のパス(ディレクトリを含んでよい)
 * @returns 連番。名前が形式どおりでなければ null
 */
export function sequenceOf(path: string): number | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const found = FILE_NAME.exec(name);
  const sequence = found?.[2];
  return sequence === undefined ? null : Number(sequence);
}

/** 検査対象の migration ファイルか。 */
function isMigration(file: string, roots: ProductRoots): boolean {
  return file.startsWith(migrationDir(roots)) && file.endsWith('.sql');
}

/** 辞書順(`localeCompare` に頼らない —— ファイル名は ASCII である)。 */
function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 採番の破れを取り出す。
 *
 * 足したファイルを辞書順に並べ、**基点の末尾**から 1 本ずつ「その次に並ぶか」を見る。
 * 名前が読めない追加は判定できないので、そのまま違反にする —— 検査は分からないときに黙らない。
 *
 * @param baseFiles 基点のコミットに存在した migration(パス)
 * @param addedFiles この変更が足した migration(パス)
 * @returns 破れの一覧(ファイル名順)
 */
export function numberingViolations(
  baseFiles: readonly string[],
  addedFiles: readonly string[],
  roots: ProductRoots,
): NumberingViolation[] {
  const added = [...new Set(addedFiles.filter((file) => isMigration(file, roots)))].sort(byName);
  const violations: NumberingViolation[] = [];
  // 基点の辞書順の末尾(規約の「置き場を並べて末尾を見る」そのもの)。
  let tail = baseFiles.filter((file) => isMigration(file, roots)).sort(byName).at(-1);
  for (const file of added) {
    const sequence = sequenceOf(file);
    if (sequence === null) {
      violations.push({ file, kind: '読めない名前' });
      continue;
    }
    const tailSequence = tail === undefined ? null : sequenceOf(tail);
    if (tail !== undefined && tailSequence !== null) {
      if (byName(file, tail) <= 0) violations.push({ file, kind: '末尾より前', tail });
      else if (sequence <= tailSequence) violations.push({ file, kind: '連番の逆行', tail });
    }
    // 次の追加はこのファイルを末尾として見る(2 本以上足したときに互いの順序も見るため)。
    tail = file;
  }
  return violations.sort((a, b) => byName(a.file, b.file));
}

/** 破り方ごとの直し方。 */
const REMEDY: Readonly<Record<NumberingViolation['kind'], string>> = {
  末尾より前:
    '**辞書順で最後のファイルの次**に採番する(`ls supabase/migrations/ | tail -1` の次)。' +
    '**欠番は埋めない** —— 一度捨てた番号を後から別の内容で使うと、その番号が何を指すかが' +
    '履歴の時点によって変わる(生成 migration なら仕様側の `migration:` / ' +
    '`policies_migration:` / `ddl_migration:` / `surface_migration:` の宣言を直してから再生成する)',
  連番の逆行:
    '**連番はリポジトリ全体を通した 1 本**である(日付が変わってもリセットしない)。' +
    '`ls supabase/migrations/ | tail -1` の連番より大きい番号に採番し直す' +
    '(生成 migration なら仕様側の宣言を直してから再生成する)',
  読めない名前:
    'ファイル名を `{8 桁の日付}{6 桁の連番}_{小文字と _ の説明}.sql` の形にする' +
    '(例: `20260904000042_update_member_discord_user_id.sql`)',
};

/** 日付の 8 桁を採る暦(migration の日付部分は日本時間の暦日で採ってきた)。 */
const NUMBERING_TIMEZONE = 'Asia/Tokyo';

/**
 * 「今日」の 8 桁(`YYYYMMDD`)。
 *
 * 暦日は `Asia/Tokyo` で採る —— 実行環境のタイムゾーンで採ると、UTC の CI が印字する日付と
 * 手元(JST)で印字する日付が 9 時間ぶんずれ、同じ破れに対して違う番号を薦めることになる
 * (datetime.md「表示は `Asia/Tokyo` を明示する」と同じ線引き)。
 *
 * 時計は引数で受け取る(この層は純関数であり、`new Date()` を呼ぶのは CLI である)。
 *
 * @param now 現在時刻
 * @returns `YYYYMMDD` の 8 桁
 */
export function dateStamp(now: Date): string {
  // ロケール依存の並びを避けるため、部品で取り出して自分で並べる。
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: NUMBERING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const of = (type: 'year' | 'month' | 'day'): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${of('year')}${of('month')}${of('day')}`;
}

/**
 * **次に使う番号**(末尾の連番 + 1・日付は今日)。
 *
 * 直し方が「`ls supabase/migrations/ | tail -1` の次」であることは規約が言い切っているが、
 * その「次」を人が手で足すあいだに 1 回ぶん間違える(日付を今日に直し忘れる・連番を日ごとに
 * 振り直す)—— どちらもこの検査が赤にする形そのものである。判定の側は末尾を既に知っている
 * ので、番号まで名指す。
 *
 * 比べる相手は**破れたファイルごとの末尾のうち最大**である(足したファイルが 2 本以上あると
 * 末尾は 1 本ずつ進む)。破れが `読めない名前` だけなら末尾が無いので番号は出せない。
 *
 * @param violations `numberingViolations` の結果
 * @param today 今日の 8 桁(`dateStamp`)
 * @returns 次に使う 14 桁。末尾を持つ破れが 1 件も無ければ null
 */
export function nextNumber(violations: readonly NumberingViolation[], today: string): string | null {
  const sequences = violations
    .map((violation) => (violation.tail === undefined ? null : sequenceOf(violation.tail)))
    .filter((sequence): sequence is number => sequence !== null);
  if (sequences.length === 0) return null;
  return `${today}${String(Math.max(...sequences) + 1).padStart(6, '0')}`;
}

/**
 * 破れの報告文を組み立てる(1 件 2 行 —— 何が・どう直すか)。
 *
 * 末尾が分かっているときは**次に使う番号**を 1 行足す(`nextNumber`)。
 *
 * @param violations `numberingViolations` の結果
 * @param base 基点の説明(どこと比べた結果かを人に返すため)
 * @param today 今日の 8 桁(`dateStamp`。次に使う番号の日付部分になる)
 * @returns 出力する行の並び(空なら呼び出し側は何も出さない)
 */
export function formatNumberingViolations(
  violations: readonly NumberingViolation[],
  base: string,
  today: string,
): string[] {
  if (violations.length === 0) return [];
  const lines = [`C23 migration の採番: ${violations.length} 件(基点 ${base} からの追加を見ています)`];
  for (const violation of violations) {
    const where =
      violation.tail === undefined ? violation.file : `${violation.file}(辞書順の末尾は ${violation.tail})`;
    lines.push(`  - [${violation.kind}] ${where}`);
    lines.push(`    直し方: ${REMEDY[violation.kind]}`);
  }
  const next = nextNumber(violations, today);
  if (next !== null) {
    lines.push(
      `  次に使う番号: ${next}(辞書順の末尾の連番 + 1・日付は今日。` +
        '2 本以上足すならここから 1 つずつ進める)',
    );
  }
  lines.push(
    '  正: docs/rules/process/backend/system/standards/conventions/migrations.md §採番' +
      'の「すべきこと: `ls supabase/migrations/ | tail -1` の次の番号を使う」' +
      '(Supabase CLI はファイル名の辞書順に当てるので、日付と連番の両方が単調でなければならない)',
  );
  return lines;
}

/**
 * `git diff --name-status` の結果から「この変更が足したファイル」を取り出す。
 *
 * 追加(`A`)と複製(`C`)は新しいパス、改名(`R`)は改名先が新しいパスである
 * (改名そのものは C23 の 1 つめの判定が落とすが、採番の側も黙らせない)。
 *
 * @param changes `parseNameStatus` の結果
 * @returns 新しく現れたパスの一覧
 */
export function addedPaths(
  changes: readonly { readonly status: string; readonly path: string; readonly renamedTo?: string }[],
): string[] {
  return changes.flatMap((change) => {
    if (change.status.startsWith('A')) return [change.path];
    if (change.status.startsWith('R') || change.status.startsWith('C')) {
      return change.renamedTo === undefined ? [] : [change.renamedTo];
    }
    return [];
  });
}
