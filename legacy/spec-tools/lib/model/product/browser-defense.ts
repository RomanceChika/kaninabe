/**
 * **ブラウザ側の守りの宣言 `BrowserDefenseProfile`**(アプリの枠の後段が値を持つ契約。型と床の検査だけで、値は持たない)。
 *
 * ## なぜ宣言にするのか
 *
 * 全応答のヘッダ(HSTS・nosniff・Referrer-Policy・枠に載せない)・文書のスクリプトの CSP・キャッシュの禁止・ログアウトの消去は、
 * 製品ごとに手で書くと書き忘れた製品だけが開く(OWASP ASVS 5.0 の V3.4.x・V3.2.1・V14.2.2・V14.3.1・V14.3.2)。
 * そこで**値をアプリの枠の後段が 1 つ持ち**(`lib/targets/<枠>/browser-defense.ts`)、生成器がそれを製品の実装の木へ配る。
 * 書き手が何もしなくても全応答に同じ守りが付き、製品の側に二重の定義を置かない。
 *
 * ## 床(弱めてはならない値)
 *
 * 宣言の値が床を下回れば、後段の選択の契約(`selectTargetSet`)が理由を名指して止める(検査も生成も動かない)。
 * 床を緩められるのは**理由つきの宣言だけ**である:
 *
 *   - 開発中だけ足す源(`csp.development`)は 1 行ずつ理由を持つ(本番には決して載らない)
 *   - 本番の CSP に床の外の源を足すときは `relaxations` に 1 行(指令・源・理由)を書く。**緩められない床**(下の表の
 *     `relaxable: false`)と**どの宣言でも足せない源**(`banned`)は、理由があっても止める
 *
 * 純粋な型と純関数である。**アプリの語彙も具体のスタックの綴りも 1 語も持たない**(HTTP と CSP の標準の語だけ)。
 */

/** 応答のヘッダ 1 本。 */
export interface DefenseHeader {
  readonly name: string;
  readonly value: string;
}

/** CSP の指令 1 つ。 */
export interface DefenseCspDirective {
  readonly name: string;
  readonly sources: readonly string[];
}

/** 開発中だけ足す源(理由つき)。 */
export interface DefenseDevelopmentSources extends DefenseCspDirective {
  readonly reason: string;
}

/** 本番の CSP で床の外の源を許す宣言(理由つき)。 */
export interface DefenseRelaxation {
  readonly directive: string;
  readonly source: string;
  readonly reason: string;
}

/** ブラウザ側の守りの宣言。 */
export interface BrowserDefenseProfile {
  /** 全応答に付ける固定のヘッダ。 */
  readonly headers: readonly DefenseHeader[];
  /** 文書の応答に付ける CSP(要求ごとの nonce を `nonceDirectives` の指令に差し込む)。 */
  readonly csp: {
    readonly directives: readonly DefenseCspDirective[];
    readonly nonceDirectives: readonly string[];
    readonly development: readonly DefenseDevelopmentSources[];
  };
  /** 認証の要る応答・Route Handler の応答のキャッシュの禁止。 */
  readonly noStore: DefenseHeader;
  /** ログアウトの応答の消去の指示。 */
  readonly clearSiteData: DefenseHeader;
  /** 本番の CSP の床を緩める宣言(理由つき)。 */
  readonly relaxations: readonly DefenseRelaxation[];
  /**
   * リクエスト前段(文書の CSP を付ける口)が通さない URL(先頭の `/` を除いた形)。静的な資材と Route Handler の置き場で、文書を返さない。
   * **末尾が `/` の値は区切りつきの接頭辞**(`api/` = `/api/…`)、**ほかはパスの完全一致**(`favicon.ico` = `/favicon.ico` だけ)。生成器は綴りの
   * `.` を文字どおりにエスケープし、完全一致には終端を付ける(6 回目 B6-3: 以前は `favicon.ico` が `.` を任意の 1 文字とする終端なしの
   * 接頭辞で、`/favicon.ico/x`・`/faviconXico` も前段を通らなかった)。
   */
  readonly gateExcludedPrefixes: readonly string[];
}

/** CSP の指令 1 つの床。 */
interface DirectiveFloor {
  /** 理由の宣言なしに書ける源。 */
  readonly allowed: readonly string[];
  /** 必ず含める源。 */
  readonly required: readonly string[];
  /** 理由の宣言で床の外の源を足せるか。 */
  readonly relaxable: boolean;
  /** どの宣言でも足せない源(開発中も)。 */
  readonly banned: readonly string[];
}

/** どの指令にも足させない、読み込み元を開け放つ源。 */
const WIDE_OPEN = ['*', 'http:', 'https:', 'data:', 'blob:'];

/**
 * CSP の床(ASVS V3.4.3: `object-src 'none'`・`base-uri 'none'`・nonce による許可。V3.4.6: `frame-ancestors`)。
 * `script-src` の開発中の `'unsafe-eval'` は banned に入れない —— 開発中だけ足す源として理由つきで宣言できる(本番の源には書けない: `PRODUCTION_BANNED`)。
 */
export const CSP_FLOORS: Readonly<Record<string, DirectiveFloor>> = {
  'script-src': { allowed: ["'strict-dynamic'", "'report-sample'"], required: ["'strict-dynamic'"], relaxable: true, banned: ["'unsafe-inline'", "'unsafe-hashes'", ...WIDE_OPEN] },
  // 以下 3 つは深層の守り(HTML の注入が起きたときの持ち出し経路を同じオリジンに絞る)。外のサービスは理由つきの `relaxations` で足せるが、読み込み元を開け放つ源は足せない。
  'default-src': { allowed: ["'self'"], required: ["'self'"], relaxable: true, banned: WIDE_OPEN },
  'connect-src': { allowed: ["'self'"], required: ["'self'"], relaxable: true, banned: WIDE_OPEN },
  'img-src': { allowed: ["'self'", 'data:'], required: ["'self'"], relaxable: true, banned: ['*', 'http:', 'https:', 'blob:'] },
  'object-src': { allowed: ["'none'"], required: ["'none'"], relaxable: false, banned: [] },
  'base-uri': { allowed: ["'none'"], required: [], relaxable: true, banned: WIDE_OPEN },
  'frame-ancestors': { allowed: ["'none'"], required: [], relaxable: true, banned: WIDE_OPEN },
};

/** 本番の源に書けない源(開発中だけ足すなら理由つきで書ける)。 */
const PRODUCTION_BANNED: Readonly<Record<string, readonly string[]>> = { 'script-src': ["'unsafe-eval'"] };

/** HSTS の最短の寿命(1 年。ASVS V3.4.1)。 */
export const HSTS_MIN_MAX_AGE = 31_536_000;

/** 外へ URL を漏らさない Referrer-Policy の値(ASVS V3.4.5)。 */
const STRICT_REFERRER = ['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin'];

/** 必ず付ける固定のヘッダと、その値の床(値が床を満たさなければ理由を返す)。 */
const HEADER_FLOORS: Readonly<Record<string, (value: string) => string | null>> = {
  'strict-transport-security': (value) => {
    const maxAge = Number(/max-age=(\d+)/i.exec(value)?.[1] ?? '0');
    if (maxAge < HSTS_MIN_MAX_AGE) return `max-age が ${HSTS_MIN_MAX_AGE} 秒(1 年)に足りません`;
    return /(^|;)\s*includeSubDomains\s*(;|$)/i.test(value) ? null : 'includeSubDomains がありません(サブドメインも HTTPS だけにする)';
  },
  'x-content-type-options': (value) => (value.trim().toLowerCase() === 'nosniff' ? null : 'nosniff ではありません'),
  'referrer-policy': (value) => (STRICT_REFERRER.includes(value.trim().toLowerCase()) ? null : `外へ URL を漏らさない値(${STRICT_REFERRER.join(' / ')})ではありません`),
  'x-frame-options': (value) => (['deny', 'sameorigin'].includes(value.trim().toLowerCase()) ? null : 'DENY か SAMEORIGIN ではありません'),
};

/** 固定のヘッダに置いてはならない名前(文書の CSP は要求ごとに組む・CORS は開けない)。 */
const FORBIDDEN_STATIC_HEADER = /^(content-security-policy|access-control-.*)$/i;

/** ヘッダの値・CSP の源に改行と `;` を入れさせない(ヘッダの分割・指令の差し込み)。 */
const BREAKS_HEADER = /[\r\n]/;

/** リクエスト前段の保護範囲に埋め込める接頭辞の形(正規表現の特別な文字を持たない)。 */
const SAFE_PREFIX = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*\/?$/;

/** 固定のヘッダの問題。 */
function headerProblems(profile: BrowserDefenseProfile): string[] {
  const problems: string[] = [];
  const counts = new Map<string, number>();
  for (const header of profile.headers) {
    const name = header.name.toLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (BREAKS_HEADER.test(header.name) || BREAKS_HEADER.test(header.value)) problems.push(`ヘッダ ${header.name} の名前か値に改行があります`);
    if (FORBIDDEN_STATIC_HEADER.test(header.name)) problems.push(`ヘッダ ${header.name} は固定のヘッダに置けません(CSP は文書ごとに nonce で組む・CORS のヘッダは開けない)`);
  }
  for (const [name, count] of counts) if (count > 1) problems.push(`ヘッダ ${name} が ${count} 回あります(1 回だけ書く)`);
  for (const [name, floor] of Object.entries(HEADER_FLOORS)) {
    const header = profile.headers.find((candidate) => candidate.name.toLowerCase() === name);
    if (header === undefined) {
      problems.push(`全応答に付けるヘッダ ${name} がありません`);
      continue;
    }
    const why = floor(header.value);
    if (why !== null) problems.push(`ヘッダ ${header.name}: ${header.value} が床を下回ります — ${why}`);
  }
  if (!/(^|,)\s*no-store\s*(,|$)/i.test(profile.noStore.value) || profile.noStore.name.toLowerCase() !== 'cache-control') {
    problems.push(`キャッシュの禁止は Cache-Control: no-store です(いま ${profile.noStore.name}: ${profile.noStore.value})`);
  }
  const cleared = ['"cache"', '"cookies"', '"storage"'].filter((kind) => !profile.clearSiteData.value.includes(kind));
  if (profile.clearSiteData.name.toLowerCase() !== 'clear-site-data' || cleared.length > 0) {
    problems.push(`ログアウトの消去は Clear-Site-Data で "cache" / "cookies" / "storage" を全部消させます(足りない: ${cleared.join(' / ') || 'ヘッダの名前'})`);
  }
  return problems;
}

/** 本番の指令 1 つの源が床に収まるか(収まらない源と理由)。 */
function directiveProblems(directive: DefenseCspDirective, floor: DirectiveFloor, relaxations: readonly DefenseRelaxation[]): string[] {
  const problems: string[] = [];
  for (const source of floor.required) {
    if (!directive.sources.includes(source)) problems.push(`CSP の ${directive.name} に ${source} がありません`);
  }
  for (const source of directive.sources) {
    if (floor.allowed.includes(source)) continue;
    if (floor.banned.includes(source) || (PRODUCTION_BANNED[directive.name] ?? []).includes(source)) {
      problems.push(`CSP の ${directive.name} に ${source} は書けません(読み込み元を開け放つ源。理由の宣言でも開けない)`);
    } else if (!floor.relaxable) {
      problems.push(`CSP の ${directive.name} は ${floor.allowed.join(' ')} だけです(緩められない床。いま ${source} がある)`);
    } else if (!relaxations.some((relax) => relax.directive === directive.name && relax.source === source)) {
      problems.push(`CSP の ${directive.name} の ${source} は床の外です(足すなら relaxations に理由つきで宣言する)`);
    }
  }
  return problems;
}

/** 文書の CSP の問題。 */
function cspProblems(profile: BrowserDefenseProfile): string[] {
  const problems: string[] = [];
  const { directives, nonceDirectives, development } = profile.csp;
  const names = directives.map((directive) => directive.name);
  for (const name of new Set(names)) if (names.filter((other) => other === name).length > 1) problems.push(`CSP の指令 ${name} が 2 回以上あります`);
  for (const directive of directives) {
    if ([directive.name, ...directive.sources].some((part) => BREAKS_HEADER.test(part) || part.includes(';') || part.trim() === '')) {
      problems.push(`CSP の指令 ${directive.name} の名前か源に改行・;・空の値があります`);
    }
  }
  for (const [name, floor] of Object.entries(CSP_FLOORS)) {
    const directive = directives.find((candidate) => candidate.name === name);
    if (directive === undefined) problems.push(`CSP の指令 ${name} がありません`);
    else problems.push(...directiveProblems(directive, floor, profile.relaxations));
  }
  if (!nonceDirectives.includes('script-src')) problems.push('CSP の script-src に要求ごとの nonce を差し込みません(nonceDirectives に script-src が要る)');
  for (const name of nonceDirectives) if (!names.includes(name)) problems.push(`nonce を差し込む指令 ${name} が CSP にありません`);
  for (const added of development) {
    const floor = CSP_FLOORS[added.name];
    if (added.reason.trim() === '') problems.push(`開発中だけ足す ${added.name} の源に理由がありません`);
    if (!names.includes(added.name)) problems.push(`開発中だけ足す源の指令 ${added.name} が本番の CSP にありません`);
    if (floor !== undefined && !floor.relaxable) problems.push(`CSP の ${added.name} は開発中も緩められません`);
    for (const source of added.sources) {
      if (floor?.banned.includes(source) === true) problems.push(`開発中でも CSP の ${added.name} に ${source} は書けません`);
    }
  }
  return problems;
}

/** 緩める宣言そのものの問題(理由・宛先・使われているか)。 */
function relaxationProblems(profile: BrowserDefenseProfile): string[] {
  const problems: string[] = [];
  for (const relax of profile.relaxations) {
    const floor = CSP_FLOORS[relax.directive];
    if (relax.reason.trim() === '') problems.push(`CSP の ${relax.directive} の ${relax.source} を緩める宣言に理由がありません`);
    if (floor === undefined || !floor.relaxable) problems.push(`CSP の ${relax.directive} は緩める宣言の宛先になりません(床の表で緩められる指令だけ)`);
    const directive = profile.csp.directives.find((candidate) => candidate.name === relax.directive);
    if (directive?.sources.includes(relax.source) !== true) problems.push(`CSP の ${relax.directive} を緩める宣言の源 ${relax.source} が、本番の CSP に書かれていません(死んだ宣言)`);
  }
  return problems;
}

/**
 * ブラウザ側の守りの宣言が床を満たすかを確かめる(後段の選択の契約が呼ぶ。throw しない)。
 *
 * @param profile アプリの枠の後段が持つ宣言
 * @returns 床を下回る点(空なら満たす)
 */
export function browserDefenseProblems(profile: BrowserDefenseProfile): string[] {
  const prefixes = profile.gateExcludedPrefixes.filter((prefix) => !SAFE_PREFIX.test(prefix));
  return [
    ...headerProblems(profile),
    ...cspProblems(profile),
    ...relaxationProblems(profile),
    ...prefixes.map((prefix) => `リクエスト前段が通さない接頭辞 ${JSON.stringify(prefix)} は、先頭の / を除いたパスの綴り(英数字と . _ - /)で書きます`),
  ];
}
