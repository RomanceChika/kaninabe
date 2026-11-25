/**
 * J2(続き)**cookie で認証する口の出どころの確認** — 送信の連携の `endpoints`(ブラウザから叩かれる手書きの口)と、認証の開始・ログアウトの口の Route Handler は、
 * 状態を変えるメソッドを export するなら、最初に出どころを確かめる部品(`refuseCrossOrigin`)を呼ぶ。
 *
 * 口の種類は宣言が決める(`job/entry-declarations.ts` の `isCookieAuthenticatedOrigin`)。ジョブの口(共有秘密)・受信口(署名)・OAuth の帰り道
 * (`GET` と PKCE の検証子)は cookie の認証に頼らないので対象外である。だから **手で書く cookie の口 = 送信の連携の `endpoints` と、
 * 認証フロー仕様の `start` / `logout`**(どちらもフォームの POST。中身はセッションの adapter)をここで見る。
 *
 * 見るのは構文木の形である(`semantics/route-origin-guard.ts`): 状態を変えるメソッドごとに、**最初の文で**部品を呼び(部品は
 * `@kaninabe/runtime/http/request-origin` から import したもの・最初の引数はそのメソッドが受けた要求)、**その結果を返している**こと ——
 * `return refuseCrossOrigin(request, …) ?? 本体` か、`const r = refuseCrossOrigin(request, …); if (r !== null) return r;` の 2 つの形だけを認める。
 * 文字列の検索では、関門を後置した実装・関門の結果を捨てる実装・コメントに書いただけの実装が通っていた(外部レビュー のレビュー origin-order-proof)。
 * **実際に閉じること**(閉じる要求で、認証・DB・外部の呼び出しに 1 度も触れず 403 を返すこと)は、アプリの枠の後段が生成する配線の
 * 見張りテストが、口の依存を全部「触れたら記録する代役」に差し替えて確かめる。
 * **宣言の口は GET / HEAD を export できない**(`effect` によらない。SameSite=Lax の cookie は別のサイトからの最上位の GET に付き、GET は出どころの確認を
 * 求めないので、本体が状態を変える処理に届けば被害者の名義で動く。本体が読み取りだけかは検査が証明できないので閉じる)。
 * 本文が読めない(口が無い)ときは何も言わない —— 口の不在は閉世界(`j2-entry-closed.ts`)が言う。
 */

import path from 'node:path';
import type { Finding } from '../../kernel/finding.js';
import { appGrounded, isFile } from '../../io/paths.js';
import { readText } from '../../io/read-text.js';
import type { AuthSpecModel } from '../../model/auth/types.js';
import type { ExternalCatalogSpec } from '../../model/external/types.js';
import type { JobSpecModel } from '../../model/job/types.js';
import { httpEntryPath } from '../../model/product/layout.js';
import type { ProductLayout } from '../../model/product/layout.js';
import type { ProductRoots } from '../../model/product/types.js';
import { exportedHttpMethods } from '../../semantics/route-exports.js';
import { originGuardShape, REQUEST_ORIGIN_GUARD } from '../../semantics/route-origin-guard.js';
import type { OriginGuardShape } from '../../semantics/route-origin-guard.js';
import type { ExternalEffect } from '../../model/external/types.js';
import { entryDeclarationsOf, isCookieAuthenticatedOrigin, isMalformedEndpoint } from '../entry-declarations.js';
import type { EntryDeclaration } from '../entry-declarations.js';

/** この検証器の ID(J2 の続き)。 */
export const VERIFIER_ID = 'J2';

/** 出どころを確かめる部品のモジュール指定(実行時パッケージの公開の口。正は `route-origin-guard.ts`)。 */
export const ORIGIN_GUARD_MODULE = REQUEST_ORIGIN_GUARD.module;

/** 出どころを確かめる部品の名前。 */
export const ORIGIN_GUARD_FUNCTION = REQUEST_ORIGIN_GUARD.name;

/** 状態を変えないメソッド(出どころを確かめなくてよい)。 */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 別のサイトからの**最上位の遷移**(リンク・`location =`)に cookie が付く安全なメソッド。cookie の属性は `SameSite=Lax` で、Lax は別のサイトからの
 * 最上位の GET に cookie を付ける。`OPTIONS`(プリフライト)は cookie を付けないので含めない。
 */
const NAVIGABLE_SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/** 形が崩れているときの言い分け(違反の文に出る)。 */
const SHAPE_WORDING: Readonly<Record<Exclude<OriginGuardShape, 'guarded'>, string>> = {
  'body-unreadable': '本体がこのファイルの関数として読めない(再輸出・高階関数の戻り値・分割代入の引数)',
  'not-called': '部品を呼んでいない(コメントに書いただけ・import していない・要求を渡していないも含む)',
  'not-first': '部品より先に別の文がある(認証・DB・外部の呼び出しが先に走りうる)',
  'result-not-returned': '部品を呼んでいるが、その結果を返していない',
  'argument-has-effect': '部品に渡すほかの引数が副作用を持つ(呼び出し・await・代入など。部品より先に走る)',
};

/**
 * GET / HEAD を許さない口か。**cookie で認証する宣言の口は、宣言の種類・`effect` によらず全部**である(点検 4 回目 B4-4)。
 *
 * サインインの開始・ログアウトは宣言の種類そのものが状態を変える(フォームの POST)。送信の連携の `effect` は**外の系への効果**の語で、
 * アプリの DB やセッションを書くかどうかではない —— `effect: read` の連携の口でも、Route Handler の層の境界は composition(セッションの管理・
 * 枠の消費など、状態を変える組み立ての根)の import を許すので、`GET` の本体から書き込みに届きうる。検査はそれを読み取りだけと証明できないので、
 * 閉じる(読み取りも `POST` にして最初の文で出どころを確かめる。同じオリジンの `fetch` はそのまま通る)。
 * 読み取り専用の `GET` を宣言で明示して許す口(本体の import の閉包が状態を変えないことの証明つき)は未対応(BACKLOG)。
 */
function forbidsNavigableMethods(origin: EntryDeclaration['origin']): boolean {
  return isCookieAuthenticatedOrigin(origin);
}

/** 違反の文に出す、口の種類の言い方。 */
function originWords(origin: EntryDeclaration['origin'], effect: ExternalEffect | undefined): string {
  if (origin !== 'external_endpoint') return '認証の POST の口';
  return effect === 'write' ? '効果を外へ送る連携 effect: write の口' : `連携の口${effect === undefined ? '' : ` effect: ${effect}`}`;
}

/** J2(cookie の口の出どころ)の入力。 */
export interface EntryOriginGuardInput {
  readonly jobs: JobSpecModel;
  /** 読み込めた外部連携カタログ(読めなければ undefined = 送信の連携の口を知れないので何も言わない)。 */
  readonly external: ExternalCatalogSpec | undefined;
  readonly auth: AuthSpecModel | undefined;
  readonly repoRoot: string;
  readonly roots: ProductRoots;
  readonly layout: ProductLayout;
}

/**
 * 手で書く cookie の口(送信の連携の `endpoints`)が、状態を変えるメソッドの前に出どころを確かめる部品を呼んでいるかを検証する。
 *
 * @param input 各カタログ・リポジトリルート・根・配置
 * @returns 違反
 */
export function verifyEntryOriginGuard(input: EntryOriginGuardInput): Finding[] {
  if (!appGrounded(input.repoRoot, input.roots.app)) return [];
  const findings: Finding[] = [];
  for (const decl of entryDeclarationsOf(input.jobs, input.external, input.auth)) {
    // 手で書く cookie の口(送信の連携の口・サインインの開始・ログアウト)。
    if (!isCookieAuthenticatedOrigin(decl.origin) || isMalformedEndpoint(decl.url)) continue;
    const route = httpEntryPath(input.layout, input.roots, decl.url);
    if (route === null || !isFile(path.join(input.repoRoot, route))) continue;
    const source = readText(path.join(input.repoRoot, route));
    const exported = exportedHttpMethods(route, source);
    // 宣言が状態を変える口なのに、別のサイトからの最上位の GET にも cookie が付く GET / HEAD を export している口(出どころの確認では守れない形)。
    const effect = input.external?.integrations.find((candidate) => candidate.id === decl.owner)?.effect;
    const navigable = forbidsNavigableMethods(decl.origin) ? exported.filter((method) => NAVIGABLE_SAFE_METHODS.has(method)) : [];
    if (navigable.length > 0) {
      findings.push({
        verifier: VERIFIER_ID,
        severity: 'error',
        message:
          `${decl.source} の Route Handler(${route})は cookie で認証する口(${originWords(decl.origin, effect)})なのに、` +
          `${navigable.join(' / ')} を export しています(cookie の属性は SameSite=Lax で、別のサイトのリンクや location による最上位の GET の遷移にも cookie が付き、` +
          'GET は出どころの確認を求めないので、本体が状態を変える処理〔composition の書き込み・セッションの操作〕に届けば被害者の名義で実行されます。' +
          '検査は GET の本体が読み取りだけだと証明できないので、宣言の口の GET / HEAD は効果の種類によらず止めます)',
        location: decl.location,
        suggestion:
          `${navigable.join(' / ')} の export を消し、POST にして最初の文で ${ORIGIN_GUARD_FUNCTION} を呼ぶ(読み取りだけの口も同じ。` +
          '同じオリジンの画面からの fetch は出どころの確認を通る)',
        counterexample: { endpoint: decl.url, route, methods: navigable.join(' / '), origin: decl.origin },
        grounding: 'implementation',
      });
    }
    const changing = exported.filter((method) => !SAFE_METHODS.has(method));
    const broken = changing.flatMap((method) => {
      const shape = originGuardShape(route, source, method, { module: ORIGIN_GUARD_MODULE, name: ORIGIN_GUARD_FUNCTION });
      return shape === 'guarded' ? [] : [{ method, shape }];
    });
    if (broken.length === 0) continue;
    findings.push({
      verifier: VERIFIER_ID,
      severity: 'error',
      message:
        `${decl.source} の Route Handler(${route})は cookie で認証する口で、状態を変える ${broken.map((b) => b.method).join(' / ')} を受けるのに、` +
        `最初に要求の出どころを確かめてその結果を返す形になっていません(${broken.map((b) => `${b.method}: ${SHAPE_WORDING[b.shape]}`).join(' / ')})`,
      location: decl.location,
      suggestion:
        `本体の最初の文で \`return ${ORIGIN_GUARD_FUNCTION}(request, BROWSER_DEFENSE) ?? (await 本体(request));\` か、` +
        `\`const refused = ${ORIGIN_GUARD_FUNCTION}(request, BROWSER_DEFENSE); if (refused !== null) return refused;\` と書く(部品は \`${ORIGIN_GUARD_MODULE}\` から import する。` +
        'Sec-Fetch-Site: same-origin と自分のオリジンの Origin が揃わない要求を、認証・DB・外部の呼び出しより先に 403 で閉じる。他のサイトから送らせた要求にも cookie は付く)',
      counterexample: { endpoint: decl.url, route, methods: broken.map((b) => b.method).join(' / '), shapes: broken.map((b) => b.shape).join(' / ') },
      grounding: 'implementation',
    });
  }
  return findings;
}
