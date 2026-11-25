import type { z } from 'zod';
import { toInputFromIso, toIsoFromInput } from './form-datetime';
import type { FieldPlan } from './form-plan';
import { planOf } from './form-plan';
import type { ActionError, FieldIssue, Result } from './result';
import { err, ok } from './result';

/**
 * 画面フォームと Server Action が **1 つの入力スキーマを共有する**ための口。
 *
 * 生成 zod スキーマ（`entity_spec` からの写像）を画面から直接使おうとすると、
 * HTML のフォーム部品が返す値の形（**すべて文字列**）とスキーマが期待する形（数値・未入力）が
 * 食い違う。その差を埋める変換規則を画面ごとに書くと、画面の数だけ規則が増える。
 * ここが**変換規則の唯一の置き場**であり、画面もアクションもこの口を通して同じ制約を見る。
 *
 * ここに置いてよいのは「HTML の形 ⇔ スキーマの形」の機械的な写しだけである。
 * **業務ルール（何が妥当か）は 1 つも書かない** — その正は `entity_spec` の生成スキーマであり、
 * この口はそれを**そのまま**呼ぶ（PRIN-0001 / PRIN-0007）。
 */

/** フォームの生の値。HTML の入力欄はすべて文字列を返す。 */
export type FormValues<K extends string> = Readonly<Record<K, string>>;

/**
 * 入力欄に**写せる**値の形。
 *
 * HTML の入力欄が扱えるのは文字列・数値と「値が無い」だけである（真偽値や入れ子の値は
 * 別の部品——チェックボックスや小さなフォーム——の話で、この口の守備範囲ではない）。
 * 型として絞っておくと、写せない形のフィールドを表示に渡した時点で呼び出し側が型エラーになる。
 */
export type InputValue = string | number | null | undefined;

/** 入力検証だけの失敗。`ActionError` の 1 分類をそのまま使う（書き写さない）。 */
export type FormError = Extract<ActionError, { kind: 'invalid_input' }>;

/**
 * 入力欄に写せる制約。**スキーマから導出したものだけ**を持つ。
 *
 * `null` は「そのスキーマがその制約を持たない」の意味であり、
 * 画面が既定値を発明してよいという意味ではない。
 */
export interface FormFieldAttributes {
  /** 未入力を許さないか（スキーマが `optional` / `nullable` でない）。 */
  readonly required: boolean;
  /** 文字列の最大長（`maxLength` 属性）。 */
  readonly maxLength: number | null;
  /** 数値の下限（`min` 属性）。 */
  readonly min: number | null;
  /** 数値の上限（`max` 属性）。 */
  readonly max: number | null;
  /**
   * 数値の刻み（`step` 属性）。整数なら `1`、小数を許すなら `'any'`、数値でなければ `null`。
   *
   * これが無いと、整数しか受け付けないスキーマに対してブラウザが小数（`1.5`）を通し、
   * **クライアントは通すのにサーバーが落とす**という非対称が残る（既定の `step` は 1 だが、
   * 明示しないと「たまたま正しい」だけで、小数を許す数値との区別が画面に現れない）。
   */
  readonly step: number | 'any' | null;
  /** 数値のフィールドか（`type="number"` にし、送信前に数値へ変換する）。 */
  readonly numeric: boolean;
  /**
   * 取り得る値の値域（`enum` のフィールドだけ。それ以外は `null`）。
   *
   * `numeric` / `datetime` と同じ形の宣言である。**画面が選択肢を発明しない** ——
   * 材料は `entity_spec` の `enum([...])`（生成スキーマの `z.enum`）であり、ここはその写しに
   * すぎない。値の**表示名**は仕様に置き場が無いので画面が持つ（既知の穴）。
   */
  readonly options: readonly string[] | null;
  /**
   * 日時のフィールドか（`type="datetime-local"` にし、表示と送信で表記を写す）。
   *
   * `numeric` と同じ形の宣言である。**画面が「この欄は日時だ」と判断しない** — 判断の材料は
   * `entity_spec` の型（生成スキーマの `z.iso.datetime`）であり、ここはその写しにすぎない。
   * 変換の中身と、タイムゾーン・精度の決めは `./form-datetime.ts`。
   */
  readonly datetime: boolean;
}

/** 生成スキーマから導いた、フォーム用の入力の口。 */
export interface FormSchema<T, K extends string> {
  /** フィールドごとの制約（HTML 属性に写す）。 */
  readonly fields: Readonly<Record<K, FormFieldAttributes>>;
  /**
   * フォームの生の値を検証して、スキーマの形に変換する。
   *
   * @param values - 入力欄の値（すべて文字列）
   * @returns 成功ならスキーマの形の値、失敗ならフィールド単位の指摘
   */
  parse(values: FormValues<K>): Result<T, FormError>;
  /**
   * **1 フィールドだけ**を検証して、スキーマの形に変換する。
   *
   * 編集フォームのように「そのとき編集してよいフィールドだけが並ぶ」画面のためにある。
   * 並ぶ集合は `access_spec` の `writes` と対象の状態で決まる（＝実行時に変わる）ので、
   * オブジェクト全体を 1 度に検証すると、**並んでいないフィールドが「未入力」として落ちる**。
   *
   * 変換規則（空文字の写し方・数値への変換）は `parse` とまったく同じものを使う
   * （規則の置き場はこの口 1 つだけ、という約束を崩さないため）。
   *
   * @param field - フィールド名
   * @param value - 入力欄の値（文字列）
   * @returns 成功ならそのフィールドの値、失敗ならそのフィールドの指摘
   */
  parseField<F extends K & keyof T>(field: F, value: string): Result<T[F], FormError>;
  /**
   * スキーマの形の値を**入力欄の文字列**に写す（`parse` の逆向き）。
   *
   * 画面が初期値を組み立てるための口である。ここが無いと、表示側の写し方（数値の文字列化・
   * `null` の空欄化・日時の表記）が画面ごとに書かれ、**送信側と食い違う**（変換規則の置き場が
   * 1 つ、という約束が片道分しか成り立たない）。実際、日時では往復が壊れる —— 保存された
   * ISO 表記をそのまま入力欄に出すと `datetime-local` が値を受け取れない。
   *
   * @param field - フィールド名
   * @param value - スキーマの形の値（`null` は「値が無い」）
   * @returns 入力欄に入れる文字列（値が無ければ空文字）
   */
  toInputValue<F extends K & keyof T>(field: F, value: Extract<T[F], InputValue>): string;
}

// 変更集合の判定（`hasAnyChange` / `changedFields`）は `./form-changes` にある。呼び出し側から
// 見た入口はこの 1 ファイルなので、ここで再輸出する。
//
// 日時の表記の写し（`./form-datetime`）とスキーマの読み取り（`./form-plan`）は**再輸出しない**。
// あれは口の内側の部品であり、画面が直に呼べる形にすると「画面が変換する」経路が復活する
// （変換規則の置き場が 1 つ、という約束はそれで崩れる）。使う口は `parse` / `parseField` /
// `toInputValue` の 3 つだけである。
export { changedFields, hasAnyChange } from './form-changes';

/**
 * zod の指摘をフィールド単位の `FieldIssue` に写す。
 *
 * 表示文言は UI の責務なので持たない（コードだけを渡す）。
 *
 * @param error - zod の検証エラー
 * @returns フィールド名と zod の issue コードの組
 */
export function toFieldIssues(error: z.ZodError): readonly FieldIssue[] {
  return error.issues.map((issue) => ({ field: issue.path.join('.'), code: issue.code }));
}

/**
 * 入力された 1 つの値を、スキーマが期待する形へ写す（空文字は呼び出し側が先に処理する）。
 *
 * @param value - 入力欄の文字列（空文字ではない）
 * @param plan - そのフィールドの導出済みの扱い
 * @returns スキーマに渡す値
 */
function toSchemaValue(value: string, plan: FieldPlan | undefined): unknown {
  if (plan?.attributes.numeric === true) return Number(value);
  if (plan?.attributes.datetime === true) return toIsoFromInput(value);
  return value;
}

/**
 * 入力欄の文字列を、スキーマが期待する形へ変換する。
 *
 * **変換規則はこの 3 つだけである**（画面ごとに増やさない）。
 *
 * 1. **空文字は「未入力」**として、スキーマの宣言どおりの形に写す。`nullable` のフィールドは
 *    `null`、それ以外は**キーごと落とす**（任意フィールドなら「無し」として通り、必須フィールドなら
 *    zod が未入力として落とす）。空文字のまま渡すと、任意の項目に `''` が保存されてしまう
 *    （「入力していない」と「空で入力した」が区別できなくなる）。
 * 2. **数値のフィールドは `Number` に変換する**。規則 1 が先に効くので、空欄が `Number('') === 0`
 *    になって「下限違反（`too_small`）」に化けることはない。数値にならない文字列は `NaN` になり、
 *    zod が型の不一致として落とす（画面が独自のエラーを組み立てない）。
 * 3. **日時のフィールドはローカル時刻として読み、ISO 8601（UTC）に正規化する**。`datetime-local`
 *    の入力欄はタイムゾーンを持たない文字列（`2026-04-01T10:00`）を返すため、そのまま渡すと
 *    生成スキーマ（`z.iso.datetime({ offset: true })`）が必ず落とす。逆向き（表示）は
 *    `toInputValue` が同じ規則で写す。タイムゾーンと精度の決めは `./form-datetime.ts`。
 *
 * @param values - 入力欄の値（すべて文字列）
 * @param plans - フィールドごとの導出済みの扱い（数値か・日時か・空文字をどう写すか）
 * @returns スキーマに渡す形のオブジェクト
 */
function convert(
  values: Readonly<Record<string, string>>,
  plans: Readonly<Record<string, FieldPlan>>,
): Record<string, unknown> {
  const converted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const plan = plans[key];
    if (value === '') {
      if (plan?.emptyValue === 'null') converted[key] = null;
      continue;
    }
    converted[key] = toSchemaValue(value, plan);
  }
  return converted;
}

/**
 * スキーマの形の値を入力欄の文字列に写す（`convert` の逆向き）。
 *
 * 「値が無い」（`null` / `undefined`）は空文字になる —— 規則 1 の逆であり、空欄のまま送り返せば
 * また「未入力」として同じ形に戻る。日時は規則 3 の逆で、ローカルの分精度の表記になる。
 *
 * @param value - スキーマの形の値
 * @param plan - そのフィールドの導出済みの扱い
 * @returns 入力欄に入れる文字列
 */
function toInputString(value: InputValue, plan: FieldPlan | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  return plan?.attributes.datetime === true ? toInputFromIso(value) : value;
}

/**
 * 生成 zod スキーマ（から導出したオブジェクトスキーマ）を、フォーム用の口に包む。
 *
 * @param schema - 入力スキーマ。制約の正は `entity_spec` の生成スキーマであり、ここでは検査しない
 * @returns フィールドの制約と、生の値のパースを持つ口
 */
export function formOf<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
): FormSchema<z.output<z.ZodObject<Shape>>, keyof Shape & string> {
  type Key = keyof Shape & string;
  const keys = Object.keys(schema.shape) as readonly Key[];
  // フィールドごとのスキーマは 1 度だけ取り出しておく（`parseField` が引く相手）。
  const shapes = Object.fromEntries(
    keys.map((key) => [key, schema.shape[key] as unknown as z.ZodType]),
  ) as Record<Key, z.ZodType>;
  const plans = Object.fromEntries(
    keys.map((key) => [key, planOf(shapes[key])]),
  ) as Record<Key, FieldPlan>;
  const fields = Object.fromEntries(
    keys.map((key) => [key, plans[key].attributes]),
  ) as Record<Key, FormFieldAttributes>;

  return {
    fields,
    parse(values) {
      const parsed = schema.safeParse(convert(values, plans));
      if (!parsed.success) return err({ kind: 'invalid_input', issues: toFieldIssues(parsed.error) });
      return ok(parsed.data);
    },
    parseField<F extends Key & keyof z.output<z.ZodObject<Shape>>>(field: F, value: string) {
      // 変換は全体と同じ規則を通す（空文字の写し方・数値化はここで再実装しない）。
      const converted = convert({ [field]: value }, plans);
      const parsed = shapes[field].safeParse(converted[field]);
      if (!parsed.success) {
        // 1 フィールドだけを渡しているので zod の `path` は空になる。指摘の宛先は
        // 呼び出し側が指定したフィールドであり、それをそのまま返す。
        const issues = parsed.error.issues.map((issue) => ({ field, code: issue.code }));
        return err({ kind: 'invalid_input', issues });
      }
      // 取り出したのは `field` のスキーマそのものなので、通った値の型はその位置の型である
      // （zod の `safeParse` は 1 フィールド分の型を持たないため、ここで写しの型を明示する）。
      return ok(parsed.data as z.output<z.ZodObject<Shape>>[F]);
    },
    toInputValue(field, value) {
      return toInputString(value, plans[field]);
    },
  };
}
