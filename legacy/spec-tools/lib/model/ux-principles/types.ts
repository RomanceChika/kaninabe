/**
 * ux_principles_spec(UX 原則の台帳。`docs/specs/frontend/ux-principles.md`)のモデル型。
 *
 * UX の原則は、これまで 3 か所に散っていた(規約の散文・検査器の定数・ユースケースの既定予算)。
 * 台帳はそれを 1 枚の目録に集める。**新しい事実を宣言する場所ではない** — 既存の宣言から原則を導く
 * 検査の ID(`enforced_by`)と、閾値(`budget`)の置き場であり、**原則が生成物の形を直接決めることはない**
 * (決めるのは属性の値と閾値だけ。`affects` は属性の名前を指すだけで、`confirm_required` に効く原則にしか付かない)。
 *
 * guarantee_spec / notification_spec 等と同じ「1 プロジェクト 1 枚・行の集合」の器だが、行の意味も
 * 検査も違う(語彙を持たず、実装とも閉じない)。7 つ目のカタログに当たるが、一般化はしない
 * (doc_types.md の再訪の記録を参照)。
 *
 * 書き方の正: docs/rules/process/frontend/specification/standards/ux-lint.md
 */

import type { SourceLocation } from '../types.js';

/** 検査で守られていない原則(機械が判定できない・まだ検査していない)の `enforced_by`。 */
export const UX_PRINCIPLE_ADVISORY = 'advisory';

/** 台帳の文書 ID(1 プロジェクト 1 枚なので導出元が無く固定)。 */
export const UX_PRINCIPLES_ID = 'ux-principles';

/**
 * 原則が効いてよい属性の名前(閉じた値域)。
 *
 * 原則 → 属性 → 生成物の経路のうち、台帳が名指しできるのは属性の**名前**だけで、生成器が台帳を
 * 直接読むことはない(原則を 1 行足すと生成物の形が変わる、という経路を作らないため)。
 * いま属性として生成物が引くのは操作の確認の要否だけである。
 */
export const UX_PRINCIPLE_AFFECTS = ['confirm_required'] as const;

/** 原則が効く属性の名前。 */
export type UxPrincipleAffects = (typeof UX_PRINCIPLE_AFFECTS)[number];

/** 閾値(`budget`)。超えたときだけ指摘する目安の個数(閾値ちょうどは指摘しない)。 */
export interface UxPrincipleBudget {
  /** 目安の上限(正の整数)。 */
  readonly limit: number;
}

/** 原則 1 件の宣言。 */
export interface UxPrincipleDecl {
  /** 原則の ID(台帳の中で一意)。検査 ID と同じ綴りか、`{検査 ID}-{指標}` の形。 */
  readonly id: string;
  /** 原則の文(日本語 1 文)。 */
  readonly statement: string;
  /** どの既存の宣言から判定するか(自由文の並び。台帳は事実を持たず、出どころを指すだけ)。 */
  readonly derives: readonly string[];
  /** 見張る検査の ID。見張る検査が無い原則は `advisory`。 */
  readonly enforcedBy: string;
  /** 閾値(任意)。 */
  readonly budget?: UxPrincipleBudget;
  /** 効く属性の名前(任意。`confirm_required` に効く原則だけ)。 */
  readonly affects?: UxPrincipleAffects;
  /** 宣言の位置(Finding 用)。 */
  readonly location: SourceLocation;
}

/** 台帳 1 ファイル分の宣言。 */
export interface UxPrinciplesSpec {
  /** 文書 ID(`ux-principles` 固定)。 */
  readonly id: string;
  /** 原則の全数(宣言順)。 */
  readonly principles: readonly UxPrincipleDecl[];
  /** 仕様ファイルの位置。 */
  readonly location: SourceLocation;
}

/** 読み込んだ台帳。 */
export interface UxPrinciplesModel {
  /** 台帳のファイルがあったか。false なら U 群は検査器の定数(既定値)で動く。 */
  readonly available: boolean;
  /** 読み込めた台帳。スキーマ違反で構築できなければ null。 */
  readonly spec: UxPrinciplesSpec | null;
}

/** 台帳が無いことを表す空のモデル(検査器の定数が既定値になる)。 */
export const NO_UX_PRINCIPLES: UxPrinciplesModel = { available: false, spec: null };
