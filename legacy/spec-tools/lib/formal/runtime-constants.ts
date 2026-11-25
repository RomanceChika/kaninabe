/**
 * **模型の前提が実装で保たれているか**の検査(C24 の第 5 段)。
 *
 * `Outbox.tla` が「リース超過は起きない」と言えるのは、3 つの時間の比が成り立つ間だけである
 * —— 1 回の起動が使ってよい時間(予算)と 1 実行の上限(外部呼び出しのタイムアウト)の和が、
 * リースの長さより短いこと。比が崩れると、同じモデルで S1 / S2 / S3 が破れる
 * (`Outbox-lease-breach.cfg` がその反例を持っている)。
 *
 * **前提は書いておくだけでは守られない。** 予算を伸ばす・タイムアウトを伸ばす・リースを
 * 縮める、のどれも別々の人が別々の理由でやりうる。ここが 3 つの実装値を読んで比を確かめ、
 * 崩れたら赤にする —— それがこの前提の執行点である。
 *
 * 純粋関数であり throw しない(ファイルの読み込みは CLI の仕事)。
 */

import type { FormalFinding } from './types.js';

/** 予算(ミリ秒)。`const BUDGET_MS = 50_000;` の形。 */
const BUDGET = /const\s+BUDGET_MS\s*=\s*([\d_]+)/;

/** 外部呼び出しのタイムアウト(ミリ秒)。生成物の `timeoutMs: 5000,` の形(全件見て最大を取る)。 */
const TIMEOUT = /timeoutMs:\s*(\d+)/g;

/** リースの既定(秒)。`p_lease_seconds integer default 300` の形。 */
const LEASE = /p_lease_seconds\s+integer\s+default\s+(\d+)/;

/** 読み取り元 3 つの中身と、人に見せるパス。 */
export interface RuntimeConstantSources {
  /** 予算を持つファイル(Cron の起動口)。 */
  readonly budget: { readonly path: string; readonly text: string };
  /** 外部呼び出しのタイムアウトを持つファイル(連携カタログの生成物)。 */
  readonly timeout: { readonly path: string; readonly text: string };
  /** リースの既定を持つファイル(取り出しの関数の migration)。 */
  readonly lease: { readonly path: string; readonly text: string };
}

/** 読み取れた 3 つの値。 */
export interface RuntimeConstants {
  /** 1 回の起動が使ってよい時間(ミリ秒)。 */
  readonly budgetMs: number;
  /** 外部呼び出しのタイムアウトの最大(ミリ秒)。 */
  readonly timeoutMs: number;
  /** リースの長さ(ミリ秒)。 */
  readonly leaseMs: number;
}

function toNumber(text: string): number {
  return Number.parseInt(text.replace(/_/g, ''), 10);
}

/** 数が 1 つも読めなかったときの Finding。 */
function unreadable(what: string, path: string, shape: string): FormalFinding {
  return {
    severity: 'error',
    message: `Outbox の前提を確かめられません(${what} を読めませんでした)`,
    location: path,
    suggestion: `${shape} の形が変わっていないかを確かめ、変わったなら lib/formal/runtime-constants.ts の読み取りを直す`,
  };
}

/**
 * 3 つの実装値を読む。
 *
 * @param sources 3 ファイルの中身
 * @returns 読めた値、または読めなかったことを報告する Finding
 */
export function readRuntimeConstants(
  sources: RuntimeConstantSources,
): RuntimeConstants | FormalFinding {
  const budget = BUDGET.exec(sources.budget.text);
  if (budget === null) return unreadable('1 回の起動の時間予算', sources.budget.path, 'const BUDGET_MS = …');
  const timeouts = [...sources.timeout.text.matchAll(TIMEOUT)].map((matched) => toNumber(matched[1] ?? '0'));
  if (timeouts.length === 0) {
    return unreadable('外部呼び出しのタイムアウト', sources.timeout.path, 'timeoutMs: …');
  }
  const lease = LEASE.exec(sources.lease.text);
  if (lease === null) {
    return unreadable('リースの既定', sources.lease.path, 'p_lease_seconds integer default …');
  }
  return {
    budgetMs: toNumber(budget[1] ?? '0'),
    timeoutMs: Math.max(...timeouts),
    leaseMs: toNumber(lease[1] ?? '0') * 1000,
  };
}

/**
 * 比を確かめる。
 *
 * @param constants 読めた 3 つの値
 * @param sources 人に見せるパス
 * @returns 比が崩れていれば 1 件の Finding、成り立っていれば空配列
 */
export function premiseFindings(
  constants: RuntimeConstants,
  sources: RuntimeConstantSources,
): FormalFinding[] {
  const held = constants.budgetMs + constants.timeoutMs < constants.leaseMs;
  if (held) return [];
  return [
    {
      severity: 'error',
      message:
        'Outbox の前提が崩れました —— 時間予算 + 外部呼び出しのタイムアウト が、リースの長さ以上になっています',
      location: `${sources.budget.path} / ${sources.timeout.path} / ${sources.lease.path}`,
      suggestion:
        'リースを伸ばすか、予算かタイムアウトを縮める。前提が崩れたまま進めると、' +
        '書き戻しが locked_by を見ないことが実害になる(同じモデルを ' +
        'formal/Outbox-lease-breach.cfg で回すと S1 / S2 / S3 の反例が出る)',
      detail: [
        `時間予算: ${constants.budgetMs} ms`,
        `タイムアウトの最大: ${constants.timeoutMs} ms`,
        `リース: ${constants.leaseMs} ms`,
        `${constants.budgetMs} + ${constants.timeoutMs} < ${constants.leaseMs} が成り立つ必要があります`,
      ],
    },
  ];
}

/** 進捗行に出す 1 行(成り立っているときに何を確かめたかを言う)。 */
export function describePremise(constants: RuntimeConstants): string {
  return (
    `  Outbox の前提: 予算 ${constants.budgetMs}ms + タイムアウト ${constants.timeoutMs}ms ` +
    `< リース ${constants.leaseMs}ms`
  );
}
