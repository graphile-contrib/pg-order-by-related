// @ts-check
const {
  makePgService,
  makeWithPgClientViaPgClientAlreadyInTransaction,
} = require("postgraphile/adaptors/pg");
const pg = require("pg");
const { readFile } = require("fs/promises");
const { default: PgOrderByRelatedPlugin } = require("../dist/index.js");
const { makeV4Preset } = require("postgraphile/presets/v4");

const connectionString =
  process.env.TEST_DATABASE_URL || "postgres:///pg_order_by_related";

let pool;
beforeAll(() => {
  pool = new pg.Pool({ connectionString });
  pool.on("error", () => {});
  pool.on("connect", (client) => client.on("error", () => {}));
});

afterAll(() => {
  pool?.end();
});

/** @type {GraphileConfig.Plugin} */
const ShoveClientIntoContextPlugin = {
  name: "ShoveClientIntoContextPlugin",

  grafast: {
    middleware: {
      prepareArgs(next, event) {
        const pgClient = event.args.contextValue.pgClient;
        if (pgClient) {
          event.args.contextValue.withPgClient =
            makeWithPgClientViaPgClientAlreadyInTransaction(pgClient, true);
        }
        return next();
      },
    },
  },
};

/** @type {(schemas: string[], options: import("postgraphile/presets/v4").V4Options) => GraphileConfig.Preset} */
const makePreset = (schemas, options) => ({
  extends: [makeV4Preset(options)],
  plugins: [PgOrderByRelatedPlugin, ShoveClientIntoContextPlugin],
  pgServices: [
    makePgService({
      pool,
      schemas,
    }),
  ],
});

// This test suite can be flaky. Increase it’s timeout.
jest.setTimeout(1000 * 20);

/** @type {<T>(url: string, fn: (client: import("pg").PoolClient) => Promise<T> | T) => Promise<T>} */
const withPgClientForUrl = async (url, fn) => {
  const pgPool = new pg.Pool({ connectionString: url });
  let client;
  try {
    client = await pgPool.connect();
    await client.query("begin");
    await client.query("set local timezone to '+04:00'");
    const result = await fn(client);
    await client.query("rollback");
    return result;
  } finally {
    try {
      await client.release();
    } catch (e) {
      console.error("Error releasing pgClient", e); // eslint-disable-line no-console
    }
    await pgPool.end();
  }
};

/** @type {<T>(fn: (client: import("pg").PoolClient) => Promise<T> | T) => Promise<T>} */
const withPgClient = async (fn) => withPgClientForUrl(connectionString, fn);

/** @type {<T>(url: string, fn: (client: import("pg").PoolClient) => Promise<T> | T) => Promise<T>} */
const withDbFromUrl = async (url, fn) => {
  return withPgClientForUrl(url, async (client) => {
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE;");
      return fn(client);
    } finally {
      await client.query("COMMIT;");
    }
  });
};

/** @type {<T>(fn: (client: import("pg").PoolClient) => Promise<T> | T) => Promise<T>} */
const withRootDb = (fn) => withDbFromUrl(connectionString, fn);

/** @type {(Promise<void> & {resolve: () => void, reject: () => void, client: import('pg').PoolClient, vars: any}) | null} */
let prepopulatedDBKeepalive = null;

/** @type {(client: import("pg").PoolClient) => Promise<{}>} */
const populateDatabase = async (client) => {
  await client.query(await readFile(`${__dirname}/p-data.sql`, "utf8"));
  return {};
};

/** @type {{(fn: (client: import("pg").PoolClient, vars: any) => Promise<void>): Promise<void>, setup: (fn: (e?: Error) => void) => Promise<void>, teardown(): void}} */
const withPrepopulatedDb = async (fn) => {
  if (!prepopulatedDBKeepalive) {
    throw new Error("You must call setup and teardown to use this");
  }
  const { client, vars } = prepopulatedDBKeepalive;
  if (!vars) {
    throw new Error("No prepopulated vars");
  }
  let err;
  try {
    await fn(client, vars);
  } catch (e) {
    err = e;
  }
  try {
    await client.query("ROLLBACK TO SAVEPOINT pristine;");
  } catch (e) {
    err = err || e;
    console.error("ERROR ROLLING BACK", /** @type{any} */ (e)?.message); // eslint-disable-line no-console
  }
  if (err) {
    throw err;
  }
};

withPrepopulatedDb.setup = (done) => {
  if (prepopulatedDBKeepalive) {
    throw new Error("There's already a prepopulated DB running");
  }
  let res;
  let rej;
  return withRootDb(async (client) => {
    prepopulatedDBKeepalive = Object.assign(
      new Promise((resolve, reject) => {
        res = resolve;
        rej = reject;
      }),
      { resolve: res, reject: rej, client, vars: undefined }
    );
    try {
      prepopulatedDBKeepalive.vars = await populateDatabase(client);
    } catch (err) {
      const e = /** @type {Error} */ (err);
      console.error("FAILED TO PREPOPULATE DB!", e.message); // eslint-disable-line no-console
      return done(e);
    }
    await client.query("SAVEPOINT pristine;");
    done();
    return prepopulatedDBKeepalive;
  });
};

withPrepopulatedDb.teardown = () => {
  if (!prepopulatedDBKeepalive) {
    throw new Error("Cannot tear down null!");
  }
  prepopulatedDBKeepalive.resolve(); // Release DB transaction
  prepopulatedDBKeepalive = null;
};

exports.withRootDb = withRootDb;
exports.withPrepopulatedDb = withPrepopulatedDb;
exports.withPgClient = withPgClient;
exports.makePreset = makePreset;
