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

export const PgOrderByRelatedPlugin: GraphileConfig.Plugin = {
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
      GraphQLEnumType_values(enumValues, build, context) {
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
          return enumValues;
        }
        const pgCodec = rawPgCodec as PgCodecWithAttributes;

        const resource = Object.values(pgRegistry.pgResources).find(
          (r) => r.codec === pgCodec && !r.parameters
        );
        if (!resource) {
          return enumValues;
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
          if (typeof remoteResource.from === "function") {
            continue;
          }
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

          const addAscDesc = <
            TInflectorName extends
              | "orderByRelatedColumnEnum"
              | "orderByRelatedComputedColumnEnum"
              | "orderByRelatedCountEnum"
              | "orderByRelatedColumnAggregateEnum"
          >(
            extendReason: string,
            inflector: TInflectorName,
            inflectionDetails: Omit<
              Parameters<GraphileBuild.Inflection[TInflectorName]>[0],
              "variant"
            >,
            sqlSubselect: (localAlias: SQL, remoteAlias: SQL) => SQL
          ) => {
            const relation =
              relationDetails.registry.pgRelations[relationDetails.codec.name][
                relationDetails.relationName
              ];
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
            extend(
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
          };

          if (!isForward && isOneToMany) {
            // Count
            addAscDesc(
              "Adding order by related count enum values",
              "orderByRelatedCountEnum",
              { relationDetails },
              EXPORTABLE(
                (remoteResource, sql, sqlKeysMatch) =>
                  (localAlias, remoteAlias) =>
                    sql`\
(
  select count(*)
  from ${remoteResource.from as SQL} as ${remoteAlias}
  where ${sqlKeysMatch(localAlias, remoteAlias)}
)`,
                [remoteResource, sql, sqlKeysMatch]
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
                    "orderBy"
                  )
                ) {
                  continue;
                }
                for (const aggregateName of ["max", "min"]) {
                  addAscDesc(
                    `Adding related column aggregate order by enums for '${attributeName}'`,
                    "orderByRelatedColumnAggregateEnum",
                    {
                      aggregateName,
                      attributeName,
                      relationDetails,
                    },
                    EXPORTABLE(
                      (
                          aggregateName,
                          attributeName,
                          remoteResource,
                          sql,
                          sqlKeysMatch
                        ) =>
                        (localAlias, remoteAlias) =>
                          sql`\
(
  select ${sql.identifier(aggregateName)}(${remoteAlias}.${sql.identifier(
                            attributeName
                          )})
  from ${remoteResource.from as SQL} as ${remoteAlias}
  where ${sqlKeysMatch(localAlias, remoteAlias)}
)`,
                      [
                        aggregateName,
                        attributeName,
                        remoteResource,
                        sql,
                        sqlKeysMatch,
                      ]
                    )
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
                  "orderBy"
                )
              ) {
                continue;
              }

              addAscDesc(
                `Adding related-by-column orderBy enum values for ${pgCodec.name}->${relation.remoteResource.name}.${attributeName}.`,
                "orderByRelatedColumnEnum",
                {
                  attributeName,
                  relationDetails,
                },
                EXPORTABLE(
                  (attributeName, remoteResource, sql, sqlKeysMatch) =>
                    (localAlias, remoteAlias) =>
                      sql`
(
select ${remoteAlias}.${sql.identifier(attributeName)}
from ${remoteResource.from as SQL} ${remoteAlias}
where ${sqlKeysMatch(localAlias, remoteAlias)}
)
`,
                  [attributeName, remoteResource, sql, sqlKeysMatch]
                )
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

              // Looks good
              addAscDesc(
                `Adding orderBy enum value for computed column ${pgCodec.name}->${relation.remoteResource.name}.${resource.name}().`,
                "orderByRelatedComputedColumnEnum",
                {
                  relationDetails,
                  resource,
                },
                EXPORTABLE(
                  (remoteResource, resource, sql, sqlKeysMatch) =>
                    (localAlias, remoteAlias) => {
                      if (typeof resource.from !== "function") {
                        throw new Error(
                          `Cannot be a computed column with a non-functional 'from'`
                        );
                      }
                      return sql`
(
  select ${resource.from({ placeholder: remoteAlias })}
  from ${remoteResource.from as SQL} as ${remoteAlias}
  where ${sqlKeysMatch(localAlias, remoteAlias)}
)
                `;
                    },
                  [remoteResource, resource, sql, sqlKeysMatch]
                )
              );
            }
          }
        }

        return enumValues;
      },
    },
  },
};

export default PgOrderByRelatedPlugin;
