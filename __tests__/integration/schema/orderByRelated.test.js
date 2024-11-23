// @ts-check
const core = require("./core");
const { default: PgOrderByRelatedPlugin } = require("../../../dist/index.js");

test(
  "prints a schema with the order-by-related plugin",
  core.test(["p"], {
    appendPlugins: [PgOrderByRelatedPlugin],
    disableDefaultMutations: true,
    legacyRelations: "omit",
  })
);
