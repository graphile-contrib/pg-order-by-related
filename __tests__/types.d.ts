declare global {
  namespace Grafast {
    interface Context {
      pgClient?: import("pg").PoolClient;
    }
  }
}

// TypeScript hack since this has to be a module
export const hack = 1;
