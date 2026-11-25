/**
 * **送信の上限**(`functions[].send_limit`)の関数の migration を組み立てる。
 *
 * 正: ARCH-SP-BE-0001 §送信の上限。宣言の形は `model/data/parse-send-limit.ts`、接地は T26 が見る。ここは宣言を字面にするだけで、
 * 判定(署名・掴む順・数え方)は下の関数が 1 つずつ持ち、検査(T26)・期待表(`code-send-limits`)・本文が同じ関数を呼ぶ。
 *
 * ## 本文の順序(崩すと嘘になる)
 *
 * 1. **種別の閉じた並び**(`v_types`)は宣言 1 つで、数える側と積む側の両方が引く(点検 18 回目 A18-1: 数える種別と積む種別が
 *    別々の値域だと、外の種別から数えられないまま積めた)。外なら例外で全部を巻き戻す。
 * 2. 鍵の `blocked`(送れない状態の行)。時刻では解けないので hint を持たない。
 * 3. 鍵ごとの advisory lock を**鍵の字面のバイト順**に取る。行の掴みは呼ぶ側の先掴みで済んでおり、ここから後で行を掴まない
 *    (ARCH-SP-BE-0001 §送信の上限 の掴む順。lock-order-parity が呼び出しの位置に本文を差し込んで見る)。
 * 4. 上限を宣言の順に数える(`{at} > now() - interval`。自分は数えない = `max` 本以上で拒む)。拒否の理由は最初に当たった上限の語、
 *    hint は当たった上限の全部の「新しい方から `max` 本目 + `per`」の最も遅い時刻(`greatest` は NULL を無視する)。
 * 5. ジョブを積む。payload は鍵の全部と宣言した欄(数える鍵が payload から抜ける形を作らない)。
 *
 * 純関数であり throw しない。**アプリの語彙は 1 語も持たない。**
 */

import type { DataFunctionDecl, SendLimitDecl, SendLimitKey, SendLimitUnit } from '../model/data/types.js';
import { RPC_BODY_WORDS } from '../messages/messages.js';
import { SEND_LIMIT_WORDS } from '../messages/messages-send-limit.js';
import { sqlCommentText } from '../kernel/safe-text.js';
import { sqlLiteral } from './guard-to-sql.js';
import { REFUSAL_CODES, REFUSAL_MESSAGE_PREFIXES } from './refusal-codes.js';

/** 数える表(outbox)。 */
export const SEND_LIMIT_JOBS_TABLE = 'jobs';

/** 関数名の接頭辞(名前から種類が読める。T26 が見る)。 */
export const SEND_LIMIT_PREFIX = 'send_limit_';

/** 拒否の hint の時刻の書式(UTC・秒まで・`Z` 終わり。秒は切り上げる)。 */
const RETRY_AT = (expression: string): string =>
  `to_char(to_timestamp(ceil(extract(epoch from ${expression}))) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

/** 署名(引数の型と名前)。 */
export interface SendLimitSignature {
  readonly args: readonly string[];
  readonly params: readonly string[];
}

/**
 * 宣言から導く署名(種別・鍵の全部・payload の欄の順)。T26 が宣言の `args` / `params` と突き合わせる。
 *
 * @param decl 送信の上限の宣言
 * @returns 引数の型と名前
 */
export function sendLimitSignature(decl: SendLimitDecl): SendLimitSignature {
  return {
    args: ['text', ...decl.keys.map(() => 'uuid'), ...decl.payload.map(() => 'text')],
    params: ['p_type', ...decl.keys.map((key) => `p_${key.name}`), ...decl.payload.map((field) => `p_${field}`)],
  };
}

/**
 * advisory lock の鍵(字面の接頭辞と鍵の名前)を、**字面のバイト順**に並べる(取る順そのもの)。
 *
 * @param fn 関数名
 * @param decl 送信の上限の宣言
 * @returns 鍵の接頭辞(`{関数名}:{鍵}=`)と鍵の名前の並び
 */
export function sendLimitLockKeys(fn: string, decl: SendLimitDecl): readonly { readonly prefix: string; readonly key: string }[] {
  return decl.keys
    .map((key) => ({ prefix: `${fn}:${key.name}=`, key: key.name }))
    .sort((a, b) => (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0));
}

/**
 * 拒否の語の全部(本文が上げる順: 送れない状態 → 上限の宣言の順)と、次に送れる時刻を持つか。
 *
 * @param decl 送信の上限の宣言
 * @returns 語と時刻の有無
 */
export function sendLimitWords(decl: SendLimitDecl): readonly { readonly word: string; readonly timed: boolean }[] {
  return [
    ...decl.keys.flatMap((key) => (key.blocked === undefined ? [] : [{ word: key.blocked.word, timed: false }])),
    ...decl.limits.map((limit) => ({ word: limit.word, timed: true })),
  ];
}

/** uuid の字面の形(payload の値を uuid として読むのは、この形のときだけ。ほかは単位に辿り着かない = 数えない)。 */
const UUID_TEXT = "'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'";

/**
 * 鍵の値から単位を引く式(参照の列を順に辿った先。辿れなければ鍵の値そのもの)。
 *
 * @param unit 辿り方
 * @param start 鍵の値(uuid の式)
 * @returns uuid の式
 */
export function sendLimitUnitExpression(unit: SendLimitUnit, start: string): string {
  const joins = unit.via
    .slice(1)
    .map((hop, index) => ` join public.${hop.table} h${String(index + 2)} on h${String(index + 2)}.id = h${String(index + 1)}.${unit.via[index]?.column ?? ''}`)
    .join('');
  const last = unit.via.length;
  const first = unit.via[0];
  return `coalesce((select h${String(last)}.${unit.via[last - 1]?.column ?? ''} from public.${first?.table ?? ''} h1${joins} where h1.id = ${start}), ${start})`;
}

/** 単位の変数名(辿り方を宣言した鍵だけ)。 */
function unitVariable(key: SendLimitKey): string {
  return `v_unit_${key.name}`;
}

/** 鍵の値の式(advisory lock と数えの比べる相手。辿り方を宣言した鍵は単位)。 */
function scopeValue(key: SendLimitKey): string {
  return key.unit === undefined ? `p_${key.name}` : unitVariable(key);
}

/** ジョブの行が数える鍵に当たる条件(辿り方を宣言した鍵は、payload の値の単位が同じ)。 */
function scopeCondition(key: SendLimitKey): string {
  if (key.unit === undefined) return `j.payload ->> ${sqlLiteral(key.name)} = p_${key.name}::text`;
  const text = `j.payload ->> ${sqlLiteral(key.name)}`;
  const start = `(case when ${text} ~ ${UUID_TEXT} then (${text})::uuid end)`;
  return `${sendLimitUnitExpression(key.unit, start)} = ${unitVariable(key)}`;
}

/** 拒否の 1 文(detail は字面か式)。 */
function refusal(event: string, detail: string, hint: string | null, indent: string): string[] {
  const head = `${indent}raise exception using errcode = '${REFUSAL_CODES.guard}', message = ${sqlLiteral(`${REFUSAL_MESSAGE_PREFIXES.guard}${event}`)}, detail = ${detail}`;
  return hint === null ? [`${head};`] : [`${head},`, `${indent}    hint = ${hint};`];
}

/** 本文の中身(`begin` と `end;` の内側)。 */
function steps(fn: string, decl: SendLimitDecl): string[] {
  const lines: string[] = [
    'if p_type is null or p_type <> all (v_types) then',
    `    raise exception ${sqlLiteral(SEND_LIMIT_WORDS.outsideTypes(fn))}, p_type;`,
    'end if;',
  ];
  for (const key of decl.keys) {
    if (key.blocked === undefined) continue;
    const values = key.blocked.values.map((value) => sqlLiteral(value)).join(', ');
    lines.push(
      `if exists (select 1 from public.${key.blocked.table} b where b.id = p_${key.name} and b.${key.blocked.column} in (${values})) then`,
      ...refusal(decl.event, sqlLiteral(key.blocked.word), null, '    '),
      'end if;',
    );
  }
  for (const key of decl.keys) {
    if (key.unit === undefined) continue;
    lines.push(`${unitVariable(key)} := ${sendLimitUnitExpression(key.unit, `p_${key.name}`)};`);
  }
  for (const lock of sendLimitLockKeys(fn, decl)) {
    const key = decl.keys.find((candidate) => candidate.name === lock.key);
    lines.push(`perform pg_advisory_xact_lock(hashtext(${sqlLiteral(lock.prefix)} || ${key === undefined ? `p_${lock.key}` : scopeValue(key)}::text));`);
  }
  for (const limit of decl.limits) {
    const per = sqlLiteral(limit.per);
    const key = decl.keys.find((candidate) => candidate.name === limit.key);
    lines.push(
      `-- ${sqlCommentText(limit.word)}: ${limit.key} ごとに ${String(limit.max)} 本 / ${sqlCommentText(limit.per)}`,
      `select count(*), (array_agg(j.created_at order by j.created_at desc))[${String(limit.max)}]`,
      'into v_count, v_nth',
      `from public.${SEND_LIMIT_JOBS_TABLE} j`,
      'where j.type = any (v_types)',
      `  and ${key === undefined ? `j.payload ->> ${sqlLiteral(limit.key)} = p_${limit.key}::text` : scopeCondition(key)}`,
      `  and j.created_at > now() - interval ${per};`,
      `if v_count >= ${String(limit.max)} then`,
      `    v_word := coalesce(v_word, ${sqlLiteral(limit.word)});`,
      `    v_retry := greatest(v_retry, v_nth + interval ${per});`,
      'end if;',
    );
  }
  const payload = [...decl.keys.map((key) => key.name), ...decl.payload].map((field) => `${sqlLiteral(field)}, p_${field}`).join(', ');
  lines.push(
    'if v_word is not null then',
    ...refusal(decl.event, 'v_word', RETRY_AT('v_retry'), '    '),
    'end if;',
    'v_job_id := gen_random_uuid();',
    `insert into public.${SEND_LIMIT_JOBS_TABLE} (id, type, payload, idempotency_key)`,
    `values (v_job_id, p_type, jsonb_build_object(${payload}), p_type || ':' || v_job_id::text);`,
    'return v_job_id;',
  );
  return lines;
}

/** 本文(plpgsql。`$$` の内側)。data-table-parity の md5 の対象(`prosrc`)と同じ字面。 */
export function sendLimitBody(fn: string, decl: SendLimitDecl): string {
  const types = decl.types.map((type) => sqlLiteral(type)).join(', ');
  return [
    '',
    'declare',
    `    v_types constant text[] := array[${types}];`,
    '    v_count integer;',
    '    v_nth timestamptz;',
    '    v_word text;',
    '    v_retry timestamptz;',
    '    v_job_id uuid;',
    ...decl.keys.flatMap((key) => (key.unit === undefined ? [] : [`    ${unitVariable(key)} uuid;`])),
    'begin',
    ...steps(fn, decl).map((line) => `    ${line}`),
    'end;',
    '',
  ].join('\n');
}

/** migration の入力。 */
export interface SendLimitMigrationInput {
  readonly fn: DataFunctionDecl;
  readonly decl: SendLimitDecl;
  /** この SQL の正になる仕様ファイル(リポジトリルート相対)。 */
  readonly specFiles: readonly string[];
}

/**
 * 送信の上限の関数 1 本の migration を組み立てる。
 *
 * @param input 関数と宣言
 * @returns SQL 1 枚
 */
export function buildSendLimitMigration(input: SendLimitMigrationInput): string {
  const { fn, decl } = input;
  const signature = sendLimitSignature(decl);
  const identity = `public.${fn.name}(${signature.args.join(', ')})`;
  return [
    `-- ${RPC_BODY_WORDS.generatedHeader}`,
    '--',
    ...RPC_BODY_WORDS.generatedNote.map((line) => `-- ${line}`),
    ...input.specFiles.map((file) => `--   - ${sqlCommentText(file)}`),
    '--',
    ...SEND_LIMIT_WORDS.migrationNote.map((line) => `-- ${line}`),
    '',
    ...SEND_LIMIT_WORDS.steps.map((line) => `-- ${line}`),
    `create or replace function public.${fn.name}(`,
    signature.params.map((param, index) => `    ${param} ${signature.args[index] ?? ''}`).join(',\n'),
    ') returns uuid',
    'language plpgsql',
    'security definer',
    'set search_path = public',
    `as $$${sendLimitBody(fn.name, decl)}$$;`,
    '',
    `comment on function ${identity} is`,
    `    ${sqlLiteral(SEND_LIMIT_WORDS.comment(decl.event))};`,
    '',
    // 面のロールには与えない(呼ぶのは定義者の権限の RPC の本文だけ)。既定の付与は function-acl の計画が剥ぐ。
    `revoke all on function ${identity} from public;`,
    '',
  ].join('\n');
}
