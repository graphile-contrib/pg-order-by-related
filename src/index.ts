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
import type { GraphQLEnumValueConfigMap } from "postgraphile/graphql";

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
        let enumValues = values;
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

        const relations = resource.getRelations() as Record<
          string,
          PgCodecRelation
        >;
        for (const [relationName, relation] of Object.entries(relations)) {
          if (!behavior.pgCodecRelationMatches(relation, "select")) {
            continue;
          }
          const { remoteResource } = relation;
          if (!behavior.pgResourceMatches(remoteResource, "select")) {
            continue;
          }
          // NOTE: V4 version of this plugin factored in the behaviors on the attributes; V5 **does not** do this. Set behaviors on the relation to exclude it.
          const isOneToMany = !relation.isUnique;

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

          const relationDetails: GraphileBuild.PgRelationsPluginRelationDetails =
            { registry: pgRegistry, codec: pgCodec, relationName };
          const from = relation.remoteResource.from;
          if (typeof from === "function") {
            throw new Error(`We don't support relations to functions.`);
          }

          if (!isForward && isOneToMany) {
            // Count
            enumValues = addAscDesc(
              "Adding order by related count enum values",
              build,
              relationDetails,
              enumValues,
              "orderByRelatedCountEnum",
              {
                relationDetails,
              },
              EXPORTABLE(
                (from, sql, sqlKeysMatch) => (localAlias, remoteAlias) => {
                  return sql.parens(
                    sql`\
select count(*)
from ${from} as ${remoteAlias}
where ${sqlKeysMatch(localAlias, remoteAlias)}
`,
                    true
                  );
                },
                [from, sql, sqlKeysMatch]
              )
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
            for (const r of Object.values(pgRegistry.pgResources)) {
              // Skip if not computed column on this codec
              {
                if (!r.parameters) continue;
                if (!r.parameters[0]) continue;
                if (r.parameters[0].codec !== pgCodec) continue;
                if (!behavior.pgResourceMatches(r, "typeField")) continue;
              }

              const resource = r as PgResource<
                any,
                any,
                any,
                readonly PgResourceParameter[],
                any
              >;
              if (typeof resource.from !== "function") continue;

              if (!behavior.pgResourceMatches(resource, "orderBy")) continue;

              // Must have only one required argument
              if (resource.parameters.slice(1).some((p) => p.required))
                continue;

              let underlyingCodec = resource.codec;
              while (underlyingCodec.domainOfCodec) {
                underlyingCodec = underlyingCodec.domainOfCodec;
              }

              if (
                !resource.isUnique ||
                resource.isList ||
                underlyingCodec.attributes ||
                underlyingCodec.arrayOfCodec ||
                underlyingCodec.rangeOfCodec ||
                underlyingCodec.name === "void"
              ) {
                // Only want to deal with scalars
                continue;
              }

              const pseudoColumnName = inflection.computedAttributeField({
                resource,
              });

              // Looks good
              const ascEnumName = inflection.orderByRelatedComputedColumnEnum({
                relationDetails,
                resource,
                variant: "asc",
              });
              const descEnumName = inflection.orderByRelatedComputedColumnEnum({
                relationDetails,
                resource,
                variant: "desc",
              });

              const sqlSubselect = EXPORTABLE(
                (from, relation, resource, sql, sqlKeysMatch) =>
                  (step: PgSelectStep) => {
                    const foreignTableAlias = sql.identifier(
                      Symbol(relation.remoteResource.codec.name)
                    );
                    if (typeof resource.from !== "function")
                      throw new Error(
                        `Impossible... unless you mutated the resource definition?!`
                      );
                    return sql.parens(
                      sql`\
select ${resource.from({ placeholder: foreignTableAlias })}
from ${from}
where ${sqlKeysMatch(step.alias, foreignTableAlias)}
`,
                      true
                    );
                  },
                [from, relation, resource, sql, sqlKeysMatch]
              );

              enumValues = extend(
                enumValues,
                {
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
                },
                `Adding orderBy enum value for computed column ${pgCodec.name}->${relation.remoteResource.name}.${resource.name}().`
              );
            }
          }
        }

        return enumValues;
      },
    },
  },
};

function addAscDesc<
  TInflectorName extends
    | "orderByRelatedColumnEnum"
    | "orderByRelatedComputedColumnEnum"
    | "orderByRelatedCountEnum"
    | "orderByRelatedColumnAggregateEnum"
>(
  extendReason: string,
  build: GraphileBuild.Build,
  relationDetails: GraphileBuild.PgRelationsPluginRelationDetails,
  enumValues: GraphQLEnumValueConfigMap,
  inflector: TInflectorName,
  inflectionDetails: Omit<
    Parameters<GraphileBuild.Inflection[TInflectorName]>[0],
    "variant"
  >,
  sqlSubselect: (localAlias: SQL, remoteAlias: SQL) => SQL
) {
  const relation =
    relationDetails.registry.pgRelations[relationDetails.codec.name][
      relationDetails.relationName
    ];
  const {
    extend,
    inflection,
    EXPORTABLE,
    dataplanPg: { TYPES },
    sql,
  } = build;
  const ascEnumName = build.inflection[inflector]({
    ...inflectionDetails,
    variant: "asc",
  } as any);
  const descEnumName = inflection.orderByRelatedCountEnum({
    relationDetails,
    variant: "desc",
  });
  const makePlan = (direction: "ASC" | "DESC") =>
    EXPORTABLE(
      (TYPES, direction, relation, sql, sqlSubselect) =>
        (step: PgSelectStep) => {
          const foreignTableAlias = sql.identifier(
            Symbol(relation.remoteResource.codec.name)
          );
          step.orderBy({
            codec: TYPES.bigint,
            fragment: sqlSubselect(step.alias, foreignTableAlias),
            direction,
          });
        },
      [TYPES, direction, relation, sql, sqlSubselect]
    );
  return extend(
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
    extendReason
  );
}

export default PgOrderByRelatedPlugin;
// HACK: for TypeScript/Babel import
module.exports = PgOrderByRelatedPlugin;
module.exports.default = PgOrderByRelatedPlugin;
Object.defineProperty(module.exports, "__esModule", { value: true });
