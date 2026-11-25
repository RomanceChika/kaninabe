/**
 * 5 形の定型(create / delete / transition / update / update-fields)が共有する
 * 非成功枝(`conflict` / `invariant_violated`)の型。
 *
 * 背景(BACKLOG「5 形の定型の Outcome 型の構造的部分型(reorder kind 写し含む)」): この 2 つの枝は
 * どの形でも文字通り同じ構造(`{ kind: 'conflict' }` / `{ kind: 'invariant_violated'; invariant: string }`)
 * を持つ。加えて、集約ごとのリポジトリ結果型(`operation/*\/ports.ts` の `Create*Outcome` /
 * `Update*Outcome` 等、38 箇所)も同じ構造を独立に書いているため、TypeScript の構造的部分型では
 * 「別の形の結果」が代入できてしまう(実例: `program_item/ports.ts` の `ReorderProgramOutcome` の
 * 非成功枝が、汎用定型 `_template/update.ts` の `UpdateOutcome<TWritten>` の非成功枝とすり抜ける)。
 *
 * ここでは非公開の symbol ブランドで閉じる —— `@kaninabe/runtime/engine`（`machine.ts`） の `FireAllowed` と同じ手法
 * である。生成できるのはこのモジュールが export するスマートコンストラクタ(`conflictOf` /
 * `invariantViolatedOf`)だけであり、構造的に一致するオブジェクトを手で書いても代入できない
 * (`{ kind: 'conflict' }` を書いても `Conflict<'update'>` にはならない —— symbol 付きのプロパティを
 * 外から書けないため)。
 *
 * **ブランドは「形」単位**(`TemplateForm` の 5 値)であり、「操作」単位(個々の予約ID)ではない。
 * 操作単位まで閉じるには `persist` の関数シグネチャに証明を追加で通す口が要り
 * (`transition.ts` の `decision: FireAllowed` と同じ構え)、5 形すべてと 68 本の操作の両方に
 * 及ぶ別バッチの規模になる(PRIN-0007/0008 —— 操作IDを文字列で指定させない —— を守ったまま
 * 予約IDを持ち込む必要があるため、`conflictOf('{予約ID}')` のように手で綴らせる案は採らない)。
 * 「形が違う結果は代入できない」という、BACKLOG の見出しそのものの性質はこのブランドで閉じる。
 */

const FORM_BRAND: unique symbol = Symbol('operation._template.formBrand');

/** 5 形の定型の値域。この 5 つ以外は存在しない。 */
export type TemplateForm = 'create' | 'delete' | 'transition' | 'update' | 'update_fields';

/**
 * 判断から書き込みまでの間に前提が崩れていた(0 行)。
 *
 * `TForm` が違えば構造的に一致しない(symbol ブランドの値が型として異なるため)。
 */
export interface Conflict<TForm extends TemplateForm> {
  readonly kind: 'conflict';
  readonly [FORM_BRAND]: TForm;
}

/**
 * DB 制約が不変条件違反を検出した(`invariant` は `INV-*` の実在ID)。
 *
 * `TForm` が違えば構造的に一致しない(symbol ブランドの値が型として異なるため)。
 */
export interface InvariantViolated<TForm extends TemplateForm> {
  readonly kind: 'invariant_violated';
  readonly invariant: string;
  readonly [FORM_BRAND]: TForm;
}

/**
 * `Conflict<TForm>` を作る唯一の口。
 *
 * @param form - 5 形のどれか(呼び出し元は自分がどの定型を組んでいるかを知っている —
 *   `createOperation` の中で使うなら `'create'`)
 * @returns その形にブランドされた `conflict`
 */
export function conflictOf<TForm extends TemplateForm>(form: TForm): Conflict<TForm> {
  return { kind: 'conflict', [FORM_BRAND]: form };
}

/**
 * `InvariantViolated<TForm>` を作る唯一の口。
 *
 * @param form - 5 形のどれか
 * @param invariant - 検出した不変条件のID(`INV-*`)
 * @returns その形にブランドされた `invariant_violated`
 */
export function invariantViolatedOf<TForm extends TemplateForm>(
  form: TForm,
  invariant: string,
): InvariantViolated<TForm> {
  return { kind: 'invariant_violated', invariant, [FORM_BRAND]: form };
}

/** ブランド無しの生の非成功枝(集約ごとのリポジトリが返す形)。 */
type RawConflict = { readonly kind: 'conflict' };
/** 同上・不変条件違反版。 */
type RawInvariantViolated = { readonly kind: 'invariant_violated'; readonly invariant: string };

/** `TRaw` からこの 2 つの生の非成功枝を除いた残り(=集約ごとの成功枝)。 */
type WithoutRawFailures<TRaw> = Exclude<TRaw, RawConflict | RawInvariantViolated>;

/**
 * 集約のリポジトリ(`operation/*\/ports.ts`)が返す生の結果を、ブランド付きの定型 Outcome へ写す。
 *
 * 各リポジトリの結果型は「成功枝(kind と中身は各定型の成功枝と揃えて書く規約)」+
 * 「生の `conflict` / `invariant_violated`」という形を独立に宣言している(38 箇所の同型重複)。
 * この関数は non-成功枝だけをその場でブランド化し、成功枝はそのまま通す
 * ——**呼び出し側(各 operation の `persist`)がリポジトリの戻り値をそのまま渡せる**のはこのためで、
 * 成功枝の形を書き換えない(書き換えが要る集約は個別に写像する。実例: `program_item/update.ts` の
 * `reorder`(成功枝の kind が `reordered` で定型の `updated` と異なるため、個別に写す)。
 *
 * @param form - 5 形のどれか
 * @param raw - リポジトリから返った生の結果(kind は文字列の値域)
 * @returns 成功枝はそのまま、`conflict` / `invariant_violated` はブランド付きにした結果
 */
export function seal<TForm extends TemplateForm, TRaw extends { readonly kind: string }>(
  form: TForm,
  raw: TRaw,
): WithoutRawFailures<TRaw> | Conflict<TForm> | InvariantViolated<TForm> {
  if (raw.kind === 'conflict') return conflictOf(form);
  if (raw.kind === 'invariant_violated') {
    return invariantViolatedOf(form, (raw as unknown as RawInvariantViolated).invariant);
  }
  return raw as WithoutRawFailures<TRaw>;
}
