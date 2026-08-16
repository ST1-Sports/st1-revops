import { chunkText } from "./text.js";
import { getKnowledgeSource } from "./repository.js";

function latestImportJob(source, importJobId) {
  if (importJobId) return (source.importJobs || []).find(job => job.id === importJobId) || null;
  return (source.importJobs || [])[0] || null;
}

function ingestionFromJob(job) {
  return job?.proposedChanges?.documents?.[0]?.ingestion || null;
}

function selectedRows(ingestion, mode, selectedIndexes = []) {
  const table = Array.isArray(ingestion?.review_table) ? ingestion.review_table : [];
  if (mode === "approve_all") return table;
  const selected = new Set(selectedIndexes.map(Number));
  return table.filter(row => selected.has(Number(row.index)));
}

function factRows(ingestion, mode) {
  if (mode !== "approve_all") return [];
  return Array.isArray(ingestion?.structured_facts) ? ingestion.structured_facts : [];
}

async function ensureChunks(prisma, document) {
  const count = await prisma.knowledgeChunk.count({ where: { documentId: document.id } });
  if (count > 0) return count;
  const chunks = chunkText(document.content);
  if (chunks.length) {
    await prisma.knowledgeChunk.createMany({
      data: chunks.map(chunk => ({ documentId: document.id, ...chunk })),
    });
  }
  return chunks.length;
}

export async function commitApprovedKnowledge(prisma, { sourceId, importJobId, mode, selectedIndexes = [], actor = {}, note = "" }) {
  const source = await getKnowledgeSource(prisma, sourceId);
  if (!source) throw new Error("Knowledge source not found");

  const job = latestImportJob(source, importJobId);
  if (!job) throw new Error("Knowledge import job not found");

  const document = source.documents?.[0];
  if (!document) throw new Error("Knowledge document not found");

  const ingestion = ingestionFromJob(job);
  if (!ingestion) throw new Error("No AI ingestion proposal found on import job");

  const rows = selectedRows(ingestion, mode, selectedIndexes);
  const facts = factRows(ingestion, mode);
  if (mode === "approve_selected" && !rows.length) {
    throw new Error("Select at least one proposed change to approve");
  }

  await ensureChunks(prisma, document);

  const committed = [];
  await prisma.$transaction(async tx => {
    for (const row of rows) {
      const record = await tx.knowledgeStructuredRecord.create({
        data: {
          sourceId,
          documentId: document.id,
          importJobId: job.id,
          recordType: "spreadsheet_row",
          action: row.action || "Needs Review",
          status: "APPROVED",
          sourceRow: row.source_row ? String(row.source_row) : null,
          fields: row.fields || {},
          existingValue: row.existing_value || null,
          proposedValue: row.proposed_value || null,
          difference: Number.isFinite(Number(row.difference)) ? Number(row.difference) : null,
          flags: row.flags || [],
          confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : null,
          approvedBy: actor.userId || null,
          approvedAt: new Date(),
        },
      });
      committed.push({ id: record.id, recordType: record.recordType, action: record.action });
    }

    for (const fact of facts) {
      const record = await tx.knowledgeStructuredRecord.create({
        data: {
          sourceId,
          documentId: document.id,
          importJobId: job.id,
          recordType: "fact",
          action: "Add",
          status: "APPROVED",
          sourceRow: null,
          fields: fact,
          existingValue: null,
          proposedValue: { fact: fact.fact, factType: fact.fact_type },
          difference: null,
          flags: [],
          confidence: Number.isFinite(Number(fact.confidence)) ? Number(fact.confidence) : null,
          approvedBy: actor.userId || null,
          approvedAt: new Date(),
        },
      });
      committed.push({ id: record.id, recordType: record.recordType, action: record.action });
    }

    await tx.knowledgeDocument.updateMany({
      where: { sourceId },
      data: { status: "APPROVED" },
    });
    await tx.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: "APPROVED", processedAt: new Date() },
    });
    await tx.knowledgeImportJob.update({
      where: { id: job.id },
      data: { status: "APPROVED", completedAt: new Date() },
    });
    await tx.knowledgeReviewEvent.create({
      data: {
        sourceId,
        importJobId: job.id,
        action: mode === "approve_all" ? "APPROVE_ALL" : "APPROVE_SELECTED",
        userId: actor.userId || null,
        selectedChanges: mode === "approve_all" ? { all: true } : { selectedIndexes },
        committedChanges: { records: committed },
        note: note || null,
      },
    });
  });

  return { source: await getKnowledgeSource(prisma, sourceId), committed };
}

export async function rejectKnowledgeImport(prisma, { sourceId, importJobId, actor = {}, note = "" }) {
  const source = await getKnowledgeSource(prisma, sourceId);
  if (!source) throw new Error("Knowledge source not found");
  const job = latestImportJob(source, importJobId);

  await prisma.$transaction([
    prisma.knowledgeDocument.updateMany({ where: { sourceId }, data: { status: "REJECTED" } }),
    prisma.knowledgeSource.update({ where: { id: sourceId }, data: { status: "REJECTED", processedAt: new Date() } }),
    ...(job ? [prisma.knowledgeImportJob.update({ where: { id: job.id }, data: { status: "REJECTED", completedAt: new Date() } })] : []),
    prisma.knowledgeReviewEvent.create({
      data: {
        sourceId,
        importJobId: job?.id || null,
        action: "REJECT",
        userId: actor.userId || null,
        note: note || null,
      },
    }),
  ]);

  return { source: await getKnowledgeSource(prisma, sourceId) };
}

export async function saveEditedKnowledgeProposal(prisma, { sourceId, importJobId, proposedChanges, warnings, actor = {}, note = "" }) {
  const source = await getKnowledgeSource(prisma, sourceId);
  if (!source) throw new Error("Knowledge source not found");
  const job = latestImportJob(source, importJobId);
  if (!job) throw new Error("Knowledge import job not found");

  await prisma.$transaction([
    prisma.knowledgeImportJob.update({
      where: { id: job.id },
      data: {
        proposedChanges: proposedChanges || job.proposedChanges || {},
        warnings: Array.isArray(warnings) ? warnings : job.warnings || [],
        status: "NEEDS_REVIEW",
      },
    }),
    prisma.knowledgeReviewEvent.create({
      data: {
        sourceId,
        importJobId: job.id,
        action: "EDIT_PROPOSAL",
        userId: actor.userId || null,
        selectedChanges: proposedChanges || {},
        note: note || null,
      },
    }),
  ]);

  return { source: await getKnowledgeSource(prisma, sourceId) };
}
