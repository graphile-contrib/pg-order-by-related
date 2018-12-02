module.exports = function PgOrderRelatedColumnsPlugin(builder) {
  builder.hook("build", build => {
    const pkg = require("./package.json");

    // Check dependencies
    if (!build.versions) {
      throw new Error(
        `Plugin ${pkg.name}@${
          pkg.version
        } requires graphile-build@^4.1.0-rc.2 in order to check dependencies (current version: ${
          build.graphileBuildVersion
        })`
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
    depends("graphile-build-pg", "^4.1.0-rc.2");

    // Register this plugin
    build.versions = build.extend(build.versions, { [pkg.name]: pkg.version });

    return build;
  });

  builder.hook("inflection", inflection => {
    return Object.assign(inflection, {
      orderByRelatedColumnEnum(attr, ascending, foreignTable, keys) {
        return `${this.constantCase(
          `${this._singularizedTableName(foreignTable)}-by-${keys
            .map(key => this._columnName(key))
            .join("-and-")}`
        )}__${this.orderByColumnEnum(attr, ascending)}`;
      },
      orderByRelatedCountEnum(ascending, foreignTable, keys) {
        return `${this.constantCase(
          `${this.pluralize(
            this._singularizedTableName(foreignTable)
          )}-by-${keys.map(key => this._columnName(key)).join("-and-")}`
        )}__${this.constantCase(`count-${ascending ? "asc" : "desc"}`)}`;
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
      .filter(con => con.type === "f")
      .reduce((memo, foreignConstraint) => {
        if (omit(foreignConstraint, "read")) {
          return memo;
        }
        const foreignTable =
          introspectionResultsByKind.classById[foreignConstraint.classId];
        if (omit(foreignTable, "read")) {
          return memo;
        }
        const keys = foreignConstraint.foreignKeyAttributes;
        const foreignKeys = foreignConstraint.keyAttributes;
        if (!keys.every(_ => _) || !foreignKeys.every(_ => _)) {
          throw new Error("Could not find key columns!");
        }
        if (keys.some(key => omit(key, "read"))) {
          return memo;
        }
        if (foreignKeys.some(key => omit(key, "read"))) {
          return memo;
        }
        const isUnique = !!foreignTable.constraints.find(
          c =>
            (c.type === "p" || c.type === "u") &&
            c.keyAttributeNums.length === foreignKeys.length &&
            c.keyAttributeNums.every((n, i) => foreignKeys[i].num === n)
        );
        if (isUnique) {
          memo.push({
            foreignTable,
            keys,
            foreignKeys,
            isBackwardSingle: true,
          });
        } else {
          memo.push({
            foreignTable,
            keys,
            foreignKeys,
            isBackwardMany: true,
          });
        }
        return memo;
      }, []);

    const forwardRelationSpecs = table.constraints
      .filter(con => con.type === "f")
      .reduce((memo, constraint) => {
        if (omit(constraint, "read")) {
          return memo;
        }
        const foreignTable =
          introspectionResultsByKind.classById[constraint.foreignClassId];
        if (omit(foreignTable, "read")) {
          return memo;
        }
        const keys = constraint.keyAttributes;
        const foreignKeys = constraint.foreignKeyAttributes;
        if (!keys.every(_ => _) || !foreignKeys.every(_ => _)) {
          throw new Error("Could not find key columns!");
        }
        if (keys.some(key => omit(key, "read"))) {
          return memo;
        }
        if (foreignKeys.some(key => omit(key, "read"))) {
          return memo;
        }
        memo.push({
          foreignTable,
          keys,
          foreignKeys,
          isForward: true,
        });
        return memo;
      }, []);

    const orderEnumValuesFromRelationSpec = relationSpec => {
      const {
        foreignTable,
        keys,
        foreignKeys,
        isForward,
        isBackwardMany,
      } = relationSpec;

      const sqlKeysMatch = tableAlias =>
        sql.fragment`(${sql.join(
          keys.map((key, i) => {
            return sql.fragment`${tableAlias}.${sql.identifier(
              key.name
            )} = ${sql.identifier(
              foreignTable.namespace.name,
              foreignTable.name
            )}.${sql.identifier(foreignKeys[i].name)}`;
          }),
          ") and ("
        )})`;

      const inflectionKeys = isForward ? keys : foreignKeys;

      if (isBackwardMany) {
        const ascEnumName = inflection.orderByRelatedCountEnum(
          true,
          foreignTable,
          inflectionKeys
        );
        const descEnumName = inflection.orderByRelatedCountEnum(
          false,
          foreignTable,
          inflectionKeys
        );

        const sqlSubselect = ({ queryBuilder }) => sql.fragment`(
          select count(*)
          from ${sql.identifier(foreignTable.namespace.name, foreignTable.name)}
          where ${sqlKeysMatch(queryBuilder.getTableAlias())}
          )`;

        return {
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
      } else {
        return foreignTable.attributes.reduce((memo, attr) => {
          if (!pgColumnFilter(attr, build, context)) return memo;
          if (omit(attr, "order")) return memo;

          const ascEnumName = inflection.orderByRelatedColumnEnum(
            attr,
            true,
            foreignTable,
            inflectionKeys
          );
          const descEnumName = inflection.orderByRelatedColumnEnum(
            attr,
            false,
            foreignTable,
            inflectionKeys
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
        }, {});
      }
    };

    return extend(
      values,
      [...forwardRelationSpecs, ...backwardRelationSpecs].reduce(
        (memo, relationSpec) =>
          extend(memo, orderEnumValuesFromRelationSpec(relationSpec)),
        {}
      ),
      `Adding related column order values for table '${table.name}'`
    );
  });
};
