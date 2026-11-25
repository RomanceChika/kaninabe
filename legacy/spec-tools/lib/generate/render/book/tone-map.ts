/**
 * 状態 → 意味色(バッジの語彙)の対応を、実装(state-badge.tsx)から読み取る純粋モジュール。
 *
 * この対応は「受理は良い知らせ・中止は悪い知らせ」という**見せ方の判断**であり、仕様に
 * 置き場が無い(state-badge.tsx の標識コメントが正)。ハンドブックのパーツ見本が
 * 全状態のバッジを実物の色で並べるには、この判断をどこかから引く必要がある —
 * 生成器が対応表を持つと実装と二重管理になるため、**実装のソースを写す**。
 *
 * 読み取るのは `const {NAME}_TONE = { … } as const satisfies Record<keyof typeof
 * {machine}StateLabels, Tone>` の定型だけである。定型が崩れて読めなかった状態機械は
 * 対応なし(空)として返り、見本側は実装と同じフォールバック(neutral)で描く。
 */

/** バッジの意味色の語彙(トークン仕様の badge 4 種)。 */
export type BadgeTone = 'info' | 'positive' | 'neutral' | 'critical';

/** 値域。 */
const TONES: readonly BadgeTone[] = ['info', 'positive', 'neutral', 'critical'];

/**
 * state-badge.tsx のソースから、状態機械ごとの「状態 → 語彙」を読み取る。
 *
 * @param source `app/src/app/_components/state-badge.tsx` の中身
 * @returns 状態機械名(snake_case) → { 状態: 語彙 }
 */
export function parseToneMap(source: string): Map<string, Readonly<Record<string, BadgeTone>>> {
  const found = new Map<string, Readonly<Record<string, BadgeTone>>>();
  const pattern =
    /const\s+\w+_TONE\s*=\s*\{([^}]*)\}\s*as const satisfies Record<keyof typeof (\w+)StateLabels/g;
  for (const match of source.matchAll(pattern)) {
    const body = match[1];
    const labelsName = match[2];
    if (body === undefined || labelsName === undefined) continue;
    const entries: Record<string, BadgeTone> = {};
    for (const entry of body.matchAll(/([a-z0-9_]+)\s*:\s*'([a-z]+)'/g)) {
      const state = entry[1];
      const tone = entry[2];
      if (state === undefined || !isTone(tone)) continue;
      entries[state] = tone;
    }
    found.set(toSnakeCase(labelsName), entries);
  }
  return found;
}

/** 文字列が値域に入っているか。 */
function isTone(value: string | undefined): value is BadgeTone {
  return value !== undefined && (TONES as readonly string[]).includes(value);
}

/** camelCase → snake_case(生成物の命名 `{machine}StateLabels` を仕様の機械名へ戻す)。 */
function toSnakeCase(camel: string): string {
  return camel.replace(/([A-Z])/g, (letter) => `_${letter.toLowerCase()}`);
}
