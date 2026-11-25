/**
 * YAML マッピングから型付きの値を取り出す読み取り器。
 *
 * 外部入力(YAML)の型付けはこのパース境界だけで行い、以降は型付きモデルだけを流す
 * (規約: scripts-code-quality.md「any 禁止」)。取り出しに失敗した値は SpecReporter に
 * V1 違反として記録され、null / undefined として返る。
 *
 * **書かれているのに型違いで読み飛ばした値・既定値に戻した値は、ここで落とした行として数える**(`SpecReporter.dropRows`。
 * 数え忘れると error は出るのに入力の状態は「読込済み」のまま、弱くなったモデルで検査・生成が走る)。
 * 値が無い(欠落・null)場合と、読めた上での意味の違反(値域の外など)は、各パーサーが判断する。
 */

import { asArray, asRecord, type SpecReporter } from './parse-common.js';

/** 1 つの YAML マッピングに対する読み取り器。base はそのマッピングの YAML パス。 */
export class YamlReader {
  private readonly record: Readonly<Record<string, unknown>>;
  private readonly base: string;
  private readonly reporter: SpecReporter;

  /**
   * @param record 読み取り対象のマッピング
   * @param base このマッピングの YAML パス(トップレベルなら空文字)
   * @param reporter 違反の記録先
   */
  constructor(record: Readonly<Record<string, unknown>>, base: string, reporter: SpecReporter) {
    this.record = record;
    this.base = base;
    this.reporter = reporter;
  }

  /** キーの YAML パスを返す(例: base="events[0]", key="to" → "events[0].to")。 */
  pointer(key: string): string {
    return this.base === '' ? key : `${this.base}.${key}`;
  }

  /** キーが存在するか(値が null でも「書かれている」と見なす)。 */
  has(key: string): boolean {
    return this.record[key] !== undefined;
  }

  /** 生の値をそのまま返す。型の判別を呼び出し側で行いたい場合に使う。 */
  raw(key: string): unknown {
    return this.record[key];
  }

  /**
   * このマッピングに書けるキーを allowlist で閉じる(知らないキーは V1 違反)。
   *
   * 列挙を「禁止」ではなく「許可」の側にするのは、**綴りを間違えた宣言・スキーマに無い宣言が
   * 黙って無視される**のを防ぐためである(`when:` を書いたのにパーサーが読まない、
   * `table:` を `tabel:` と書いた、など)。読まれないキーは「書いたのに効いていない」という
   * 最も危険な型の穴を作るので、パース境界でエラーにする。
   *
   * @param allowed 書いてよいキーの全体
   * @param what 人間に示すこのマッピングの呼び名(例: "access_spec" / "reads の要素")
   * @param suggestion どう直すか(呼び出し側の文脈に応じた具体文)
   */
  rejectUnknownKeys(allowed: readonly string[], what: string, suggestion: string): void {
    for (const key of Object.keys(this.record)) {
      if (allowed.includes(key)) continue;
      this.reporter.error(this.pointer(key), `${what} に ${key} は書けません`, suggestion, {
        key,
        allowed: allowed.join(', '),
      });
    }
  }

  /**
   * 必須の文字列を取り出す。欠落・型不正は V1 違反として記録し null を返す。
   * @param suggestion どう直すか(呼び出し側の文脈に応じた具体文)
   */
  requiredString(key: string, suggestion: string): string | null {
    const value = this.record[key];
    if (value === undefined || value === null) {
      this.reporter.error(this.pointer(key), `${key} がありません`, suggestion);
      return null;
    }
    return this.coerceString(key, value, suggestion);
  }

  /**
   * 任意の文字列を取り出す。欠落は違反にせず undefined を返す。
   * 書かれているが文字列でない場合のみ V1 違反として記録する(落とした宣言として数える)。
   */
  optionalString(key: string, suggestion: string): string | undefined {
    const value = this.record[key];
    if (value === undefined || value === null) return undefined;
    return this.coerceString(key, value, suggestion) ?? undefined;
  }

  /**
   * 任意の**注記**(判定に使われず、読み手への説明だけの文字列欄)を取り出す。型違いは違反として記録するが、落とした宣言としては数えない
   * (注記を読み飛ばしても検査・生成の判定は変わらない。数えると、注記 1 つの書き間違いで表やカタログ全体が阻害になる)。
   */
  optionalNote(key: string, suggestion: string): string | undefined {
    const value = this.record[key];
    if (typeof value === 'string') return value;
    if (value !== undefined && value !== null) this.reporter.error(this.pointer(key), `${key} は文字列で書きます`, suggestion, { value: String(value) });
    return undefined;
  }

  /**
   * 任意の表示名(`label`)を取り出す。空文字・空白だけの label は「書いたのに表示名になっていない」
   * 宣言なので違反として記録し、モデルには載せない(決めていないならキーごと書かない)。
   * 表示名を持てる宣言はどれも同じ規則なので、判定はここ 1 か所に置く。
   */
  optionalLabel(key: string, suggestion: string): string | undefined {
    const value = this.optionalString(key, suggestion);
    if (value === undefined) return undefined;
    if (value.trim() !== '') return value;
    this.reporter.error(this.pointer(key), `${key} が空です`, suggestion);
    return undefined;
  }

  /**
   * 必須のシーケンスを取り出す。欠落・型不正は V1 違反として記録し null を返す(読めなかったリスト 1 本を落とした行 1 件として数える)。
   * 空配列は許容する(空であることの是非は各パーサーが判断する)。
   */
  requiredList(key: string, suggestion: string): readonly unknown[] | null {
    const value = this.record[key];
    const absent = value === undefined || value === null;
    const list = absent ? null : asArray(value);
    if (list !== null) return list;
    const message = absent ? `${key} がありません` : `${key} はリストで書きます`;
    this.reporter.error(this.pointer(key), message, absent ? suggestion : `${suggestion}(各要素を "- " で始まる行として並べる)`);
    this.reporter.dropRows();
    return null;
  }

  /** 任意のシーケンスを取り出す。欠落なら空配列、型不正は違反を記録して空配列(落とした行 1 件として数える)。 */
  optionalList(key: string, suggestion: string): readonly unknown[] {
    const value = this.record[key];
    if (value === undefined || value === null) return [];
    const list = asArray(value);
    if (list === null) {
      this.reporter.error(this.pointer(key), `${key} はリストで書きます`, suggestion);
      this.reporter.dropRows();
      return [];
    }
    return list;
  }

  /**
   * 必須の文字列リストを取り出す。文字列でない要素は読み飛ばして違反を記録する(落とした行として数える)。
   * @param allowEmpty false のとき、空リストを V1 違反として記録し null を返す(「書かれていない」と同じ意味になるため)
   */
  requiredStringList(key: string, suggestion: string, allowEmpty = true): readonly string[] | null {
    const list = this.requiredList(key, suggestion);
    if (list === null) return null;
    const values = this.collectStrings(key, list, suggestion);
    if (!allowEmpty && values.length === 0) {
      this.reporter.error(this.pointer(key), `${key} が空です`, suggestion);
      return null;
    }
    return values;
  }

  /** 任意の文字列リストを取り出す。欠落なら空配列。 */
  optionalStringList(key: string, suggestion: string): readonly string[] {
    const list = this.optionalList(key, suggestion);
    return this.collectStrings(key, list, suggestion);
  }

  /** 任意の真偽値を取り出す。欠落時は defaultValue、型不正は違反を記録し(既定値に戻った宣言として数え)defaultValue を返す。 */
  optionalBoolean(key: string, suggestion: string, defaultValue = false): boolean {
    const value = this.record[key];
    if (value === undefined || value === null) return defaultValue;
    if (typeof value !== 'boolean') {
      this.reporter.error(this.pointer(key), `${key} は true / false で書きます`, suggestion, { value: String(value) });
      this.reporter.dropRows();
      return defaultValue;
    }
    return value;
  }

  /**
   * 必須の真偽値を取り出す。欠落・型不正は V1 違反として記録し null を返す(型不正は落とした宣言として数える。
   * `optionalBoolean` と違い、「暗黙に false にする」を許さない宣言のためのもの)。
   */
  requiredBoolean(key: string, suggestion: string): boolean | null {
    const value = this.record[key];
    if (value === undefined || value === null) {
      this.reporter.error(this.pointer(key), `${key} がありません`, suggestion);
      return null;
    }
    if (typeof value !== 'boolean') {
      this.reporter.error(this.pointer(key), `${key} は true / false で書きます`, suggestion, { value: String(value) });
      this.reporter.dropRows();
      return null;
    }
    return value;
  }

  /** 任意の数値を取り出す。欠落・型不正なら undefined(型不正は違反として記録し、落とした宣言として数える)。 */
  optionalNumber(key: string, suggestion: string): number | undefined {
    const value = this.record[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.reporter.error(this.pointer(key), `${key} は数値で書きます`, suggestion, { value: String(value) });
      this.reporter.dropRows();
      return undefined;
    }
    return value;
  }

  /**
   * 任意の「文字列 → 文字列」の写像を取り出す(entity_spec の context など)。
   * 欠落なら空オブジェクト。値が文字列でないキーは読み飛ばして違反を記録する(落とした行として数える)。
   */
  optionalStringMap(key: string, suggestion: string): Readonly<Record<string, string>> {
    const value = this.record[key];
    if (value === undefined || value === null) return {};
    const record = asRecord(value);
    if (record === null) {
      this.reporter.error(this.pointer(key), `${key} はマッピングで書きます`, suggestion);
      this.reporter.dropRows();
      return {};
    }
    const result: Record<string, string> = {};
    for (const [name, entry] of Object.entries(record)) {
      if (typeof entry === 'string') {
        result[name] = entry;
        continue;
      }
      this.reporter.error(`${this.pointer(key)}.${name}`, `${key}.${name} は文字列で書きます`, suggestion, { value: String(entry) });
      this.reporter.dropRows();
    }
    return result;
  }

  /**
   * 任意の「文字列 または 明示的な null」を取り出す(例: personal_placeholder — NOT NULL でない
   * 列は消去時に NULL にする、という宣言を null リテラルで書ける)。
   *
   * 欠落は undefined(呼び出し側が `has` で「書かれているか」を別途見る)、明示的な null は
   * null、文字列はそのまま返す。文字列でも null でもない値は V1 違反として記録し(落とした宣言として数え)undefined。
   */
  optionalStringOrNull(key: string, suggestion: string): string | null | undefined {
    if (!this.has(key)) return undefined;
    const value = this.record[key];
    if (value === null) return null;
    return this.coerceString(key, value, suggestion) ?? undefined;
  }

  private coerceString(key: string, value: unknown, suggestion: string): string | null {
    if (typeof value === 'string') return value;
    this.reporter.error(this.pointer(key), `${key} は文字列で書きます`, suggestion, { value: String(value) });
    this.reporter.dropRows();
    return null;
  }

  private collectStrings(key: string, list: readonly unknown[], suggestion: string): readonly string[] {
    const values: string[] = [];
    list.forEach((item, index) => {
      if (typeof item === 'string') {
        values.push(item);
        return;
      }
      this.reporter.error(`${this.pointer(key)}[${index}]`, `${key}[${index}] は文字列で書きます`, suggestion, { value: String(item) });
      this.reporter.dropRows();
    });
    return values;
  }
}

/**
 * シーケンスの各要素をマッピングとして順に読む。
 *
 * 要素がマッピングでない場合は V1 違反として記録し、その要素だけ読み飛ばす
 * (1 件の書き間違いで残りの要素の指摘が消えないようにするため)。読み飛ばした要素を落とした行として数えるのは、リストを読み終えた
 * 呼び手(`SpecReporter.settleRows`: 読んだ行 − 残した行 − 重複)である —— ここでも数えると二重になる。
 *
 * @param items 対象のシーケンス
 * @param base シーケンスの YAML パス(例: "events")
 * @param reporter 違反の記録先
 * @param suggestion 要素がマッピングでない場合の修正案
 * @param visit 要素ごとの処理。reader の base は "{base}[{index}]" になる
 */
export function eachRecord(
  items: readonly unknown[],
  base: string,
  reporter: SpecReporter,
  suggestion: string,
  visit: (reader: YamlReader, index: number) => void,
): void {
  items.forEach((item, index) => {
    const record = asRecord(item);
    if (record === null) {
      reporter.error(`${base}[${index}]`, `${base}[${index}] はマッピングで書きます`, suggestion, { value: String(item) });
      return;
    }
    visit(new YamlReader(record, `${base}[${index}]`, reporter), index);
  });
}
