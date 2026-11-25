/**
 * R16 **持っていれば効く値(`bearer`)の取り扱い**(危ない形の群。規則の正は enforcement-matrix の C32)。
 *
 * 招待コード・使い捨てのリンクの鍵のように、持っているだけで権能が手に入る値は、①推測されない強さで作り ②URL に載せず ③寿命を宣言する
 * (ASVS V11.5.1・V14.2.1・V6.4.1)。`bearer` を宣言した欄について、次を見る。
 *
 * | 止める形 | 直し方 |
 * |---|---|
 * | 寿命の宣言が名指す欄(`expires_at` / `used_at`)が同じ集約の `datetime` として実在しない・同じ欄を指している | 実在する別々の `datetime` の欄を名指す(欄が無ければ足す) |
 * | data_table の `defaults` がその欄の CSPRNG の式(32 バイトの `gen_random_bytes` を base64url にしたもの)でない・`defaults` が無い(UUID を使っていれば止まる) | `defaults` に `kernel/bearer.ts` の式を書く(拡張は `create extension if not exists pgcrypto with schema extensions`) |
 * | 表の関数がその欄の値を引数で受ける(`p_{欄}` / `p_new_{欄}`) | 引数を外す。値は列の既定値だけが作る(呼び出し側が渡せる口を閉じる) |
 * | 画面の `route` の動的セグメントが `bearer` の欄の名前(`:{欄}` / `:{集約}_{欄}`) | URL のパスに載せない。POST の本文で渡すか、URL のフラグメント(`#…`。サーバーにもログにも Referer にも届かない)で運ぶ |
 *
 * `reusable: 理由` は**受け入れた危険**として毎回 warning で名指す(区分は宣言の側が持つ。`Finding.acceptance`)。
 * 読むのは欄の宣言・表の `defaults` と関数の引数・画面の route だけで、**アプリの語彙は 1 語も持たない**。純関数であり throw しない。
 * ログに出さないことは、構造化ログの欄が閉じている(K5 / logging.md)ので別に見ない。
 */

import { BEARER_DEFAULT_SQL, isBearerDefault } from '../../kernel/bearer.js';
import { makeFinding, type AcceptedRiskDecl, type Finding } from '../../kernel/finding.js';
import type { DataTableSpec } from '../../model/data/types.js';
import { dynamicParams } from '../../model/screen/route-syntax.js';
import type { SourceLocation } from '../../kernel/source-location.js';
import type { EntitySpec, FieldDef, SpecModel } from '../../model/types.js';

/** この検証器の ID。 */
export const VERIFIER_ID = 'R16';

/** 画面の route(動的セグメントを見る)。 */
export interface BearerScreenRoute {
  readonly id: string;
  readonly route: string;
  readonly location: SourceLocation;
}

/** R16 の入力。 */
export interface BearerInput {
  /** ドメイン仕様全体。 */
  readonly model: SpecModel;
  /** テーブル仕様(読めたとき。無ければ `defaults` と引数は見ない)。 */
  readonly tables: readonly DataTableSpec[] | null;
  /** 画面の route(読めたとき。無ければ見ない)。 */
  readonly screens: readonly BearerScreenRoute[] | null;
}

/** `bearer` を宣言した欄 1 つ。 */
interface BearerField {
  readonly entity: EntitySpec;
  readonly field: FieldDef;
}

/** `bearer` を宣言した欄の全数。 */
function bearerFields(model: SpecModel): BearerField[] {
  return [...model.aggregates.values()].flatMap((specs) =>
    specs.entity === undefined ? [] : specs.entity.fields.filter((field) => field.bearer !== undefined).map((field) => ({ entity: specs.entity as EntitySpec, field })),
  );
}

/** `{集約}.{欄}`。 */
function placeOf({ entity, field }: BearerField): string {
  return `${entity.entity}.${field.name}`;
}

/** 寿命の宣言が名指す欄の実在と型。 */
function lifetimeFindings(target: BearerField): Finding[] {
  const decl = target.field.bearer;
  if (decl?.kind !== 'expiring') return [];
  const place = placeOf(target);
  const named = [
    { key: 'expires_at', name: decl.expiresAt },
    { key: 'used_at', name: decl.usedAt },
  ];
  const findings = named.flatMap(({ key, name }) => {
    const found = target.entity.fields.find((candidate) => candidate.name === name);
    if (found === undefined) {
      return [
        makeFinding(VERIFIER_ID, {
          message: `${place} の bearer.${key} が名指す欄 ${name} は ${target.entity.entity} に実在しません`,
          location: decl.location,
          suggestion: `${target.entity.entity} に ${name}(type: datetime)を足すか、実在する datetime の欄の名前に直す`,
          counterexample: { entity: target.entity.entity, field: target.field.name, key, named: name },
        }),
      ];
    }
    if (found.type.kind !== 'datetime') {
      return [
        makeFinding(VERIFIER_ID, {
          message: `${place} の bearer.${key} が名指す欄 ${name} は datetime ではありません(${found.type.kind} です)`,
          location: decl.location,
          suggestion: `${key} には時刻を持つ type: datetime の欄を名指す`,
          counterexample: { entity: target.entity.entity, field: target.field.name, key, named: name, type: found.type.kind },
        }),
      ];
    }
    return [];
  });
  if (decl.expiresAt !== decl.usedAt) return findings;
  return [
    ...findings,
    makeFinding(VERIFIER_ID, {
      message: `${place} の bearer の expires_at と used_at が同じ欄 ${decl.expiresAt} です(失効の時刻と使った時刻は別の事実です)`,
      location: decl.location,
      suggestion: '失効の時刻と使った時刻を別々の datetime の欄にする',
      counterexample: { entity: target.entity.entity, field: target.field.name, named: decl.expiresAt },
    }),
  ];
}

/** 使い回しを受け入れる宣言の警告(受け入れた危険)。 */
function reusableFindings(target: BearerField): Finding[] {
  const decl = target.field.bearer;
  if (decl?.kind !== 'reusable') return [];
  return [
    {
      verifier: VERIFIER_ID,
      severity: 'warning',
      message: `${placeOf(target)} は持っていれば効く値ですが、使い回しを受け入れています(理由: ${decl.reason})。値が漏れれば、止める(失効させる)まで誰でも使えます`,
      location: decl.location,
      suggestion: 'この理由が今も成り立つかを確かめる。成り立たなくなったら reusable を消し、expires_at と used_at(datetime の欄)で短期の失効と使い切りを宣言する',
      counterexample: { entity: target.entity.entity, field: target.field.name, reusable: decl.reason },
      acceptance: { reason: decl.reason, location: decl.location },
    },
  ];
}

/** 列の既定値(CSPRNG の式)と、値を渡す口が閉じていること。 */
function mechanismFindings(target: BearerField, tables: readonly DataTableSpec[]): Finding[] {
  const table = tables.find((candidate) => candidate.entity === target.entity.entity);
  if (table === undefined) return [];
  const place = placeOf(target);
  const findings: Finding[] = [];
  const expression = table.defaults[target.field.name];
  if (expression === undefined || !isBearerDefault(expression)) {
    findings.push(
      makeFinding(VERIFIER_ID, {
        message:
          expression === undefined
            ? `${place} は bearer ですが、${table.table} の defaults に値の作り方がありません`
            : `${place} は bearer ですが、${table.table} の defaults の式が CSPRNG の 32 バイトではありません(${expression})`,
        location: target.field.location,
        suggestion:
          `${table.table} の defaults に ${target.field.name}: "${BEARER_DEFAULT_SQL}" を書く(UUID は 122 ビットで ASVS V11.5.1 が不可とする。` +
          '拡張は create extension if not exists pgcrypto with schema extensions)',
        counterexample: { entity: target.entity.entity, field: target.field.name, table: table.table },
      }),
    );
  }
  const spellings = new Set([`p_${target.field.name}`, `p_new_${target.field.name}`]);
  for (const fn of table.functions) {
    const leak = fn.params.find((param) => spellings.has(param));
    if (leak === undefined) continue;
    findings.push(
      makeFinding(VERIFIER_ID, {
        message: `${place} は bearer ですが、${fn.name} が値を引数 ${leak} で受けています(呼び出し側の乱数に頼る口が開いています)`,
        location: target.field.location,
        suggestion: `${fn.name} から ${leak} を外す migration を足し、関数は列の既定値が作った値を使う。data_table の functions の args / params も同じ形に直す`,
        counterexample: { entity: target.entity.entity, field: target.field.name, function: fn.name, param: leak },
      }),
    );
  }
  return findings;
}

/** 画面の route に載る動的セグメントが bearer の欄を名指していないこと。 */
function routeFindings(targets: readonly BearerField[], screens: readonly BearerScreenRoute[]): Finding[] {
  return screens.flatMap((screen) =>
    dynamicParams(screen.route).flatMap((param) => {
      const hit = targets.find(({ entity, field }) => param === field.name || param === `${entity.entity}_${field.name}`);
      if (hit === undefined) return [];
      return [
        makeFinding(VERIFIER_ID, {
          message: `画面 ${screen.id} の route ${screen.route} が bearer の欄 ${placeOf(hit)} を URL のパス(:${param})に載せています(履歴・アクセスログ・Referer・共有されたリンクに残ります)`,
          location: screen.location,
          suggestion:
            'route から動的セグメントを外す。値は POST の本文で受けるか、URL のフラグメント(`/path#値`)で運ぶ(フラグメントはサーバーにも Referer にも届かない。' +
            'ページが読んで POST で送る)',
          counterexample: { screen: screen.id, route: screen.route, param, field: placeOf(hit) },
        }),
      ];
    }),
  );
}

/**
 * R16: `bearer` の欄の取り扱いを見る。
 *
 * @param input 仕様モデルと、テーブル仕様・画面の route(読めたときだけ)
 * @returns 違反と、受け入れた危険の警告(無ければ空)
 */
export function verifyBearer(input: BearerInput): Finding[] {
  const targets = bearerFields(input.model);
  return [
    ...targets.flatMap((target) => [
      ...lifetimeFindings(target),
      ...reusableFindings(target),
      ...(input.tables === null ? [] : mechanismFindings(target, input.tables)),
    ]),
    ...(input.screens === null ? [] : routeFindings(targets, input.screens)),
  ];
}

/**
 * 宣言した「使い回しを受け入れる」を、受け入れた危険の宣言として取り出す(組み立ての根が W5 へ渡す。警告の `acceptance` と同じもの)。
 *
 * @param model ドメイン仕様全体
 * @returns 受け入れた危険の宣言
 */
export function bearerAcceptances(model: SpecModel): readonly AcceptedRiskDecl[] {
  return bearerFields(model).flatMap(({ field }) => (field.bearer?.kind === 'reusable' ? [{ reason: field.bearer.reason, location: field.bearer.location }] : []));
}
