/**
 * engine ⇔ RPC の**一致の証明**(束 ⑳-5a)の生成物に出る**仕組みの文言**。
 *
 * テスト名はテストケースの宣言の宛先でもあるので、**仕様から機械的に決まる**(T3 / T4 / ⑳-4b と同じ流儀)。
 * 名前を規約にすると、宣言を足した人がどこに何が現れるかを検査のメッセージが答えられる。
 * 別のアプリに移したときに何が日本語のまま残るかは、ここを見れば分かる。
 */

/** 操作 1 本ぶんのテスト名を組む材料。 */
export interface EqOperationTitleParts {
  readonly op: string;
  /** 実行する組み合わせの数。 */
  readonly count: number;
  /** 代表値に畳んだ軸。 */
  readonly folded: readonly string[];
  /** 畳んだガード変数の内訳(`foldedGuard` で組んだもの)。 */
  readonly guards: readonly string[];
}

/**
 * 保存点 1 つぶんのテスト名を組む材料。
 *
 * 操作の材料に**拒否の側を比べない手順**が加わる。`shape: composite` を宣言した本文は判定を
 * 持たないので、その手順で落ちるはずの組み合わせについてテストは何も言えない —— 何も言えない
 * ことを示さずに「全 N 通りで一致する」とだけ書くと、主張が実際より広くなる
 * (畳んだ軸を両側とも示すのと同じ流儀。独立レビュー ⑳-5a2 の直す 3)。
 */
export interface EqSaveDecisionTitleParts extends EqOperationTitleParts {
  /** 判定を持たない手順の操作 ID(`shape: composite` を宣言した本文)。 */
  readonly unenforced: readonly string[];
  /** その保存点の**どの手順も**判定を持たないか(拒否の側を 1 つも比べない)。 */
  readonly allUnenforced: boolean;
}

/** 畳んだガード変数 1 本の内訳を組む材料。 */
export interface EqFoldedGuardParts {
  readonly key: string;
  /** その値ならどれかの規則が成立する、という値の字面。 */
  readonly satisfying: readonly string[];
  /** どの規則も成立しない値の字面。 */
  readonly refuting: readonly string[];
}

/** 生成した一致の証明に出る文言。 */
export const EQ_TEST_WORDS = {
  /** テストの束(describe)の見出し。 */
  suite: (aggregate: string): string => `${aggregate} の engine ⇔ RPC の一致(生成)`,
  /** 作成 1 本ぶんの送り直しの性質のテスト名(点検 20 回目 B20-1)。 */
  resendTitle: (op: string): string => `${op} の同じ入力の送り直しは 1 回目の行を返し、行を増やさない`,
  resendAlreadySavedTitle: (op: string): string => `${op} の同じ入力の送り直しは行を増やさず、画面は既に保存されている旨の文言になる`,
  /** 操作 1 本ぶんのテスト名。 */
  operationTitle: (parts: EqOperationTitleParts): string =>
    `${parts.op} の全 ${parts.count} 通りで engine の判定と RPC の結末が一致する` + foldNote(parts),
  /**
   * 畳んだガード変数 1 本の内訳。
   *
   * **両側とも示す。** 「代表値で実行した」とだけ書くと、成立側が消えていても読む人は
   * 気づけない(独立レビュー 2-b)。
   */
  foldedGuard: (parts: EqFoldedGuardParts): string =>
    [
      parts.key,
      ...(parts.satisfying.length === 0 ? [] : [`成立 ${parts.satisfying.join('|')}`]),
      ...(parts.refuting.length === 0 ? [] : [`不成立 ${parts.refuting.join('|')}`]),
    ].join(' '),
  /** world が設計図どおりに作られたことの検査のテスト名。 */
  worldBuilt: (aggregate: string): string => `${aggregate} の world が設計図どおりに作られている`,
  /** 保存点のテストの束(describe)の見出し。 */
  saveSuite: (usecase: string): string => `${usecase} の保存点の decide ⇔ 複合 RPC の一致(生成)`,
  /** 保存点 1 つぶんの節(describe)の見出し。 */
  saveSection: (label: string, key: string): string => `${label}(${key})`,
  /**
   * 判定の grid のテスト名。
   *
   * **判定を持たない手順があるなら、そこまで示す。** その手順で落ちるはずの組み合わせは
   * 拒否の側を比べていないので、「全 N 通りで一致する」は主張が広すぎる(直す 3)。
   */
  saveDecisionTitle: (parts: EqSaveDecisionTitleParts): string =>
    (parts.allUnenforced
      ? `${parts.op} の判定の全 ${parts.count} 通りのうち、decide が許可した側だけ複合 RPC の結末と一致する`
      : `${parts.op} の判定の全 ${parts.count} 通りで decide と複合 RPC の結末が一致する`) +
    saveUnenforcedNote(parts) +
    foldNote(parts),
  /** 書き込み経路の grid のテスト名。 */
  saveWriteTitle: (key: string, count: number): string =>
    `${key} の書き込み経路の全 ${count} 通りで宣言どおりの行ができる`,
  /** 保存点の作成の、入力を 1 欄変えた押し直しの性質のテスト名(点検 21 回目 A21-1)。 */
  saveResendEditedTitle: (key: string): string =>
    `${key} の同じ鍵で入力を 1 欄変えた押し直しは resend_input_mismatch で断られ、行は 1 回目のまま`,
  /** 保存点の作成の、1 回目がコミットする前・錨の行を消す txn と重なって届いた同じ鍵の押し直しの性質のテスト名(点検 22 回目 A22-1・23 回目 A23-1)。 */
  saveResendRaceTitle: (key: string): string =>
    `${key} の 1 回目がコミットする前に届いた同じ鍵の押し直しは、同じ入力なら 1 回目の行を返し、変えた入力なら resend_input_mismatch で断られ、錨の行を消す txn と重なれば resend_target_deleted で断られる`,
} as const;

/**
 * 畳んだ軸をテスト名の末尾に示す一節(畳んでいなければ空)。
 *
 * 操作と保存点で同じ字面である —— 畳み方が同じ(`eq-fold.ts`)なのだから、示し方も 1 つでよい。
 */
function foldNote(parts: EqOperationTitleParts): string {
  if (parts.folded.length === 0) return '';
  const guards = parts.guards.length === 0 ? '' : `: ${parts.guards.join(' / ')}`;
  return `(畳んだ軸 ${parts.folded.join(' ')}${guards})`;
}

/**
 * 拒否の側を比べない手順をテスト名に示す一節(全部の手順が判定を持つなら空)。
 *
 * 免除ではない —— `shape` を 5 形のどれかに直せばこの一節は消え、理由まで突き合わせるように
 * なる。示すのは「いま何を実測していないか」を読む人が数えられるようにするためである。
 */
function saveUnenforcedNote(parts: EqSaveDecisionTitleParts): string {
  if (parts.unenforced.length === 0) return '';
  const ops = parts.unenforced.join(' ');
  return parts.allUnenforced
    ? `(どの手順も判定を持たない(composite): ${ops})`
    : `(判定を持たない(composite)手順があるので、その拒否は比べない: ${ops})`;
}

/**
 * 差し込み位置を表す印(断片に分けるときだけ使う。出力には現れない)。
 *
 * **NUL(`\\u{0}`)ではなく私用領域の 1 文字である。** NUL をソースに置くと git がそのファイルを
 * binary と判断し、差分が `Bin … bytes` になって**レビューできなくなる**(独立レビュー ⑳-5a2
 * の記録 13)。文言にも生成物にも現れない文字であればよいので、エスケープで書ける私用領域を使う。
 */
const HOLE = '\u{E000}';

/**
 * 一致の証明に出る文言の**断片**(出力側の目が生成コードの日本語を説明するのに使う)。
 *
 * テンプレートの穴に印を入れて割るので、**表はここ 1 つのまま**である。
 *
 * @returns 断片の全数(空白だけの断片は落とす)
 */
export function eqTestFragments(): readonly string[] {
  return [
    EQ_TEST_WORDS.suite(HOLE),
    EQ_TEST_WORDS.worldBuilt(HOLE),
    EQ_TEST_WORDS.resendTitle(HOLE),
    EQ_TEST_WORDS.resendAlreadySavedTitle(HOLE),
    // 畳んだ軸の有無で文が変わるので、**両方**を割る(片方だけだと、もう片方の形が
    // 「表に無い日本語」として残る)。
    EQ_TEST_WORDS.operationTitle({ op: HOLE, count: 0, folded: [], guards: [] }).split('0').join(HOLE),
    EQ_TEST_WORDS.operationTitle({ op: HOLE, count: 0, folded: [HOLE], guards: [] })
      .split('0')
      .join(HOLE),
    EQ_TEST_WORDS.operationTitle({ op: HOLE, count: 0, folded: [HOLE], guards: [HOLE] })
      .split('0')
      .join(HOLE),
    // 畳んだ内訳も両側を割る(片方だけだと、もう片方の形が「表に無い日本語」として残る)。
    EQ_TEST_WORDS.foldedGuard({ key: HOLE, satisfying: [HOLE], refuting: [HOLE] }),
    // 保存点の節(束 ⑳-5a2)。
    EQ_TEST_WORDS.saveSuite(HOLE),
    EQ_TEST_WORDS.saveSection(HOLE, HOLE),
    // 判定の grid のテスト名は「畳んだか」と「拒否の側を比べない手順があるか」で形が変わる。
    // 断片は**部分文字列として**引かれる(`generated-wording.ts`)ので、一節ごとに割れば足りる。
    ...[false, true].flatMap((allUnenforced) =>
      [[], [HOLE]].map((unenforced) =>
        EQ_TEST_WORDS.saveDecisionTitle({
          op: HOLE,
          count: 0,
          folded: [],
          guards: [],
          unenforced,
          allUnenforced: allUnenforced && unenforced.length > 0,
        })
          .split('0')
          .join(HOLE),
      ),
    ),
    EQ_TEST_WORDS.saveDecisionTitle({
      op: HOLE,
      count: 0,
      folded: [HOLE],
      guards: [],
      unenforced: [],
      allUnenforced: false,
    })
      .split('0')
      .join(HOLE),
    EQ_TEST_WORDS.saveDecisionTitle({
      op: HOLE,
      count: 0,
      folded: [HOLE],
      guards: [HOLE],
      unenforced: [],
      allUnenforced: false,
    })
      .split('0')
      .join(HOLE),
    EQ_TEST_WORDS.saveWriteTitle(HOLE, 0).split('0').join(HOLE),
    EQ_TEST_WORDS.saveResendEditedTitle(HOLE),
    EQ_TEST_WORDS.saveResendRaceTitle(HOLE),
  ].flatMap((text) => text.split(HOLE).filter((part) => part.trim() !== ''));
}
