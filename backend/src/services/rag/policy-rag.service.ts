import { getNeo4jSession } from "../../config/neo4j";

export interface ProjectPolicyDetails {
  projectCode: string;
  name: string;
  developer: string;
  isGuaranteedBySHB: boolean;
  guaranteeContractNo: string;
  evidenceSource: string;
  verificationStatus: string;
  lastVerifiedAt: string;
}

export interface RegulationSourceDetails {
  documentId: string;
  documentNumber: string;
  title: string;
  issuer: string;
  officialUrl: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  legalStatus: string;
  verificationStatus: string;
  sourceTier: string;
  lastVerifiedAt: string;
}

export interface ClausePolicyRuleDetails {
  ruleId: string;
  name: string;
  ruleType: string;
  gateId: string;
  gateName: string;
}

export interface RegulationClauseDetails {
  clauseId: string;
  code: string;
  summary: string;
  description: string;
  vetoPower: boolean;
  textType: string;
  sourceVerificationStatus: string;
  article: { articleId: string; number: string; heading: string } | null;
  source: RegulationSourceDetails | null;
  policyRules: ClausePolicyRuleDetails[];
  interpretations: Array<{
    interpretationId: string;
    statement: string;
    owner: string;
    reviewStatus: string;
    validFrom: string;
  }>;
}

/**
 * Service to execute real Neo4j Cypher queries for GraphRAG policy checks
 */
export const queryProjectGuarantee = async (projectCode: string): Promise<ProjectPolicyDetails | null> => {
  const session = getNeo4jSession();
  try {
    const result = await session.run(
      `MATCH (p:Project {projectCode: $projectCode}) 
       RETURN p.projectCode AS projectCode, 
              p.name AS name, 
              p.developer AS developer, 
              p.isGuaranteedBySHB AS isGuaranteedBySHB, 
              p.guaranteeContractNo AS guaranteeContractNo,
              p.evidenceSource AS evidenceSource,
              p.verificationStatus AS verificationStatus,
              p.lastVerifiedAt AS lastVerifiedAt`,
      { projectCode }
    );

    if (result.records.length === 0) {
      return null;
    }

    const record = result.records[0];
    return {
      projectCode: record.get("projectCode"),
      name: record.get("name"),
      developer: record.get("developer"),
      isGuaranteedBySHB: record.get("isGuaranteedBySHB"),
      guaranteeContractNo: record.get("guaranteeContractNo"),
      evidenceSource: record.get("evidenceSource"),
      verificationStatus: record.get("verificationStatus"),
      lastVerifiedAt: record.get("lastVerifiedAt"),
    };
  } catch (error) {
    console.error(`Neo4j GraphRAG: Failed to query project guarantee for ${projectCode}:`, error);
    return null;
  } finally {
    await session.close();
  }
};

export const queryRegulationClause = async (clauseId: string): Promise<RegulationClauseDetails | null> => {
  const session = getNeo4jSession();
  try {
    const result = await session.run(
      `MATCH (c:Clause {clauseId: $clauseId})
       OPTIONAL MATCH (article:Article)-[:HAS_CLAUSE]->(c)
       OPTIONAL MATCH (source:LegalDocument)-[:HAS_ARTICLE]->(article)
       OPTIONAL MATCH (c)-[:SUPPORTS]->(rule:PolicyRule)
       OPTIONAL MATCH (rule)-[:BLOCKS_AT]->(gate:DecisionGate)
       OPTIONAL MATCH (interpretation:LegalInterpretation)-[:INTERPRETS]->(c)
       WITH c, article, source,
            collect(DISTINCT CASE WHEN rule IS NULL THEN null ELSE {
              ruleId: rule.ruleId,
              name: rule.name,
              ruleType: rule.ruleType,
              gateId: gate.gateId,
              gateName: gate.name
            } END) AS policyRules,
            collect(DISTINCT CASE WHEN interpretation IS NULL THEN null ELSE {
              interpretationId: interpretation.interpretationId,
              statement: interpretation.statement,
              owner: interpretation.owner,
              reviewStatus: interpretation.reviewStatus,
              validFrom: interpretation.validFrom
            } END) AS interpretations
       RETURN c.clauseId AS clauseId,
              c.code AS code,
              c.summary AS summary,
              c.description AS description,
              c.vetoPower AS vetoPower,
              c.textType AS textType,
              c.sourceVerificationStatus AS sourceVerificationStatus,
              CASE WHEN article IS NULL THEN null ELSE {
                articleId: article.articleId,
                number: article.number,
                heading: article.heading
              } END AS article,
              CASE WHEN source IS NULL THEN null ELSE {
                documentId: source.documentId,
                documentNumber: source.documentNumber,
                title: source.title,
                issuer: source.issuer,
                officialUrl: source.officialUrl,
                effectiveFrom: source.effectiveFrom,
                effectiveTo: source.effectiveTo,
                legalStatus: source.legalStatus,
                verificationStatus: source.verificationStatus,
                sourceTier: source.sourceTier,
                lastVerifiedAt: source.catalogVerifiedAt
              } END AS source,
              policyRules,
              interpretations`,
      { clauseId }
    );

    if (result.records.length === 0) {
      return null;
    }

    const record = result.records[0];
    return {
      clauseId: record.get("clauseId"),
      code: record.get("code"),
      summary: record.get("summary"),
      description: record.get("description"),
      vetoPower: record.get("vetoPower"),
      textType: record.get("textType"),
      sourceVerificationStatus: record.get("sourceVerificationStatus"),
      article: record.get("article"),
      source: record.get("source"),
      policyRules: record.get("policyRules"),
      interpretations: record.get("interpretations"),
    };
  } catch (error) {
    console.error(`Neo4j GraphRAG: Failed to query regulation clause ${clauseId}:`, error);
    return null;
  } finally {
    await session.close();
  }
};
