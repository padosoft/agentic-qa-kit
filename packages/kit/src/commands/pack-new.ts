// `runPackNew` lives in @aqa/pack-author (extracted in v1.9 to break the
// @aqa/kit ↔ @aqa/server build cycle: server's POST /api/packs/scaffold
// needs the same scaffolding logic and used to import it from @aqa/kit,
// which forbade kit from depending on @aqa/server). This file is a
// re-export so existing in-kit imports (CLI, tests) keep working.
export {
  runPackNew,
  type PackNewErrorCode,
  type PackNewOptions,
  type PackNewResult,
} from '@aqa/pack-author';
