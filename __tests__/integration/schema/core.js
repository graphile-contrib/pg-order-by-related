// @ts-check
const { withPgClient, makePreset } = require("../../helpers");
const { makeSchema } = require("postgraphile");
const {
  GraphQLSchema,
  lexicographicSortSchema,
  printSchema,
} = require("postgraphile/graphql");

/** @type {(schemas: string[], options: import("postgraphile/presets/v4").V4Options, setup?: string | ((client: import("pg").PoolClient) => Promise<void>)) => () => Promise<void>} */
exports.test = (schemas, options, setup) => () =>
  withPgClient(async (client) => {
    if (setup) {
      if (typeof setup === "function") {
        await setup(client);
      } else {
        await client.query(setup);
      }
    }
    const preset = makePreset(schemas, options);
    const { schema } = await makeSchema(preset);
    expect(printSchemaOrdered(schema)).toMatchSnapshot();
  });

/** @type {(schema: GraphQLSchema) => string} */
function printSchemaOrdered(originalSchema) {
  return printSchema(lexicographicSortSchema(originalSchema));
}
