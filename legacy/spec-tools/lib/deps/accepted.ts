/**
 * 受け入れ表(`dependency-accepted.md`)の読み取りと、指摘への当てはめ。
 *
 * 表は Markdown の表 1 枚: `| 種別 | 対象 | パッケージ | 版 | 前提 | 理由 | 見直しの期限 |`。
 *   - 種別 `advisory` … 対象 = advisory の ID(GHSA・CVE。別名も当たる)。パッケージは名前か `*`。
 *     **版 = 受け入れる版の全部**(`1.2.3` の形の版をカンマで並べる。`*`・範囲・空は書けない)。同じ advisory でも、並べていない版の指摘には当たらない
 *     (受け入れの判断は「この版に届くか」を確かめた結果なので、新しく入った別の版を黙って覆わない)。版の分からない指摘(`version` 無し)にも当たらない。
 *   - 種別 `cooldown` … 対象 = 版(`1.2.3` の形の 1 つの版だけ)。パッケージは名前 1 つだけ。公開から日の浅い版を理由つきで通す。
 *     版の欄は**対象と同じ 1 つの版**を書く(待ちの受け入れは元から版を名指すので、欄は同じ値の写しで、違えば行を採らない)。
 *     **`*` は対象にもパッケージにも書けない**(点検 9 回目 C9-2。`* / *` の 1 行で全部の部品の待ちが外れ、出荷の関門の 7 日の待ちが恒久に効かなくなった)。
 *   - 前提 … 受け入れが成り立つ条件の名前(閉じた表 `PREMISE_NAMES` の名前をカンマで並べる。無ければ `-`)。**知らない名前・空の欄の行は採らない**。
 *     この段が見るのは名前だけで、条件そのものは開発用リポジトリのテスト(`__tests__/dev-repo/unit/deps/accept-premises.ts`)が期限内の行についてだけ見る
 *     (出荷の関門の閉包は相対と `node:` の import だけなので、製品の設定を読む照らしをここに置かない)。
 * 期限内なら指摘を赤にしない(accepted)。**期限切れは赤**(重大度が低くても赤 = 見直しを強制する)。
 * **advisory の期限は重大度の上限を超えられない**(`ACCEPT_LIMIT_DAYS`。今日から数えて critical 3 日・high 7 日・moderate 30 日・low 90 日。超えた行は赤 — ASVS V15.1.1)。
 * **cooldown の期限は今日から `COOLDOWN_DAYS`(7 日)を超えられない**(9 回目 C9-2。表に足した日の列は無いので、advisory と同じく今日から数える。
 *   待ちの 7 日が過ぎた版はもう指摘に出ないので、それより長い期限は要らない。超えた行は赤)。
 * 読めない行(種別が不明・日付が不正・理由が空)は notes に出し、行としては採らない(受け入れは fail-closed)。
 */

import { ACCEPT_LIMIT_DAYS, COOLDOWN_DAYS, PREMISE_NAMES } from './types.js';
import type { AcceptedEntry, DepsFinding, PremiseName } from './types.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 版として書ける形(1 つの正確な版。`*`・範囲・タグは書けない)。cooldown の対象と、版の欄の 1 つずつ。 */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** cooldown の行のパッケージに書ける名前の形(npm の名前 1 つ。`*` は書けない)。 */
const COOLDOWN_PACKAGE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

/** 表の解釈結果。 */
export interface AcceptedTable {
  readonly entries: readonly AcceptedEntry[];
  /** 採れなかった行の理由。 */
  readonly problems: readonly string[];
}

/** `YYYY-MM-DD` が実在の日付か。 */
function isRealDate(text: string): boolean {
  if (!DATE_RE.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

/** 版の欄を読む(カンマ区切りの正確な版。1 つでも形が違えば null = 行を採らない)。 */
function parseVersions(cell: string): string[] | null {
  const versions = cell.split(',').map((part) => part.trim().replace(/^`|`$/g, ''));
  return versions.every((version) => EXACT_VERSION.test(version)) ? versions : null;
}

/** 前提の欄を読む(`-` は前提なし。閉じた表に無い名前・重なり・空が 1 つでもあれば null = 行を採らない)。 */
function parsePremises(cell: string): PremiseName[] | null {
  if (cell === '-') return [];
  const names = cell.split(',').map((part) => part.trim().replace(/^`|`$/g, ''));
  const known = names.filter((name): name is PremiseName => (PREMISE_NAMES as readonly string[]).includes(name));
  return known.length === names.length && new Set(known).size === known.length ? known : null;
}

/**
 * 受け入れ表を読む。表の外の文章は無視する。見出し行(種別の列名)と区切り行は飛ばす。
 *
 * @param text 文書の本文(無ければ null = 表なし)
 */
export function parseAcceptedTable(text: string | null): AcceptedTable {
  if (text === null) return { entries: [], problems: [] };
  const entries: AcceptedEntry[] = [];
  const problems: string[] = [];
  for (const [index, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim().replace(/^`|`$/g, ''));
    const kind = cells[0] ?? '';
    if (kind === '種別' || /^:?-+:?$/.test(kind)) continue;
    const where = `受け入れ表 ${String(index + 1)} 行目`;
    if (cells.length !== 7) {
      problems.push(`${where}: 列が 7 つではありません(種別・対象・パッケージ・版・前提・理由・見直しの期限)`);
      continue;
    }
    const [, target = '', pkg = '', versionCell = '', premiseCell = '', reason = '', reviewBy = ''] = cells;
    const versions = parseVersions(versionCell);
    const premises = parsePremises(premiseCell);
    if (kind !== 'advisory' && kind !== 'cooldown') {
      problems.push(`${where}: 種別は advisory か cooldown です(${kind})`);
    } else if (target === '' || pkg === '') {
      problems.push(`${where}: 対象とパッケージが要ります`);
    } else if (reason === '') {
      problems.push(`${where}: 理由が空です(受け入れには理由が要る)`);
    } else if (kind === 'cooldown' && !EXACT_VERSION.test(target)) {
      problems.push(`${where}: cooldown の対象は 1 つの版(1.2.3 の形)です(${target})。* や範囲では受け入れない`);
    } else if (kind === 'cooldown' && !COOLDOWN_PACKAGE.test(pkg)) {
      problems.push(`${where}: cooldown のパッケージは名前 1 つです(${pkg})。* では受け入れない`);
    } else if (versions === null) {
      problems.push(`${where}: 版は正確な版をカンマで並べます(${versionCell})。* や範囲・空では受け入れない`);
    } else if (kind === 'cooldown' && (versions.length !== 1 || versions[0] !== target)) {
      problems.push(`${where}: cooldown の版は対象と同じ 1 つの版です(対象 ${target}・版 ${versionCell})`);
    } else if (premises === null) {
      problems.push(`${where}: 前提は ${PREMISE_NAMES.join('・')} の名前をカンマで並べるか - です(${premiseCell})。知らない名前の行は受け入れない`);
    } else if (!isRealDate(reviewBy)) {
      problems.push(`${where}: 見直しの期限は実在の YYYY-MM-DD です(${reviewBy})`);
    } else {
      entries.push({ kind, target, pkg, versions, premises, reason, reviewBy });
    }
  }
  return { entries, problems };
}

/** `YYYY-MM-DD` 2 つの間の日数(`to` が後なら正)。 */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 行が指摘に当たるか。 */
function matches(entry: AcceptedEntry, finding: DepsFinding): boolean {
  // lockfile の配信元・固定の違反は受け入れられない(取得元の差し替えを「期限つきで許す」形を作らない)。
  if (finding.kind === 'lockfile') return false;
  // 待ちを確かめられない版(公開日時が引けない・手元の時計より後。7 回目 C7-7)も受け入れない(受け入れるのは「待ちの中」の警告だけ)。
  if (finding.kind === 'cooldown' && finding.id !== 'cooldown') return false;
  if (entry.kind !== (finding.kind === 'cooldown' ? 'cooldown' : 'advisory')) return false;
  // 版は両方の種別で名指した版だけに当たる(版の分からない指摘には当たらない)。
  if (finding.version === undefined || !entry.versions.includes(finding.version)) return false;
  // cooldown の行は名前と版の両方を名指す(`*` は表の読み取りで拒む。ここでも全部に当たる形を作らない。9 回目 C9-2)。
  if (entry.kind === 'cooldown') return entry.pkg === finding.pkg && entry.target === finding.version;
  if (entry.pkg !== '*' && entry.pkg !== finding.pkg) return false;
  return entry.target === finding.id || finding.aliases.includes(entry.target);
}

/**
 * 指摘に受け入れ表を当てる。赤の指摘だけでなく警告にも当てる(警告の受け入れも「受け入れた」と記録できる)。
 * 期限は `reviewBy` の日の終わりまで有効(`today` が期限より後なら期限切れ)。
 *
 * @param findings 指摘(`level` と `accepted` を直接更新する)
 * @param entries 受け入れ表の行
 * @param today 今日(`YYYY-MM-DD`)
 * @returns 指摘に当たらなかった行(不要な行の候補)
 */
export function applyAccepted(findings: readonly DepsFinding[], entries: readonly AcceptedEntry[], today: string): AcceptedEntry[] {
  const used = new Set<AcceptedEntry>();
  for (const finding of findings) {
    const entry = entries.find((candidate) => matches(candidate, finding));
    if (entry === undefined) continue;
    used.add(entry);
    const expired = today > entry.reviewBy;
    const limit = entry.kind === 'advisory' ? ACCEPT_LIMIT_DAYS[finding.severity] : COOLDOWN_DAYS;
    const over = !expired && daysBetween(today, entry.reviewBy) > limit;
    finding.accepted = { reason: entry.reason, reviewBy: entry.reviewBy, expired, ...(over ? { overDeadline: limit } : {}) };
    finding.level = expired || over ? 'red' : 'accepted';
  }
  return entries.filter((entry) => !used.has(entry));
}

/**
 * 期限内の行が持つ前提の名前(前提の照らしは、これを持つ期限内の行があるときだけ回す)。期限は `applyAccepted` と同じく `reviewBy` の日の終わりまで。
 *
 * @param entries 受け入れ表の行
 * @param today 今日(`YYYY-MM-DD`)
 * @returns 前提の名前 → それを持つ期限内の行の対象(ID・版)
 */
export function livePremises(entries: readonly AcceptedEntry[], today: string): ReadonlyMap<PremiseName, readonly string[]> {
  const live = new Map<PremiseName, string[]>();
  for (const entry of entries) {
    if (today > entry.reviewBy) continue;
    for (const name of entry.premises) live.set(name, [...(live.get(name) ?? []), entry.target]);
  }
  return live;
}
