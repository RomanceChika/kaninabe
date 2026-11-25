/**
 * 認証フロー仕様の `platform_ops`(認証基盤が持つ操作を画面から叩くための、閉じた名前つきの一覧)の宣言の型。
 *
 * 画面が起こせる操作は `actions`(ドメインイベントか予約 ID)だけで、セッションの一覧・終了のような
 * **ドメインの状態機械に写らない認証基盤の操作**は書けなかった(ログアウトだけが `logout.control` で専用の形を持っていた)。
 * ここはその一般化である。正は 1 か所(auth_spec)で、実行者の資格・引数の出どころ・返す欄・確認の要否・配線先を宣言から閉じた形で書かせる。
 * 画面は `usecases:` と並ぶ第 3 の露出口 `platform_ops:` で参照する(S20 / S21)。設計の正: 設計メモ「セッションの管理の画面」。
 *
 * 使い手は 3 つ: パーサー(`parse-auth-platform-ops.ts`。H0 が形を見る)・H9(宣言の閉世界)・画面の検査 S20 / S21。
 * 軸は仕組み(`kind` / `actor` の形 / 引数の出どころの種類)、語はアプリ(操作 id・欄名・`port` / `method`)である。
 */

import type { SourceLocation } from '../types.js';

/** 操作の種類(`read` = 行を返す読み / `do` = 状態を変える操作)。 */
export type PlatformOpKind = 'read' | 'do';

/** 操作の種類の値域。 */
export const PLATFORM_OP_KINDS: readonly PlatformOpKind[] = ['read', 'do'];

/**
 * 実行者の資格。
 *
 * - `self` … 本人。メンバー ID はリクエストのセッションから導く(引数に取らない)
 * - `role` … ロール(roles.md に実在)。`activeMember` が true なら有効メンバーであることもいまの DB の行で確かめる
 */
export type PlatformActor =
  | { readonly kind: 'self' }
  | { readonly kind: 'role'; readonly role: string; readonly activeMember: boolean };

/** 識別子の値の形(今は UUID だけ)。 */
export type PlatformIdFormat = 'uuid';

/** 型つきの自由入力の型の値域(識別子を運べる文字列は宣言できない — H9)。 */
export type PlatformArgType = 'bool' | 'int' | 'string';

/** 型つきの自由入力の型の値域。 */
export const PLATFORM_ARG_TYPES: readonly PlatformArgType[] = ['bool', 'int', 'string'];

/** 引数 1 つ。出どころは行(`from: row`)か、型つきの自由入力のどちらかである。 */
export type PlatformArg =
  | {
      readonly kind: 'row';
      readonly name: string;
      /** 行の出どころ(同じ auth_spec の `read` の操作 id か、画面の `reads` の query_spec の id)。 */
      readonly of: string;
      /** 出どころの行の欄。 */
      readonly field: string;
      /** 値の形(`uuid` = 配線先が UUID の形を要求する識別子。入口のスキーマで、配線先に届く前に壊れた識別子を弾く)。 */
      readonly format?: PlatformIdFormat;
      /** 出どころの行のこの欄(真偽値)が true の行には、この操作のボタンを出さない(例: いまの端末の行に「この端末を終える」を出さない)。 */
      readonly skipIf?: string;
      readonly location: SourceLocation;
    }
  | {
      readonly kind: 'typed';
      readonly name: string;
      readonly type: PlatformArgType;
      readonly default?: boolean | number | string;
      readonly location: SourceLocation;
    };

/**
 * 配線先の ABI(値の型)の語。宣言した引数・欄の型(`bool` / `int` / `string`)と配線先の型(`boolean` / `number` / `string`)は
 * 別の語彙で、この対応表(`VALUE_TYPE_OF_ARG`)で突き合わせる。
 */
export type PlatformValueType = 'string' | 'boolean' | 'number';

/** 配線先の値の型の値域。 */
export const PLATFORM_VALUE_TYPES: readonly PlatformValueType[] = ['string', 'boolean', 'number'];

/** 型つきの自由入力の型 → 配線先の値の型(`from: row` の識別子は `string`)。 */
export const VALUE_TYPE_OF_ARG: Readonly<Record<PlatformArgType, PlatformValueType>> = { bool: 'boolean', int: 'number', string: 'string' };

/** 配線先のメソッドの引数 1 つの、宣言した引数への対応(オブジェクトの引数の 1 プロパティも同じ形)。 */
export interface PlatformParamArg {
  /** 対応する宣言した引数の名前(`args` のキー)。 */
  readonly arg: string;
  /** 配線先の側の値の型。 */
  readonly type: PlatformValueType;
  /** 配線先の側で省略できるか(`?`)。 */
  readonly optional: boolean;
}

/**
 * 配線先のメソッドの引数 1 つ(位置の順)。スカラー 1 つの引数(`scalar`)か、プロパティごとに宣言した引数へ対応するオブジェクトの引数(`object`)。
 * **宣言した引数ごとに、対応する配線先の引数かプロパティがちょうど 1 つ**ある(H9 が未対応・余剰・重複を拒む)。
 */
export type PlatformBindingParam =
  | { readonly kind: 'scalar'; readonly name: string; readonly map: PlatformParamArg; readonly location: SourceLocation }
  | {
      readonly kind: 'object';
      readonly name: string;
      readonly optional: boolean;
      readonly props: readonly (PlatformParamArg & { readonly prop: string })[];
      readonly location: SourceLocation;
    };

/** 配線先の戻り値の値(結果の union の `value` の側)。`rows` は行の配列(行の型は `platform_ports` の `rows`)。 */
export type PlatformBindingValue = { readonly kind: 'scalar'; readonly type: PlatformValueType } | { readonly kind: 'rows'; readonly row: string };

/**
 * 配線先(`port` の `method`)と、宣言した引数・返す欄との**明示の対応表**(`params` / `result`)。
 *
 * 宣言(`args` / `returns`)と配線先の実際の ABI を突き合わせる唯一の場所で、名前・型・省略・配列・結果の union を省略せずに書く
 * (設計レビューの指摘: 欄の名前が食い違ったまま画面が組まれる事故を宣言の時点で止める)。`result` が無い宣言は H9 が拒む。
 */
export interface PlatformOpBinding {
  readonly port: string;
  readonly method: string;
  /** 配線先のメソッドの引数(位置の順)。 */
  readonly params: readonly PlatformBindingParam[];
  /** 配線先の戻り値の値の型(結果の union の `value` の側)。無ければ undefined(H9 が拒む)。 */
  readonly result?: PlatformBindingValue;
}

/** 行の型のプロパティ 1 つ(配線先が返す行の欄)。 */
export interface PlatformRowProp {
  readonly name: string;
  readonly type: PlatformValueType;
  /** null がありうるか(`?`)。 */
  readonly nullable: boolean;
}

/** 配線先が返す行の型 1 つ(`platform_ports.{port}.rows` の 1 件)。 */
export interface PlatformRowDecl {
  readonly name: string;
  readonly props: readonly PlatformRowProp[];
}

/** 結果の union(`{ ok: true, value } | { ok: false, reason }` の形)の判別の欄の名前。 */
export interface PlatformResultUnion {
  /** union の型名。 */
  readonly type: string;
  /** 成功かを示す真偽値の欄。 */
  readonly ok: string;
  /** 成功のときの値の欄。 */
  readonly value: string;
  /** 失敗のときの理由の欄。 */
  readonly reason: string;
}

/** 失敗の理由 1 つと、画面に出す文言。 */
export interface PlatformRefusalDecl {
  readonly reason: string;
  readonly message: string;
}

/** 配線先のポート 1 つ(`platform_ports.{名前}`)の宣言。 */
export interface PlatformPortDecl {
  readonly name: string;
  readonly union: PlatformResultUnion;
  readonly refusals: readonly PlatformRefusalDecl[];
  readonly rows: readonly PlatformRowDecl[];
  readonly location: SourceLocation;
}

/** 操作 1 件。 */
export interface PlatformOpDecl {
  /** `{グループ}.{名前}`(スネークケースの 2 段。例: `session.end_mine`)。画面の `platform_op.{id}.success` の id になる。 */
  readonly id: string;
  /** 表示名。 */
  readonly label: string;
  readonly kind: PlatformOpKind;
  readonly actor: PlatformActor;
  readonly args: readonly PlatformArg[];
  /** `read` だけが持つ、返す欄の集合(`shapes` のキー)。 */
  readonly returns?: string;
  /** いまの端末が不明なら拒む(自分を締め出さない)。 */
  readonly needsCurrentSession: boolean;
  /** `do` だけが持つ確認の要否。 */
  readonly confirm?: boolean;
  readonly binding: PlatformOpBinding;
  readonly location: SourceLocation;
}

/** 欄の表示の整形の値域。 */
export type PlatformFieldFormat = 'datetime';

/** 欄の表示の整形の値域(一覧)。 */
export const PLATFORM_FIELD_FORMATS: readonly PlatformFieldFormat[] = ['datetime'];

/** 返す欄 1 つの、配線先の行のプロパティへの対応。 */
export interface PlatformFieldMapping {
  /** 宣言した欄(`fields` の名前)。 */
  readonly field: string;
  /** 配線先の行のプロパティ。 */
  readonly from: string;
}

/**
 * 返す欄の閉じた集合。`row` と `mapping` が配線先の行との明示の対応表(欄ごとに行のプロパティ 1 つ。型と null の有無は行の型から導く)。
 * 対応表を書かない形(`fields: [欄, …]`)は読めるが、H9 が拒む(対応表の無い欄は画面に出せない)。
 */
export interface PlatformShape {
  readonly name: string;
  readonly fields: readonly string[];
  /** 配線先の行の型の名前(`platform_ports.{port}.rows` のキー)。 */
  readonly row?: string;
  /** 欄 → 行のプロパティ。 */
  readonly mapping?: readonly PlatformFieldMapping[];
  /** 欄 → 見出しの文言(画面の表の見出し。無い欄は欄名を出す)。 */
  readonly labels?: readonly { readonly field: string; readonly label: string }[];
  /** 欄 → 表示の整形(`datetime` = 日時を表示のタイムゾーンで整える)。無い欄は型どおり(文字列はそのまま・真偽値は はい / いいえ)。 */
  readonly formats?: readonly { readonly field: string; readonly format: PlatformFieldFormat }[];
  readonly location: SourceLocation;
}

/** `platform_ops` の節全体(`shapes` と、返せない欄名の語を含む)。 */
export interface AuthPlatformOps {
  readonly ops: readonly PlatformOpDecl[];
  readonly shapes: readonly PlatformShape[];
  /** 配線先のポートの宣言(結果の union・失敗の理由と文言・行の型)。 */
  readonly ports: readonly PlatformPortDecl[];
  /** 欄名に含んではいけない語(小文字。例の語は仕様が宣言する — 体系側は語彙を持たない)。 */
  readonly secretWords: readonly string[];
  readonly location: SourceLocation;
}

/** 操作 id の形(`{グループ}.{名前}`)。 */
export const PLATFORM_OP_ID = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** 画面の遷移のきっかけの前置(`platform_op.{id}.success`)。ドメインイベント・`usecase.` とは名前空間が違う。 */
export const PLATFORM_OP_PREFIX = 'platform_op.';
