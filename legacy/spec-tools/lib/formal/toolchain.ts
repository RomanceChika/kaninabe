/**
 * 道具(Java 21 と `tla2tools.jar`)の在り処の解決。
 *
 * **道具が無いときに黙って緑にしない。** ここは「見つからなかった」を型で返し、
 * CLI がそれを error として報告する —— 検査が飛んだ実行と全部を見た実行が見分けのつかない形に
 * ならないようにするためである(enforcement-matrix の C23 と同じ線)。
 *
 * 純粋関数であり throw しない(ファイルの実在の判定は呼ぶ側が注入する)。
 */

/** 既定の jar の置き場(人が置く。リポジトリには入れない)。 */
export const DEFAULT_JAR = '~/.tla/tla2tools.jar';

/** Homebrew の openjdk@21(PATH に無いことが多いので既定の候補に入れる)。 */
const BREW_JAVA = '/opt/homebrew/opt/openjdk@21/bin/java';

/** 解決できた道具。 */
export interface Toolchain {
  /** `java` の実行パス(PATH に任せるなら `java`)。 */
  readonly java: string;
  /** `tla2tools.jar` の絶対パス。 */
  readonly jar: string;
}

/** 解決できなかった理由。 */
export interface ToolchainMissing {
  /** 何が見つからなかったか。 */
  readonly what: 'java' | 'jar';
  /** 探した場所。 */
  readonly looked: readonly string[];
}

/** 解決の入力(環境変数と、パスの実在の判定)。 */
export interface ToolchainInput {
  /** `JAVA_HOME` / `TLA_TOOLS_JAR` を含む環境変数。 */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** ホームディレクトリ(`~` の展開に使う)。 */
  readonly home: string;
  /** そのパスにファイルがあるか。 */
  readonly exists: (path: string) => boolean;
}

/** `~/` を展開する。 */
function expand(path: string, home: string): string {
  return path.startsWith('~/') ? `${home}/${path.slice(2)}` : path;
}

/**
 * Java と jar の在り処を決める。
 *
 * java は `JAVA_HOME` → Homebrew の openjdk@21 → PATH の `java` の順、
 * jar は `TLA_TOOLS_JAR` → `~/.tla/tla2tools.jar` の順に探す。
 *
 * @param input 環境変数・ホーム・実在の判定
 * @returns 解決できた道具、または見つからなかった理由
 */
export function resolveToolchain(input: ToolchainInput): Toolchain | ToolchainMissing {
  const javaHome = input.env['JAVA_HOME'];
  const javaCandidates = [...(javaHome === undefined ? [] : [`${javaHome}/bin/java`]), BREW_JAVA];
  const java = javaCandidates.find((candidate) => input.exists(candidate));

  const configured = input.env['TLA_TOOLS_JAR'];
  const jarCandidates = [...(configured === undefined ? [] : [configured]), DEFAULT_JAR].map((path) =>
    expand(path, input.home),
  );
  const jar = jarCandidates.find((candidate) => input.exists(candidate));
  if (jar === undefined) return { what: 'jar', looked: jarCandidates };

  // java だけは PATH 上の `java` に委ねる余地を残す(候補が全滅しても諦めない)。
  return { java: java ?? 'java', jar };
}

/**
 * 見つからなかったことを人の言葉にする。
 *
 * @param missing 解決できなかった理由
 * @returns 1 行目が何が無いか、2 行目以降が探した場所と入れ方
 */
export function describeMissing(missing: ToolchainMissing): string[] {
  if (missing.what === 'jar') {
    return [
      'check:formal: TLC(tla2tools.jar)が見つからないので約束事のモデルを検査できません',
      `  探した場所: ${missing.looked.join(' / ')}`,
      `  入れ方: TLA+ の公開リリースから tla2tools.jar を取り、${DEFAULT_JAR} に置くか TLA_TOOLS_JAR で場所を指す`,
      '  (検査を飛ばして緑にはしません —— 道具が無い実行と全部を見た実行を見分けのつかない形にしないため)',
    ];
  }
  return [
    'check:formal: Java 21 が見つからないので約束事のモデルを検査できません',
    `  探した場所: ${missing.looked.join(' / ')}`,
    '  入れ方: JDK 21 を入れて JAVA_HOME を指す',
  ];
}
