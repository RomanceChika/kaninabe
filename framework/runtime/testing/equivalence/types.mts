/**
 * engine ⇔ RPC の一致の証明の**world の設計図の型**。
 *
 * 値(どの集約にどの行を置き、どの軸をどう掛けるか)は**製品の生成物**が運び、**形はここだけが
 * 持つ** —— 集約名・操作 ID・列名は 1 つも現れない。生成物(`eq-worlds.ts`)はこのファイルから
 * **型を再輸出する**(束 ①-d 手 2)ので、宣言は 1 か所である。生成物が読める境界は
 * `runtime-testing` の要素として宣言されており、**テストの軸のファイルからだけ**許されている。
 *
 * 散文の正: docs/rules/process/backend/system/standards/conventions/testing/integration.md
 */

/** world の行・置き直す値に入れられる値。 */
export type EqValue = string | number | boolean | null;

/** world の行 1 つ(⑳-4b の RLS の world と同じ形)。 */
export interface EqWorldRow {
  readonly key: string;
  readonly table: string;
  readonly entity: string;
  /** そのまま入れる列。 */
  readonly values: Readonly<Record<string, EqValue>>;
  /** 列 → 参照する行の名前。 */
  readonly refs: Readonly<Record<string, string>>;
  /** 実行者自身の行なら、その実行者の名前。 */
  readonly actor: string | null;
  /** 集約 → その行の名前(自分と、参照を遡って届く全部)。 */
  readonly ancestry: Readonly<Record<string, string>>;
}

/** 実行者が渡すロールの配列(`p_actor_roles`)1 通り。 */
export interface EqRoleArray {
  readonly name: string;
  readonly roles: readonly string[];
}

/** world の実行者 1 人。 */
export interface EqActor {
  readonly key: string;
  /** その人が代表する役(テスト名に出る)。 */
  readonly role: string;
  readonly basis: 'binding' | 'claim' | 'default' | 'no_row';
  /** 実行者自身の行の名前(行が無い人なら null)。 */
  readonly row: string | null;
  /** その系統の対象の行の名前(行が無い人なら null)。 */
  readonly target: string | null;
  readonly arrays: readonly EqRoleArray[];
  /**
   * この人が条件を満たさないロール(ADR-0018)。根拠(束縛・claim)は成立しているが、既定のログインロールの条件・
   * 含意の先の行の条件だけを満たさない。通常の実行者は持たない。
   */
  readonly unmet?: string;
}

/** 実行する直前に置き直す値 1 つ。 */
export interface EqPlacement {
  /** どの集約の行(実行者の系統から引く)。 */
  readonly entity: string;
  readonly column: string;
  readonly value: EqValue;
  /** 行に置くか、作成の入力に載せるか。 */
  readonly into: 'row' | 'input';
}

/** ガード変数 1 本の値(その値にするために置き直すもの)。 */
export interface EqAxisValue {
  /** 値の字面(食い違いの報告に出る)。 */
  readonly label: string;
  readonly placements: readonly EqPlacement[];
  /**
   * 作成の入力の欄に**実行者の id**(`self`)か**実行者でない人の id**(`other`)を置く(作成の規則の縛り)。
   * 値が実行時の実行者で決まるので、固定の値の置き直し(`placements`)とは別に運ぶ。
   */
  readonly actorInputs?: readonly EqActorInput[];
}

/** 作成の入力の欄に置く実行者(本人か、それ以外か)。 */
export interface EqActorInput {
  readonly column: string;
  readonly who: 'self' | 'other';
}

/** ガード変数 1 本の軸。 */
export interface EqAxis {
  /** ガード式の変数名(`{集約}.{欄}`)。 */
  readonly key: string;
  readonly values: readonly EqAxisValue[];
}

/** 畳んだガード変数 1 本の内訳。 */
export interface EqFoldedGuard {
  /** ガード式の変数名。 */
  readonly key: string;
  /** その値ならどれかの規則が成立する、という値の字面。 */
  readonly satisfying: readonly string[];
  /** どの規則も成立しない値の字面。 */
  readonly refuting: readonly string[];
}

/** 状態ごとに置き直す列 1 つ(遷移が書き留める欄)。 */
export interface EqRecordedColumn {
  readonly column: string;
  /** 置く値(その状態では空なら null)。 */
  readonly value: string | null;
  /**
   * 参照の欄なら、その参照先の集約の名前(`records_actor`)。
   *
   * 値は world の中のその集約の行の id に解決する(置き直す側が実行者自身の行から引く)ので、
   * `value` は使わない。時刻の欄では null である。
   */
  readonly entity: string | null;
}

/** 状態 1 つぶんの「遷移が書き留めた欄」の姿。 */
export interface EqRecorded {
  /** その状態が載る列。 */
  readonly stateColumn: string;
  /** 状態の値。 */
  readonly state: string;
  /** その状態のときに置き直す列(空に戻す列も並ぶ)。 */
  readonly columns: readonly EqRecordedColumn[];
}

/** 操作 1 つぶんの軸(直積は実行する側が掛ける)。 */
export interface EqOperation {
  /** 操作 ID(`operation-plans.ts` の鍵)。 */
  readonly op: string;
  /** 人の言葉での見出し(仕様の label)。 */
  readonly label: string;
  /** 動かす集約(作成が「行ではなく入力を見る」判定に使う)。 */
  readonly aggregate: string;
  readonly kind: 'create' | 'transition' | 'delete' | 'update';
  /** 対象の状態が載る列(遷移だけ。それ以外は null)。 */
  readonly stateColumn: string | null;
  /** 対象の状態の並び(遷移だけ。それ以外は [null])。 */
  readonly states: readonly (string | null)[];
  /**
   * 実行する実行者の並び(world の実行者の名前)。
   *
   * 判断材料として実行者自身の行を読む操作からは、行が無い人が外れる —— その人には
   * engine の判定そのものが無い(実行器は読み取りの段で止まる)。
   */
  readonly actors: readonly string[];
  /** ロール配列の種類の並び(実行者の arrays から引く鍵)。 */
  readonly arrays: readonly string[];
  /** 編集で動かす欄の並び(編集以外は [null])。 */
  readonly fields: readonly (string | null)[];
  readonly axes: readonly EqAxis[];
  /** 直積の大きさ(実行する側が同じ数だけ回す)。 */
  readonly count: number;
  /** 代表値に畳んだ軸(畳んでいなければ空)。 */
  readonly folded: readonly string[];
  /**
   * 畳んだガード変数の内訳(畳んでいなければ空)。
   *
   * 残した値は「そのガードを成立させる値 + 不成立にする値」である(V9 と同じ充足性判定の
   * witness から選ぶ)。両側とも残るので、畳んだ操作でも許可の側が必ず実行される。
   */
  readonly foldedGuards: readonly EqFoldedGuard[];
  /**
   * その操作の RPC が**拒否をどこまで返すか**(data_table の宣言から決まる)。
   *
   * `named` は本文が生成物(理由まで一致する)、`unnamed` は `handwritten:` を宣言した本文
   * (可否は一致するが理由は返さず 0 行で返る)、`none` は `shape: composite`
   * (RPC は判定せず、守っているのは engine だけ)である。
   */
  readonly enforcement: 'named' | 'unnamed' | 'none';
  /**
   * 判断材料として実行者自身の行から読む集約(対象の集約は除く)。実行者の集約が対象の行の祖先でもあるとき、
   * 集約の名前だけで引くと別人の行を実行者の行として読んでしまう —— ここに挙げた集約は実行者の行で引く。
   */
  readonly actorReads: readonly string[];
  /** 入力の欄の既定値(型から決まる。対象の行の雛形に無い欄の受け皿)。 */
  readonly inputs: Readonly<Record<string, EqValue>>;
  /**
   * 作成のとき、雛形の値の上から置き直す入力の欄(world の行と一意の鍵で当たらない値。無ければ置き直さない)。
   * 雛形は world に既にある行なので、一意の鍵の欄まで写すと許可された作成が全部その索引に当たる(点検 20 回目 B20-1 の残り 2)。
   */
  readonly fresh?: Readonly<Record<string, EqValue>>;
  /**
   * **他の系統(= 他のテナント)の対象の行でも実行するか**(テナント境界を結んだ操作だけが真。無ければ偽)。
   *
   * 真のとき、行を持つ実行者ごとに「他の系統の対象の行」でも同じ軸を掛けて実行し、**engine も RPC も拒否する**ことを
   * 表明する(一致だけでは足りない —— 境界の項を書き忘れた仕様では engine と RPC が仲良く許可する)。
   */
  readonly crossTenant?: boolean;
}

/** 集約 1 つぶんの world と組み合わせ。 */
export interface EqWorld {
  readonly aggregate: string;
  readonly table: string;
  /** 実行者の集約の物理テーブル名。 */
  readonly actorTable: string;
  readonly actors: readonly EqActor[];
  /** 挿入順の行(参照先が先)。 */
  readonly rows: readonly EqWorldRow[];
  /**
   * 状態ごとの「遷移が書き留めた欄」の姿(`records_actor` / `records_time`)。
   *
   * 置き直しが状態の欄を動かすとき、その状態が要求する欄を一緒に置くための材料である
   * —— 状態だけを動かすと「状態 ⇔ 欄の有無」の不変条件が破れた行ができる。
   */
  readonly records: readonly EqRecorded[];
  readonly operations: readonly EqOperation[];
}
