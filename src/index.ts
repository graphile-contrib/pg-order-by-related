import type {} from "postgraphile";
import type { SQL } from "postgraphile/pg-sql2";
import type {
  PgCodecRelation,
  PgCodecWithAttributes,
  PgResource,
  PgResourceParameter,
  PgSelectStep,
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
  namespace GraphileBuild {
    interface SchemaOptions {
      /**
       * Set `true` if you'd like to add related column aggregates to your
       * schema; this is expensive so it's not recommended unless you're
       * using [Trusted Documents](https://benjie.dev/graphql/trusted-documents).
       */
      orderByRelatedColumnAggregates?: boolean;
    }
  }
}

interface RelationSpec {
  relationName: string;
  relation: PgCodecRelation;
  isOneToMany: boolean;
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
          inflection,
          sql,
          input: { pgRegistry },
          behavior,
          EXPORTABLE,
          dataplanPg: { TYPES },
        } = build;
        const {
          scope: { isPgRowSortEnum, pgCodec: rawPgCodec },
        } = context;
        if (!isPgRowSortEnum || !rawPgCodec || !rawPgCodec.attributes) {
          return values;
        }
        const pgCodec = rawPgCodec as PgCodecWithAttributes;

        const resource = Object.values(pgRegistry.pgResources).find(
          (r) => r.codec === pgCodec && !r.parameters
        );
        if (!resource) {
          return values;
        }

        const relationSpecs = Object.entries(resource.getRelations()).reduce(
          (memo, [relationName, relation]) => {
            if (!behavior.pgCodecRelationMatches(relation, "select")) {
              return memo;
            }
            const { remoteResource } = relation;
            if (!behavior.pgResourceMatches(remoteResource, "select")) {
              return memo;
            }
            // NOTE: V4 version of this plugin factored in the behaviors on the attributes; V5 **does not** do this. Set behaviors on the relation to exclude it.
            const isForeignKeyUnique = relation.isUnique;
            memo.push({
              relationName,
              relation,
              isOneToMany: !isForeignKeyUnique,
            });
            return memo;
          },
          [] as Array<RelationSpec>
        );
        const backwardRelationSpecs = relationSpecs.filter(
          (r) => !!r.relation.isReferencee
        );
        const forwardRelationSpecs = relationSpecs.filter(
          (r) => !r.relation.isReferencee
        );

        const orderEnumValuesFromRelationSpec = (
          relationSpec: RelationSpec
        ) => {
          const { isOneToMany, relation, relationName } = relationSpec;
          const isForward = !relation.isReferencee;

          const sqlKeysMatch = EXPORTABLE(
            (relation, sql) => (localAlias: SQL, remoteAlias: SQL) =>
              sql.fragment`(${sql.join(
                relation.localAttributes.map((attributeName, i) => {
                  return sql.fragment`${localAlias}.${sql.identifier(
                    attributeName
                  )} = ${remoteAlias}.${sql.identifier(
                    relation.remoteAttributes[i]
                  )}`;
                }),
                ") and ("
              )})`,
            [relation, sql]
          );

          let enumValues = values;
          const relationDetails: GraphileBuild.PgRelationsPluginRelationDetails =
            { registry: pgRegistry, codec: pgCodec, relationName };
          const from = relation.remoteResource.from;
          if (typeof from === "function") {
            throw new Error(`We don't support relations to functions.`);
          }

          if (!isForward && isOneToMany) {
            // Count
            const ascEnumName = inflection.orderByRelatedCountEnum({
              relationDetails,
              variant: "asc",
            });
            const descEnumName = inflection.orderByRelatedCountEnum({
              relationDetails,
              variant: "desc",
            });
            const sqlSubselect = EXPORTABLE(
              (from, relation, sql, sqlKeysMatch) => (step: PgSelectStep) => {
                const foreignTableAlias = sql.identifier(
                  Symbol(relation.remoteResource.codec.name)
                );
                return sql.parens(
                  sql`\
select count(*)
from ${from} as ${foreignTableAlias}
where ${sqlKeysMatch(step.alias, foreignTableAlias)}
`,
                  true
                );
              },
              [from, relation, sql, sqlKeysMatch]
            );
            const makePlan = (direction: "ASC" | "DESC") =>
              EXPORTABLE(
                (TYPES, direction, sqlSubselect) => (step: PgSelectStep) => {
                  step.orderBy({
                    codec: TYPES.bigint,
                    fragment: sqlSubselect(step),
                    direction,
                  });
                },
                [TYPES, direction, sqlSubselect]
              );
            enumValues = extend(
              enumValues,
              {
                [ascEnumName]: {
                  extensions: {
                    grafast: {
                      applyPlan: makePlan("ASC"),
                    },
                  },
                },
                [descEnumName]: {
                  extensions: {
                    grafast: {
                      applyPlan: makePlan("DESC"),
                    },
                  },
                },
              },
              "Adding order by related count enum values"
            );

            if (build.options.orderByRelatedColumnAggregates) {
              // Column aggregates
              for (const attributeName of Object.keys(
                relation.remoteResource.codec.attributes
              )) {
                if (
                  !behavior.pgCodecAttributeMatches(
                    [relation.remoteResource.codec, attributeName],
                    // TODO: this is probably the wrong behavior
                    "order"
                  )
                ) {
                  continue;
                }
                for (const aggregateName of ["max", "min"]) {
                  const ascEnumName =
                    inflection.orderByRelatedColumnAggregateEnum({
                      aggregateName,
                      attributeName,
                      variant: "asc",
                      relationDetails,
                    });
                  const descEnumName =
                    inflection.orderByRelatedColumnAggregateEnum({
                      aggregateName,
                      attributeName,
                      variant: "desc",
                      relationDetails,
                    });

                  const sqlSubselect = EXPORTABLE(
                    (
                        aggregateName,
                        attributeName,
                        from,
                        relation,
                        sql,
                        sqlKeysMatch
                      ) =>
                      (step: PgSelectStep) => {
                        const foreignTableAlias = sql.identifier(
                          Symbol(relation.remoteResource.codec.name)
                        );
                        return sql.parens(
                          sql`\
select ${sql.identifier(aggregateName)}(${foreignTableAlias}.${sql.identifier(
                            attributeName
                          )})
from ${from}
where ${sqlKeysMatch(step.alias, foreignTableAlias)}
`,
                          true
                        );
                      },
                    [
                      aggregateName,
                      attributeName,
                      from,
                      relation,
                      sql,
                      sqlKeysMatch,
                    ]
                  );
                  const makePlan = (direction: "ASC" | "DESC") =>
                    EXPORTABLE(
                      (TYPES, direction, sqlSubselect) =>
                        (step: PgSelectStep) => {
                          step.orderBy({
                            codec: TYPES.bigint,
                            fragment: sqlSubselect(step),
                            direction,
                          });
                        },
                      [TYPES, direction, sqlSubselect]
                    );

                  enumValues = extend(
                    enumValues,
                    {
                      [ascEnumName]: {
                        extensions: {
                          grafast: {
                            applyPlan: makePlan("ASC"),
                          },
                        },
                      },
                      [descEnumName]: {
                        extensions: {
                          grafast: {
                            applyPlan: makePlan("DESC"),
                          },
                        },
                      },
                    },
                    `Adding related column aggregate order by enums for '${attributeName}'`
                  );
                }
              }
            }
          } else {
            // Columns
            const remoteCodec = relation.remoteResource.codec;
            for (const attributeName of Object.keys(remoteCodec.attributes)) {
              if (
                !behavior.pgCodecAttributeMatches(
                  [remoteCodec, attributeName],
                  "order"
                )
              ) {
                continue;
              }

              const ascEnumName = inflection.orderByRelatedColumnEnum({
                attributeName,
                relationDetails,
                variant: "asc",
              });
              const descEnumName = inflection.orderByRelatedColumnEnum({
                attributeName,
                relationDetails,
                variant: "desc",
              });

              const sqlSubselect = EXPORTABLE(
                (attributeName, from, relation, sql, sqlKeysMatch) =>
                  (step: PgSelectStep) => {
                    const foreignTableAlias = sql.identifier(
                      Symbol(relation.remoteResource.codec.name)
                    );
                    return sql.parens(
                      sql`\
select ${foreignTableAlias}.${sql.identifier(attributeName)}
from ${from}
where ${sqlKeysMatch(step.alias, foreignTableAlias)}
`,
                      true
                    );
                  },
                [attributeName, from, relation, sql, sqlKeysMatch]
              );
              const makePlan = (direction: "ASC" | "DESC") =>
                EXPORTABLE(
                  (TYPES, direction, sqlSubselect) => (step: PgSelectStep) => {
                    step.orderBy({
                      codec: TYPES.bigint,
                      fragment: sqlSubselect(step),
                      direction,
                    });
                  },
                  [TYPES, direction, sqlSubselect]
                );

              enumValues = extend(
                enumValues,
                {
                  [ascEnumName]: {
                    extensions: {
                      grafast: {
                        applyPlan: makePlan("ASC"),
                      },
                    },
                  },
                  [descEnumName]: {
                    extensions: {
                      grafast: {
                        applyPlan: makePlan("DESC"),
                      },
                    },
                  },
                },
                `Adding related-by-column orderBy enum values for ${pgCodec.name}->${relation.remoteResource.name}.${attributeName}.`
              );
            }

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
