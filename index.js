module.exports = function PgOrderRelatedColumnsPlugin(builder) {
  builder.hook("inflection", inflection => {
    return Object.assign(inflection, {
      orderByRelatedColumnEnum(attr, ascending, foreignTable, keys) {
        return `${this.constantCase(
          `${this._singularizedTableName(foreignTable)}-by-${keys
            .map(key => this._columnName(key))
            .join("-and-")}`
        )}__${this.orderByColumnEnum(attr, ascending)}`;
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

    const backwardSingleRelationSpecs = table.foreignConstraints
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
            isForward: false,
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
      const { foreignTable, keys, foreignKeys, isForward } = relationSpec;

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

      return foreignTable.attributes.reduce((memo, attr) => {
        if (!pgColumnFilter(attr, build, context)) return memo;
        if (omit(attr, "order")) return memo;

        const ascFieldName = inflection.orderByRelatedColumnEnum(
          attr,
          true,
          foreignTable,
          isForward ? keys : foreignKeys
        );
        const descFieldName = inflection.orderByRelatedColumnEnum(
          attr,
          false,
          foreignTable,
          isForward ? keys : foreignKeys
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
            [ascFieldName]: {
              value: {
                alias: ascFieldName.toLowerCase(),
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
            [descFieldName]: {
              value: {
                alias: descFieldName.toLowerCase(),
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
    };

    return extend(
      values,
      [...forwardRelationSpecs, ...backwardSingleRelationSpecs].reduce(
        (memo, relationSpec) =>
          extend(memo, orderEnumValuesFromRelationSpec(relationSpec)),
        {}
      ),
      `Adding related column order values for table '${table.name}'`
    );
  });
};
