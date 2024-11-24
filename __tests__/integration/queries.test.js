// @ts-check
const { printSchema } = require("postgraphile/graphql");
const { withPgClient, makePreset } = require("../helpers.js");
const { makeSchema } = require("postgraphile");
const { grafast, isAsyncIterable } = require("postgraphile/grafast");
const { readdirSync } = require("fs");
const { readFile } = require("fs/promises");
const { resolve: resolvePath } = require("path");
const debug = require("debug")("graphile-build:schema");

const queriesDir = `${__dirname}/../fixtures/queries`;
const queryFileNames = readdirSync(queriesDir);
let queryResults = [];

const kitchenSinkData = () => readFile(`${__dirname}/../p-data.sql`, "utf8");

beforeAll(() => {
  // Get a few GraphQL schema instance that we can query.
  const gqlSchemasPromise = (async () => {
    // Different fixtures need different schemas with different configurations.
    // Make all of the different schemas with different configurations that we
    // need and wait for them to be created in parallel.
    const [normal, columnAggregates] = await Promise.all([
      makeSchema(makePreset(["p"], {})),
      makeSchema(
        makePreset(["p"], {
          graphileBuildOptions: {
            orderByRelatedColumnAggregates: true,
          },
        })
      ),
    ]);
    debug(printSchema(normal.schema));
    return {
      normal,
      columnAggregates,
    };
  })();

  // Execute all of the queries in parallel. We will not wait for them to
  // resolve or reject. The tests will do that.
  //
  // All of our queries share a single client instance.
  const queryResultsPromise = (async () => {
    // Wait for the schema to resolve. We need the schema to be introspected
    // before we can do anything else!
    const gqlSchemas = await gqlSchemasPromise;
    // Get a new Postgres client instance.
    return await withPgClient(async (pgClient) => {
      // Add data to the client instance we are using.
      await pgClient.query(await kitchenSinkData());
      // Run all of our queries in parallel.
      return await Promise.all(
        queryFileNames.map(async (fileName) => {
          // Read the query from the file system.
          const source = await readFile(
            resolvePath(queriesDir, fileName),
            "utf8"
          );
          // Get the appropriate GraphQL schema for this fixture. We want to test
          // some specific fixtures against a schema configured slightly
          // differently.
          const schemas = {
            "columnAggregates.graphql": gqlSchemas.columnAggregates,
          };
          const { schema, resolvedPreset } =
            schemas[fileName] ?? gqlSchemas.normal;
          // Return the result of our GraphQL query.
          const result = await grafast({
            schema,
            source,
            resolvedPreset,
            requestContext: {},
          });
          if (isAsyncIterable(result)) {
            throw new Error(`Didn't expect an async iterable`);
          }
          if (result.errors) {
            console.log(result.errors.map((e) => e.originalError ?? e));
          }
          return result;
        })
      );
    });
  })();

  // Flatten out the query results promise.
  queryResults = queryFileNames.map(
    async (_, i) => (await queryResultsPromise)[i]
  );
});

for (let i = 0; i < queryFileNames.length; i++) {
  // eslint-disable-next-line jest/valid-title
  test(queryFileNames[i], async () => {
    expect(await queryResults[i]).toMatchSnapshot();
  });
}
