/**
 * entity_spec(docs/specs/domain/{aggregate}/entity.md)の型。
 *
 * フィールド制約の唯一の定義場所であり、zod スキーマ生成の源になる。
 * 入口は types.ts(ファサード)。スキーマの正:
 * docs/rules/process/common/specification/standards/domain-spec-writing.md
 */

import type { SourceLocation } from './types-common.js';
import type { FieldFormat } from '../kernel/url-format.js';

/**
 * フィールド型。閉じた集合(domain-spec-writing.md §entity_spec)。
 * enum / ref / state はパラメータを持つため判別可能ユニオンで表す。
 */
export type FieldType =
  | { readonly kind: 'uuid' }
  | { readonly kind: 'string' }
  | { readonly kind: 'text' }
  | { readonly kind: 'integer' }
  | { readonly kind: 'decimal' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'date' }
  | { readonly kind: 'datetime' }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'ref'; readonly entity: string }
  | { readonly kind: 'state'; readonly machine: string };

/**
 * 値の供給元の値域(`supplied_by`)。
 *
 * 既定(宣言なし)は「入力か実行者」——作成入力に現れるか、実行者そのもの(`ref(member)`)で
 * 埋まる欄である。`db` は**入力にも実行者にも現れず、DB(列の既定値・トリガ)が決める**という
 * 宣言であり、機構の実体は data_table 側が `defaults` / `triggers[].supplies` で宣言する(V17)。
 */
export const SUPPLIED_BY_VALUES = ['db'] as const;

/** 値の供給元。 */
export type SuppliedBy = (typeof SUPPLIED_BY_VALUES)[number];

/**
 * `bearer`(持っていれば効く値)の宣言。値の生成は DB の列の既定値(CSPRNG の 32 バイト)が持つので、ここが持つのは**寿命の宣言**だけである。
 *
 * - `expiring` … 失効の時刻の欄(`expires_at`)と使った時刻の欄(`used_at`)を同じ集約の `datetime` の欄で名指す(短期で失効し・使い切り)。
 * - `reusable` … 使い回しを理由つきで受け入れる(毎回 warning で名指す = 受け入れた危険)。
 */
export type BearerDecl =
  | {
      readonly kind: 'expiring';
      /** 失効の時刻の欄(同じ集約の `datetime`)。 */
      readonly expiresAt: string;
      /** 使った時刻の欄(同じ集約の `datetime`。入ったら二度と使えない)。 */
      readonly usedAt: string;
      readonly location: SourceLocation;
    }
  | {
      readonly kind: 'reusable';
      /** 使い回しを受け入れる理由(空でない)。 */
      readonly reason: string;
      readonly location: SourceLocation;
    };

/** エンティティの 1 フィールド。制約(max_length 等)は zod 生成の源になる。 */
export interface FieldDef {
  readonly name: string;
  readonly type: FieldType;
  readonly required: boolean;
  /**
   * UI の表示名(業務の名詞。例: 演目名)。states[].label と同じ流儀の任意キーで、
   * 画面は内部名(name)で配線し、表示はこの label を生成物経由で引く
   * (domain-spec-writing.md §entity_spec)。説明文は description が持ち、混ぜない。
   */
  readonly label?: string;
  /**
   * `enum([...])` の値 → 人の言葉(`states[].label` と同じ流儀の任意キー)。
   *
   * **その欄がどれかの action_spec の `input` に現れるなら必須**である(人が選ぶ値には人の言葉が
   * 要る)。キー集合は enum の値集合と一致しなければならない —— どちらも V16 が見る。
   * 生成物: `app/src/domain/generated/{entity}.labels.ts` の `{entity}EnumLabels`。
   * 画面(生成フォームの `select` を含む)はこの表を引き、値 → 表示名の対応を自前で持たない。
   */
  readonly labels?: Readonly<Record<string, string>>;
  /**
   * 値の供給元(任意。既定は「入力か実行者」)。
   *
   * `db` は「入力に現れず、DB が決める」という宣言である。宣言した欄は作成入力スキーマから
   * 落ち、機構(列の既定値 / before insert トリガ)を data_table が宣言する。V17 が
   * (a) どの action_spec の `input` にも現れない (b) data_table が機構を宣言している
   * (c) 作成 RPC の `params` に `p_{欄}` が無い(渡す口が閉じている)の 3 つを見る。
   */
  readonly suppliedBy?: SuppliedBy;
  /** 人間向けの説明。生成されるフィールド定義表の「説明」列の源(YAMLコメントはパースで失われるため専用フィールドを持つ)。 */
  readonly description?: string;
  /** システム採番などで自動設定されるフィールド。writes の対象にできない。 */
  readonly auto: boolean;
  readonly maxLength?: number;
  /**
   * **文字列の欄に長さの上限を置かないことの、理由つきの受け入れ**(`unbounded: 理由`)。
   *
   * `string` / `text` の欄は `max_length` を必ず持つ(上限の無い入力は巨大な本文・ログ・通知・保存の費用の口になる)。
   * 意図して上限を置かない欄だけが、その理由をここに書く。書けるのは `string` / `text` だけで、`max_length` と併記できず、
   * 理由は空にできない(どれも R10 が見る)。数の欄(`integer` / `decimal`)に受け入れの口は無い —— 上限と下限は必ず書く。
   */
  readonly unbounded?: string;
  /**
   * **実行者の集約の参照の欄が、テナントの境界ではないことの理由つきの宣言**(`not_boundary: 理由`。点検 5 回目 A5-4)。
   *
   * 境界の欄は `actor.{欄}` の使用と `session: true` の参照の欄から導く。境界を**全部**書き忘れ、テナントの欄に `session: true` も
   * 付けなかった製品では境界の欄が 0 本になり、V20 / V26 がそろって黙る。そこで境界の欄が 0 本のとき、実行者の集約の参照の欄のうち
   * ほかの集約も同じ参照先を指すもの(テナントの欄に見える形)を V20 が error で名指す。テナントでないならこの宣言で外す(理由は空にできない)。
   */
  readonly notBoundary?: string;
  readonly min?: number;
  readonly max?: number;
  readonly pattern?: string;
  /**
   * 文字列の欄の**書式**(`format: url` = 絶対 URL の http / https だけ)。
   *
   * 外へのリンクになりうる文字列は自由文にせず、この宣言で書く。入力スキーマ(zod)・表の CHECK・
   * world の値・表示側の安全なリンクの部品(`@kaninabe/runtime/url`)が、同じ 1 つの宣言から出る
   * (`pattern` で代用すると world を作れず生成テストが消える)。`string` 型にだけ書け、`pattern` とは併記できず、
   * `max_length` は URL の天井(2048)以下でなければならない。文法の正は `lib/kernel/url-format.ts`。
   */
  readonly format?: FieldFormat;
  /**
   * **持っていれば効く値**(その値を持っているだけで権能が手に入る。招待コード・使い捨てのリンクの鍵など)であることの宣言。
   *
   * `string` の欄で `supplied_by: db` にだけ書ける。値は DB の列の既定値が CSPRNG の 32 バイト(base64url の 43 字)で作り
   * (UUID は使わない)、URL のパス・クエリに載せず、監査ログにも書かない。寿命(失効と使い切り / 使い回しの受け入れ)は必ず宣言する
   * (R16)。文法の正は `lib/kernel/bearer.ts`。
   */
  readonly bearer?: BearerDecl;
  /**
   * 特定の個人に結びつき、本人が消去を求めうる値か
   * (security-surface-proposal.md §3 / domain-spec-writing.md §entity_spec)。
   *
   * **全フィールドに必須**(書き忘れを V1 エラーにし、「暗黙に非個人」を作らない)。true の列の値は
   * 監査ログ(`domain_events.payload`)に書かれず、列名だけが `redacted` に残る
   * (guarantees/audit-no-personal-data.test.ts が見る)。
   */
  readonly personal: boolean;
  /**
   * ログインセッション(`app_metadata.profile`)に載せる列か(手順 1)。
   *
   * **全フィールドで省略可・既定 false**(`personal` と違い、無宣言の列を「載せない」と
   * 読める安全側のデフォルトが取れるため必須にしていない)。`true` を付けられるのは
   * **認証ユーザーに対応する集約(1 つだけ)**に限る — 複数の集約に付くと、どの行の値が
   * セッションを表すのか宣言から決まらなくなる(V13 が全集約を横断してこの制約を見る)。
   * `personal: true` との併存は可(claims は本人にしか見えないため)。
   * 生成物: `app/src/domain/generated/session-profile.ts`(`SessionProfile` 型 / `SESSION_FIELDS`)。
   * 書き方の正: auth-spec-writing.md §session 属性。
   */
  readonly session: boolean;
  /**
   * `personal: true` のときの、手順 2(anonymize)が書く置換値。
   *
   * 文字列リテラル(`{id}` を含めると行 id に置換 — 一意制約のある列用)、または
   * NOT NULL でない列向けの `null`。`personal: false` のフィールドには書けない
   * (V1 が閉じる)。手順 1 ではこの値は宣言されるだけで使われない。
   */
  readonly personalPlaceholder?: string | null;
  readonly location: SourceLocation;
}

/**
 * 値を**システムが供給する**フィールドか(= 作成入力には現れない)。
 *
 * `auto: true` は採番・既定値が、`state(...)` 型は state_spec の `initial`(その写像が列の
 * DEFAULT)が値を決める。どちらも「入力に現れない」だけであって「無いことがある」ではないので、
 * 生成される入力スキーマからは除外され、**行(row)のスキーマでは必須**になる
 * (domain-spec-writing.md §entity_spec)。
 *
 * `required` はあくまで「入力として必須か」を表す 1 つの意味に保ち、この判定と混ぜない
 * (混ぜると、例えば required 文字列だけに付く `.trim().min(1)` が auto の文字列にも
 * 誤って付くことになる)。
 */
export function isSystemSupplied(field: FieldDef): boolean {
  return field.auto || field.type.kind === 'state';
}

/**
 * 作成入力に現れないフィールドか。
 *
 * `isSystemSupplied` に `supplied_by: db` を足したものである。**行の形の判断には使わない** ——
 * `supplied_by: db` は「入力の出所」の宣言であって「行に必ず値がある」の宣言ではなく、
 * 行で必須かどうかは `required` が正のままである(`auto` / `state` は行では必ず値があるので、
 * そちらは `isSystemSupplied` が引き続き答える)。
 */
export function isInputAbsent(field: FieldDef): boolean {
  return isSystemSupplied(field) || field.suppliedBy === 'db';
}

/**
 * **行の上で空になりうる**フィールドか(束 ㉒)。
 *
 * `required` は「入力として必須か」だが、行が NOT NULL になるかどうかもこれが決める ——
 * ただし `auto` / `state(...)` は入力に現れないだけで**行には必ず値がある**ので、
 * `required` の宣言に関わらず空にならない(`isSystemSupplied` と同じ線)。
 *
 * この判定を要るのは 2 か所である: V19(`clears` が空にできる列か)と、V10 が見る
 * 「`is null` を書ける欄か」。**同じ問いなので写像は 1 本にする** —— どちらも error で止める
 * 検査であり、片方だけが `required` を直読みしていると「V19 は通すが V10 はエラーにする」列が生まれる。
 */
export function canBeEmpty(field: FieldDef): boolean {
  return !field.required && !isSystemSupplied(field);
}

/** entity.md。集約ごとに 1 つ。 */
export interface EntitySpec {
  readonly entity: string;
  /**
   * この集約そのものの表示名(業務の名詞。例: 催し)。`fields[].label` の 1 段上で、
   * 原則は同じ「内部名で配線・label で表示」— 生成物(ハンドブックの章題・集約関係図の節点)は
   * この label を引き、実装は従来どおり内部名(`entity`)で配線する。
   * 空文字は不可、全エンティティ間で重複不可(V1)。
   */
  readonly label?: string;
  /**
   * 章の頭の 1 文(この集約は何か)。**人が書く文**で、ハンドブックの章の頭に出る(book-human-face.md §2)。
   * 検証には使わない(文書の欄)。書かなければ章に「(まだ書かれていない)」と出る。
   * 書き方は domain-spec-writing.md §summary。空文字は不可(V1)。
   */
  readonly summary?: string;
  /**
   * この集約の行を**人に名指す欄**(`fields` に居る文字列型の 1 欄。例: 会場の `name`)。
   * 生成物が行の名前を出す場所 —— 確認ダイアログの本文(`「{値}」{確認の見出し}`)と、参照の欄の選択肢の表示名の
   * 規則(S18 が、選択肢の読みの第 2 列がこの欄であることを見る)—— はこの欄を引く。名前の欄は集約ごとに綴りが違い
   * (`name` / `title` / `display_name` / `subject` …)規約からは導けないので宣言する(ADR-0016)。任意。
   * 実在と型(string / text)は V22 が見る。
   */
  readonly displayField?: string;
  /**
   * DB のテーブル名。**規則で導けない場合だけ**書く例外宣言。
   *
   * 既定は entity の単純な英語複数形化(`entry` → `entries`)であり、生成器はこの規則で
   * 期待 RLS ポリシー名を作る。不規則な複数形・既存テーブル名との突き合わせなど、規則から
   * 外れるときにここで上書きする(domain-spec-writing.md §entity_spec)。
   */
  readonly table?: string;
  /**
   * この集約が**他の集約の写し**(公開用の投影など。state_spec の `effects[].snapshot.to` の写像先)であることの宣言
   * (`mirror: true`)。
   *
   * 写しの行は写し直し・取り下げで消えても元のデータが残るので、写しの表への `delete` は破壊的な書き込みに数えない。
   * その免除を「snapshot.to に名前が出た」ことから推測しないために宣言させ、snapshot.to と双方向で一致させる(V12)。
   * 写しの表は state_spec の写像以外で書かれない(access_spec の creates / writes / deletes が system だけ。V25)。
   */
  readonly mirror?: true;
  /**
   * 文脈依存ロール解決のための参照パス。キー = 到達先エンティティ名、値 = 参照パス。
   * 例: { workshop: "entry.workshop_id" } は「このエントリーの workshop」を解決する。
   */
  readonly context: Readonly<Record<string, string>>;
  readonly fields: readonly FieldDef[];
  readonly location: SourceLocation;
}
