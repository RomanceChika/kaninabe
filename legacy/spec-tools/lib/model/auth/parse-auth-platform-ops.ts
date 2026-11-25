/**
 * auth_spec の `platform_ops`(と `shapes` / `secret_field_words`)の読み取り。
 *
 * parse-auth.ts が呼ぶ下位の部品。責務は 1 ファイルの中で閉じる形に限る —— 書けるキー・`kind` / `actor` / `args` / `binding` の形・
 * `read` だけが `returns`・`do` だけが `confirm` を持つこと・`from` が `row` だけであること。
 * 配線先の対応表(`binding` の `params` / `result`)・ポート(`platform_ports`)・返す欄の対応(`shapes`)は下位の部品が読む。
 * 宣言の閉世界(id の重複・actor のロールの実在・引数の出どころの整合・返す欄の値域と秘密語)は H9 が見る。
 * 節が無い製品は何も宣言しない(任意の節。`undefined`)。
 */

import type { SpecReporter } from '../parse-common.js';
import { asRecord } from '../parse-common.js';
import { eachRecord, YamlReader } from '../yaml-reader.js';
import type { AuthPlatformOps, PlatformActor, PlatformArg, PlatformArgType, PlatformOpDecl, PlatformOpKind } from './platform-ops.js';
import { PLATFORM_ARG_TYPES, PLATFORM_OP_ID, PLATFORM_OP_KINDS } from './platform-ops.js';
import { readEnum } from './parse-auth-shared.js';
import { readBinding } from './parse-auth-platform-binding.js';
import { parsePorts, parseSecretWords, parseShapes } from './parse-auth-platform-ports.js';

const SNAKE = /^[a-z][a-z0-9_]*$/;
const OP_KEYS: readonly string[] = ['id', 'label', 'kind', 'actor', 'args', 'returns', 'needs', 'confirm', 'binding'];

const OPS_SUGGESTION =
  'platform_ops は "- id / label / kind / actor / (args) / (returns) / (needs) / (confirm) / binding" のリストで書く' +
  '(認証基盤が持つ操作を画面から叩く閉じた一覧。設計: 設計メモ「セッションの管理の画面」)';

/**
 * `platform_ops` / `shapes` / `secret_field_words` を読む。どれも書かれていなければ undefined(節の無い製品)。
 *
 * @param root 認証フロー仕様のルート
 * @param reporter 違反の記録先
 */
export function parsePlatformOps(root: YamlReader, reporter: SpecReporter): AuthPlatformOps | undefined {
  const hasOps = root.has('platform_ops');
  if (!hasOps && !root.has('shapes') && !root.has('secret_field_words') && !root.has('platform_ports')) return undefined;
  if (!hasOps) {
    reporter.error(root.pointer('platform_ops'), 'shapes / secret_field_words / platform_ports を書いたのに platform_ops がありません', OPS_SUGGESTION);
    reporter.dropRows();
    return undefined;
  }
  const items = root.requiredList('platform_ops', OPS_SUGGESTION) ?? [];
  const ops: PlatformOpDecl[] = [];
  eachRecord(items, 'platform_ops', reporter, OPS_SUGGESTION, (item, index) => {
    const decl = buildOp(item, `platform_ops[${index}]`, reporter);
    if (decl !== null) ops.push(decl);
  });
  reporter.settleRows(items.length, ops.length);
  const shapes = parseShapes(root, reporter);
  const ports = parsePorts(root, reporter);
  const secretWords = parseSecretWords(root, shapes.length > 0, reporter);
  return { ops, shapes, ports, secretWords, location: reporter.location('platform_ops') };
}

/** 操作 1 件を読む。 */
function buildOp(item: YamlReader, at: string, reporter: SpecReporter): PlatformOpDecl | null {
  item.rejectUnknownKeys(OP_KEYS, 'platform_ops の要素', `書けるのは ${OP_KEYS.join(' / ')} だけ`);
  const id = item.requiredString('id', 'id に "{グループ}.{名前}"(例: session.end_mine)を書く');
  const label = item.requiredString('label', 'label に操作の表示名を書く');
  const kind = readEnum<PlatformOpKind>(item, 'kind', PLATFORM_OP_KINDS, reporter, true);
  const actor = readActor(item, reporter);
  const args = readArgs(item, at, reporter);
  const binding = readBinding(item, reporter);
  if (id === null || label === null || kind == null || actor === null || args === null || binding === null) return null;
  if (!PLATFORM_OP_ID.test(id)) {
    reporter.error(item.pointer('id'), `操作 ${id} の id が "{グループ}.{名前}"(スネークケースの 2 段)ではありません`, 'session.end_mine のように 2 段で書く(画面の platform_op.{id}.success の id になる)', { id });
    return null;
  }
  const shape = readShapeRules(item, id, kind, reporter);
  if (shape === null) return null;
  const needs = readNeeds(item, reporter);
  if (needs === null) return null;
  return {
    id,
    label,
    kind,
    actor,
    args,
    ...(shape.returns === undefined ? {} : { returns: shape.returns }),
    needsCurrentSession: needs,
    ...(shape.confirm === undefined ? {} : { confirm: shape.confirm }),
    binding,
    location: reporter.location(at),
  };
}

/** `read` だけが `returns`(必須)、`do` だけが `confirm`(必須)を持つ。 */
function readShapeRules(item: YamlReader, id: string, kind: PlatformOpKind, reporter: SpecReporter): { returns?: string; confirm?: boolean } | null {
  if (kind === 'read') {
    const returns = item.requiredString('returns', 'returns に返す欄の集合の名前(shapes のキー)を書く(read は返す欄を宣言する)');
    if (item.has('confirm')) {
      reporter.error(item.pointer('confirm'), `読み ${id} は confirm を持てません`, '確認が要るのは状態を変える操作(kind: do)だけ。confirm を消す', { op: id });
      return null;
    }
    return returns === null ? null : { returns };
  }
  if (item.has('returns')) {
    reporter.error(item.pointer('returns'), `操作 ${id} は kind: do なのに returns を持っています`, 'returns を消す(返す欄を宣言するのは kind: read だけ)', { op: id });
    return null;
  }
  const confirm = item.requiredBoolean('confirm', 'confirm に true / false を書く(取り消せない・影響が広い操作は true。書かないと確認の要否が読めない)');
  return confirm === null ? null : { confirm };
}

/** `needs`(任意。値は current_session だけ)。 */
function readNeeds(item: YamlReader, reporter: SpecReporter): boolean | null {
  if (!item.has('needs')) return false;
  const value = item.requiredString('needs', 'needs は current_session だけ');
  if (value === null) return null;
  if (value !== 'current_session') {
    reporter.error(item.pointer('needs'), `needs ${value} は宣言できる語ではありません`, 'needs に書けるのは current_session(いまの端末が不明なら拒む)だけ', { needs: value });
    return null;
  }
  return true;
}

/** `actor`(`{ self: true }` か `{ role, active_member? }`)。 */
function readActor(item: YamlReader, reporter: SpecReporter): PlatformActor | null {
  const suggestion = 'actor は { self: true }(本人)か { role: ロール ID, active_member: true/false }(ロール)で書く';
  const record = asRecord(item.raw('actor'));
  if (record === null) {
    reporter.error(item.pointer('actor'), item.has('actor') ? 'actor はマッピングで書きます' : 'actor がありません', suggestion);
    reporter.dropRows();
    return null;
  }
  const reader = new YamlReader(record, item.pointer('actor'), reporter);
  if (reader.has('self')) {
    reader.rejectUnknownKeys(['self'], 'actor(本人)', 'self と role は同時に書けない。本人なら { self: true } だけを書く');
    if (reader.raw('self') !== true) {
      reporter.error(reader.pointer('self'), 'actor.self は true だけ書けます', suggestion);
      return null;
    }
    return { kind: 'self' };
  }
  reader.rejectUnknownKeys(['role', 'active_member'], 'actor(ロール)', suggestion);
  const role = reader.requiredString('role', suggestion);
  const activeMember = reader.has('active_member') ? reader.requiredBoolean('active_member', suggestion) : false;
  return role === null || activeMember === null ? null : { kind: 'role', role, activeMember };
}

/** `args`(任意)。出どころは `from: row` か型つきの自由入力。`from` の他の種類は書けない。 */
function readArgs(item: YamlReader, at: string, reporter: SpecReporter): readonly PlatformArg[] | null {
  if (!item.has('args')) return [];
  const record = asRecord(item.raw('args'));
  const suggestion = 'args は "{引数名}: { from: row, of: {読みの id}, field: {欄} }" か "{引数名}: { type: bool|int|string, default: … }" のマッピングで書く';
  if (record === null) {
    reporter.error(item.pointer('args'), 'args はマッピングで書きます', suggestion);
    reporter.dropRows();
    return null;
  }
  const args: PlatformArg[] = [];
  let ok = true;
  for (const [name, raw] of Object.entries(record)) {
    const arg = readArg(name, raw, `${at}.args.${name}`, suggestion, reporter);
    if (arg === null) ok = false;
    else args.push(arg);
  }
  return ok ? args : null;
}

/** 引数 1 つ。 */
function readArg(name: string, raw: unknown, at: string, suggestion: string, reporter: SpecReporter): PlatformArg | null {
  const record = asRecord(raw);
  if (record === null || !SNAKE.test(name)) {
    reporter.error(at, record === null ? `${at} はマッピングで書きます` : `引数名 ${name} がスネークケースではありません`, suggestion, { arg: name });
    reporter.dropRows();
    return null;
  }
  const reader = new YamlReader(record, at, reporter);
  const location = reporter.location(at);
  if (reader.has('from')) {
    reader.rejectUnknownKeys(['from', 'of', 'field', 'skip_if', 'format'], `引数 ${name}`, suggestion);
    if (reader.raw('from') !== 'row') {
      reporter.error(reader.pointer('from'), `引数 ${name} の from ${String(reader.raw('from'))} は書けません`, 'from に書けるのは row(一覧の行の欄)だけ。識別子を自由入力にしない', { arg: name });
      reporter.dropRows();
      return null;
    }
    const of = reader.requiredString('of', suggestion);
    const field = reader.requiredString('field', suggestion);
    const skipIf = reader.optionalString('skip_if', 'skip_if には、出どころの行の真偽値の欄の名前を書く(その欄が true の行にはボタンを出さない)');
    const format = reader.optionalString('format', 'format は uuid だけ(配線先が UUID の形を要求する識別子)');
    if (format !== undefined && format !== 'uuid') {
      reporter.error(reader.pointer('format'), `引数 ${name} の format ${format} は書けません`, 'format に書けるのは uuid だけ', { arg: name });
      return null;
    }
    return of === null || field === null ? null : { kind: 'row', name, of, field, ...(format === undefined ? {} : { format }), ...(skipIf === undefined ? {} : { skipIf }), location };
  }
  reader.rejectUnknownKeys(['type', 'default'], `引数 ${name}`, suggestion);
  const type = readEnum<PlatformArgType>(reader, 'type', PLATFORM_ARG_TYPES, reporter, true);
  if (type == null) return null;
  if (!reader.has('default')) return { kind: 'typed', name, type, location };
  const value = reader.raw('default');
  const matches = (type === 'bool' && typeof value === 'boolean') || (type === 'int' && typeof value === 'number' && Number.isInteger(value)) || (type === 'string' && typeof value === 'string');
  if (!matches) {
    reporter.error(reader.pointer('default'), `引数 ${name} の default が型 ${type} と合いません`, `default は type(${type})の値で書く`, { arg: name });
    return null;
  }
  return { kind: 'typed', name, type, default: value as boolean | number | string, location };
}
