/**
 * 保存点(ユースケース)の一致の証明の**world の設計図の型**。
 *
 * 値(どの集約にどの行を置き、どの軸をどう掛けるか)は**製品の生成物**が運び、**形はここだけが
 * 持つ** —— 集約名・操作 ID・列名は 1 つも現れない。生成物(`eq-worlds.ts`)はこのファイルから
 * **型を再輸出する**(束 ①-d 手 2)ので、宣言は 1 か所である。生成物が読める境界は
 * `runtime-testing` の要素として宣言されており、**テストの軸のファイルからだけ**許されている。
 *
 * 散文の正: docs/rules/process/backend/system/standards/conventions/testing/integration.md
 */

import type { EqAxis, EqFoldedGuard, EqValue, EqWorldRow } from '../equivalence/types.mjs';

/** 保存点の手順 1 つに渡す入力の 1 組。 */
export interface EqSaveInput {
  /** そのまま載せる欄。 */
  readonly values: Readonly<Record<string, EqValue>>;
  /** 参照の欄 → world のどの集約の行を指すか。 */
  readonly refs: Readonly<Record<string, string>>;
  /**
   * 同じ鍵の押し直しで 1 欄だけ変えるときの、その欄の別の値(欄 → 値。宣言の範囲の中。生成器
   * `legacy/spec-tools/lib/world/eq-save-inputs.ts` の `editedValueOf` が決める)。
   */
  readonly edits: Readonly<Record<string, EqValue>>;
}

/** 保存点の手順 1 つぶんの実行の仕方。 */
export interface EqSaveStep {
  /** 操作 ID(拒否が載せるのはこちら)。 */
  readonly op: string;
  /** 入力・結果の鍵(`p_input` の鍵)。 */
  readonly alias: string;
  /** 人の言葉での見出し(仕様の label)。 */
  readonly label: string;
  readonly kind: 'create' | 'transition' | 'delete' | 'update';
  readonly aggregate: string;
  readonly table: string;
  readonly repeat: boolean;
  /**
   * その手順の定型 RPC が**拒否をどこまで返すか**(data_table の宣言から決まる)。
   *
   * `named` は本文が生成物(errcode の理由まで一致する)、`unnamed` は `handwritten:` を
   * 宣言した本文(理由を返さず 0 行で返るので、複合 RPC がその手順の競合として返す)、
   * `none` は `shape: composite`(その手順の RPC は判定せず、守っているのは engine だけ)。
   */
  readonly enforcement: 'named' | 'unnamed' | 'none';
  /** 繰り返さない手順の入力。 */
  readonly input: EqSaveInput;
  /** 繰り返す手順に渡す要素(先頭から件数の軸のぶんだけ使う)。 */
  readonly elements: readonly EqSaveInput[];
  /** 落としてよい任意の欄(入力の軸が minimal のとき送らない)。 */
  readonly optional: readonly string[];
  /** その手順の RPC が帰属表のほかに書き込む表(data_table の also_writes)。 */
  readonly alsoWrites: readonly string[];
}

/**
 * 実行する間に片付ける表(と、宣言が片付けを拒む表)。手順の RPC は `also_writes` の表にも
 * 書くので、そこに一意の宣言があると 2 回目の許可が 23505 になり一致に飲まれる。
 */
export interface EqSaveCleanup {
  /** 1 つ実行するたびに「設計図の行以外」を消す表(消す順。台帳が先・作る集約の表は逆順)。 */
  readonly tables: readonly string[];
  /** also_writes に出るが片付けない表(追記専用を宣言している)。 */
  readonly appendOnly: readonly string[];
}

/** 保存点の world の実行者 1 人。 */
export interface EqSaveActor {
  readonly key: string;
  /** その人が代表する役(テスト名に出る)。 */
  readonly role: string;
  readonly basis: 'binding' | 'claim' | 'default' | 'no_row';
  /** 実行者自身の行の名前(行が無い人なら null)。 */
  readonly row: string | null;
  /** 集約 → その系統の行の名前(行が無い人は空)。 */
  readonly targets: Readonly<Record<string, string>>;
  /**
   * この人が条件を満たさないロール(ADR-0018)。根拠(束縛・claim)は成立しているが、既定のログインロールの条件・
   * 含意の先の行の条件だけを満たさない。通常の実行者は持たない。
   */
  readonly unmet?: string;
  /** 古いロール一覧。持つ人は実行器が解決した配列の代わりにこれを `p_actor_roles` に渡す(DB が配列を信じないことの見張り)。 */
  readonly staleRoles?: readonly string[];
}

/** 呼び出し元の文脈 1 通り(実行器が `p_actor_roles` に何を渡すかを決めるもの)。 */
export interface EqSaveCaller {
  /** ロール配列の名前(テスト名に出る)。 */
  readonly name: string;
  /** 実行者の id を渡すか(人の入口だけが渡す。システム起点と未ログインは持たない)。 */
  readonly actor: boolean;
  /** セッションのプロフィールを渡すか(行が無い人には渡らない = 「id はあるがプロフィールが無い」実在の形)。 */
  readonly session: boolean;
  /** システム起点の呼び出しか(Cron / Webhook)。 */
  readonly system: boolean;
}

/**
 * 保存点の軸(2 つの grid)。
 *
 * 判定の grid は「外部集約の状態 × 実行者 × ロール配列 × ガード変数の境界」、書き込み経路の
 * grid は「繰り返しの件数 × 任意欄の有無 × 再送」である。掛け合わせないのは、書き込み経路の
 * 軸が判定を 1 つも変えないからである(実行器は件数に関わらず全手順の `permit` を立てる)——
 * 入力を見る事実がある保存点だけは件数と任意欄が判定の grid に入る。
 */
export interface EqSaveGrid {
  readonly axes: readonly EqAxis[];
  /** 実行する実行者の名前(判断材料に実行者自身の行を読む保存点では、行が無い人が外れる)。 */
  readonly actors: readonly string[];
  /**
   * 呼び出し元の文脈(ロール配列の 3 通りと 1 対 1)。
   *
   * 配列そのものを渡さないのは、配列を作るのが実行器の `planActorRoles` だからである ——
   * テストがそこを飛ばして別の配列を渡すと、期待(文脈からロールを解決する)と DB(配列を
   * 見る)が実行時にありえない組み合わせで比べられることになる。
   */
  readonly callers: readonly EqSaveCaller[];
  readonly decisionRepeats: readonly number[];
  readonly decisionInputs: readonly string[];
  /** 判定の grid の大きさ(実行する側が同じ数だけ回す)。 */
  readonly decisionCount: number;
  readonly writeRepeats: readonly number[];
  readonly writeInputs: readonly string[];
  readonly resends: readonly number[];
  /** 書き込み経路の grid の大きさ。 */
  readonly writeCount: number;
  /** 代表値に畳んだ軸(畳んでいなければ空)。 */
  readonly folded: readonly string[];
  /** 畳んだガード変数の内訳(成立側と不成立側の両方を残す)。 */
  readonly foldedGuards: readonly EqFoldedGuard[];
}

/** 保存点 1 つぶんの world と組み合わせ。 */
export interface EqSaveWorld {
  readonly usecase: string;
  readonly save: string;
  /** 人の言葉での見出し(仕様の label)。 */
  readonly label: string;
  /** 複合 RPC の関数名。 */
  readonly rpc: string;
  /** 実行者の集約の物理テーブル名。 */
  readonly actorTable: string;
  /** 集約 → 物理テーブル名(world に置く集約と、保存点が作る集約の全部)。 */
  readonly tables: Readonly<Record<string, string>>;
  readonly actors: readonly EqSaveActor[];
  /** 挿入順の行(参照先が先)。 */
  readonly rows: readonly EqWorldRow[];
  /** 手順の並び(宣言順)。 */
  readonly steps: readonly EqSaveStep[];
  /** 1 つ実行するたびに片付ける表(作る集約の表 + 手順の also_writes)。 */
  readonly cleanup: EqSaveCleanup;
  /** `p_expected` に載せる鍵(`{集約}.{欄}`)。 */
  readonly expectedKeys: readonly string[];
  readonly grid: EqSaveGrid;
  /** 結末の集約の物理テーブル名。 */
  readonly resultTable: string;
  /** 結末の状態が載る列(状態を持たない集約なら null)。 */
  readonly resultStateColumn: string | null;
  /** 保存点を通った後の予測状態(状態を持たない集約なら null)。 */
  readonly resultState: string | null;
  /** 結末の id が入力から決まるなら、その手順と欄(冪等キーなら null)。 */
  readonly resultIdFrom: { readonly step: number; readonly field: string } | null;
  /**
   * 同じ `p_id` の再送で 2 回目に何が起きるか(**計画の形から決まる**)。
   *
   * `idempotent` = 作成の手順(最初の作成 = 冪等の錨)があり、その表が既存の行を返すので読み直して同じ形を返す /
   * `conflict` = 錨の表が既存の行を返さない・錨が無く最初の手順が外の集約の状態を条件にする遷移なので競合になる /
   * `unknown` = どちらでもない(再送の軸を実行しない)。
   */
  readonly resend: 'idempotent' | 'conflict' | 'unknown';
  /** 再送が競合になるとき、その競合を返す手順の操作 ID。 */
  readonly resendOp: string | null;
}
