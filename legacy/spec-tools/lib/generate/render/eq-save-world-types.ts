/**
 * 一致の証明の設計図の型の**再輸出**のうち、**保存点**の節(束 ①-d 手 2)。
 *
 * **形の正はハーネスが 1 か所で持つ**(`@kaninabe/runtime/testing/save/types`)—— 値はこの生成物が
 * 書き出し、形はパッケージから再輸出する(単発の操作の節と同じ理由。設計メモ §9-12)。
 */

import { RUNTIME_TESTING_SAVE_TYPES_MODULE } from './runtime-modules.js';

/** 保存点の節の型の再輸出。 */
export const EQ_SAVE_TYPES: readonly string[] = [
  'export type {',
  '  EqSaveActor,',
  '  EqSaveCaller,',
  '  EqSaveCleanup,',
  '  EqSaveGrid,',
  '  EqSaveInput,',
  '  EqSaveStep,',
  '  EqSaveWorld,',
  `} from '${RUNTIME_TESTING_SAVE_TYPES_MODULE}';`,
];
