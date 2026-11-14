import { SEED_ENTRY_COUNT } from "../packages/db/src/seed-data";

/** Number of entries `pnpm db:setup` writes, so specs follow the seed instead of a hardcoded count. */
export { SEED_ENTRY_COUNT };
export const SEED_COUNT_LABEL = `${SEED_ENTRY_COUNT} in view`;
