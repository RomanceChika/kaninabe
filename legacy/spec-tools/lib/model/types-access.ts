/**
 * access_spec(docs/specs/domain/{aggregate}/access.md)の型。
 *
 * 読み取りスコープと、状態遷移によらない作成・更新・削除の権限。
 * 期待 RLS ポリシー表と権限マトリクスの源であり、V4 の入力になる。
 * 入口は types.ts(ファサード)。スキーマの正:
 * docs/rules/process/common/specification/standards/domain-spec-writing.md
 */

import type { SelfAssignDecl, SourceLocation } from './types-common.js';

/**
 * 作成の規則の `delegate` の 1 要素 —— **この規則が実行者に縛らない、入力に出した実行者への参照の欄**と、その理由。
 *
 * 読み手は `parse-access.ts`(形)・`v18-delegate.ts`(接地: 自集約・作成の入力にある・`ref(実行者の集約)`・解く意味がある)・
 * `usecase/actor-bound.ts`(縛りを解く判定)。
 */
export interface DelegateDecl {
  /** 欄の集約(access_spec の entity と同じでなければ読み込みが止める)。 */
  readonly entity: string;
  readonly field: string;
  /** 自分以外を入れてよい理由(誰を選ぶ業務か)。 */
  readonly reason: string;
  readonly location: SourceLocation;
}

/** 読み取りスコープ。閉じた集合。context はパラメータを持つ。 */
export type ReadScope =
  | { readonly kind: 'own' }
  | { readonly kind: 'all' }
  | { readonly kind: 'none' }
  | { readonly kind: 'context'; readonly entity: string };

/**
 * **実行者の属性で行を絞る宣言**(`reads[].filters` の 1 本)。
 *
 * `scope` は「原理としてどの行か」(own / context / all / none)を答えるが、テナントの境界
 * ——「同じ会社の行だけ」—— のように**実行者の属性で一律に狭める**言い方を持っていなかった。
 * その結果、複数テナントのシステムは `scope: all` と書くしかなく、**テナントを越える
 * 読み取りが「正しい仕様」として verify 緑で通っていた**(束 ⑱ の題材 D が実測した最大の穴)。
 *
 * 宣言は「対象の列 = 実行者の属性」の対である(`{ company_id: actor.company_id }`)。
 * 右辺に書けるのは `actor.{欄}` だけで、その欄は `session: true` を宣言していなければならない
 * —— 実行計画の先読みはセッションの写しから引くからである(V2 が接地を見る)。**DB の判定の正は
 * 実行者の行であり、写しではない**: RLS の述語は security definer の補助関数
 * `public.actor_{欄}()` が実行者自身の行を読んで比べる(写しが古いトークンを信じない)。
 *
 * 左辺は対象の列(`{列}`)か、**`context` で辿れる親の列**(`{集約}.{列}`)である。親を辿る語彙は
 * `binding` / `when` と同じ形・同じ上限(2 段。`refPathTo`)であり、テナントの列を持たない子表
 * (予約 → 部屋 → 部門 のように、境界の列が祖先にしか無い表)でも境界を書ける。
 */
export interface ReadFilter {
  /**
   * 境界の列を持つ親の集約(左辺が `{集約}.{列}` のときの `{集約}`)。
   * 書かなければ対象の集約そのものの列である(自集約の名前で書いた左辺も、ここには入れない)。
   */
  readonly entity?: string;
  /** 境界の列(`entity` があればその集約の列、無ければ対象エンティティの列)。 */
  readonly field: string;
  /** 実行者の属性(`actor.{欄}` の `{欄}`)。 */
  readonly actorField: string;
}

/**
 * **テナント境界を宣言しないことの、理由つき受け入れ**(`accept` の 1 件。束 ⑲-2a)。
 *
 * 実行者の属性を表す列(テナントを表す列)を持つエンティティが、その列の `filters` 無しで
 * `scope: all` / `scope: context(...)` を宣言していたら V20 が error を出す(書き込みの側の `when` は V26)。境界を跨がない
 * 理由が別にあるなら(文脈依存ロールがそもそもテナントの中にしか立たない、など)、**対象を
 * 名指しして**受け入れる —— 免除リストではなく、1 件ずつ理由が読める形にするためである
 * (usecase_spec の `accept` と同じ流儀)。
 */
export interface ReadFilterAccept {
  /** 受け入れる読み取り規則のロール。 */
  readonly by: string;
  /** 受け入れる列(テナントを表す列)。 */
  readonly field: string;
  /** なぜ狭めなくてよいか。 */
  readonly reason: string;
  /**
   * **受け入れる規則の種類**(`on: [read, create, write, delete, transition]`)。**省略は読み取りだけ**。
   *
   * 読み取りで跨がない理由は書き込みで跨がない理由とは限らず、その逆も同じである(A3-4: 作成の理由で読み取りが開く)。
   * したがって `on` を書いたら、**書いた種類にだけ**効く —— 読み取りも受け入れるなら `read` を並べる。
   * 書き込み(V26。`creates` / `writes` / `deletes` の `when`・遷移の `guard` に境界が無い形)は `on` で名指したときだけ受け入れる。
   */
  readonly on?: readonly AcceptKind[];
  /**
   * **受け入れる状態遷移**(イベントの ID。`on` に `transition` があるときは必須・無いときは書けない。A4-4)。
   *
   * 遷移の受け入れの理由は 1 つの遷移について書かれる。ロール × 列だけで効かせると、後から足した同じロールの遷移
   * (取消・無効化)の境界まで黙って外れる。名指されていない遷移には効かない。
   */
  readonly events?: readonly string[];
  readonly location: SourceLocation;
}

/** 受け入れが名指せる規則の種類(`reads` / `creates` / `writes` / `deletes` / 状態遷移に対応)。 */
export const ACCEPT_KINDS = ['read', 'create', 'write', 'delete', 'transition'] as const;
export type AcceptKind = (typeof ACCEPT_KINDS)[number];

/** 受け入れが書き込みについて名指せる規則の種類(`creates` / `writes` / `deletes` に対応)。 */
export const WRITE_ACCEPT_KINDS = ['create', 'write', 'delete'] as const satisfies readonly AcceptKind[];
export type WriteAcceptKind = (typeof WRITE_ACCEPT_KINDS)[number];

/**
 * その受け入れが読み取り(V20)に効くか(`on` が無い = 読み取りだけ・`on` があれば `read` を名指したときだけ)。
 *
 * @param accept 受け入れ
 * @returns 読み取りに効くなら true
 */
export function acceptsRead(accept: ReadFilterAccept): boolean {
  return accept.on === undefined || accept.on.includes('read');
}

/** ロールごとの読み取り規則。全ロールについて明示必須(V4 が検証)。 */
export interface ReadRule {
  readonly by: string;
  readonly scope: ReadScope;
  /**
   * 実行者の属性で一律に狭める条件(宣言順。空なら狭めない)。
   * `scope` と直交する —— `scope` が原理の行集合、`filters` がその中の「実行者の側の境界」。
   */
  readonly filters?: readonly ReadFilter[];
  /**
   * **行の状態で見え方を絞る条件**(ガード式の生文字列。省略時は状態で絞らない。束 §14)。
   *
   * `filters` が「実行者の側の境界」を答えるのに対して、ここは**対象の行の側の判定**を答える
   * ——「保管した文書は一般の社員に見せない」のように、**同じ物が状態によって見えなくなる**
   * 言い方である。`scope` / `filters` と論理積で重なる。
   *
   * 右辺にも左辺にも `actor.{欄}` は書けない(V2 がエラーにする)—— 実行者の属性で狭めるのは
   * `filters` の役であり、2 つの口が同じことを言えると「どちらで書いたか」でポリシーの
   * 字面が変わる。ここに書けるのは**自分の行の欄と、`context` で辿れる親の欄**だけである。
   */
  readonly when?: string;
  readonly location: SourceLocation;
}

/** スコープ内でも特定ロールから隠すフィールド。 */
export interface FieldHiddenRule {
  readonly field: string;
  readonly from: readonly string[];
  readonly location: SourceLocation;
}

/** 天井 1 つ(`per` の幅の中に `max` 件まで。`per` は `{n} {minute|hour|day}`)。 */
export interface AbuseWindow {
  /** 幅の中に存在してよい行数(1 以上の整数であるかは R5 が見る)。 */
  readonly max: number;
  /** 幅の字面(`1 hour`。読み込みが `{n} {minute|hour|day}` の形で閉じる)。 */
  readonly per: string;
}

/** 鍵ごとの天井(`per_key`)。 */
export interface AbusePerKey extends AbuseWindow {
  /** 鍵になる欄(自集約の欄の名前。実在は R5 が見る)。 */
  readonly column: string;
}

/**
 * **未ログインが書ける作成の濫用の歯止め**(`creates[].abuse`。R5)。
 *
 * 匿名のロールの作成の規則にだけ書ける。`globalCeiling` は「毎回違う鍵で送られても効く全体の天井」で、無ければ R5 が止める
 * (読み込みは**書かれたものだけ**を持つ。欠落を黙って補わない)。`perKey` は同じ鍵の作り直しを数える任意の天井。
 * `at` は期間を切る日時の欄(省略時は `auto: true` の `datetime` 欄がちょうど 1 つあるときだけその欄)。
 */
export interface AbuseDecl {
  readonly globalCeiling?: AbuseWindow;
  readonly perKey?: AbusePerKey;
  readonly at?: string;
  readonly location: SourceLocation;
}

/**
 * エンティティを新規作成する権限。書かれていないロールは作成不可(deny by default)。
 *
 * 「誰が作れるか」は業務の意味なのでドメイン仕様が持つ(action_spec は公開の判断だけを書く
 * 薄い層であり、そこに置くと SoT が割れる)。writes と同じ流儀で by + 任意の when を書く。
 */
export interface CreateRule {
  readonly by: string;
  /** 作成を許可する条件(ガード式の生文字列)。省略時は常に許可。 */
  readonly when?: string;
  /**
   * **代理で作ってよい欄と理由**(`delegate: [{ field, reason }]`。任意。欄を 1 本ずつ名指す)。
   *
   * 書かなければ、作成の RPC は**実行者を指す参照の欄**(実行者の集約への `ref` の欄。持ち主・発行者など)を
   * 実行者そのものに縛る(違う値なら UC403)。この規則のロールが他人を指す値を入れて作る業務なら、
   * その欄を名指して理由をここに書く(`by` が system のロールの規則は書かなくても縛らない。claim のロールも名指す。点検 11 回目 A11-3)。
   * 解けるのは名指した欄だけである —— 以前は規則単位の 1 文字列で、承認者の欄のために書いた理由が、後から入力に
   * 足した別の実行者への参照の欄の縛りも黙って外した(点検 10 回目 A10-2)。接地は V18(`v18-delegate.ts`)が見る。
   */
  readonly delegate?: readonly DelegateDecl[];
  /**
   * **役の根拠の欄をこの規則の書き手が書いてよいことの、理由つき受け入れ**(`self_assign: [{ field, role, by, reason }]`。欄 × 役を名指す。R2)。
   *
   * 役の根拠の欄(`claim` の欄・`binding` の欄・`actor.{欄}` の欄)は、その役を持つか含意する役と、追える内部実行の
   * 入口だけが書ける。ほかの書き手が書く規則(作った人が自分を所有者にする・自分の状態を戻す・所有者を指名する)は、
   * その場所に理由を書いたときだけ通る。書いたのに根拠の欄を書かない規則は、腐った受け入れとして R2 が止める。
   */
  readonly selfAssign?: readonly SelfAssignDecl[];
  /** 未ログインが書ける作成の濫用の歯止め(R5。匿名のロールの規則にだけ書ける)。 */
  readonly abuse?: AbuseDecl;
  readonly location: SourceLocation;
}

/**
 * エンティティを物理削除する権限。書かれていないロールは削除不可(deny by default)。
 *
 * `creates` と対になる宣言であり、同じ流儀で by + 任意の when を書く。
 * ここが表すのは**行そのものを消す操作**だけである。「取下げ」「無効化」のように
 * 履歴を残す取消しは状態機械(state_spec)の領分であり、`deletes` には現れない。
 */
export interface DeleteRule {
  readonly by: string;
  /** 削除を許可する条件(ガード式の生文字列)。省略時は常に許可。 */
  readonly when?: string;
  /**
   * **未ログインに開く書き込みの、理由つき受け入れ**(`public: 理由`。R5-5)。
   *
   * `by` が未ログインのロールの規則は、意図して開いているときだけこの場所に理由を書いて通す。
   * 未ログインのロールでない規則に書いた `public` は、腐った受け入れとして R5-6 が止める。
   */
  readonly public?: string;
  readonly location: SourceLocation;
}

/** 状態遷移によらないフィールド更新の権限。書かれていない組み合わせは編集不可(deny by default)。 */
export interface WriteRule {
  readonly by: string;
  readonly fields: readonly string[];
  /** 編集を許可する条件(ガード式の生文字列)。省略時は常に許可。 */
  readonly when?: string;
  /**
   * 編集の副作用(outbox ジョブの ID)。state_spec の `effects[].do` と同じ語彙で、
   * 参照先は job_spec の `source: outbox` のジョブ(J1 が双方向に見る)。
   *
   * 状態遷移の `effects` と違い、**この規則の `fields` に含まれる列が実際に変わった行に
   * 対してだけ積む**(条件はここに書かない — 「変わったら積む」の判定は RPC が行う。
   * domain-spec-writing.md §access_spec の `writes[].effects`)。
   */
  readonly effects?: readonly string[];
  /**
   * **役の根拠の欄をこの規則の書き手が書いてよいことの、理由つき受け入れ**(`self_assign: [{ field, role, by, reason }]`。欄 × 役を名指す。R2)。
   *
   * 役の根拠の欄(`claim` の欄・`binding` の欄・`actor.{欄}` の欄)は、その役を持つか含意する役と、追える内部実行の
   * 入口だけが書ける。ほかの書き手が書く規則(作った人が自分を所有者にする・自分の状態を戻す・所有者を指名する)は、
   * その場所に理由を書いたときだけ通る。書いたのに根拠の欄を書かない規則は、腐った受け入れとして R2 が止める。
   */
  readonly selfAssign?: readonly SelfAssignDecl[];
  /**
   * **未ログインに開く書き込みの、理由つき受け入れ**(`public: 理由`。R5-5)。
   *
   * `by` が未ログインのロールの規則は、意図して開いているときだけこの場所に理由を書いて通す。
   * 未ログインのロールでない規則に書いた `public` は、腐った受け入れとして R5-6 が止める。
   */
  readonly public?: string;
  readonly location: SourceLocation;
}

/** access.md。集約ごとに 1 つ。 */
export interface AccessSpec {
  /**
   * 文書 ID(例: "entry-access")。他レイヤーの仕様がこのアクセス宣言を参照するときの名前で、
   * query_spec の `test_cases[].spec_ids` の接地先になる。
   */
  readonly id?: string;
  readonly entity: string;
  readonly reads: readonly ReadRule[];
  readonly fieldsHidden: readonly FieldHiddenRule[];
  readonly creates: readonly CreateRule[];
  readonly writes: readonly WriteRule[];
  /**
   * **遷移だけが書く列**(`transition_writes: [列]`。宣言順)。
   *
   * 人の操作としては現れず、状態遷移(`records_actor` / `records_time` / `clears`)だけが書く列の、集約単位の宣言である。
   * `writes` の規則と違って**ロールを持たず、どの経路も作らない** —— 編集の RPC の書ける列にも、実行器の編集の表にも
   * 入らない。書くのは遷移の RPC だけである(V19 がこの宣言で接地を見る)。
   *
   * 以前はこの宣言を `writes` の `by: system` の行で近似していたが、その行は「内部実行が編集で書ける」という実行の許可でも
   * あり、入口の追えない書き込みの経路を作っていた(2026-10-20 オーケストレーターの裁定)。`by: system` の行は、
   * いまは内部実行の入口が書く編集の意味だけを持つ。
   */
  readonly transitionWrites: readonly string[];
  readonly deletes: readonly DeleteRule[];
  /** テナント境界を宣言しないことの理由つき受け入れ(宣言順。空なら受け入れ無し)。 */
  readonly accepts: readonly ReadFilterAccept[];
  readonly location: SourceLocation;
}
