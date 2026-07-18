import type { Session } from "neo4j-driver";
import knowledgeGraphCatalogJson from "../../policy/knowledge-graph-catalog.json";

type DocumentRelationType = "AMENDS" | "REPLACES" | "CONSOLIDATED_IN" | "IMPLEMENTS";

interface KnowledgeGraphCatalog {
  catalogId: string;
  version: string;
  lastVerifiedAt: string;
  documents: Array<Record<string, unknown> & { documentId: string; sourceTier: string; officialUrl: string | null }>;
  articles: Array<Record<string, unknown> & { articleId: string; documentId: string }>;
  clauses: Array<Record<string, unknown> & { clauseId: string; articleId: string }>;
  decisionGates: Array<Record<string, unknown> & { gateId: string }>;
  policyRules: Array<Record<string, unknown> & { ruleId: string; clauseIds: string[]; gateId: string }>;
  legalInterpretations: Array<Record<string, unknown> & { interpretationId: string; clauseId: string }>;
  sourceSystems: Array<Record<string, unknown> & { sourceSystemId: string }>;
  documentRelations: Array<{ fromDocumentId: string; toDocumentId: string; type: DocumentRelationType }>;
  ruleEvidenceSources: Array<{ ruleId: string; sourceSystemId: string }>;
}

const catalog = knowledgeGraphCatalogJson as KnowledgeGraphCatalog;
const DOCUMENT_RELATION_TYPES = new Set<DocumentRelationType>(["AMENDS", "REPLACES", "CONSOLIDATED_IN", "IMPLEMENTS"]);

const assertUnique = (label: string, ids: string[]): void => {
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) throw new Error(`Knowledge graph catalog has duplicate ${label}: ${[...new Set(duplicates)].join(", ")}`);
};

const assertReferences = (label: string, referencedIds: string[], knownIds: Set<string>): void => {
  const missing = referencedIds.filter(id => !knownIds.has(id));
  if (missing.length) throw new Error(`Knowledge graph catalog has unknown ${label}: ${[...new Set(missing)].join(", ")}`);
};

/**
 * Fails startup before writing a partial graph when the versioned catalog contains
 * duplicate IDs, broken edges or an official source without an official URL.
 */
export const validateKnowledgeGraphCatalog = (): void => {
  const documentIdList = catalog.documents.map(document => document.documentId);
  const articleIdList = catalog.articles.map(article => article.articleId);
  const clauseIdList = catalog.clauses.map(clause => clause.clauseId);
  const gateIdList = catalog.decisionGates.map(gate => gate.gateId);
  const ruleIdList = catalog.policyRules.map(rule => rule.ruleId);
  const sourceSystemIdList = catalog.sourceSystems.map(source => source.sourceSystemId);
  const documentIds = new Set(documentIdList);
  const articleIds = new Set(articleIdList);
  const clauseIds = new Set(clauseIdList);
  const gateIds = new Set(gateIdList);
  const ruleIds = new Set(ruleIdList);
  const sourceSystemIds = new Set(sourceSystemIdList);

  assertUnique("documentId", documentIdList);
  assertUnique("articleId", articleIdList);
  assertUnique("clauseId", clauseIdList);
  assertUnique("gateId", gateIdList);
  assertUnique("ruleId", ruleIdList);
  assertUnique("sourceSystemId", sourceSystemIdList);

  assertReferences("article.documentId", catalog.articles.map(article => article.documentId), documentIds);
  assertReferences("clause.articleId", catalog.clauses.map(clause => clause.articleId), articleIds);
  assertReferences("rule.clauseIds", catalog.policyRules.flatMap(rule => rule.clauseIds), clauseIds);
  assertReferences("rule.gateId", catalog.policyRules.map(rule => rule.gateId), gateIds);
  assertReferences("interpretation.clauseId", catalog.legalInterpretations.map(item => item.clauseId), clauseIds);
  assertReferences(
    "document relation endpoint",
    catalog.documentRelations.flatMap(relation => [relation.fromDocumentId, relation.toDocumentId]),
    documentIds
  );
  assertReferences("rule evidence ruleId", catalog.ruleEvidenceSources.map(item => item.ruleId), ruleIds);
  assertReferences("rule evidence sourceSystemId", catalog.ruleEvidenceSources.map(item => item.sourceSystemId), sourceSystemIds);

  const invalidRelations = catalog.documentRelations.filter(relation => !DOCUMENT_RELATION_TYPES.has(relation.type));
  if (invalidRelations.length) throw new Error(`Knowledge graph catalog has unsupported document relationship types.`);

  const officialWithoutUrl = catalog.documents.filter(
    document => document.sourceTier === "PRIMARY_OFFICIAL" && !document.officialUrl
  );
  if (officialWithoutUrl.length) {
    throw new Error(`Official knowledge graph sources require URLs: ${officialWithoutUrl.map(item => item.documentId).join(", ")}`);
  }
};

export const getKnowledgeGraphCatalog = (): Readonly<KnowledgeGraphCatalog> => catalog;

const createConstraints = async (session: Session): Promise<void> => {
  const statements = [
    "CREATE CONSTRAINT legal_document_id IF NOT EXISTS FOR (n:LegalDocument) REQUIRE n.documentId IS UNIQUE",
    "CREATE CONSTRAINT article_id IF NOT EXISTS FOR (n:Article) REQUIRE n.articleId IS UNIQUE",
    "CREATE CONSTRAINT clause_id IF NOT EXISTS FOR (n:Clause) REQUIRE n.clauseId IS UNIQUE",
    "CREATE CONSTRAINT policy_rule_id IF NOT EXISTS FOR (n:PolicyRule) REQUIRE n.ruleId IS UNIQUE",
    "CREATE CONSTRAINT decision_gate_id IF NOT EXISTS FOR (n:DecisionGate) REQUIRE n.gateId IS UNIQUE",
    "CREATE CONSTRAINT legal_interpretation_id IF NOT EXISTS FOR (n:LegalInterpretation) REQUIRE n.interpretationId IS UNIQUE",
    "CREATE CONSTRAINT source_system_id IF NOT EXISTS FOR (n:SourceSystem) REQUIRE n.sourceSystemId IS UNIQUE",
    "CREATE CONSTRAINT project_code IF NOT EXISTS FOR (n:Project) REQUIRE n.projectCode IS UNIQUE"
  ];
  for (const statement of statements) await session.run(statement);
};

/**
 * Idempotently materializes the versioned legal/policy catalog. It intentionally does
 * not clear Neo4j, so externally curated nodes survive application restarts.
 */
export const seedLegalKnowledgeGraph = async (session: Session): Promise<void> => {
  validateKnowledgeGraphCatalog();
  await createConstraints(session);

  const seedMetadata = { seedCatalog: catalog.catalogId, seedVersion: catalog.version, catalogVerifiedAt: catalog.lastVerifiedAt };
  const documents = catalog.documents.map(document => ({ ...document, ...seedMetadata }));
  const articles = catalog.articles.map(article => ({ ...article, ...seedMetadata }));
  const clauses = catalog.clauses.map(clause => ({ ...clause, ...seedMetadata }));
  const rules = catalog.policyRules.map(rule => ({ ...rule, ...seedMetadata }));
  const gates = catalog.decisionGates.map(gate => ({ ...gate, ...seedMetadata }));
  const interpretations = catalog.legalInterpretations.map(item => ({ ...item, ...seedMetadata }));
  const sourceSystems = catalog.sourceSystems.map(source => ({ ...source, ...seedMetadata }));

  await session.run(
    `UNWIND $rows AS row
     MERGE (document:LegalDocument:Regulation {documentId: row.documentId})
     SET document += row,
         document.regId = row.documentId`,
    { rows: documents }
  );

  await session.run(
    `UNWIND $rows AS row
     MATCH (document:LegalDocument {documentId: row.documentId})
     MERGE (article:Article {articleId: row.articleId})
     SET article += row
     MERGE (document)-[:HAS_ARTICLE]->(article)`,
    { rows: articles }
  );

  await session.run(
    `UNWIND $rows AS row
     MATCH (article:Article {articleId: row.articleId})
     MERGE (clause:Clause {clauseId: row.clauseId})
     SET clause += row
     MERGE (article)-[:HAS_CLAUSE]->(clause)`,
    { rows: clauses }
  );

  await session.run(
    `UNWIND $rows AS row
     MERGE (gate:DecisionGate {gateId: row.gateId})
     SET gate += row`,
    { rows: gates }
  );

  await session.run(
    `UNWIND $rows AS row
     MERGE (rule:PolicyRule {ruleId: row.ruleId})
     SET rule += row
     WITH rule, row
     MATCH (gate:DecisionGate {gateId: row.gateId})
     MERGE (rule)-[:BLOCKS_AT]->(gate)
     WITH rule, row
     UNWIND row.clauseIds AS clauseId
     MATCH (clause:Clause {clauseId: clauseId})
     MERGE (clause)-[:SUPPORTS]->(rule)`,
    { rows: rules }
  );

  await session.run(
    `UNWIND $rows AS row
     MATCH (clause:Clause {clauseId: row.clauseId})
     MERGE (interpretation:LegalInterpretation {interpretationId: row.interpretationId})
     SET interpretation += row
     MERGE (interpretation)-[:INTERPRETS]->(clause)`,
    { rows: interpretations }
  );

  await session.run(
    `UNWIND $rows AS row
     MERGE (source:SourceSystem {sourceSystemId: row.sourceSystemId})
     SET source += row`,
    { rows: sourceSystems }
  );

  for (const relation of catalog.documentRelations) {
    await session.run(
      `MATCH (source:LegalDocument {documentId: $fromDocumentId})
       MATCH (target:LegalDocument {documentId: $toDocumentId})
       MERGE (source)-[:${relation.type}]->(target)`,
      relation
    );
  }

  await session.run(
    `UNWIND $rows AS row
     MATCH (rule:PolicyRule {ruleId: row.ruleId})
     MATCH (source:SourceSystem {sourceSystemId: row.sourceSystemId})
     MERGE (rule)-[:USES_EVIDENCE_FROM]->(source)`,
    { rows: catalog.ruleEvidenceSources }
  );
};
