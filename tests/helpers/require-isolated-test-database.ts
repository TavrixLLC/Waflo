const databaseName = process.env.WAFLO_TEST_DATABASE_NAME;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseName || !/^waflo_test_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error(
    "Database-backed Vitest projects must run through scripts/run-isolated-vitest.mjs; refusing to use a shared development database.",
  );
}

if (!databaseUrl || new URL(databaseUrl).pathname.slice(1) !== databaseName) {
  throw new Error(
    "The isolated Vitest database name does not match DATABASE_URL; refusing to run database-backed tests.",
  );
}
