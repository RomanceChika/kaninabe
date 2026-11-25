/**
 * G 群検証器のレジストリ。
 * 追加は「DesignVerifier 実装モジュールを作り、ここに 1 行足す」だけ
 * (ALL_VERIFIERS / ALL_SCREEN_VERIFIERS と同じ規約)。
 */

import type { DesignVerifier } from '../verifier.js';
import { g1RawValues } from './g1-raw-values.js';
import { g2TokenReference } from './g2-token-reference.js';
import { g3Contrast } from './g3-contrast.js';
import { g7DeadTokens } from './g7-dead-tokens.js';
import { g8Brand } from './g8-brand.js';

/** 実行される全 G 群検証器(登録順)。 */
export const ALL_DESIGN_VERIFIERS: readonly DesignVerifier[] = [
  g1RawValues,
  g2TokenReference,
  g3Contrast,
  g7DeadTokens,
  g8Brand,
];
