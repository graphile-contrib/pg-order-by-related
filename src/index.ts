import type {} from "postgraphile";
import type {
  PgResource,
  PgResourceParameter,
} from "postgraphile/@dataplan/pg";
import * as pkg from "../package.json";

type Variant = "asc" | "desc" | "asc_nulls_last" | "desc_nulls_last";

declare global {
  namespace GraphileBuild {
    interface Inflection {
      orderByRelatedColumnEnum(details: {
        relationDetails: GraphileBuild.PgRelationsPluginRelationDetails;
        attributeName: string;
        variant: Variant;
      }): string;
      orderByRelatedComputedColumnEnum(details: {
        relationDetails: GraphileBuild.PgRelationsPluginRelationDetails;
        resource: PgResource<
          any,
          any,
          any,
          readonly PgResourceParameter[],
          any
        >;
        variant: Variant;
      }): string;
      orderByRelatedCountEnum(details: {
        relationDetails: GraphileBuild.PgRelationsPluginRelationDetails;
        variant: Variant;
      }): string;
      orderByRelatedColumnAggregateEnum(details: {
        relationDetails: GraphileBuild.PgRelationsPluginRelationDetails;
        attributeName: string;
        aggregateName: string;
        variant: Variant;
      }): string;
    }
  }
}

const PgOrderByRelatedPlugin: GraphileConfig.Plugin = {
  name: "PgOrderByRelatedPlugin",
  version: pkg.version,

  inflection: {
    add: {
      orderByRelatedColumnEnum(
        _preset,
        { relationDetails, attributeName, variant }
      ) {
        const prefix = this.constantCase(this.singleRelation(relationDetails));
        const relation =
          relationDetails.registry.pgRelations[relationDetails.codec.name]?.[
            relationDetails.relationName
          ];
        if (!relation.isUnique)
          throw new Error(
            `inflection.orderByRelatedColumnEnum can only be used with unique relations`
          );
        const remoteCodec = relation.remoteResource.codec;
        return `${prefix}__${this.orderByAttributeEnum({
          codec: remoteCodec,
          attributeName,
          variant,
          // This is being removed from newer versions
          attribute: remoteCodec.attributes[attributeName],
        })}`;
      },
      orderByRelatedComputedColumnEnum(
        _preset,
        { relationDetails, resource, variant }
      ) {
        const prefix = this.constantCase(this.singleRelation(relationDetails));
        const relation =
          relationDetails.registry.pgRelations[relationDetails.codec.name]?.[
            relationDetails.relationName
          ];
        if (!relation.isUnique)
          throw new Error(
            `inflection.orderByRelatedColumnEnum can only be used with unique relations`
          );
        return `${prefix}__${this.computedAttributeOrder({
          variant,
          resource,
        })}`;
      },
      orderByRelatedCountEnum(_preset, { relationDetails, variant }) {
        const prefix = this.constantCase(this._manyRelation(relationDetails));
        return `${prefix}__${this.constantCase(`count-${variant}`)}`;
      },
      orderByRelatedColumnAggregateEnum(
        _preset,
        { relationDetails, attributeName, aggregateName, variant }
      ) {
        const prefix = this.constantCase(this._manyRelation(relationDetails));
        const relation =
          relationDetails.registry.pgRelations[relationDetails.codec.name]?.[
            relationDetails.relationName
          ];
        const remoteCodec = relation.remoteResource.codec;
        return `${prefix}__${this.constantCase(
          aggregateName
        )}_${this.orderByAttributeEnum({
          codec: remoteCodec,
          attributeName,
          variant,
          // This is being removed from newer versions
          attribute: remoteCodec.attributes[attributeName],
        })}`;
      },
    },
  },
  schema: {
    hooks: {
      GraphQLEnumType_values(values, build, context) {
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
                const descEnumName =
                  inflection.orderByRelatedComputedColumnEnum(
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
            ...forwardRelationSpecs.map((spec) => ({
              ...spec,
              isForward: true,
            })),
            ...backwardRelationSpecs.map((spec) => ({
              ...spec,
              isForward: false,
            })),
          ].reduce(
            (memo, spec) => extend(memo, orderEnumValuesFromRelationSpec(spec)),
            {}
          ),
          `Adding related column order values for table '${table.name}'`
        );
      },
    },
  },
};

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

export default PgOrderByRelatedPlugin;

// HACK: for TypeScript/Babel import
module.exports = PgOrderByRelatedPlugin;
module.exports.default = PgOrderByRelatedPlugin;
Object.defineProperty(module.exports, "__esModule", { value: true });
