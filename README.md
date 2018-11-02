# @graphile-contrib/pg-order-by-related

This Graphile Engine plugin adds additional enum values to the `orderBy` argument on connections, allowing you to order by columns in related tables.

Both forward (1:1 and 1:m) and backward (1:1) relations are supported.

## Installation

Dependencies: `graphile-build-pg@^4.1.0` (`postgraphile@^4.1.0`)

```
yarn add @graphile-contrib/pg-order-by-related
```

## Usage

Simply append this plugin and the additional `orderBy` options will be added to your schema.

### Usage - CLI

```
postgraphile --append-plugins @graphile-contrib/pg-order-by-related -c postgres:///my_db
```

### Usage - Library

```js
const express = require("express");
const { postgraphile } = require("postgraphile");
const PgOrderByRelated = require("@graphile-contrib/pg-order-by-related");

const app = express();

app.use(
  postgraphile(process.env.DATABASE_URL, "app_public", {
    appendPlugins: [PgOrderByRelated]
  })
);

app.listen(process.env.PORT || 3000);
```

## Inflection

This plugin follows the constant-case naming convention of PostGraphile v4 (e.g. `POSTS__CREATED_AT_ASC`). You can override this by adding an inflector plugin. The following plugin would camel-case the table name:

```js
const { makeAddInflectorsPlugin } = require("graphile-utils");

module.exports = makeAddInflectorsPlugin(
  {
    orderByRelatedColumnEnum(attr, ascending, foreignTable) {
      return `${this.camelCase(
        foreignTable.name
      )}__${this.orderByColumnEnum(attr, ascending)}`;
    },
  },
  true // Passing true here allows the plugin to overwrite existing inflectors.
);
```

See the [makeAddInflectorsPlugin documentation](https://www.graphile.org/postgraphile/make-add-inflectors-plugin/) for more information.