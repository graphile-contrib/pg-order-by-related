// @ts-check
const core = require("./core");

test(
  "prints a schema with the order-by-related plugin",
  core.test(["p"], {
    disableDefaultMutations: true,
  })
);
