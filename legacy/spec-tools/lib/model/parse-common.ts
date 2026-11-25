/**
 * ドメイン仕様パーサーの共有基盤。
 *
 * ここに置くのは「YAML フロントマターの取り出し」と「V1(スキーマ適合)違反の記録」だけで、
 * ファイル I/O は行わない(I/O は loader.ts に集約する。規約: scripts-code-quality.md)。
 * doc_type ごとのパースは parse-role / parse-entity / parse-state / parse-access / parse-invariant が担う。
 */

import { readFrontMatter } from '../io/front-matter.js';
import type { Finding } from '../kernel/finding.js';
import type { SourceLocation } from './types.js';

/** ローダーが積む Finding の検証器 ID。ローダーが担うのは V1(スキーマ適合)のみ。 */
export const V1_VERIFIER_ID = 'V1';

/**
 * doc_type によらずどの文書のフロントマターにも書いてよいキー
 * (正: docs/rules/meta/standards/frontmatter_policy.md の共通キー表)。
 *
 * 仕様のスキーマをキーの allowlist で閉じる(`YamlReader.rejectUnknownKeys`)ときは、
 * スキーマ固有のキーに加えてこれを許す。ここを閉じてしまうと、方針上どの文書にも書ける
 * `norms:` / `decisions:` を仕様ファイルへ書いた瞬間に落ちるためである。
 */
export const META_FRONTMATTER_KEYS: readonly string[] = [
  'doc_type',
  'scope',
  'id',
  'norms',
  'decisions',
  'definitions',
  'deprecated',
  'audience',
  'stability',
];

/**
 * パース結果。
 * value が null は「その仕様を構築できなかった」ことを意味する。
 * 呼び出し側(loader)はその仕様を欠いたままモデル構築を続ける(モデル全体は捨てない)。
 */
export interface ParseResult<T> {
  /** 構築できた仕様。構造が壊れていて構築不能なら null。 */
  readonly value: T | null;
  /** 検出した V1 違反。value が非 null でも違反が含まれ得る(部分的に読み飛ばした場合)。 */
  readonly findings: readonly Finding[];
}

/**
 * 1 ファイル分の V1 違反を集める記録器。
 *
 * Finding の 3 点セット(何が = message / どこで = location / どう直すか = suggestion)を
 * 必ず埋めさせるため、message と suggestion を必須引数にしている。
 */
export class SpecReporter {
  private readonly file: string;
  private readonly collected: Finding[] = [];
  private droppedRows = 0;

  /**
   * @param file リポジトリルートからの相対パス(Finding の location.file に入る)
   */
  constructor(file: string) {
    this.file = file;
  }

  /**
   * このファイル内の位置を表す SourceLocation を作る。
   * @param pointer YAML パス(例: "events.submit")。ファイル全体を指すなら省略する。
   */
  location(pointer?: string): SourceLocation {
    return pointer === undefined ? { file: this.file } : { file: this.file, pointer };
  }

  /**
   * 仕様として受理できない違反を記録する。
   * @param pointer 違反箇所の YAML パス
   * @param message 何が問題か(1 文)
   * @param suggestion どう直すか(具体的な修正候補)
   * @param counterexample 違反の具体値(あれば)
   */
  error(
    pointer: string | undefined,
    message: string,
    suggestion: string,
    counterexample?: Readonly<Record<string, string>>,
  ): void {
    this.push('error', pointer, message, suggestion, counterexample);
  }

  /**
   * 受理はするが人間の確認を促す指摘を記録する(仕様ファイルの欠落など)。
   * 引数は error と同じ。
   */
  warn(
    pointer: string | undefined,
    message: string,
    suggestion: string,
    counterexample?: Readonly<Record<string, string>>,
  ): void {
    this.push('warning', pointer, message, suggestion, counterexample);
  }

  /** 記録済みの Finding のコピーを返す。 */
  findings(): readonly Finding[] {
    return [...this.collected];
  }

  /**
   * 読めずにモデルへ入れなかった行(リストの要素・必須のリスト 1 本ぶん)を数える。
   * ローダーが `droppedCount` で読み、入力の状態の「仕様を落としたか」(阻害)を決める。使うのは **0 かどうか**だけである
   * (行の中の必須のリストが読めなかったときは、その行の分と重なって数えるので、数そのものは目安)。
   * **行を落とさない違反**(未知のキー・id の重複で先の行が残る形)は数えない。
   *
   * @param count 落とした行の数(0 以下は数えない)
   */
  dropRows(count = 1): void {
    if (count > 0) this.droppedRows += count;
  }

  /**
   * リスト 1 本を読み終えたときに、落とした行を数える(読んだ行 − 残した行 − 重複で先の行が残った行)。
   *
   * @param read リストの要素の数
   * @param kept モデルに入れた行の数
   * @param duplicates id の重複で落とした行の数(先に出た同じ id の行がモデルに残っているので、仕様は欠けない)
   *   読んだ行より残した行と重複の合計が多いのは数え方の不具合なので、error として出す(黙って 0 にしない・投げない)。
   */
  settleRows(read: number, kept: number, duplicates = 0): void {
    const unaccounted = read - kept - duplicates;
    if (unaccounted < 0) {
      // 勘定の食い違い = パーサーの数え方の不具合(残した行が読んだ行より多い)。黙って 0 にせず、検証の出力に出して開発時に気づけるようにする。
      this.error(
        undefined,
        `落とした行の勘定が合いません(読んだ ${read} 行 < 残した ${kept} 行 + 重複 ${duplicates} 行)`,
        'パーサーの settleRows の引数(読んだ行・残した行・重複した行の数え方)を見直す(仕様の誤りではなく検証器の不具合)',
      );
      return;
    }
    this.dropRows(unaccounted);
  }

  /** `dropRows` / `settleRows` が数えた、落とした行の合計。 */
  droppedCount(): number {
    return this.droppedRows;
  }

  private push(
    severity: Finding['severity'],
    pointer: string | undefined,
    message: string,
    suggestion: string,
    counterexample?: Readonly<Record<string, string>>,
  ): void {
    const base = {
      verifier: V1_VERIFIER_ID,
      severity,
      message,
      location: this.location(pointer),
      suggestion,
    } as const;
    this.collected.push(counterexample === undefined ? base : { ...base, counterexample });
  }
}

/**
 * unknown が YAML のマッピング(プレーンなオブジェクト)かを判定して絞り込む。
 * 配列と null はマッピングとして扱わない。
 */
export function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Readonly<Record<string, unknown>>;
}

/** unknown が YAML のシーケンス(配列)かを判定して絞り込む。 */
export function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? (value as readonly unknown[]) : null;
}

/**
 * 配列要素の YAML パスを作る。
 * id が分かっているときは人間が探しやすい id 形式(例: "events.submit")、
 * 分からないときは添字形式(例: "events[2]")を使う。
 */
export function elementPointer(base: string, index: number, id?: string): string {
  return id === undefined || id === '' ? `${base}[${index}]` : `${base}.${id}`;
}

/**
 * Markdown 文字列から YAML フロントマターを取り出す。
 *
 * 読み取り(`lib/io/front-matter.ts`)は拒む入力(言語の指定・壊れた YAML・大きすぎる・別名の爆発・
 * 禁じるキー)を例外ではなく結果で返すので、ここで Finding に変換して null を返す
 * (パーサーは例外で違反を報告しない。規約: scripts-code-quality.md)。**拒んだファイルは「読めない」として
 * null を返し、空のフロントマターとして先へ進めない**。
 *
 * @param source Markdown ファイルの中身
 * @param reporter 違反の記録先
 * @returns フロントマターのマッピング。取り出せない場合は null
 */
export function parseFrontmatter(
  source: string,
  reporter: SpecReporter,
): Readonly<Record<string, unknown>> | null {
  const result = readFrontMatter(source);
  if (result.kind === 'rejected') {
    reporter.error(undefined, result.message, result.suggestion);
    return null;
  }
  const record = result.kind === 'ok' ? asRecord(result.data) : null;
  if (record === null || Object.keys(record).length === 0) {
    reporter.error(
      undefined,
      'YAML フロントマターがありません',
      'ファイル先頭を "---" で開き、doc_type から始まる YAML を書いて "---" で閉じる',
    );
    return null;
  }
  return record;
}

/**
 * doc_type がこのファイルに期待されるものかを確認する。
 * 一致しなくてもパースは続行する(残りの構造も一度に指摘したいため)。
 *
 * @param record フロントマター
 * @param expected 期待する doc_type(例: "state_spec")
 * @param reporter 違反の記録先
 */
export function checkDocType(
  record: Readonly<Record<string, unknown>>,
  expected: string,
  reporter: SpecReporter,
): void {
  const actual = record['doc_type'];
  if (actual === expected) return;
  if (actual === undefined) {
    reporter.error('doc_type', 'doc_type がありません', `フロントマターの先頭に doc_type: ${expected} を書く`, {
      expected,
    });
    return;
  }
  reporter.error(
    'doc_type',
    `doc_type が ${expected} ではありません`,
    `このファイル名で置ける doc_type は ${expected} のみ。doc_type: ${expected} に直すか、内容に合ったファイル名に移す`,
    { expected, actual: String(actual) },
  );
}
