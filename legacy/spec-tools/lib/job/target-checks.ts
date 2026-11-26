/**
 * ジョブ仕様の検査(J 群)のうち、**後段が受け持つもの**の契約(derive 層)。
 *
 * Cron の登録(ホストの設定ファイル)・DB 内のスケジューラの登録(プラットフォームの拡張)・ホストの頻度制約は、
 * どれも具体のスタックの語を持つので、コアには置かず後段(`lib/targets/<後段>/`)が**自分の検査を登録する**
 * (設計メモ framework-modules §20)。コアが持つのは次の 2 つだけである。
 *
 *   - **口(`JOB_CHECK_SLOTS`)** … どの検査(ルール ID)を、どの**役割**の後段が受け持つか。後段の名前は書かない
 *   - **登録された検査を口に当てる関数(`resolveJobChecks`)** … 口に当たる検査が無い口は「埋まっていない口」として返し、
 *     検査の束ね役(`run.ts`)と実行ログが**未実施**と名指す(黙って緑にしない・赤にもしない。入力の状態の未選択と同じ基準)。
 *     未実施の理由は事実で分ける: その役割の後段が選ばれていない(「この構成に無い」)/ 選ばれているが口を登録していない
 *     (「後段 <名前> がこの検査を登録していない」)。後段が**理由つきでその口を対象外と宣言した**ときは(`notApplicable`)、
 *     未実施ではなく**対象外**として別に返す(宣言は見ていないことではなく、見る必要が無いことの申告)
 *
 * ルール ID・検査の中身・指摘の文面は後段に移っても変わらない(執行者の置き場が動くだけ)。
 */

import type { Finding } from '../kernel/finding.js';
import type { TargetRole } from '../kernel/target-role.js';
import type { SpecModel } from '../model/types.js';
import type { JobScheduler, JobSpecModel } from '../model/job/types.js';
import type { ProductRoots } from '../model/product/types.js';
import type { TargetUnverified } from './target-unverified.js';

/** 後段の検査 1 本が受け取る入力(リポジトリルートは I/O のため呼び出し側が渡す)。 */
export interface JobCheckInput {
  /** 構築済みのドメイン仕様モデル。 */
  readonly domain: SpecModel;
  /** 読み込み済みのジョブカタログ。 */
  readonly jobs: JobSpecModel;
  /** リポジトリルートの絶対パス(登録ファイルの実在確認に使う)。 */
  readonly repoRoot: string;
  /** 製品が宣言した根(実装の木・migration の置き場)。 */
  readonly roots: ProductRoots;
}

/** 後段が登録するジョブ検査(J 群)1 本。純粋な関数で、例外で違反を報告しない(規約)。 */
export interface JobTargetVerifier {
  /** 検査の種類(後段の登録は種類ごとに分かれる。いまはジョブ仕様の検査だけ)。 */
  readonly group: 'job';
  /** ルール ID(`JOB_CHECK_SLOTS` の口の ID と一致させる。例: `J4`)。 */
  readonly id: string;
  /** 検査を実行し、違反を返す(ジョブカタログを読めていなければ空)。 */
  verify(input: JobCheckInput): Finding[];
  /**
   * この木で突合しなかった分の一言(句点なし。全部突合した・対象が無いなら null)。J 群の実行ログが見出しに添える
   * (後段が自分の検査の飛ばし方を言う。コアは中身を知らない)。省けば、飛ばす分が無い検査。
   */
  skipped?(input: JobCheckInput): string | null;
}

/** 口 1 つ(ルール ID と、それを受け持つ後段の役割)。 */
export interface JobCheckSlot {
  /** ルール ID。 */
  readonly id: string;
  /** この検査を受け持つ後段の役割。 */
  readonly role: TargetRole;
  /** 後段が無いときに見ていないこと(文末。句点は付けない)。 */
  readonly unseen: string;
  /** 後段が無くても実行している部分(あれば)。 */
  readonly stillRuns?: StillRuns;
}

/** 口の検査のうち、後段が無くても実行している部分の言い方。 */
export interface StillRuns {
  /** 実行ログの見出しに出す短い言い方(「J2 は<label>のみ」)。 */
  readonly label: string;
  /** 実装の木があるときの言い方(文末。句点は付けない)。 */
  readonly withApp: string;
  /** 実装の木が無いときの言い方(実装に依る部分は実行していないので言わない。文末。句点は付けない)。 */
  readonly specOnly: string;
}

/**
 * 鳴る場所(`schedule.scheduler`)→ その場所の検査を受け持つ後段の役割。全域(`Record`)なので、
 * 鳴る場所の値を足すと型がここで止まる(持ち主の宣言を忘れられない)。
 *
 * **鳴る場所と検査の持ち主は別の軸である**: 値は「時計がどこで鳴るか」(`host` = アプリを動かす場所の Cron /
 * `database` = DB 内のスケジューラ)で、持ち主は「その登録を突合できる後段の役割」。いまは
 * `host` → ホストの後段・`database` → プラットフォームの後段だが、対応は値の綴りからは導かず、この表で宣言する。
 * この表が決めるのは口の表(`JOB_CHECK_SLOTS`)の役割だけで、後段が自分の担当を選ぶ絞り(`scheduler === 'host'` 等)は
 * それぞれの後段のファイルにある。
 */
export const SCHEDULER_OWNER: Readonly<Record<JobScheduler, TargetRole>> = {
  host: 'host',
  database: 'platform',
};

/**
 * 口の表。**表に載るのは、受け持つ後段の役割が決まっている検査だけ**である(コアが全部を実行できる J1 / J5 / J6 などは載らない)。
 * 並びは `run.ts` が検査を束ねる順(違反の並びが変わらないように)。
 */
export const JOB_CHECK_SLOTS: readonly JobCheckSlot[] = [
  {
    id: 'J2',
    role: SCHEDULER_OWNER.host,
    unseen: 'Cron の登録とカタログの双方向の突合',
    stillRuns: {
      label: '接地と入口の衝突・閉世界',
      withApp: '実装・起動口・fires・due_from の接地と、HTTP の入口(起動口・受信口・認証の callback・送信の連携の口)の衝突と閉世界の検査は実行済み',
      specOnly: 'fires・due_from の接地は実行済み。HTTP の入口の衝突と閉世界は実装の木が無いので見ていない',
    },
  },
  { id: 'J3', role: SCHEDULER_OWNER.database, unseen: 'DB 内のスケジューラの登録とカタログの双方向の突合' },
  { id: 'J4', role: SCHEDULER_OWNER.host, unseen: 'ホストの Cron の頻度制約の突合' },
];

/** 後段が登録した検査と、その後段の役割(組み立ての根が選んだ後段の一覧から集める)。 */
export interface RegisteredJobCheck {
  /** 登録した後段の役割。 */
  readonly role: TargetRole;
  /** 登録された検査。 */
  readonly check: JobTargetVerifier;
}

/** 後段が口を対象外と宣言する欄(ルール ID → 理由)。 */
export type NotApplicableDeclarations = Readonly<Record<string, string>>;

/** 組み立ての根が選んだ後段 1 つの、検査の束ね役が要る分(名前・役割・対象外の宣言)。 */
export interface SelectedTarget {
  /** 後段の名前。 */
  readonly id: string;
  /** 後段の役割。 */
  readonly role: TargetRole;
  /** この後段が対象外と宣言した口(ルール ID → 理由。無ければ空)。 */
  readonly notApplicable: NotApplicableDeclarations;
  /** この後段が毎回名指す未検証(`target-unverified.ts`。無ければ省く)。 */
  readonly unverified?: readonly TargetUnverified[];
}

/**
 * 選んだ後段のうち検査の束ね役が読む分(検査の登録と、選んだ後段の名前・役割・対象外の宣言)。
 * 束ね役(`lib/verify/`)は後段の登録の契約を読まないので、契約が作ってこの形のデータで渡す(`lib/target-api/contract.ts` の `jobTargetsOf`)。
 */
export interface JobTargetRegistry {
  /** 後段が登録した検査。 */
  readonly checks: readonly RegisteredJobCheck[];
  /** 選んだ後段(口が埋まらない理由を「後段が無い」と「後段が登録していない」に分けるため)。 */
  readonly targets: readonly SelectedTarget[];
}

/** 後段を 1 つも選んでいない登録(受け持つ検査は全部「この構成に後段が無い」未実施になる)。 */
export const NO_JOB_TARGETS: JobTargetRegistry = { checks: [], targets: [] };

/** 埋まっていない口(未実施)。 */
export interface UnfilledJobSlot extends JobCheckSlot {
  /**
   * その役割の後段が選ばれているときの、その後段の名前(選ばれているが口を登録していない)。
   * 無ければ、その役割の後段がこの構成に無い。
   */
  readonly selectedTarget?: string;
}

/** 後段が理由つきで「この後段では対象外」と宣言した口。 */
export interface NotApplicableJobSlot extends JobCheckSlot {
  /** 宣言した後段の名前。 */
  readonly target: string;
  /** 宣言の理由。 */
  readonly reason: string;
}

/** 口に検査を当てた結果。 */
export interface ResolvedJobChecks {
  /** ルール ID → 当たった検査(口が埋まっているものだけ)。 */
  readonly byId: ReadonlyMap<string, JobTargetVerifier>;
  /** 埋まっていない口(口の表の並び。未実施。後段が無い・役割が違う・後段が登録していない)。 */
  readonly missing: readonly UnfilledJobSlot[];
  /** 後段が対象外と宣言した口(口の表の並び。検査は埋まっていない。未実施には数えない)。 */
  readonly notApplicable: readonly NotApplicableJobSlot[];
}

/**
 * 登録された検査を口に当てる。**ルール ID と後段の役割の両方が口と一致する**検査だけが当たる
 * (同じ ID でも役割の違う後段が登録したものは当てない)。口の表に無い ID の登録は、ここでは無視する
 * (そのような登録は `lib/target-api/contract.ts` の契約の検査が理由つきで止める)。
 * 当たらなかった口は、同じ役割の後段が**対象外と宣言**していれば対象外に、していなければ未実施に分ける
 * (未実施には、同じ役割の後段が選ばれているかも添える)。宣言と検査の両方がある口は検査が当たる(両方の登録は契約が止める)。
 *
 * @param registry 後段が登録した検査と、選んだ後段
 * @returns 当たった検査と、埋まっていない口・対象外の口
 */
export function resolveJobChecks(registry: JobTargetRegistry): ResolvedJobChecks {
  const byId = new Map<string, JobTargetVerifier>();
  const missing: UnfilledJobSlot[] = [];
  const notApplicable: NotApplicableJobSlot[] = [];
  for (const slot of JOB_CHECK_SLOTS) {
    const found = registry.checks.find((entry) => entry.check.id === slot.id && entry.role === slot.role);
    if (found !== undefined) {
      byId.set(slot.id, found.check);
      continue;
    }
    const sameRole = registry.targets.filter((target) => target.role === slot.role);
    const declaration = declarationFor(sameRole, slot.id);
    if (declaration !== null) notApplicable.push({ ...slot, ...declaration });
    else missing.push(sameRole[0] === undefined ? slot : { ...slot, selectedTarget: sameRole[0].id });
  }
  return { byId, missing, notApplicable };
}

/** 同じ役割の後段のうち、口を対象外と宣言した後段とその理由(無ければ null)。 */
function declarationFor(targets: readonly SelectedTarget[], slotId: string): { readonly target: string; readonly reason: string } | null {
  for (const target of targets) {
    const reason = target.notApplicable[slotId];
    if (reason !== undefined) return { target: target.id, reason };
  }
  return null;
}
