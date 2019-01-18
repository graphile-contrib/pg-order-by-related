module.exports = function PgOrderRelatedColumnsPlugin(builder) {
  builder.hook("build", build => {
    const pkg = require("./package.json");

    // Check dependencies
    if (!build.versions) {
      throw new Error(
        `Plugin ${pkg.name}@${
          pkg.version
        } requires graphile-build@^4.1.0 in order to check dependencies (current version: ${
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
    depends("graphile-build-pg", "^4.1.0");

    // Register this plugin
    build.versions = build.extend(build.versions, { [pkg.name]: pkg.version });

    return build;
  });

  builder.hook("inflection", inflection => {
    return Object.assign(inflection, {
      orderByRelatedColumnEnum(attr, ascending, foreignTable, keyAttributes) {
        return `${this.constantCase(
          `${this._singularizedTableName(foreignTable)}-by-${keyAttributes
            .map(keyAttr => this._columnName(keyAttr))
            .join("-and-")}`
        )}__${this.orderByColumnEnum(attr, ascending)}`;
      },
      orderByRelatedCountEnum(ascending, foreignTable, keyAttributes) {
        return `${this.constantCase(
          `${this.pluralize(
            this._singularizedTableName(foreignTable)
          )}-by-${keyAttributes
            .map(keyAttr => this._columnName(keyAttr))
            .join("-and-")}`
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
        if (!foreignTable) {
          throw new Error(
            `Could not find the foreign table (constraint: ${
              foreignConstraint.name
            })`
          );
        }
        if (omit(foreignTable, "read")) {
          return memo;
        }
        const keyAttributes = foreignConstraint.foreignKeyAttributes;
        const foreignKeyAttributes = foreignConstraint.keyAttributes;
        if (keyAttributes.some(attr => omit(attr, "read"))) {
          return memo;
        }
        if (foreignKeyAttributes.some(attr => omit(attr, "read"))) {
          return memo;
        }
        const isForeignKeyUnique = !!foreignTable.constraints.find(
          c =>
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
      .filter(con => con.type === "f")
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
        if (keyAttributes.some(attr => omit(attr, "read"))) {
          return memo;
        }
        if (foreignKeyAttributes.some(attr => omit(attr, "read"))) {
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

    const orderEnumValuesFromRelationSpec = relationSpec => {
      const {
        keyAttributes,
        foreignTable,
        foreignKeyAttributes,
        isOneToMany,
        isForward,
      } = relationSpec;

      const sqlKeysMatch = tableAlias =>
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

      if (!isForward && isOneToMany) {
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
        }, {});
      }
    };

    return extend(
      values,
      [
        ...forwardRelationSpecs.map(spec => ({ ...spec, isForward: true })),
        ...backwardRelationSpecs.map(spec => ({ ...spec, isForward: false })),
      ].reduce(
        (memo, spec) => extend(memo, orderEnumValuesFromRelationSpec(spec)),
        {}
      ),
      `Adding related column order values for table '${table.name}'`
    );
  });
};
