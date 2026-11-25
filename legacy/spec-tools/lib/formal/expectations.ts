/**
 * 宣言(`formal/expectations.json`)の読み取りと、TLC の答えとの突合(C24 の第 4 段)。
 *
 * **これは免除リストではない。** 「破れる」と書いた性質が破れなくなったときも赤にする ——
 * 実装が直ったのか反例が消えたのかを人に確かめさせるためであり、宣言を放置して緑を
 * 買うことはできない。
 *
 * 純粋関数であり throw しない(JSON の読み込みは CLI の仕事)。
 */

import type { FormalFinding, ModelExpectation, PropertyExpectation, TlcResult } from './types.js';

const CHECKS = new Set(['INVARIANT', 'PROPERTY', 'DEADLOCK']);
const VERDICTS = new Set(['holds', 'violated']);

/** 宣言の読み取り結果。 */
export interface ExpectationParseResult {
  readonly models: readonly ModelExpectation[];
  /** 形が合わなかったところ(1 件 1 文)。 */
  readonly problems: readonly string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** 性質 1 件を読む。形が合わなければ理由を返す。 */
function readProperty(model: string, raw: unknown): PropertyExpectation | string {
  const record = asRecord(raw);
  if (record === null) return `${model}: properties の要素がオブジェクトではありません`;
  const id = asText(record['id']);
  const check = asText(record['check']);
  const intent = asText(record['intent']);
  const verdict = asText(record['verdict']);
  if (id === null) return `${model}: 性質に id がありません`;
  if (check === null || !CHECKS.has(check)) return `${model} / ${id}: check は INVARIANT / PROPERTY / DEADLOCK のどれかです`;
  if (intent === null) return `${model} / ${id}: 日本語の意図(intent)がありません`;
  if (verdict === null || !VERDICTS.has(verdict)) return `${model} / ${id}: verdict は holds か violated です`;
  if (verdict === 'holds') {
    return { id, check: check as PropertyExpectation['check'], intent, verdict: 'holds' };
  }
  const reason = asText(record['reason']);
  const where = asText(record['where']);
  const remedy = asText(record['remedy']);
  if (reason === null || where === null || remedy === null) {
    return `${model} / ${id}: violated には reason(なぜ破れるか)・where(実装のファイル:行)・remedy(対処)の 3 つが要ります`;
  }
  return { id, check: check as PropertyExpectation['check'], intent, verdict: 'violated', reason, where, remedy };
}

/**
 * `formal/expectations.json` を読む。
 *
 * @param raw JSON.parse の結果
 * @returns 読めたモデルの並びと、形が合わなかった箇所
 */
export function parseExpectations(raw: unknown): ExpectationParseResult {
  const root = asRecord(raw);
  if (root === null) return { models: [], problems: ['expectations.json の中身がオブジェクトではありません'] };
  const list = root['models'];
  if (!Array.isArray(list)) return { models: [], problems: ['expectations.json に models の配列がありません'] };
  const models: ModelExpectation[] = [];
  const problems: string[] = [];
  for (const entry of list) {
    const record = asRecord(entry);
    const model = record === null ? null : asText(record['model']);
    if (record === null || model === null) {
      problems.push('models の要素に model(モジュール名)がありません');
      continue;
    }
    const cfg = asText(record['cfg']) ?? `${model}.cfg`;
    const premise = asText(record['premise']);
    if (premise === null) {
      problems.push(`${model} / ${cfg}: premise(この定数の組が置いている前提)がありません`);
      continue;
    }
    const rawProperties = record['properties'];
    if (!Array.isArray(rawProperties) || rawProperties.length === 0) {
      problems.push(`${model} / ${cfg}: properties が空です(検証する性質を 1 つ以上宣言する)`);
      continue;
    }
    const properties: PropertyExpectation[] = [];
    for (const rawProperty of rawProperties) {
      const read = readProperty(`${model} / ${cfg}`, rawProperty);
      if (typeof read === 'string') problems.push(read);
      else properties.push(read);
    }
    models.push({ model, cfg, premise, properties });
  }
  return { models, problems };
}

/**
 * 宣言と機械の答えを突き合わせる。
 *
 * @param model モジュール名
 * @param property その性質の宣言
 * @param result TLC の答え
 * @param trace 反例を人の言葉にした行(違反のときだけ渡す)
 * @returns 食い違い 1 件につき 1 つの Finding。一致していれば空配列
 */
export function verdictFindings(
  model: string,
  property: PropertyExpectation,
  result: TlcResult,
  trace: readonly string[],
): FormalFinding[] {
  if (result.kind === 'timeout') {
    return [
      {
        severity: 'error',
        message: `${model} / ${property.id}: TLC が ${result.seconds} 秒で終わりませんでした`,
        location: `formal/${model.split(' / ')[0] ?? model}.tla`,
        suggestion:
          '.cfg の定数を落とすか、探索が伸びた理由(モデルに無限に増える変数が入っていないか)を' +
          '確かめる。答えが出ていないので、この実行は緑にしない',
      },
    ];
  }
  if (result.kind === 'error') {
    return [
      {
        severity: 'error',
        message: `${model} / ${property.id}: TLC が答えを返しませんでした(${result.reason})`,
        location: `formal/${model}.tla`,
        suggestion: 'モデルか .cfg の書き損じを直す。道具の不足なら check:formal の冒頭が報告する',
        detail: result.output.slice(-12),
      },
    ];
  }
  if (property.verdict === 'holds' && result.kind === 'violated') {
    return [
      {
        severity: 'error',
        message: `${model} / ${property.id}: holds と宣言した性質が破れました`,
        location: `formal/expectations.json(${model} / ${property.id})`,
        suggestion:
          '反例を読み、実装が壊れたのかモデルが実装とずれたのかを決める。実装の穴なら ' +
          'verdict を violated にして reason / where / remedy を書く',
        // 反例の先頭に意図が入っているので、ここで重ねない(`explainCounterexample`)。
        detail: trace,
      },
    ];
  }
  if (property.verdict === 'violated' && result.kind === 'holds') {
    return [
      {
        severity: 'error',
        message: `${model} / ${property.id}: violated と宣言した性質が破れませんでした(反例が消えました)`,
        location: `formal/expectations.json(${model} / ${property.id})`,
        suggestion:
          `実装が直ったなら verdict を holds にして reason / where / remedy を消す(場所: ${property.where ?? '不明'})。` +
          'モデルが弱まって反例を作れなくなっただけなら、モデルを戻す',
        detail: [`意図: ${property.intent}`, `宣言していた理由: ${property.reason ?? ''}`],
      },
    ];
  }
  return [];
}
