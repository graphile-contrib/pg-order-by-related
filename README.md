# @graphile-contrib/pg-order-by-related

This Graphile Engine plugin adds additional enum values to the `orderBy` argument on connections, allowing you to order by columns in related tables.

> Requires `postgraphile@^4.1.0-rc.2` or `graphile-build-pg@^4.1.0-rc.2`

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
yarn add postgraphile@^4.1.0-rc.2
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

To avoid naming conflicts, this plugin uses a `<TABLE>_BY_<KEYS>` naming convention (e.g. `USER_BY_AUTHOR_ID__CREATED_AT_ASC`), similar to how related fields are named by default in PostGraphile v4. 

You can override this by adding an inflector plugin. For example, the following plugin shortens the names by dropping the `<TABLE>_BY` portion (producing e.g. `AUTHOR_ID__CREATED_AT_ASC`):

```js
const { makeAddInflectorsPlugin } = require("graphile-utils");

module.exports = makeAddInflectorsPlugin(
  {
    orderByRelatedColumnEnum(attr, ascending, foreignTable, keys) {
      return `${this.constantCase(
        keys.map(key => this._columnName(key)).join("-and-")
      )}__${this.orderByColumnEnum(attr, ascending)}`;
    },
  },
  true // Passing true here allows the plugin to overwrite existing inflectors.
);
```

See the [makeAddInflectorsPlugin documentation](https://www.graphile.org/postgraphile/make-add-inflectors-plugin/) for more information.