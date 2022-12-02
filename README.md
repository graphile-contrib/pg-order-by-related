# @graphile-contrib/pg-order-by-related

[![Package on npm](https://img.shields.io/npm/v/@graphile-contrib/pg-order-by-related.svg)](https://www.npmjs.com/package/@graphile-contrib/pg-order-by-related)

This Graphile Engine plugin adds additional enum values to the `orderBy` argument on connections, allowing you to order by columns in related tables.

> Requires `postgraphile@^4.3.1` or `graphile-build-pg@^4.3.1`

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

Append this plugin and the additional `orderBy` options will be added to your schema.

### CLI

```bash
yarn add postgraphile
yarn add @graphile-contrib/pg-order-by-related
npx postgraphile --append-plugins @graphile-contrib/pg-order-by-related
```

### Library

```js
const express = require("express");
const { postgraphile } = require("postgraphile");
const PgOrderByRelatedPlugin = require("@graphile-contrib/pg-order-by-related");

const app = express();

app.use(
  postgraphile(process.env.DATABASE_URL, "app_public", {
    appendPlugins: [PgOrderByRelatedPlugin],
    graphiql: true,
  })
);

app.listen(5000);
```

## Inflection

To avoid naming conflicts, this plugin uses a `<TABLE>_BY_<KEY>` naming convention (e.g. `USER_BY_AUTHOR_ID__CREATED_AT_ASC`), similar to how related fields are named by default in PostGraphile v4.

You can override this by adding an inflector plugin. For example, the following plugin shortens the names by dropping the `<TABLE>_BY` portion (producing e.g. `AUTHOR_ID__CREATED_AT_ASC`):

```js
const { makeAddInflectorsPlugin } = require("graphile-utils");

module.exports = makeAddInflectorsPlugin(
  {
    orderByRelatedColumnEnum(attr, ascending, foreignTable, keyAttributes) {
      return `${this.constantCase(
        keyAttributes.map((keyAttr) => this._columnName(keyAttr)).join("-and-")
      )}__${this.orderByColumnEnum(attr, ascending)}`;
    },
  },
  true // Passing true here allows the plugin to overwrite existing inflectors.
);
```

See the [makeAddInflectorsPlugin documentation](https://www.graphile.org/postgraphile/make-add-inflectors-plugin/) for more information.

## Options

When using PostGraphile as a library, the following options can be specified via `graphileBuildOptions`.

### orderByRelatedColumnAggregates

Adds additional enum values for column aggregates (currently `min` and `max`) for one-to-many relationships.

Example:

```js
postgraphile(pgConfig, schema, {
  graphileBuildOptions: {
    orderByRelatedColumnAggregates: true,
  },
});
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
