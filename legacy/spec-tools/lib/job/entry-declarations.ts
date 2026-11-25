/**
 * HTTP の入口(Route Handler)の**宣言の全数** — どの仕様が、どの URL を、どんな持ち主として名指しているか。
 *
 * 実装の木の HTTP の入口は、6 通りの宣言のどれかに分類される(J2 の続き。衝突は `j2-entry-collision.ts`・閉世界は `j2-entry-closed.ts`):
 *
 * | 出どころ | 宣言の場所 | 口を書く者 |
 * |---|---|---|
 * | `job` | ジョブの `endpoint`(Cron が叩く口) | 製品(手書き) |
 * | `inbound` | 受信の連携(`direction: inbound`。URL は連携 ID から決まる) | 受信口の生成器 |
 * | `auth_callback` | 認証フロー仕様の `callback.endpoint`(OAuth の帰り道) | 製品(手書き) |
 * | `auth_start` | 認証フロー仕様の `start.endpoint`(サインインの開始。POST) | 製品(手書き。中身はセッションの adapter の `startSignIn`) |
 * | `auth_logout` | 認証フロー仕様の `logout.endpoint`(ログアウト。POST) | 製品(手書き。中身はセッションの adapter の `signOut`) |
 * | `external_endpoint` | 送信の連携の `endpoints`(その連携を使う手書きの口) | 製品(手書き) |
 *
 * **cookie で認証する口**(他のサイトから送らせた要求にも cookie が付く口)は `external_endpoint` と `auth_start` と `auth_logout` で、状態を変える要求の出どころを
 * 確かめる部品(`@kaninabe/runtime/http/request-origin` の `refuseCrossOrigin`)が必須である(`isCookieAuthenticatedOrigin`)。ジョブの口は共有秘密・
 * 受信口は署名で認証し、OAuth の帰り道は `GET` で OAuth の state が守る —— どれも cookie の認証に頼らないので対象外。
 *
 * 衝突の検査(主張を集めて配置に当てる)と閉世界の検査(実装の木の全入口が宣言に当たる)は、**同じ宣言の全数**を読む。ここが 1 か所で作るので、
 * 片方の検査にだけ新しい出どころが足されて食い違う、が起きない。URL は宣言のまま持つ(正規化は読み手が配置の規則で行う)。
 */

import type { SourceLocation } from '../kernel/source-location.js';
import type { AuthSpecModel } from '../model/auth/types.js';
import type { ExternalCatalogSpec } from '../model/external/types.js';
import type { JobSpecModel } from '../model/job/types.js';
import { hasDotSegment } from '../model/product/layout.js';
import { inboundUrlOf } from '../inbound/inbound-url.js';

/** 宣言の出どころ(閉じた 6 つ)。 */
export const ENTRY_ORIGINS = ['job', 'inbound', 'auth_callback', 'external_endpoint', 'auth_start', 'auth_logout'] as const;

/** 宣言の出どころ。 */
export type EntryOrigin = (typeof ENTRY_ORIGINS)[number];

/** HTTP の入口の宣言 1 件。 */
export interface EntryDeclaration {
  readonly origin: EntryOrigin;
  /** 宣言した URL のパス(宣言のまま。受信口は連携 ID から決まる URL)。 */
  readonly url: string;
  /** 宣言の持ち主の ID(ジョブ ID / 連携 ID。認証の口は `callback` / `start` / `logout`)。 */
  readonly owner: string;
  /** 人が読む出どころ(違反の説明に出る。例: `ジョブ example_job の endpoint /api/x`)。 */
  readonly source: string;
  /** 宣言の位置(Finding 用)。 */
  readonly location: SourceLocation;
}

/** 認証の口の持ち主の名前(認証フロー仕様に 1 つずつしかない宣言なので ID を持たない)。 */
export const AUTH_CALLBACK_OWNER = 'callback';

/** サインインの開始の口の持ち主の名前。 */
export const AUTH_START_OWNER = 'start';

/** ログアウトの口の持ち主の名前。 */
export const AUTH_LOGOUT_OWNER = 'logout';

/**
 * endpoint が URL のパスとして書けない形か(空のセグメント `//`・クエリ `?`・フラグメント `#`・`.` / `..` のセグメント)。
 * ファイルの置き場にならず、置き場の衝突も正しく数えられない。
 *
 * @param endpoint 宣言された URL のパス
 */
export function isMalformedEndpoint(endpoint: string): boolean {
  return /\/\/|[?#]/.test(endpoint) || hasDotSegment(endpoint);
}

/** 手書きの口を持つ出どころか(受信口は生成物)。 */
export function isHandwrittenOrigin(origin: EntryOrigin): boolean {
  return origin !== 'inbound';
}

/**
 * cookie で認証する口の出どころか(状態を変える要求の出どころの確認が必須になる。送信の連携の手書きの口と、サインインの開始・ログアウトの口)。
 *
 * @param origin 宣言の出どころ
 */
export function isCookieAuthenticatedOrigin(origin: EntryOrigin): boolean {
  return origin === 'external_endpoint' || origin === 'auth_start' || origin === 'auth_logout';
}

/**
 * HTTP の入口の宣言を全部集める(ジョブ → 外部連携の宣言順 → 認証の口(帰り道・開始・ログアウト)の順)。
 *
 * @param jobs 読み込み済みのジョブカタログ(無ければ空)
 * @param external 読み込めた外部連携カタログ(読めなければ undefined = 受信口も送信の連携の口も無いものとして数える)
 * @param auth 読み込み済みの認証フロー仕様(読めない・無いは undefined)
 * @returns 宣言の並び
 */
export function entryDeclarationsOf(
  jobs: JobSpecModel,
  external: ExternalCatalogSpec | undefined,
  auth: AuthSpecModel | undefined,
): EntryDeclaration[] {
  const declarations: EntryDeclaration[] = [];
  for (const decl of jobs.catalog?.jobs ?? []) {
    const endpoint = decl.schedule?.endpoint;
    if (endpoint === undefined) continue;
    declarations.push({ origin: 'job', url: endpoint, owner: decl.id, source: `ジョブ ${decl.id} の endpoint ${endpoint}`, location: decl.location });
  }
  for (const integration of external?.integrations ?? []) {
    if (integration.direction === 'inbound') {
      const url = inboundUrlOf(integration.id);
      declarations.push({ origin: 'inbound', url, owner: integration.id, source: `外部連携 ${integration.id} の受信口 ${url}`, location: integration.location });
      continue;
    }
    for (const endpoint of integration.endpoints ?? []) {
      declarations.push({
        origin: 'external_endpoint',
        url: endpoint,
        owner: integration.id,
        source: `外部連携 ${integration.id} の endpoints ${endpoint}`,
        location: integration.location,
      });
    }
  }
  const flow = auth?.flow;
  const authEntries = [
    { origin: 'auth_callback', owner: AUTH_CALLBACK_OWNER, decl: flow?.callback },
    { origin: 'auth_start', owner: AUTH_START_OWNER, decl: flow?.start },
    { origin: 'auth_logout', owner: AUTH_LOGOUT_OWNER, decl: flow?.logout },
  ] as const;
  for (const { origin, owner, decl } of authEntries) {
    if (decl === undefined) continue;
    declarations.push({ origin, url: decl.endpoint, owner, source: `認証 ${owner} の endpoint ${decl.endpoint}`, location: decl.location });
  }
  return declarations;
}
