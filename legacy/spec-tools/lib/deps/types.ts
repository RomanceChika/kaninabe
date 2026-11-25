/**
 * 依存の脆弱性の検査(`npm run deps:check`)の共有の型。設計の正は依存の脆弱性への対応の設計メモ(開発用リポジトリの設計文書)の検出の節。
 *
 * 道具は**純粋**に保つ: ネットワーク(`fetch`)と子プロセス(`npm audit`)は `DepsIo` として外から渡す。
 * 本番の口は `cli/deps-check-io.ts`、テストは偽の口を渡す(テストはネットワークに出ない)。
 */

/** 重大度(npm audit の語)。`unknown` は出どころが重大度を言わないもの。 */
export type Severity = 'critical' | 'high' | 'moderate' | 'low' | 'unknown';

/** 指摘の判定。red = 失敗、warning = 一覧に出すだけ、accepted = 受け入れ表で期限内。 */
export type Level = 'red' | 'warning' | 'accepted';

/** 指摘の種類。 */
export type FindingKind = 'advisory' | 'cooldown' | 'signature' | 'lockfile';

/** 検査の部分の名前。 */
export type PartName = 'audit' | 'osv' | 'signatures' | 'cooldown';

/** 検査の部分の結果。`unavailable` は「未実施」(ネットワークなど。落とさずに記録する)。 */
export interface PartResult {
  readonly status: 'done' | 'unavailable';
  /** 未実施の理由。 */
  readonly reason?: string;
}

/**
 * 受け入れ表の「前提」の欄に書ける名前の閉じた表。前提は「この受け入れが成り立つのは、この条件が今の木で真のときだけ」を名指す。
 * **この段(deps:check)が見るのは名前だけ**で、条件そのものは出荷の関門の閉包(相対と `node:` の import だけ)の外の開発用リポジトリのテストが見る
 * (`__tests__/dev-repo/unit/deps/accept-premises.ts` の照らし手の表。名前を足したら照らし手も足す —— 無い名前を持つ期限内の行はそのテストが赤にする)。
 *   - `next-config-no-images` … 製品の next.config に画像の照合のパターンの出どころ(`images` と、絶対の `assetPrefix`)が無い。
 *     鍵の持ち主は J2(許可表 `NEXT_CONFIG_ALLOWED_KEYS`)で、照らし手は J2 の許可表と配線を指す。
 */
export const PREMISE_NAMES = ['next-config-no-images'] as const;

/** 前提の名前。 */
export type PremiseName = (typeof PREMISE_NAMES)[number];

/** 受け入れ表の 1 行。 */
export interface AcceptedEntry {
  readonly kind: 'advisory' | 'cooldown';
  /** advisory の ID(GHSA・CVE など)。cooldown は 1 つの版(`*` は書けない。9 回目 C9-2)。 */
  readonly target: string;
  /** パッケージ名(advisory は `*` で全部。cooldown は名前 1 つだけ)。 */
  readonly pkg: string;
  /** 受け入れる版の全部(正確な版。cooldown は対象と同じ 1 つ)。ここに無い版の指摘には当たらない。 */
  readonly versions: readonly string[];
  /** この受け入れが成り立つ前提(閉じた表 `PREMISE_NAMES` の名前。無ければ空)。 */
  readonly premises: readonly PremiseName[];
  readonly reason: string;
  /** 見直しの期限(`YYYY-MM-DD`。この日まで有効)。 */
  readonly reviewBy: string;
}

/** 指摘 1 件。 */
export interface DepsFinding {
  readonly lockfile: string;
  readonly kind: FindingKind;
  /** advisory の ID。cooldown・signature は固定の語。 */
  readonly id: string;
  readonly aliases: readonly string[];
  readonly pkg: string;
  readonly version?: string;
  readonly severity: Severity;
  /** 見つけた出どころ(`audit` / `osv` / `signatures` / `registry`)。 */
  readonly sources: readonly string[];
  readonly title: string;
  readonly url?: string;
  level: Level;
  /** 受け入れ表の行(期限内なら accepted、期限切れなら red のまま)。 */
  accepted?: { readonly reason: string; readonly reviewBy: string; readonly expired: boolean; readonly overDeadline?: number };
}

/** lockfile の 1 つの (名前, 版)。 */
export interface LockedPackage {
  readonly name: string;
  readonly version: string;
  /** 登録簿(npmjs.org)から来たか。cooldown はそれだけ見る。 */
  readonly fromRegistry: boolean;
  /** lockfile の `integrity`(無ければ undefined)。登録簿の `dist.integrity` との突き合わせ(通信できるときだけ)に使う。 */
  readonly integrity?: string;
}

/** 外の世界への口。 */
export interface DepsIo {
  /** JSON を取る(GET / POST)。ネットワーク失敗・HTTP エラーは投げる。 */
  readonly fetchJson: (url: string, init?: { readonly method?: 'GET' | 'POST'; readonly body?: unknown }) => Promise<unknown>;
  /** コマンドを回す(終了コードが非 0 でも投げない)。 */
  readonly exec: (cmd: string, args: readonly string[], cwd: string) => Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }>;
  /** ルート相対のパスのテキストを読む(無ければ null)。 */
  readonly readText: (rel: string) => string | null;
  /** ディレクトリが実在するか(ルート相対)。 */
  readonly isDirectory: (rel: string) => boolean;
  /** ディレクトリの中の名前(ルート相対。ドット始まりは含めない)。 */
  readonly list: (rel: string) => readonly string[];
  readonly now: () => Date;
  /** ルート相対のパスへ書く(置き場は作る。SBOM の書き出しが使う)。 */
  readonly writeText: (rel: string, text: string) => void;
}

/** lockfile 1 つの結果。 */
export interface LockfileReport {
  readonly path: string;
  /**
   * 確かめた lockfile の中身の sha256(16 進)。取り込みの台本の日数の口(`--fresh`)が今の lockfile と比べ、違えば回す
   * (日付だけの印では、lockfile が変わっても印が新しい間は回らなかった。差分点検 A27-2)。
   */
  readonly sha256: string;
  readonly packages: number;
  readonly parts: Readonly<Record<PartName, PartResult>>;
}

/** 検査全体の結果(`LATEST_FILE` の中身)。 */
export interface DepsReport {
  readonly version: 1;
  readonly generatedAt: string;
  readonly lockfiles: readonly LockfileReport[];
  readonly findings: readonly DepsFinding[];
  /** 受け入れ表の行の問題(読めない・期限切れで対象が残っていない等)。 */
  readonly notes: readonly string[];
  readonly summary: {
    readonly red: number;
    readonly warning: number;
    readonly accepted: number;
    /** 未実施の部分の数。 */
    readonly unperformed: number;
  };
  readonly ok: boolean;
}

/** 受け入れ表の置き場(ルート相対。`docs/rules` の下なので配布に入る)。 */
export const ACCEPTED_FILE = 'docs/rules/process/common/tooling/standards/dependency-accepted.md';

/** 結果の置き場(ルート相対。追跡しない作業置き場の下)。 */
export const LATEST_FILE = 'tmp/deps-check/latest.json';

/** 公開から何日未満の版を警告するか(裁定 2026-10-22)。 */
export const COOLDOWN_DAYS = 7;

/**
 * 依存の検査の鮮度の上限(日)。最終実施からこの日数を超えたら verify が警告する(手元)。夜間の CI の audit も、最後に成功した監査から
 * この日数を超えた夜はコミットが動いていなくても回す(夜間の workflow の `AUDIT_MAX_AGE_DAYS` は書き写し。突合は開発用リポジトリのテスト。fix27)。
 */
export const STALE_DAYS = 7;

/**
 * 受け入れの見直しの期限が、今日から数えて何日以内でなければならないか(重大度ごと)。
 * 正は `docs/rules/process/common/tooling/standards/dependency-patch-policy.md` の表(critical は修正の 72 時間 = 3 日、high は 7 日、moderate は 30 日、
 * low は次の定期の更新 = 90 日)。重大度が分からないものは high と同じに扱う(出どころが言わないものを長く受け入れない)。
 * 受け入れ表に検知の日付の列は無いので、今日から数える(長い期限を書いた行は、書いた日に赤になる)。
 */
export const ACCEPT_LIMIT_DAYS: Readonly<Record<Severity, number>> = { critical: 3, high: 7, moderate: 30, low: 90, unknown: 7 };

/** SBOM の置き場(ルート相対。追跡しない作業置き場の下)。 */
export const SBOM_DIR = 'tmp/deps-check';
