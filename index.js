function PgOrderByRelatedPlugin(builder, { orderByRelatedColumnAggregates }) {
  builder.hook("build", (build) => {
    const pkg = require("./package.json");

    // Check dependencies
    if (!build.versions) {
      throw new Error(
        `Plugin ${pkg.name}@${pkg.version} requires graphile-build@^4.1.0 in order to check dependencies (current version: ${build.graphileBuildVersion})`
      );
    }
    const depends = (name, range) => {
      if (!build.hasVersion(name, range)) {
        throw new Error(
          `Plugin ${pkg.name}@${pkg.version} requires ${name}@${range} (${
            build.versions[name]
              ? `current version: ${build.versions[name]}`
              : "not found"
          })`
        );
      }
    };
    depends("graphile-build-pg", "^4.3.1");

    // Register this plugin
    build.versions = build.extend(build.versions, { [pkg.name]: pkg.version });

    return build;
  });

  builder.hook("inflection", (inflection) => {
    return Object.assign(inflection, {
      orderByRelatedColumnEnum(attr, ascending, foreignTable, keyAttributes) {
        return `${this.constantCase(
          `${this._singularizedTableName(foreignTable)}-by-${keyAttributes
            .map((keyAttr) => this._columnName(keyAttr))
            .join("-and-")}`
        )}__${this.orderByColumnEnum(attr, ascending)}`;
      },
      orderByRelatedComputedColumnEnum(
        pseudoColumnName,
        proc,
        ascending,
        foreignTable,
        keyAttributes
      ) {
        return `${this.constantCase(
          `${this._singularizedTableName(foreignTable)}-by-${keyAttributes
            .map((keyAttr) => this._columnName(keyAttr))
            .join("-and-")}`
        )}__${this.orderByComputedColumnEnum(
          pseudoColumnName,
          proc,
          foreignTable,
          ascending
        )}`;
      },
      orderByRelatedCountEnum(ascending, foreignTable, keyAttributes) {
        return `${this.constantCase(
          `${this.pluralize(
            this._singularizedTableName(foreignTable)
          )}-by-${keyAttributes
            .map((keyAttr) => this._columnName(keyAttr))
            .join("-and-")}`
        )}__${this.constantCase(`count-${ascending ? "asc" : "desc"}`)}`;
      },
      orderByRelatedColumnAggregateEnum(
        attr,
        ascending,
        foreignTable,
        keyAttributes,
        aggregateName
      ) {
        return `${this.constantCase(
          `${this.pluralize(
            this._singularizedTableName(foreignTable)
          )}-by-${keyAttributes
            .map((keyAttr) => this._columnName(keyAttr))
            .join("-and-")}`
        )}__${this.constantCase(aggregateName)}_${this.orderByColumnEnum(
          attr,
          ascending
        )}`;
      },
    });
  });

  builder.hook("GraphQLEnumType:values", (values, build, context) => {
    const {
      extend,
      pgColumnFilter,
      inflection,
      pgSql: sql,
      pgOmit: omit,
      pgIntrospectionResultsByKind: introspectionResultsByKind,
      describePgEntity,
      sqlCommentByAddingTags,
    } = build;
    const {
      scope: { isPgRowSortEnum, pgIntrospection: table },
    } = context;
    if (!isPgRowSortEnum || !table || table.kind !== "class") {
      return values;
    }

    const backwardRelationSpecs = table.foreignConstraints
      .filter((con) => con.type === "f")
      .reduce((memo, foreignConstraint) => {
        if (omit(foreignConstraint, "read")) {
          return memo;
        }
        const foreignTable =
          introspectionResultsByKind.classById[foreignConstraint.classId];
        if (!foreignTable) {
          throw new Error(
            `Could not find the foreign table (constraint: ${foreignConstraint.name})`
          );
        }
        if (omit(foreignTable, "read")) {
          return memo;
        }
        const keyAttributes = foreignConstraint.foreignKeyAttributes;
        const foreignKeyAttributes = foreignConstraint.keyAttributes;
        if (keyAttributes.some((attr) => omit(attr, "read"))) {
          return memo;
        }
        if (foreignKeyAttributes.some((attr) => omit(attr, "read"))) {
          return memo;
        }
        const isForeignKeyUnique = !!foreignTable.constraints.find(
          (c) =>
            (c.type === "p" || c.type === "u") &&
            c.keyAttributeNums.length === foreignKeyAttributes.length &&
            c.keyAttributeNums.every(
              (n, i) => foreignKeyAttributes[i].num === n
            )
        );
        memo.push({
          table,
          keyAttributes,
          foreignTable,
          foreignKeyAttributes,
          foreignConstraint,
          isOneToMany: !isForeignKeyUnique,
        });
        return memo;
      }, []);

    const forwardRelationSpecs = table.constraints
      .filter((con) => con.type === "f")
      .reduce((memo, constraint) => {
        if (omit(constraint, "read")) {
          return memo;
        }
        const foreignTable =
          introspectionResultsByKind.classById[constraint.foreignClassId];
        if (!foreignTable) {
          throw new Error(
            `Could not find the foreign table (constraint: ${constraint.name})`
          );
        }
        if (omit(foreignTable, "read")) {
          return memo;
        }
        const keyAttributes = constraint.keyAttributes;
        const foreignKeyAttributes = constraint.foreignKeyAttributes;
        if (keyAttributes.some((attr) => omit(attr, "read"))) {
          return memo;
        }
        if (foreignKeyAttributes.some((attr) => omit(attr, "read"))) {
          return memo;
        }
        memo.push({
          table,
          keyAttributes,
          foreignTable,
          foreignKeyAttributes,
          constraint,
        });
        return memo;
      }, []);

    const orderEnumValuesFromRelationSpec = (relationSpec) => {
      const {
        keyAttributes,
        foreignTable,
        foreignKeyAttributes,
        isOneToMany,
        isForward,
      } = relationSpec;

      const sqlKeysMatch = (tableAlias) =>
        sql.fragment`(${sql.join(
          keyAttributes.map((attr, i) => {
            return sql.fragment`${tableAlias}.${sql.identifier(
              attr.name
            )} = ${sql.identifier(
              foreignTable.namespace.name,
              foreignTable.name
            )}.${sql.identifier(foreignKeyAttributes[i].name)}`;
          }),
          ") and ("
        )})`;

      const inflectionKeyAttributes = isForward
        ? keyAttributes
        : foreignKeyAttributes;

      const enumValues = {};

      if (!isForward && isOneToMany) {
        // Count
        const ascEnumName = inflection.orderByRelatedCountEnum(
          true,
          foreignTable,
          inflectionKeyAttributes
        );
        const descEnumName = inflection.orderByRelatedCountEnum(
          false,
          foreignTable,
          inflectionKeyAttributes
        );
        const sqlSubselect = ({ queryBuilder }) => sql.fragment`(
          select count(*)
          from ${sql.identifier(foreignTable.namespace.name, foreignTable.name)}
          where ${sqlKeysMatch(queryBuilder.getTableAlias())}
          )`;
        const countEnumValues = {
          [ascEnumName]: {
            value: {
              alias: ascEnumName.toLowerCase(),
              specs: [[sqlSubselect, true]],
            },
          },
          [descEnumName]: {
            value: {
              alias: descEnumName.toLowerCase(),
              specs: [[sqlSubselect, false]],
            },
          },
        };
        extend(enumValues, countEnumValues);

        if (orderByRelatedColumnAggregates) {
          // Column aggregates
          const columnAggregateEnumValues = foreignTable.attributes.reduce(
            (memo, attr) => {
              if (!pgColumnFilter(attr, build, context)) return memo;
              if (omit(attr, "order")) return memo;

              for (const aggregateName of ["max", "min"]) {
                const ascEnumName =
                  inflection.orderByRelatedColumnAggregateEnum(
                    attr,
                    true,
                    foreignTable,
                    inflectionKeyAttributes,
                    aggregateName
                  );
                const descEnumName =
                  inflection.orderByRelatedColumnAggregateEnum(
                    attr,
                    false,
                    foreignTable,
                    inflectionKeyAttributes,
                    aggregateName
                  );

                const sqlSubselect = ({ queryBuilder }) => sql.fragment`(
              select ${sql.raw(aggregateName)}(${sql.identifier(attr.name)})
              from ${sql.identifier(
                foreignTable.namespace.name,
                foreignTable.name
              )}
              where ${sqlKeysMatch(queryBuilder.getTableAlias())}
              )`;

                memo = extend(memo, {
                  [ascEnumName]: {
                    value: {
                      alias: ascEnumName.toLowerCase(),
                      specs: [[sqlSubselect, true]],
                    },
                  },
                  [descEnumName]: {
                    value: {
                      alias: descEnumName.toLowerCase(),
                      specs: [[sqlSubselect, false]],
                    },
                  },
                });
              }
              return memo;
            },
            {}
          );
          extend(enumValues, columnAggregateEnumValues);
        }
      } else {
        // Columns
        const columnEnumValues = foreignTable.attributes.reduce(
          (memo, attr) => {
            if (!pgColumnFilter(attr, build, context)) return memo;
            if (omit(attr, "order")) return memo;

            const ascEnumName = inflection.orderByRelatedColumnEnum(
              attr,
              true,
              foreignTable,
              inflectionKeyAttributes
            );
            const descEnumName = inflection.orderByRelatedColumnEnum(
              attr,
              false,
              foreignTable,
              inflectionKeyAttributes
            );

            const sqlSubselect = ({ queryBuilder }) => sql.fragment`(
            select ${sql.identifier(attr.name)}
            from ${sql.identifier(
              foreignTable.namespace.name,
              foreignTable.name
            )}
            where ${sqlKeysMatch(queryBuilder.getTableAlias())}
            )`;

            memo = extend(
              memo,
              {
                [ascEnumName]: {
                  value: {
                    alias: ascEnumName.toLowerCase(),
                    specs: [[sqlSubselect, true]],
                  },
                },
              },
              `Adding ascending orderBy enum value for ${describePgEntity(
                attr
              )}. You can rename this field with:\n\n  ${sqlCommentByAddingTags(
                attr,
                {
                  name: "newNameHere",
                }
              )}`
            );
            memo = extend(
              memo,
              {
                [descEnumName]: {
                  value: {
                    alias: descEnumName.toLowerCase(),
                    specs: [[sqlSubselect, false]],
                  },
                },
              },
              `Adding descending orderBy enum value for ${describePgEntity(
                attr
              )}. You can rename this field with:\n\n  ${sqlCommentByAddingTags(
                attr,
                {
                  name: "newNameHere",
                }
              )}`
            );
            return memo;
          },
          {}
        );
        extend(enumValues, columnEnumValues);

        // Computed columns
        const computedColumnEnumValues =
          introspectionResultsByKind.procedure.reduce((memo, proc) => {
            // Must be marked @sortable
            if (!proc.tags.sortable) return memo;

            // Must not be omitted
            if (omit(proc, "execute")) return memo;
            if (omit(proc, "order")) return memo;

            // Must be a computed column
            const computedColumnDetails = getComputedColumnDetails(
              build,
              foreignTable,
              proc
            );
            if (!computedColumnDetails) return memo;
            const { pseudoColumnName } = computedColumnDetails;

            // Must have only one required argument
            const nonOptionalArgumentsCount =
              proc.argDefaultsNum - proc.inputArgsCount;
            if (nonOptionalArgumentsCount > 1) {
              return memo;
            }

            // Must return a scalar or an array
            if (proc.returnsSet) return memo;
            const returnType =
              introspectionResultsByKind.typeById[proc.returnTypeId];
            const returnTypeTable =
              introspectionResultsByKind.classById[returnType.classId];
            if (returnTypeTable) return memo;
            const isRecordLike = returnType.id === "2249";
            if (isRecordLike) return memo;
            const isVoid = String(returnType.id) === "2278";
            if (isVoid) return memo;

            // Looks good
            const ascEnumName = inflection.orderByRelatedComputedColumnEnum(
              pseudoColumnName,
              proc,
              true,
              foreignTable,
              inflectionKeyAttributes
            );
            const descEnumName = inflection.orderByRelatedComputedColumnEnum(
              pseudoColumnName,
              proc,
              false,
              foreignTable,
              inflectionKeyAttributes
            );

            const sqlSubselect = ({ queryBuilder }) => sql.fragment`(
            select ${sql.identifier(
              proc.namespace.name,
              proc.name
            )}(${sql.identifier(foreignTable.name)})
            from ${sql.identifier(
              foreignTable.namespace.name,
              foreignTable.name
            )}
            where ${sqlKeysMatch(queryBuilder.getTableAlias())}
            )`;

            memo = extend(
              memo,
              {
                [ascEnumName]: {
                  value: {
                    alias: ascEnumName.toLowerCase(),
                    specs: [[sqlSubselect, true]],
                  },
                },
              },
              `Adding ascending orderBy enum value for ${describePgEntity(
                proc
              )}.`
            );
            memo = extend(
              memo,
              {
                [descEnumName]: {
                  value: {
                    alias: descEnumName.toLowerCase(),
                    specs: [[sqlSubselect, false]],
                  },
                },
              },
              `Adding descending orderBy enum value for ${describePgEntity(
                proc
              )}.`
            );
            return memo;
          }, {});
        extend(enumValues, computedColumnEnumValues);
      }

      return enumValues;
    };

    return extend(
      values,
      [
        ...forwardRelationSpecs.map((spec) => ({ ...spec, isForward: true })),
        ...backwardRelationSpecs.map((spec) => ({ ...spec, isForward: false })),
      ].reduce(
        (memo, spec) => extend(memo, orderEnumValuesFromRelationSpec(spec)),
        {}
      ),
      `Adding related column order values for table '${table.name}'`
    );
  });

  function getComputedColumnDetails(build, table, proc) {
    if (!proc.isStable) return null;
    if (proc.namespaceId !== table.namespaceId) return null;
    if (!proc.name.startsWith(`${table.name}_`)) return null;
    if (proc.argTypeIds.length < 1) return null;
    if (proc.argTypeIds[0] !== table.type.id) return null;

    const argTypes = proc.argTypeIds.reduce((prev, typeId, idx) => {
      if (
        proc.argModes.length === 0 || // all args are `in`
        proc.argModes[idx] === "i" || // this arg is `in`
        proc.argModes[idx] === "b" // this arg is `inout`
      ) {
        prev.push(build.pgIntrospectionResultsByKind.typeById[typeId]);
      }
      return prev;
    }, []);
    if (
      argTypes
        .slice(1)
        .some(
          (type) => type.type === "c" && type.class && type.class.isSelectable
        )
    ) {
      // Accepts two input tables? Skip.
      return null;
    }

    const pseudoColumnName = proc.name.substr(table.name.length + 1);
    return { argTypes, pseudoColumnName };
  }
}

module.exports = PgOrderByRelatedPlugin;
// Hacks for TypeScript/Babel import
module.exports.default = PgOrderByRelatedPlugin;
Object.defineProperty(module.exports, "__esModule", { value: true });
