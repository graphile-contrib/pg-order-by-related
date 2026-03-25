# @graphile-contrib/pg-order-by-related

[![Package on npm](https://img.shields.io/npm/v/@graphile-contrib/pg-order-by-related.svg)](https://www.npmjs.com/package/@graphile-contrib/pg-order-by-related)

This plugin adds additional enum values to the `orderBy` argument on
connections, allowing you to order by columns in related tables.

> Requires `postgraphile@^5.0.0`

Example:

```graphql
{
  # additional enum values exposed here 👇
  allPosts(orderBy: PERSON_BY_AUTHOR_ID__CREATED_AT_ASC) {
    nodes {
      headline
      personByAuthorId {
        id
        name
        about
      }
    }
  }
}
```

One-to-one and many-to-one relations are supported. For one-to-many relations, `__COUNT_ASC`/`__COUNT_DESC` enums allow ordering by the number of related records.

## Usage

Add the plugin to the `plugins` list in your Graphile config:

```ts
import { makePgService } from "postgraphile/adaptors/pg";
import { PostGraphileAmberPreset } from "postgraphile/presets/amber";
import { PgOrderByRelatedPlugin } from "@graphile-contrib/pg-order-by-related";

const preset: GraphileConfig.Preset = {
  extends: [PostGraphileAmberPreset],
  plugins: [PgOrderByRelatedPlugin],
  pgServices: [
    makePgService({
      connectionString: process.env.DATABASE_URL!,
      schemas: ["app_public"],
    }),
  ],
};

export default preset;
```

## Inflection

To avoid naming conflicts, this plugin uses a `<TABLE>_BY_<KEY>` naming
convention (e.g. `USER_BY_AUTHOR_ID__CREATED_AT_ASC`).

You can override this with a custom V5 inflection plugin if you want shorter or
more domain-specific enum names. See the
[inflection documentation](https://postgraphile.org/postgraphile/next/inflection)
for the current plugin patterns.

## Options

### orderByRelatedColumnAggregates

Adds additional enum values for column aggregates (currently `min` and `max`) for one-to-many relationships.

Example:

```ts
const preset: GraphileConfig.Preset = {
  extends: [PostGraphileAmberPreset],
  plugins: [PgOrderByRelatedPlugin],
  schema: {
    orderByRelatedColumnAggregates: true,
  },
};
```

```graphql
{
  allPersons(orderBy: POSTS_BY_AUTHOR_ID__MAX_CREATED_AT_ASC, first: 10) {
    nodes {
      id
      name
    }
  }
}
```

## Development

To establish a test environment, create an empty PostgreSQL database and set a `TEST_DATABASE_URL` environment variable with your database connection string.

```bash
createdb graphile_test
export TEST_DATABASE_URL=postgres://localhost:5432/graphile_test
yarn
yarn test
```
