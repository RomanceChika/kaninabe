/**
 * data_table(テーブル仕様)のモデル型。
 *
 * data_table が宣言するのは **DB 固有の実装判断だけ**である(列・型・NOT NULL は
 * entity_spec が正 — ARCH-SP-BE-0001)。ここに載る宣言は生成器が
 * `app/src/domain/generated/data-table-expectations.ts` に写し、統合テストが
 * pg_catalog と双方向に突き合わせる(rls-expectations / policy-parity と同じ流儀)。
 *
 * 表の宣言(外部キー・トリガ・チェック)と、関数の帰属宣言(`functions[]`)の型を**同じ 1 枚**に
 * 置く。表の形の器(インデックス・排他・連番)だけは `types-shape.ts` にある。
 *
 * @oversize 超える理由: data_table の宣言の型は 1 つの仕様種のモデルで、パーサー・生成器・検証器の全部が
 *   この 1 枚を読む。`DataTableSpec` が関数の宣言を持つので、表と関数の型を 1 か所で見通せる形にしてある。
 * @split-review 割る案と結果: 表の宣言(`DataTableSpec` ・外部キー・トリガ・検査)と関数の宣言(`DataFunctionDecl` と 3 つの閉じた
 *   語彙。以前の `types-functions.ts`)に割る案を検討した。関数の宣言を使う側は全員 `types.ts` の入口から
 *   読んでおり、`types-functions.ts` を直接読んでいたのは `types.ts` の再輸出だけだった。`DataTableSpec` が
 *   `functions` の欄でこの型を持つので、割っても再輸出の 1 段が増えるだけで、独立した使い手がいない。
 *   別の読み手がいる表の形の器(インデックス・排他・連番)は、既に `types-shape.ts` に割ってある。
 */

import type { TriggerCopyAccept } from '../parse-copy-accept.js';
import type { LockStrength, RefuseErasedDecl, TriggerCopySource } from './types-locks.js';
import type { SourceLocation } from '../types.js';
import type { DataExclusionDecl, DataIndexDecl, DataSequenceDecl } from './types-shape.js';
import type { ActionTestCase } from '../../testcase/types.js';
import type { DataResendDecl } from './types-resend.js';
import type { DataParityAccept } from './types-parity-accept.js';

export type { DataResendDecl } from './types-resend.js';

/** 外部キーの ON DELETE 挙動の値域(pg_constraint.confdeltype の写像)。 */
export const ON_DELETE_ACTIONS = ['cascade', 'no_action', 'restrict', 'set_null', 'set_default'] as const;

/** 外部キーの ON DELETE 挙動。 */
export type OnDeleteAction = (typeof ON_DELETE_ACTIONS)[number];

/** 外部キー 1 本の宣言。制約名は宣言しない(自動命名はノイズ)。列 + 参照先 + ON DELETE が同一性。 */
export interface DataForeignKeyDecl {
  /** この表側の列。 */
  readonly column: string;
  /** 参照先テーブル。public 以外は `auth.users` のようにスキーマ修飾する。 */
  readonly references: string;
  /** ON DELETE の挙動。業務上の意味(消したら何が起きるか)を持つ実装判断。 */
  readonly onDelete: OnDeleteAction;
  /** 消去された行への新しい紐づけを断る宣言(点検 19 回目 A19-4。`types-locks.ts`)。 */
  readonly refuseErased?: RefuseErasedDecl;
}

/** 導出の方式の値域(`triggers[].derives` の `mode`)。`initial` = 挿入時に空のときだけ / `follow` = 発火のたびに引き直す。 */
export const DERIVE_MODES = ['initial', 'follow'] as const;

/** 導出の方式。 */
export type DeriveMode = (typeof DERIVE_MODES)[number];

/** 導出の幅の単位(`offset` の語。複数形も同じ単位として読む)。 */
export const DERIVE_UNITS = ['minute', 'hour', 'day'] as const;

/** 導出の幅の単位。 */
export type DeriveUnit = (typeof DERIVE_UNITS)[number];

/**
 * 導出 1 列の宣言(`triggers[].derives` の 1 要素)。形は 2 つある —— 同じ行の日時列 ± 定数の幅(`OffsetDerivation`)と、
 * 親の下の末尾の番号(`AppendDerivation`。点検 24 回目 B24-1)。
 *
 * 値は**字面のまま**持つ —— 値域・形の検査は T15 の仕事で、パーサーが先に丸めると
 * 「書いた人の字面」を指して直す指摘が出せない。
 */
export type DataDerivation = OffsetDerivation | AppendDerivation;

/** 同じ行の日時列 ± 定数の幅で決める導出。 */
export interface OffsetDerivation {
  /** 導出される列(自表の列。`supplied_by: db`)。 */
  readonly column: string;
  /** 導出の元になる自表の日時列。 */
  readonly from: string;
  /** 元からの幅(`{±n} {minute|hour|day}`。例: `-14 days`)。 */
  readonly offset: string;
  /** 導出の方式(`DERIVE_MODES`)。 */
  readonly mode: string;
  readonly within?: undefined;
}

/**
 * **親の下の末尾の番号**で決める導出(`{ append_within: {親を指す列}, mode: initial | insert_at }`)。
 *
 * 挿入のときに空なら、同じ親(`within` の列の値が同じ行)の番号の最大 + 1 を入れる。数える前に親の行を排他で掴む
 * (トリガの `locks` に親の表を `update` で宣言する。書き込む RPC はそれを先掴みに入れる)ので、同じ親への同時の作成は
 * 1 本ずつ番号を取り、重ならない。画面が読み取りから「次の番号」を導いて送る形(古い読みが一意の索引の拒否に化ける)を
 * 宣言の側で閉じる口である。
 *
 * 方式は 2 つ(`APPEND_MODES`)。`initial` は値を入れてきた行をそのまま入れる(データ移行の明示の値)。`insert_at` は入れてきた値を
 * **位置**と読み、同じ親のその位置以降の行を 1 つずつ後ろにずらして差し込む(末尾 + 1 を越える位置は末尾に丸める。fix25s)——
 * 利用者が発表順を選ぶ作成で、選んだ番号が既にあっても一意の索引の拒否に化けない。
 */
export interface AppendDerivation {
  /** 導出される列(自表の整数の列。`supplied_by: db`)。 */
  readonly column: string;
  /** 番号を数える範囲 = 親を指す自表の列(直の外部キーを持つこと)。 */
  readonly within: string;
  /** 導出の方式(`APPEND_MODES`)。 */
  readonly mode: string;
  readonly from?: undefined;
  readonly offset?: undefined;
}

/**
 * 末尾の番号の方式の値域。`initial` = 空のときだけ末尾に振る / `insert_at` = 入れてきた値を位置と読んで差し込み、空なら末尾(fix25s)。
 */
export const APPEND_MODES = ['initial', 'insert_at'] as const;

/** 入れてきた値を位置と読む方式(作成の入力に現れてよい。V17 (a)(c) の例外)。 */
export const APPEND_INSERT_AT = 'insert_at';

/**
 * 末尾の番号の導出か。
 *
 * @param derivation 導出 1 列
 * @returns `append_within` の形なら true
 */
export function isAppendDerivation(derivation: DataDerivation): derivation is AppendDerivation {
  return derivation.within !== undefined;
}

/**
 * その表で、**作成が位置を入れてよい**列(`derives` の末尾の番号のうち `mode: insert_at` のもの。fix25s)。
 *
 * `supplied_by: db` の欄は作成の入力に現れない(V17 (a))・作成 RPC に渡す口が無い(V17 (c))・値の袋で運ばない(`rpc-columns.ts`)のが
 * 既定である。この列だけは「空なら DB が末尾に振る・入れたら DB がその位置に差し込む」なので、作成の入力に**任意で**現れてよい。
 * 例外の持ち主はこの 1 本で、検査(V17)と生成(作成 RPC の列)が同じものを呼ぶ。
 *
 * @param table テーブル仕様
 * @returns 列名の集合
 */
export function insertAtColumnsOf(table: DataTableSpec): ReadonlySet<string> {
  const columns = new Set<string>();
  for (const trigger of table.triggers) {
    for (const derivation of trigger.derives ?? []) {
      if (isAppendDerivation(derivation) && derivation.mode === APPEND_INSERT_AT) columns.add(derivation.column);
    }
  }
  return columns;
}

/** トリガ 1 本の宣言。突合は名前・関数・**遅延であること**・**発火の細部**まで。 */
export interface DataTriggerDecl {
  /** 写しの先で隠し列・個人列の約束が崩れることの理由つき受け入れ(任意。T15 が接地を見る。A12-2)。 */
  readonly accept?: readonly TriggerCopyAccept[];
  /** トリガ名。 */
  readonly name: string;
  /** 実行する関数名(同じファイルの functions に kind: trigger で載っていること)。 */
  readonly functionName: string;
  /**
   * 発火タイミング(例: `"before insert or update of state, workshop_id"`)。
   *
   * **突合される** —— data-table-parity が `pg_trigger.tgtype` を割って、いつ
   * (before / after)・何で(insert / update / delete / truncate)・何ごとに(行 / 文)を
   * 両方向で比べる(2026-09-23 まで宣言のみだった。「INSERT も見る」と書いたトリガが
   * UPDATE しか見ていなくても全部緑だった)。字面を割るのは `lib/model/trigger-fires.ts`、
   * 実 DB 側の `tgtype` を割るのは突合のクエリである。
   * **列の名指し(`of …`)までは比べない** —— そこは `tgattr` を読む別の判断である。
   */
  readonly fires?: string;
  /**
   * コミット時に評価する制約トリガか(`deferrable initially deferred`)。
   *
   * `fires` と同じく**突合される**(data-table-parity が `pg_trigger` の
   * `tgdeferrable` / `tginitdeferred` と比べる)。複数の手順にまたがって満たす不変条件は
   * 遅延であることが執行の前提であり、誰かが後から普通のトリガに書き換えると、
   * 保存点の内側で途中状態が弾かれるようになる —— そこを機械が守る
   * (ARCH-SP-BE-0001 §コミット時に評価する不変条件)。
   */
  readonly deferred: boolean;
  /**
   * このトリガが値を供給する列(entity_spec が `supplied_by: db` を宣言した欄)。
   *
   * 「入力に無いがサーバーが決める値」の機構の宣言である(V17 が entity_spec 側と突き合わせる)。
   * 突合は**トリガの実在まで**であり(名前と関数の集合が data-table-parity で閉世界になる)、
   * 本文が実際にその列を埋めるかは見ない(`fires` は発火の細部まで突合するが、こちらは
   * 本文の中身になるので同じ線には乗らない)。
   */
  readonly supplies: readonly string[];
  /**
   * そのトリガが使う定数(名前 → 値の文字列)。
   *
   * 逆算の「何日前か」のような業務の慣習を**仕様に載せる**ための宣言であり、実装(SQL)の中に
   * だけ住んでいる数を仕様の側から読めるようにする。値の突合は無い(SQL の式と比べる汎用の
   * 手が無い)—— 宣言であることに意味がある、という扱いである。
   */
  readonly params: Readonly<Record<string, string>>;
  /**
   * 供給する列を**同じ行の日時列 ± 定数の幅**か**親の下の末尾の番号**で決める宣言(列 → 元の列・幅・方式 / 親を指す列・方式)。
   *
   * 宣言すると**トリガ関数の本文は生成物になる**(`handwritten` は併記できない)。
   * `supplies` の列と一致していなければならず、`mode` は `initial`(挿入時に空のときだけ)か
   * `follow`(`fires` のたびに引き直す。`fires` に元の列の更新を含むこと)である。
   * 検査は T15、本文は `ddl-derive-triggers.ts` が組み立てる。
   */
  readonly derives?: readonly DataDerivation[];
  /**
   * **作成の後に変えない列**(`freezes: [列]`。点検 fix26 2 回目)。宣言すると本文は生成物になり、`fires: after update`(列を絞らない
   * AFTER の行トリガ)で OLD と NEW を比べて違えば断る(`sql/ddl-freeze-triggers.ts`)。その列を書き換える宣言があれば T17 が止める。
   * 不変条件の書き込みの端の覆いは、凍らせた列の `update of` の端を覆いに数える。
   */
  readonly freezes?: readonly string[];
  /** 由来する不変条件 ID(あれば)。 */
  readonly invariant?: string;
  /** トリガが掴む親の表と強さ(点検 19 回目 A19-1。`types-locks.ts`)。 */
  readonly locks?: Readonly<Record<string, LockStrength>>;
  /** 供給する列の写し元(点検 19 回目 A19-3。`types-locks.ts`)。 */
  readonly copiesFrom?: readonly TriggerCopySource[];
  /** 本文が取る advisory lock の鍵の接頭辞(点検 19 回目 O19-2)。 */
  readonly advisory?: readonly string[];
  /**
   * このトリガが**行の元の持ち主を記録する**ことの宣言(持ち主の列。`remembers_owner: {列}`)。
   *
   * 個人列の写し(`copies_from`)は写した時点の値を持ち、その値の持ち主は写した時点の行の持ち主である。持ち主の列が後から変わる・
   * 行が消える・**持ち主のまま写し元の個人列が書き換わる**と、写しに残った古い値が誰のものかが DB から消え、消去が届かない
   * (点検 19 回目の後の性質テストの反例。名前を直してから紐づけを外すと、演目の写しの元の名前に消去が届かなかった)。
   * 宣言したトリガは、その 3 つの瞬間の全部で発火すること・持ち主の列が変わりうる写し元の表はこの宣言を持つことを T28 が見る。
   */
  readonly remembersOwner?: string;
}

/** entity_spec から導出できない CHECK 制約 1 本の宣言。突合は「DB に実在すること」まで。 */
export interface DataCheckDecl {
  /** 制約名(DB の実名)。 */
  readonly name: string;
  /** 規則(SQL 断片)。定義の正が invariant_spec にあるものは書かず invariant で参照する。 */
  readonly rule?: string;
  /** 由来する不変条件 ID(あれば)。 */
  readonly invariant?: string;
  /**
   * **本文を手書きの migration が持つ**ことの宣言(理由そのものを書く)。
   *
   * `invariant` だけを宣言する行の式は不変条件の `formal` から生成できるが、既に手書きの
   * migration が同じ制約を作っている表では、生成に切り替えると**動いている執行点を
   * `drop` → `add` で作り直す**ことになる。そこを人の判断に残すための宣言であり、
   * `functions[].handwritten`(本文が手写しの RPC)と同じ語・同じ形である
   * —— 理由が空なら T16 が止め、`rule` とは同時に宣言できない。
   */
  readonly handwritten?: string;
}

/** data_table 1 ファイル分の宣言。 */
export interface DataTableSpec {
  /** 文書 ID(`table-{table}`)。 */
  readonly id: string;
  /** 物理テーブル名。 */
  readonly table: string;
  /** 対応する entity_spec の entity。内部テーブル(internal: true)は持たない。 */
  readonly entity?: string;
  /** ドメイン仕様に現れない内部テーブルか(jobs / domain_events / resend_digests など)。RLS ポリシー 0 本が期待になる。 */
  readonly internal: boolean;
  /**
   * **仕組みが自分で持つ表**の設計図の名前(`jobs` / `domain_events`。値域)。
   *
   * 内部テーブルのうち、この 2 つは「アプリの台帳」ではなく**仕組みの台帳**である —— 列を
   * 決めているのは定型 RPC の本文(`rpc-parts.ts`)であり、アプリではない。設計図を
   * `lib/sql/framework-tables.ts` に持ち、ここはそれを名指すだけにする(新しいアプリを
   * 起こすたびに同じ 2 表を書き写す作業が消える)。値域に無い名前は T12 が止める。
   *
   * アプリ固有の内部テーブル(ドメインに現れないがそのアプリだけの台帳)はこれを宣言しない
   * —— 設計図が無いので DDL は手書きの migration のままである。
   */
  readonly framework?: string;
  /**
   * 行を保つ時間(時間の数。`retention_hours`)。**`framework: resend_digests` の表だけ**が持ち、その表では必須である(T12)。
   * 保存点の再送の入力の要約は、この時間を過ぎると比べに使わず(押し直しは `resend_expired` で断る)、次の保存点の書き込みが消す
   * (`rpc-resend-digest.ts`)。ほかの表は無期限保持のまま。
   */
  readonly retentionHours?: number;
  /**
   * 内部テーブルが**写しの表に添える表**であることの宣言(`mirror_of`)。値は写しの表(entity_spec の `mirror: true`)の名前。
   *
   * 添え表の行は写しの行と同じ運命なので、削除は写しの行の削除と同じに数える(破壊的な書き込みに数えない。`mirrorTables`)。
   * 値が写しの表でなければ効かず、破壊的な書き込みのまま数える(閉じる側)。`scrub` は写しと同じく数える。
   */
  readonly mirrorOf?: string;
  /** インデックス(主キー以外の全数)。 */
  readonly indexes: readonly DataIndexDecl[];
  /** 採番の器(全数)。表の DDL の**冒頭**に `create sequence` が出る(既定値の式が呼ぶため)。 */
  readonly sequences: readonly DataSequenceDecl[];
  /** 排他制約(全数)。期間の重なりを禁じる執行点。 */
  readonly exclusions: readonly DataExclusionDecl[];
  /** 外部キー(全数)。 */
  readonly foreignKeys: readonly DataForeignKeyDecl[];
  /** トリガ(全数)。 */
  readonly triggers: readonly DataTriggerDecl[];
  /**
   * 列の既定値(列名 → SQL の式)。
   *
   * entity_spec が `supplied_by: db` を宣言した欄の機構のうち「列の既定値で決まる」ものを
   * 宣言する(V17)。突合は**片方向**である(data-table-parity が `pg_attrdef` の式と比べる)——
   * `id` / `state` のように entity_spec からの導出で入る既定値は宣言に現れないため、
   * DB 側の全数との双方向突合はできない(CHECK と同じ線引き)。
   */
  readonly defaults: Readonly<Record<string, string>>;
  /**
   * **RLS の select ポリシー全数**を生成して書き出す migration のファイル名
   * (`{14 桁}_policies_{table}.sql`)。
   *
   * `access_spec` を持つ表(= `reads` がある表)には必須である(T7)。中身は `reads` から
   * 決まる —— 権限(`revoke` / `grant select`)・RLS の有効化・ポリシー 1 本ずつの
   * `using (…)` までが宣言の写しになる(束 ⑳-4a)。名前を仕様に宣言させるのは定型 RPC の
   * 本文と同じ理由で、**SQL が変わる変更では名前を新しくする**ことで追記専用の歴史と両立する。
   */
  readonly policiesMigration?: string;
  /**
   * **表の DDL 全体**を生成して書き出す migration のファイル名(`{14 桁}_ddl_{table}.sql`)。
   *
   * `entity` を持つ表には必須である(T12)。中身は entity_spec(列・型・NOT NULL・
   * フィールド制約)と data_table(索引・外部キー・排他・既定値)から決まる —— 表の形は
   * どこにも「決める余地」が残っていないのに、310 列ぶんが手で書き写されていた
   * (ADR-0012「DB を権威にする」の続き)。
   *
   * 中身は**冪等な DDL** である(`create table if not exists` / `add column if not exists` /
   * 導出 CHECK の `drop constraint if exists` → `add constraint`)。**列は足すだけで、
   * 落とさない・型は変えない** —— データに触る判断は人が手書きの migration で行い、
   * 食い違いは突合(ddl-parity)が error で名指す。
   *
   * 名前を仕様に宣言させるのは `policies_migration` と同じ理由で、**DDL が変わる仕様変更では
   * 名前を新しくする**ことで追記専用の歴史と両立する(migrations.md §生成 migration)。
   */
  readonly ddlMigration?: string;
  /**
   * **SQL の公開面(surface)のビュー 1 枚**を生成して書き出す migration のファイル名
   * (`{14 桁}_{exposedSchema}_view_{table}.sql`。T12 が置き場の実在に依らずいつも名前の規則と照らす)。
   *
   * entity_spec と access_spec の両方を持つ表には必須である(T12)。中身は entity_spec の
   * 列(並びも含めた全列挙)と access_spec の `fields_hidden`(隠し列とそれを解く述語)から
   * 決まる —— 「外から見えるのは宣言した列だけ」という約束は、列を並べて書いたビューの
   * 字面がそのまま形にしている(docs/design/api-views-generation.md §1)。
   *
   * 名前を仕様に宣言させるのは `policies_migration` / `ddl_migration` と同じ理由で、
   * **SQL が変わる仕様変更では名前を新しくする**ことで追記専用の歴史と両立する
   * (列を 1 つ足せばビューの字面が変わる = 新しい名前が要る)。
   */
  readonly surfaceMigration?: string;
  /**
   * 廃止された旧いキー `api_view_migration` が書かれていた(パーサが廃止の error を出している)。立っているとき、T12 は
   * 「surface_migration がありません」を重ねて出さない(1 つの原因に 1 つの指摘。直し先は同じ `surface_migration` への書き直しである)。
   */
  readonly retiredSurfaceKey?: true;
  /**
   * 作成の冪等な再送で既存の行を返すか(`resend`。`types-resend.ts`)。
   *
   * `shape: create` の関数を持つ表と、保存点の最初の作成の錨になる表には必須である
   * (書いていなければ T6 / Y12 が名指しで止める。黙って実行者を問わない枝を出さない)。
   */
  readonly resend?: DataResendDecl;
  /**
   * 参照を辿って本人に届く個人列を、消去の連鎖に入れないことの理由つきの受け入れ(`erasure_accept`。T24 が実在と腐りを見る)。
   */
  readonly erasureAccepts?: readonly DataErasureAccept[];
  /**
   * 「持ち主は宛先」の個人列の閉じた表(`erasure_addressee`)。本人の行の参照(`{本人の表}.{列}`)がこの表を指すとき、書いた人でなく指された本人の個人データである。
   * 本人からの参照が指す表の個人列は、ここか `erasure_accept` のどちらかに載る(T24)。
   */
  readonly erasureAddressees?: readonly DataErasureAddressee[];
  /**
   * 内部テーブルの個人列(`personal_columns`。空の並びは「個人列を持たない」の宣言)。内部テーブルは entity_spec を持たないので、本人へ届く外部キーを持つ表はここが必須である(T24)。
   */
  readonly personalColumns?: readonly string[];
  /**
   * 構造の突合の照らし(不変条件の書き込みの端・トリガの advisory lock・隔離の門)の、理由と試験の ID つきの受け入れ(`parity_accepts`。
   * `types-parity-accept.ts`。生成物 `dataTableParityAccepts` を突合が読む。点検 26 回目 A26-1)。
   */
  readonly parityAccepts?: readonly DataParityAccept[];
  /** この表を持ち場とする関数(閉世界の割り当て)。 */
  readonly functions: readonly DataFunctionDecl[];
  /** entity_spec の導出でない CHECK 制約。 */
  readonly checks: readonly DataCheckDecl[];
  /** テストケース宣言(突合テストを指す)。 */
  readonly testCases: readonly ActionTestCase[];
  /** 仕様ファイルの位置。 */
  readonly location: SourceLocation;
  /** specs/backend/data/tables からの相対パス(一覧表用)。 */
  readonly relPath: string;
}

/** `erasure_accept` の 1 行(参照の列・受け入れる個人列・理由を名指す)。 */
export interface DataErasureAccept {
  readonly via: string;
  readonly columns: readonly string[];
  readonly reason: string;
}

/** `erasure_addressee` の 1 行(個人列・本人からの参照・理由を名指す)。 */
export interface DataErasureAddressee {
  readonly column: string;
  /** 本人の行からこの表を指す参照(`{本人の表}.{列}`)。 */
  readonly via: string;
  readonly reason: string;
}

/** 読み込んだ data_table の集合。 */
export interface DataTableSpecModel {
  /** specs/backend/data/tables ディレクトリが存在したか。false なら T 群はスキップされる。 */
  readonly available: boolean;
  /** 読み込めた data_table(ファイル名順)。 */
  readonly tables: readonly DataTableSpec[];
  /**
   * 読めずにモデルへ入れなかった表のファイル(置き場からの相対パス。ファイル全体が読めなかったもの・表の中で行を落としたもの)。
   * 落としたものが無ければ書かない。部分のモデルの要約が「落ちた表」を名指すのに使う。
   */
  readonly droppedTables?: readonly string[];
  /**
   * 落とした表のうち、フロントマターに `entity` が読めたものの entity 名(`droppedTables` の要素 → entity)。
   * 落とした表の ID の名前空間(`TC-EQ-{ENTITY}-…`)を知るのに使う。読めなかった表は載らない。無ければ書かない。
   */
  readonly droppedEntities?: Readonly<Record<string, string>>;
}

// ── `functions[]`(public スキーマの関数の帰属宣言)の型。
// スキーマの正: ARCH-SP-BE-0001 §テーブル仕様。

/**
 * 関数の種別の値域。rpc = security definer + service_role 限定 / trigger = トリガ関数 / helper = RLS 補助 /
 * send_limit = 送信の上限(outbox へ積む前に、宣言した単位ごとの直近の件数を数えて拒む。本文は生成物。`sendLimit` の宣言)。
 */
export const DATA_FUNCTION_KINDS = ['rpc', 'trigger', 'helper', 'send_limit'] as const;

/** 関数の種別。 */
export type DataFunctionKind = (typeof DATA_FUNCTION_KINDS)[number];

/**
 * 書き込み RPC の**形**の値域。
 *
 * `transition` / `create` / `update` / `delete` は server-actions.md の「5 形の定型」の SQL 版で
 * あり、**本文が宣言から決まる**(許可列・楽観的並行制御の有無・書き込み先)。したがって
 * 期待を生成でき、統合テスト(rpc-parity)が実 DB の `pg_get_functiondef` と突き合わせる。
 *
 * `composite` は定型に乗らない関数(複数集約をまたぐ・独自の手順を持つ)である。本文の意味は
 * 突合しないが、**印を付けること自体が宣言**であり、「定型のつもりで書いたのに定型でない」
 * ものが黙って増えるのを防ぐ(免除台帳を別に作らないのは、帰属の宣言と同じ場所に書けるため)。
 */
export const DATA_FUNCTION_SHAPES = ['transition', 'create', 'update', 'delete', 'composite'] as const;

/** 書き込み RPC の形。 */
export type DataFunctionShape = (typeof DATA_FUNCTION_SHAPES)[number];

/**
 * 書き込み RPC の**戻り値の形**の値域。
 *
 *   - `rows` … 帰属表の行の列(`setof`)。定型 4 形は常にこれなので、書かせない(書くとエラー)。
 *   - `scalar` … 行でも文書でもない単一の値(例: 消した件数)。
 *
 * 定型に乗らない `composite` の RPC は戻り値の形を**必ず宣言する**(省略を `rows` とみなして署名の表に
 * 黙って書くと、行を返さない関数が行を返すことになる)。生成した複合 RPC(保存点・受信)は文書(jsonb)を返し、
 * これは仕様に書かず生成器が決める。
 */
export const DATA_FUNCTION_RETURNS = ['rows', 'scalar'] as const;

/** 書き込み RPC の戻り値の形。 */
export type DataFunctionReturns = (typeof DATA_FUNCTION_RETURNS)[number];

/**
 * 関数を**誰の権限で実行するか**の値域(`security definer` / `security invoker`)。
 *
 * **宣言できるのは `kind: trigger` の手書きの本文だけである。** `rpc` / `helper` は
 * どちらも必ず `definer`(それが種別の意味そのもの)であり、本文が生成物のトリガ関数は
 * 生成器が決める —— 読み直すトリガだけが `definer` で、`new` だけを見るトリガは
 * `invoker` である(`ddl-guards.ts` の `DdlTriggerFunction.securityDefiner`)。
 * 二重の正を作らないため、生成物に宣言を書くのは T17 が error で止める。
 */
export const DATA_FUNCTION_SECURITY = ['definer', 'invoker'] as const;

/** 関数を誰の権限で実行するか。 */
export type DataFunctionSecurity = (typeof DATA_FUNCTION_SECURITY)[number];

/**
 * `functions[].enforces` の 1 要素 — `composite` の関数が執行点になる `writes` の規則 1 つ。
 *
 * `when` / `fields` は**持たない**(正は access_spec の規則で、写すと 2 重の正になる)。
 */
export interface DataFunctionEnforces {
  /** access_spec のエンティティ(その `writes` の規則を名指す)。 */
  readonly writes: string;
  /** その `writes` の規則の `by`(ロール ID)。同じ `by` の規則が複数あれば、そのすべてを名指す。 */
  readonly by: string;
  /** その規則を守っていることを確かめる見張りテストの id(**同じ表**の `test_cases`)。 */
  readonly testCase: string;
}

/**
 * public スキーマの関数 1 本の帰属宣言。
 *
 * 全 data_table の functions の和集合が「public スキーマの関数の完全集合」になる(閉世界)。
 * どの表にも帰属しない関数が DB にあれば突合が落ちる。
 */
export interface DataFunctionDecl {
  /** 関数名。 */
  readonly name: string;
  /** 引数型の並び(pg_catalog の型名。例: uuid, text, text[], jsonb, integer)。 */
  readonly args: readonly string[];
  /**
   * 引数**名**の並び(`args` と同じ順・同じ長さ。`kind: rpc` でだけ宣言する)。
   *
   * 束 ⑯b は「引数名は migration の SQL にしかない」として型だけを正にしたが、複合 RPC を
   * 生成する(束 ⑯c)には各引数の**意味**が要る。名前を仕様に載せ、`pg_proc.proargnames` と
   * 双方向に突き合わせる(rpc-signatures-parity)ことで、二重管理ではなく**突合された単一の
   * 正**になる。名前の意味の規約は usecase-spec-writing.md §引数名 → 供給元。
   */
  readonly params: readonly string[];
  /** 種別。rpc / helper は security definer であることも突合される。 */
  readonly kind: DataFunctionKind;
  /**
   * 書き込み RPC の形(`kind: rpc` のときだけ宣言する。他の種別では書けない)。
   *
   * 定型(composite 以外)なら、本文の意味 — 許可列・楽観的並行制御の有無 — が仕様から
   * 決まるので、生成した期待と実 DB の関数定義を統合テストが突き合わせる。
   */
  readonly shape?: DataFunctionShape;
  /**
   * 書き込み RPC の戻り値の形(`kind: rpc` かつ `shape: composite` だけが宣言し、そこでは必須)。
   * 定型 4 形は常に行の列を返すので宣言できない。署名の表(`rpc-signatures`)の `returns` の出どころで、
   * 実 DB の関数の戻り値の型と統合テストが突き合わせる。
   */
  readonly returns?: DataFunctionReturns;
  /**
   * 本文を生成して書き出す migration のファイル名(`kind: rpc` は `{14 桁}_rpc_{name}.sql`、
   * `kind: helper` は `{14 桁}_helper_{name}.sql`)。
   *
   * **これが「本文は生成物である」という宣言そのもの**である(束 ⑳-2)。定型 5 形の RPC は
   * 許可列・楽観的並行制御・監査ログ・副作用の積み方まで仕様から決まるので、`code-rpc-bodies`
   * が plpgsql をまるごと書き出す。migration が追記専用の歴史であることとの両立は、複合 RPC
   * (`saves[].migration`)と同じ手で取る —— **名前を仕様に宣言させ、SQL が変わる仕様変更では
   * 名前を新しくする**(旧ファイルは歴史として残り、新ファイルが `create or replace` で
   * 置き換える)。形式と一意性は T6 が、実 DB との一致は rpc-parity が見る。
   */
  readonly migration?: string;
  /**
   * 本文を手で書く理由(**生成できるはずの本文を生成しない**ことの、理由つきの宣言)。
   *
   * 2 つの種別が宣言できる。
   *
   * - **`kind: rpc`**: `migration` と**排他**であり、どちらか一方が必ず要る(T6)。ここに
   *   書けるのは「形は定型だが、本文に仕様から導けない手順が混じっている」もの ——
   *   例えば DSL 外と宣言された不変条件の連鎖を本文が持つ場合である。`composite` に
   *   降格させないのは、**降格すると許可列・楽観的並行制御の突合まで失われる**からで、
   *   形の宣言は残したまま「本文だけ手書き」と宣言するのがこの欄である。
   * - **`kind: trigger`**(束 ㉖): 本文が**手書きの migration にある**ことの宣言である。
   *   トリガ関数の本文も宣言から決まるものは生成する(祖先の列の写し / 条件を課すもの)が、
   *   既に手書きの migration が同じ関数を作っている表で生成に切り替えると**動いている執行点を
   *   置き換える** —— そこを人の判断に残す。書き出し先はその表の `ddl_migration` なので
   *   `migration` は宣言できず、**宣言しなければ本文が生成できることを T17 が要求する**。
   *   **この種別だけ書き方がマッピングである** —— `handwritten: { migration, reason }` で、
   *   `migration` は**その本文を作っている migration のファイル名**である(下記)。
   *
   * どちらも**免除リストではない** —— 理由が空ならパーサーが止め、別の台帳は無い。
   */
  readonly handwritten?: string;
  /**
   * `handwritten` が名指した **migration のファイル名**(`kind: trigger` だけが持つ)。
   *
   * **T17 がその実在と、その本文に関数名の字面があることを見る。** 理由が自由文 1 行だった
   * あいだ、名指しの誤りは誰も捕まえなかった —— 束 ㉖ の 23 行のうち 1 行が、関数名を 1 文字も
   * 含まない migration を宣言していた(独立レビュー D1)。名前を欄に分けたのはそこを閉じる
   * ためであり、**自由文から名前を拾う形は採らない**(拾い方が仕様になってしまう)。
   */
  readonly handwrittenMigration?: string;
  /**
   * その関数を**誰の権限で実行するか**(`kind: trigger` の**手書きの本文**だけが宣言する)。
   *
   * **省略は `invoker` である。** `create or replace function` は指定しなかった属性を既定に
   * 戻すので、`security definer` は「宣言に現れないのに実 DB にだけある性質」になりやすい ——
   * 手書きの関数を生成物に差し替えた日に、定義者権限が**静かに**落ちる(束 §17 で実際に
   * 2 本落ちた。読み直さないトリガなので害は無かったが、誰も報告していなかった)。
   * ここに書けば `data-table-parity` が `pg_proc.prosecdef` と突き合わせる。
   *
   * 本文が生成物のトリガ関数は**書かない** —— 値は生成器の計画が持っており、宣言を重ねると
   * 正が 2 つになる(T17 が両方向を見る。`bodyMd5` を仕様に書かないのと同じ線引き)。
   */
  readonly security?: DataFunctionSecurity;
  /**
   * その補助関数が判定する**ロール**(`kind: helper` でだけ宣言する)。
   *
   * **これが「本文は生成物である」という宣言そのもの**である(束 ⑳-4a)。グローバルに立つ
   * ロール(セッションから立つ `kind` と、実行者自身の行の欄で立つ `claim`)の根拠は、RLS の
   * ポリシーの中から直には書けない —— 実行者の集約を読むと、その集約自身のポリシーで再帰する。
   * そこで security definer の補助関数に逃がすのだが、その本文もロールの宣言から決まるので
   * 生成する。関数名は `is_{role}` に固定であり(T7 が一致を見る)、`migration` と対で宣言する。
   */
  readonly role?: string;
  /**
   * その補助関数が返す**実行者の欄**(`kind: helper` でだけ宣言する。`role` とはどちらか一方)。
   *
   * テナント境界(`reads[].filters` の右辺 `actor.{欄}`)の値の正は実行者自身の行であり、セッションの
   * 写しではない(写しは最長でトークンの寿命だけ古い)。ポリシーの中から実行者の集約を読むと再帰するので、
   * 役の判定と同じく security definer の補助関数に逃がす。**これも「本文は生成物である」という宣言**で、
   * 関数名は `actor_{欄}` に固定であり(T7 が一致を見る)、`migration` と対で宣言する。
   */
  readonly actorField?: string;
  /**
   * この関数が**執行点になる `access_spec.writes` の規則**(`kind: rpc` + `shape: composite` だけが宣言できる)。
   *
   * 定型の `shape: update` は本文が `writes` から生成されるので執行点が仕様から出るが、複数行を一括で
   * 動かすような `composite` は本文が手書きで、`writes` の規則との結びつきが宣言に無かった。ここに
   * 「どの規則の執行点か」と「それを守っていることを確かめる見張りテスト」を書く(ADR-0014)。
   * 形(キーの欠落・余計なキー)はパーサーが、書ける場所・規則の実在・見張りテストの実在・執行点が
   * 1 つであることは T18 が、A18(`writes` の執行点)が執行点として数えるかを決める。
   */
  readonly enforces?: readonly DataFunctionEnforces[];
  /**
   * この関数の本文が**自表を絞り込み・並べるのに使う列の並び**(索引の要求。トリガ関数も書ける)。
   *
   * 例: 同じ送信元の直近の件数を数えるトリガ関数は `lookup: [sender_email, created_at]`
   * (等値で絞る列を先に、範囲・並びの列を後に — query_spec の filters → sort と同じ並べ方)。
   * T2 は query_spec から導く期待索引と**同じ導出**(前方一致の畳み込み・主キー / 一意 / FK 索引による除外)に
   * この宣言を通し、`indexes:` に無ければ error にする。**実在の突合**は data-table-parity が見る
   * (宣言した列が、実 DB の関数の本文に全部現れること — 宣言だけ書いて本文が引かない、を止める)。
   * 読み取りは query_spec が正なので、app のコードが引く索引はここではなく query_spec に書く。
   */
  readonly lookup?: readonly string[];
  /**
   * 主対象のほかに書き込むテーブル(あれば)。
   *
   * **`kind: rpc` では突合される**(rpc-parity): 本文が書き込む表から帰属表を除いた集合が
   * ここと一致すること。宣言に無い表への書き込み(連鎖の書き忘れ)が検出できる。
   */
  readonly alsoWrites: readonly string[];
  /**
   * `alsoWrites` の各表に対する**書き込みの種類**(`also_writes: { {表}: [insert | update | delete | scrub] }`)。
   *
   * 宣言では**必須**(書いていなければパーサーが名指しで error。黙った既定を作らない)。型が任意なのは、
   * 書き込み先を持たない関数と、仕様から合成した関数を省略で表せるようにするためで、`alsoWrites` の各表は
   * ここにキーを持つ。操作の属性(destructive / touches_personal)は、名指しされた RPC のこの宣言から導く。
   * 本文が実際に行う書き込みとの一致は rpc-parity が見る(`scrub` は本文では `update`)。
   * 外部キーの `on delete cascade` / `set null` で**暗黙に**起きる書き込みもここに載せる(T21 が閉包を見る)。
   */
  readonly alsoWriteKinds?: Readonly<Record<string, readonly DataWriteKind[]>>;
  /**
   * **帰属表(自表)への書き込みの種類**(`self_writes: [insert | update | delete | scrub]`)。
   *
   * `shape: composite` では必須(書き込まない関数は `[]` と明示する)。定型 4 形は形が決める
   * (`selfWriteKindsOf`。create = insert / update = update / delete = delete / transition = update)ので、
   * 宣言できるのは本文が手書き(`handwritten`)のものだけである。本文との一致は rpc-parity が見る。
   */
  readonly selfWriteKinds?: readonly DataWriteKind[];
  /**
   * **イベントごとの書き込み**(`event_writes: { {イベント ID}: { {表}: [種類…] } }`)。
   *
   * 1 本の RPC を複数のイベントが通り(遷移の RPC・複数のイベントが名指す複合 RPC)、かつ破壊的な書き込み
   * (写しでない表の `delete`・`scrub`)を持つときは必須(T22)。値は `also_writes` の部分集合で、そのイベントで
   * 書かない関数は `{}` と明示する。操作の属性はイベントのこの宣言から導く(全イベントに後始末を負わせない)。
   */
  readonly eventWrites?: Readonly<Record<string, Readonly<Record<string, readonly DataWriteKind[]>>>>;
  /**
   * **消去が表のどの参照の道で行に届くか**(`scrub_via: { {表}: [参照の列…] }`)。`scrub` / `delete` は表の単位なので、同じ表に本人へ届く別の道があっても宣言からは見えない。
   * 本人へ届く道の全部が、ここか表の `erasure_accept` のどちらかに載る(T24)。本文の一致は erase-parity が見る。
   */
  readonly scrubVia?: Readonly<Record<string, readonly string[]>>;
  /**
   * 本文が呼ぶ**他の関数**(`calls: [関数名…]`。`perform api.x(…)` / `select api.x(…)` の類)。
   *
   * 呼ばれた側の書き込みは呼んだ側の操作の属性に合流する。本文の呼び出しとの一致は rpc-parity が見る
   * (宣言の無い呼び出しは「読めない」で赤)。呼び先の実在は T20 が見る。
   */
  readonly calls?: readonly string[];
  /**
   * 本文が**動的 SQL**(`execute`)を使うことの理由(`dynamic_sql: {理由}`)。
   *
   * 動的 SQL の書き込み先は本文から読めないので、宣言(`also_writes` / `self_writes`)が正になる。宣言の無い
   * `execute` は rpc-parity が「読めない」で赤にし、宣言したのに本文に無ければそれも赤にする。
   */
  readonly dynamicSql?: string;
  /**
   * **送信の上限**の宣言(`kind: send_limit` だけが持ち、そこでは必須)。本文(数え・advisory lock・拒否・積む)は生成物で、
   * 書き出し先は `migration`。形はパーサーが、接地(種別がジョブカタログにある・止める表と列が実在する・署名が宣言から導いた形と
   * 一致する)は T26 が見る。正: ARCH-SP-BE-0001 §送信の上限。
   */
  readonly sendLimit?: SendLimitDecl;
}

/**
 * 送信の上限の宣言(`functions[].send_limit`)。
 *
 * 1 本の生成関数が、outbox(`jobs`)へ 1 本積む前に次を順に行う(本文は `sql/send-limit.ts`)。
 *
 * 1. 種別が `types` の外なら例外(何も積まない)。
 * 2. 鍵の `blocked` に当たる行(例: 下書きの親)なら拒否(語は `blocked.word`。時刻を持たない)。
 * 3. 鍵ごとの advisory lock を、鍵の字面のバイト順に取る(行の掴みの後。ARCH-SP-BE-0001 §送信の上限)。
 * 4. `limits` を宣言の順に数え、`max` 本以上あれば拒否する。理由は最初に当たった上限の語、次に送れる見込みの時刻は
 *    当たった上限の全部の「新しい方から `max` 本目 + `per`」の最も遅い時刻(秒は切り上げ)。
 * 5. 種別 `p_type`・payload(鍵の全部と `payload` の欄)のジョブを 1 本積み、その ID を返す。
 */
export interface SendLimitDecl {
  /** 拒否の本文の操作 ID(`usecase_guard:{event}`。呼ぶ操作の ID)。 */
  readonly event: string;
  /** 数える種別と積んでよい種別(同じ 1 つの閉じた並び。ジョブカタログの ID)。 */
  readonly types: readonly string[];
  /** 数える単位(payload の鍵。引数 `p_{鍵}` uuid)。宣言の順が引数の順。 */
  readonly keys: readonly SendLimitKey[];
  /** 鍵のほかに payload に載せる欄(引数 `p_{欄}` text)。 */
  readonly payload: readonly string[];
  /** 上限(宣言の順が拒否の理由を選ぶ順)。 */
  readonly limits: readonly SendLimitRule[];
}

/** 数える単位 1 つ。 */
export interface SendLimitKey {
  /** payload の鍵(スネークケース)。 */
  readonly name: string;
  /** その鍵が指す行がこの状態なら送れない(任意)。 */
  readonly blocked?: SendLimitBlocked;
  /**
   * 何を 1 つと数えるか(任意。省略 = 鍵の値そのもの = 実行者ごと)。宣言すると、鍵の値から参照の列を順に辿った先の値
   * (例: メンバー → 招いた招待 → その発行者 = 招いたメンバー)を単位にし、同じ単位に辿り着く鍵の値の送信をまとめて数える
   * (自分の別アカウントを招いても上限が増えない)。辿れない値(招いた人がいない最初のメンバーなど)は鍵の値そのものを単位にする。
   */
  readonly unit?: SendLimitUnit;
}

/** 数える単位の辿り方(参照の列を順に辿る。最後の行き先は鍵が指す表と同じ = 単位は鍵と同じ種類の値)。 */
export interface SendLimitUnit {
  readonly via: readonly SendLimitHop[];
}

/** 辿る 1 歩(`table` の行の参照の列 `column` から、`to` の行へ)。 */
export interface SendLimitHop {
  readonly table: string;
  readonly column: string;
  readonly to: string;
}

/** 送れない行の宣言(鍵が指す表の列の値)。 */
export interface SendLimitBlocked {
  /** 鍵が指す表(`id` = 鍵の値)。 */
  readonly table: string;
  /** 見る列。 */
  readonly column: string;
  /** 送れない値。 */
  readonly values: readonly string[];
  /** 拒否の語(UC412 の detail)。 */
  readonly word: string;
}

/** 上限 1 つ(`per` の範囲に `max` 本まで)。 */
export interface SendLimitRule {
  /** 拒否の語(UC412 の detail)。 */
  readonly word: string;
  /** 数える単位(`keys` の名前)。 */
  readonly key: string;
  /** 範囲の中に積めるジョブの本数の上限。 */
  readonly max: number;
  /** 範囲の幅(`{n} {minute|hour|day}s`)。 */
  readonly per: string;
}

/**
 * 書き込みの種類の値域。
 *
 *   - `insert` … 行を足す  - `update` … 行の値を書き換える(個人データを消すものは `scrub`)
 *   - `delete` … 行を消す  - `scrub` … 個人列を placeholder などに置き換えて消す(本文では `update`)
 */
export const DATA_WRITE_KINDS = ['insert', 'update', 'delete', 'scrub'] as const;

/** 書き込みの種類。 */
export type DataWriteKind = (typeof DATA_WRITE_KINDS)[number];
