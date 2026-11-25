/**
 * 設計図 → **実行する相手**(行の id と、置き直したあとの列の値)。束 ⑳-5b-b。
 *
 * 一致の証明(⑳-5a / ⑳-5a2)と結果表(⑳-5b)は、同じ設計図から同じ相手を組み立てる。違うのは
 * **行の値の出どころだけ**である。
 *
 * | 誰が | 行の値 | 行の id |
 * |---|---|---|
 * | 一致の証明(実 DB) | 入れて読み直した行(既定値・トリガの結果を含む) | 実 uuid |
 * | 結果表(シミュレーション) | 設計図が「入れる」と宣言した値 | 行の名前から作る疑似 id |
 *
 * その 1 点を関数(`rowOf`)で受け取れば、**系統の畳み方・置き直しの当て方・実行者自身の行の
 * 見つけ方**は 1 本で済む。束 ⑳-5b ではシミュレーションの版が実 DB 版の写しになっており、写し間違いを
 * 機械が捕まえる仕組みが無かった(独立レビュー ⑳-5b 観点 2-b)。
 *
 * このファイルは**何も import しない**(型も値も)。住んでいるのは実行時パッケージ
 * (`@kaninabe/runtime/sql/eq-subject`)であり、仕様側(結果表のシミュレーション上の world)と製品側(一致の証明の
 * 実 DB の world)が**依存として**同じ 1 本を引く —— 束 ①-c までは docs の中に住んでいて、
 * app が相対パスで借りていた(B14 の例外。ADR-0013)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

/** 実行する直前に置き直す値 1 つ(設計図の `placements` と同じ形)。 */
export interface EqSubjectPlacement {
  /** 行に置くか、入力に載せるか。**ここが見るのは行だけ**である。 */
  readonly into: string;
  readonly entity: string;
  readonly column: string;
  readonly value: string | number | boolean | null;
}

/** world の行 1 つ(読み方は呼び側が持つ)。 */
export interface EqSubjectRow {
  readonly id: string;
  readonly values: Readonly<Record<string, unknown>>;
}

/** 実行する相手を決めるのに要るもの。 */
export interface EqSubjectInput {
  /**
   * 集約 → world の行の名前(その実行者の系統の的)。
   *
   * 行が無い人は系統を持たないので、呼び側が**他人の系統**を渡す(「ログインはできるが自分の
   * 行が無い人が、他人の行を動かそうとする」という実在の形)。
   */
  readonly targets: Readonly<Record<string, string>>;
  /** 行の名前 → その行(読み方は呼び側が持つ)。 */
  readonly rowOf: (key: string) => EqSubjectRow | undefined;
  /** 実行者自身の行の名前(行が無い人は null)。 */
  readonly actorRow: string | null;
  /**
   * 実行者自身の行で引く集約(省略なら無い)。
   *
   * 系統の的は集約ごとに 1 行だが、同じ集約の行が系統に何本もあることがある(実行者自身の行と、束縛の列のために
   * 分けた別人の行)。判断材料が「実行者自身の行」を名指しする集約は、的ではなく実行者の行を指す。
   */
  readonly actorEntities?: readonly string[];
  /** 実行する直前に置き直す値(軸が選んだもの)。 */
  readonly placements: readonly EqSubjectPlacement[];
  /** 状態の置き直し(状態を持たない形では null)。 */
  readonly state: { readonly entity: string; readonly column: string; readonly value: string } | null;
}

/** 置き直したあとの相手。 */
export interface EqSubjectValues {
  /** 集約 → その行の id。 */
  readonly ids: ReadonlyMap<string, string>;
  /** 集約 → 列 → 置き直したあとの値。 */
  readonly values: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  /** 実行者自身の行の値(`claim` とセッションの欄の根拠)。行が無い人では空。 */
  readonly actorRow: Readonly<Record<string, unknown>>;
}

/** 置き直しのうち、行に当てるもの(入力に載せるものは呼び側が扱う)。 */
const INTO_ROW = 'row';

/**
 * 設計図どおりの相手を組み立てる。
 *
 * 順序は「系統の行 → 置き直し → 状態」である —— 後から置いたものが勝つ。
 *
 * @param input 系統の的・行の読み方・実行者の行・置き直し・状態
 * @returns 置き直したあとの id と値
 */
export function eqSubjectValues(input: EqSubjectInput): EqSubjectValues {
  const ids = new Map<string, string>();
  const values = new Map<string, Record<string, unknown>>();
  const targets: Record<string, string> = { ...input.targets };
  if (input.actorRow !== null) {
    for (const entity of input.actorEntities ?? []) targets[entity] = input.actorRow;
  }
  for (const [entity, key] of Object.entries(targets)) {
    const row = input.rowOf(key);
    if (row === undefined || values.has(entity)) continue;
    ids.set(entity, row.id);
    values.set(entity, { ...row.values });
  }
  for (const placement of input.placements) {
    if (placement.into !== INTO_ROW) continue;
    assign(values.get(placement.entity), placement.column, placement.value);
  }
  const state = input.state;
  if (state !== null) assign(values.get(state.entity), state.column, state.value);
  return { ids, values, actorRow: actorRowOf({ ...input, targets }, values) };
}

/**
 * 実行者自身の行の値。
 *
 * **置き直しが実行者自身の行に当たるなら、その値を見る** —— 軸が実行者の行の欄を動かすことは
 * ある(実行者の在籍状態がガードに現れる形)ので、置く前の値で判定すると、DB が見ている行と
 * 期待が見ている行が別物になる。
 *
 * 当たるかどうかは**行の名前**で見る。集約の名前で見てはならない —— 同じ集約の行が系統の中に
 * 何本もあることがあり(実行者自身の行と、対象の持ち主の行)、集約で引くと**別人の行**を
 * 実行者の行として読んでしまう。
 */
function actorRowOf(
  input: EqSubjectInput,
  values: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
): Readonly<Record<string, unknown>> {
  const key = input.actorRow;
  if (key === null) return {};
  for (const [entity, candidate] of Object.entries(input.targets)) {
    if (candidate === key) return values.get(entity) ?? {};
  }
  return input.rowOf(key)?.values ?? {};
}

/** 1 列を置き直す(その集約の行が無ければ何もしない)。 */
function assign(
  into: Record<string, unknown> | undefined,
  column: string,
  value: string | number | boolean | null,
): void {
  if (into === undefined) return;
  into[column] = value;
}
