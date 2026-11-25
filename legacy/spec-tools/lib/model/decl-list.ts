/**
 * ディレクトリガイド(README.md)のフロントマターに書かれた**宣言リスト**を読む共通ローダー。
 *
 * 「網羅の宣言」と「免除の宣言」は群をまたいで同じ形をしている —
 * README のフロントマターにキーを 1 つ作り、その下に**必須の文字列フィールドだけを持つ
 * マッピング**を並べる。読み方の規則も同じである。
 *
 *   - README にフロントマターが無い / キーが無いのは**正常**(宣言なし)であり、違反にしない
 *   - 書き方が壊れているとき(リストでない・マッピングでない・フィールド欠落)だけ違反を積む
 *   - 先頭のフィールドが識別子で、YAML パス(`{key}.{識別子}`)と指摘文の主語になる
 *   - 2 つ目以降のフィールドが空文字なのは「理由を書いたつもりで書いていない」なので違反にする
 *
 * A4 の `unhandled` / A10 の `scans`・`unscanned`(specs/backend/actions/README.md)、
 * S10 の `unexposed` / S13 の `unreachable_states` 等(specs/frontend/screens/README.md)がこれを共有する。
 * 3 コピー目を書く時点で規則が同じであることが確定したため、ここへ集約した。
 * **免除の書式が群ごとに散らないこと自体が目的**であり、増えるのは呼び出し側の 1 宣言だけになる。
 *
 * トップレベルのキーは allowlist(共通 frontmatter キー + `specs` が宣言するキー)で閉じる。
 * `unexposd:` のような綴り違いは `record[spec.key] === undefined` になるだけで
 * 「宣言なし」として黙って通っていた(access_spec の `table:` → `tabel:` と同族の穴)。
 *
 * ここは fs に触れる層であり、検証器からは import しない
 * (規約: scripts-code-quality.md「I/O と純粋ロジックの分離」)。
 */

import { readFileSync } from 'node:fs';
import type { Finding } from '../kernel/finding.js';
import type { SourceLocation } from './types.js';
import { asRecord, META_FRONTMATTER_KEYS, SpecReporter } from './parse-common.js';
import { parseSafeFrontmatter } from './safe-frontmatter.js';
import { eachRecord, YamlReader } from './yaml-reader.js';
import { isFile } from '../io/paths.js';

/** 読み取った宣言 1 件。値は宣言したフィールド名で引く。 */
export interface Decl {
  /** フィールド名 → 書かれた文字列(宣言した全フィールドが揃っているものだけが作られる)。 */
  readonly values: Readonly<Record<string, string>>;
  /** `{key}.{識別子}` を指す位置(指摘の「どこで」になる)。 */
  readonly location: SourceLocation;
}

/**
 * 1 つのキーの読み方。
 *
 * `fields` は**すべて必須の文字列**として読む。任意フィールドを持つ宣言はここでは表せない
 * (今のところ全群が「識別子 + 理由」の形をしており、緩めると書式が群ごとに散る)。
 */
export interface DeclListSpec {
  /** フロントマターのキー(例: `unhandled`)。 */
  readonly key: string;
  /** 必須の文字列フィールド(宣言順)。**先頭が識別子**。 */
  readonly fields: readonly string[];
  /** 書き方が壊れているときの「どう直すか」。 */
  readonly suggestion: string;
  /**
   * 位置と指摘文に使う識別子(既定は先頭フィールドの値)。
   * 先頭フィールド 1 つでは一意にならない宣言(U 群の `check` + `subject`)のために開けてある。
   */
  readonly identify?: (values: Readonly<Record<string, string>>) => string;
  /** 2 つ目以降のフィールドが空文字だったときの「どう直すか」(既定は「{識別子} の {field} を書く」)。 */
  readonly emptySuggestion?: (id: string, field: string) => string;
}

/** readDeclLists の入力。 */
export interface ReadDeclListsOptions {
  /** README.md の絶対パス。存在しなければ「宣言なし」を返す。 */
  readonly absolute: string;
  /** Finding の location.file に入れるリポジトリルートからの相対パス。 */
  readonly file: string;
  /** 積む Finding の検証器 ID(スキーマ違反なので各群の 0 番: A0 / S0 など)。 */
  readonly verifierId: string;
  /** 読むキーの一覧(宣言順に読み、違反もこの順で並ぶ)。 */
  readonly specs: readonly DeclListSpec[];
}

/** readDeclLists の結果。 */
export interface ReadDeclListsResult {
  /** キー → 読み取れた宣言。宣言が無いキーも空配列で必ず存在する。 */
  readonly decls: ReadonlyMap<string, readonly Decl[]>;
  /** 書き方の違反(verifierId で branding 済み)。 */
  readonly findings: readonly Finding[];
}

/**
 * README.md のフロントマターから宣言リストを読む。
 *
 * @param options 対象ファイルと読むキーの一覧
 * @returns キーごとの宣言と、書き方の違反
 */
export function readDeclLists(options: ReadDeclListsOptions): ReadDeclListsResult {
  const empty = new Map<string, readonly Decl[]>(options.specs.map((spec) => [spec.key, []]));
  if (!isFile(options.absolute)) return { decls: empty, findings: [] };

  // フロントマター自体の欠落は README では正常なので、取り出しの違反は捨てる
  const source = readText(options.absolute);
  const quiet = new SpecReporter(options.file);
  const record = source === null ? null : asRecord(parseSafeFrontmatter(source, quiet));
  if (record === null) return { decls: empty, findings: [] };

  const reporter = new SpecReporter(options.file);
  // 綴り違いのキー(`unexposd:` 等)は record[spec.key] が undefined になるだけで
  // 「宣言なし」として黙って通ってしまう。allowlist で閉じ、知らないキーを違反にする
  // (access_spec の C-26 と同じ判断・同じ機構 = YamlReader.rejectUnknownKeys)。
  const allowedKeys = [...META_FRONTMATTER_KEYS, ...options.specs.map((spec) => spec.key)];
  new YamlReader(record, '', reporter).rejectUnknownKeys(
    allowedKeys,
    'README のフロントマター',
    `綴りを直すか、書けるキー(${options.specs.map((spec) => spec.key).join(' / ')})に合わせてください`,
  );
  const decls = new Map<string, readonly Decl[]>();
  for (const spec of options.specs) decls.set(spec.key, readOne(record, spec, reporter));
  return {
    decls,
    findings: reporter.findings().map((finding) => ({ ...finding, verifier: options.verifierId })),
  };
}

/**
 * 宣言 1 件からフィールドの値を取り出す。
 *
 * 宣言は全フィールドが揃ったものだけが作られるので既定値は使われないが、
 * 添字アクセスの `undefined` を呼び出し側に漏らさないための入口をここに 1 つ置く。
 *
 * @param decl 読み取った宣言
 * @param field フィールド名(DeclListSpec.fields に書いたもの)
 * @returns 書かれた文字列
 */
export function declValue(decl: Decl, field: string): string {
  return decl.values[field] ?? '';
}

/** 1 つのキーを読む。キーが無ければ「宣言なし」。 */
function readOne(
  record: Readonly<Record<string, unknown>>,
  spec: DeclListSpec,
  reporter: SpecReporter,
): readonly Decl[] {
  if (record[spec.key] === undefined) return [];
  const items = new YamlReader(record, '', reporter).optionalList(spec.key, spec.suggestion);
  const decls: Decl[] = [];
  eachRecord(items, spec.key, reporter, spec.suggestion, (reader) => {
    // 欠落は 1 件ずつ全部言う。先に見つかった 1 つで打ち切ると、書き直して再実行するたびに
    // 次の欠落が出てくる「もぐら叩き」になる。
    const values: Record<string, string> = {};
    let complete = true;
    for (const field of spec.fields) {
      const value = reader.requiredString(field, spec.suggestion);
      if (value === null) {
        complete = false;
        continue;
      }
      values[field] = value;
    }
    if (!complete) return;

    const id = spec.identify === undefined ? (values[spec.fields[0] ?? ''] ?? '') : spec.identify(values);
    const pointer = `${spec.key}.${id}`;
    if (hasBlank(values, spec, id, pointer, reporter)) return;
    decls.push({ values, location: reporter.location(pointer) });
  });
  return decls;
}

/** 2 つ目以降のフィールドの空文字を違反として記録する。1 件でもあれば宣言は作らない。 */
function hasBlank(
  values: Readonly<Record<string, string>>,
  spec: DeclListSpec,
  id: string,
  pointer: string,
  reporter: SpecReporter,
): boolean {
  const head = spec.fields[0] ?? '';
  for (const field of spec.fields.slice(1)) {
    if ((values[field] ?? '').trim() !== '') continue;
    const suggestion =
      spec.emptySuggestion === undefined ? `${id} の ${field} を書く` : spec.emptySuggestion(id, field);
    reporter.error(pointer, `${id} の ${field} が空です`, suggestion, { [head]: values[head] ?? '' });
    return true;
  }
  return false;
}

/** ファイルを読む。読めない場合は null(README が読めないことは違反にしない)。 */
function readText(absolute: string): string | null {
  try {
    return readFileSync(absolute, 'utf8');
  } catch {
    return null;
  }
}
