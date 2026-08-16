import { chunkText, cleanText, sha256 } from "./text.js";

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sourceImportType(sourceType) {
  if (sourceType === "URL") return "URL_FETCH";
  if (sourceType === "GOOGLE_DRIVE") return "GOOGLE_DRIVE_SYNC";
  return "AI_INGESTION";
}

export async function createKnowledgeSourceWithDocument(prisma, input, actor = {}) {
  const content = cleanText(input.content || input.text || input.rawText || "");
  if (!content) throw new Error("Knowledge document content is required");

  const sourceTitle = cleanText(input.sourceTitle || input.title || input.originalFilename || input.sourceUrl || "Untitled source").slice(0, 240);
  const documentTitle = cleanText(input.documentTitle || input.title || sourceTitle).slice(0, 240);
  const sourceType = input.sourceType;
  const contentHash = sha256(`${sourceType}:${input.sourceUrl || input.originalFilename || ""}:${content}`);

  const existing = await prisma.knowledgeSource.findFirst({
    where: { metadata: { path: ["contentHash"], equals: contentHash } },
    include: {
      documents: { include: { chunks: { orderBy: { chunkIndex: "asc" } } } },
      importJobs: { orderBy: { createdAt: "desc" } },
    },
  }).catch(() => null);
  if (existing) return { source: existing, duplicate: true };

  const chunks = chunkText(content);
  return prisma.$transaction(async tx => {
    const source = await tx.knowledgeSource.create({
      data: {
        title: sourceTitle,
        sourceType,
        sourceUrl: input.sourceUrl || null,
        storageReference: input.storageReference || input.filePath || null,
        originalFilename: input.originalFilename || input.fileName || null,
        uploadedBy: actor.userId || input.uploadedBy || null,
        status: "UPLOADED",
        metadata: {
          ...(input.metadata || {}),
          contentHash,
          mimeType: input.mimeType || null,
          uploadSize: input.uploadSize || null,
        },
      },
    });

    const document = await tx.knowledgeDocument.create({
      data: {
        sourceId: source.id,
        title: documentTitle,
        category: input.category || null,
        content,
        summary: input.summary || null,
        status: "UPLOADED",
        owner: input.owner || actor.userId || null,
        effectiveDate: toDate(input.effectiveDate),
        expirationDate: toDate(input.expirationDate),
        metadata: input.documentMetadata || {},
      },
    });

    if (chunks.length) {
      await tx.knowledgeChunk.createMany({
        data: chunks.map(chunk => ({ documentId: document.id, ...chunk })),
      });
    }

    const importJob = await tx.knowledgeImportJob.create({
      data: {
        sourceId: source.id,
        importType: sourceImportType(sourceType),
        status: "UPLOADED",
        proposedChanges: {
          documentId: document.id,
          chunkCount: chunks.length,
          category: input.category || null,
        },
        warnings: [],
      },
    });

    const fullSource = await tx.knowledgeSource.findUnique({
      where: { id: source.id },
      include: {
        documents: { include: { chunks: { orderBy: { chunkIndex: "asc" } } } },
        importJobs: { orderBy: { createdAt: "desc" } },
      },
    });

    return { source: fullSource, document, importJob, duplicate: false };
  });
}

export async function listKnowledgeSources(prisma, { status, sourceType, q, limit = 50 } = {}) {
  const where = {};
  if (status) where.status = String(status).toUpperCase();
  if (sourceType) where.sourceType = String(sourceType).toUpperCase();
  if (q) {
    where.OR = [
      { title: { contains: String(q), mode: "insensitive" } },
      { sourceUrl: { contains: String(q), mode: "insensitive" } },
      { originalFilename: { contains: String(q), mode: "insensitive" } },
      { documents: { some: { title: { contains: String(q), mode: "insensitive" } } } },
      { documents: { some: { content: { contains: String(q), mode: "insensitive" } } } },
    ];
  }

  return prisma.knowledgeSource.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: Math.min(Number(limit) || 50, 100),
    include: {
      documents: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          title: true,
          category: true,
          summary: true,
          status: true,
          owner: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { chunks: true } },
        },
      },
      importJobs: {
        orderBy: { createdAt: "desc" },
        take: 3,
      },
    },
  });
}

export async function getKnowledgeSource(prisma, id) {
  return prisma.knowledgeSource.findUnique({
    where: { id },
    include: {
      documents: {
        orderBy: { createdAt: "desc" },
        include: { chunks: { orderBy: { chunkIndex: "asc" } } },
      },
      importJobs: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function updateKnowledgeSourceStatus(prisma, id, status, actor = {}) {
  const data = { status };
  if (["APPROVED", "REJECTED", "FAILED", "NEEDS_REVIEW"].includes(status)) {
    data.processedAt = new Date();
  }

  await prisma.$transaction([
    prisma.knowledgeSource.update({ where: { id }, data }),
    prisma.knowledgeDocument.updateMany({
      where: { sourceId: id },
      data: {
        status,
        ...(status === "APPROVED" && actor.userId ? { owner: actor.userId } : {}),
      },
    }),
  ]);

  return prisma.knowledgeSource.findUnique({
    where: { id },
    include: {
      documents: { include: { chunks: { orderBy: { chunkIndex: "asc" } } } },
      importJobs: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function processKnowledgeImport(prisma, sourceId, actor = {}) {
  const source = await getKnowledgeSource(prisma, sourceId);
  if (!source) throw new Error("Knowledge source not found");

  const started = await prisma.knowledgeImportJob.create({
    data: {
      sourceId,
      importType: sourceImportType(source.sourceType),
      status: "PROCESSING",
      proposedChanges: {},
      warnings: [],
    },
  });

  try {
    const documentUpdates = [];
    for (const document of source.documents) {
      let chunks = document.chunks || [];
      if (!chunks.length) {
        const newChunks = chunkText(document.content);
        if (newChunks.length) {
          await prisma.knowledgeChunk.createMany({
            data: newChunks.map(chunk => ({ documentId: document.id, ...chunk })),
          });
          chunks = newChunks;
        }
      }
      const summary = document.summary || cleanText(document.content).slice(0, 700);
      await prisma.knowledgeDocument.update({
        where: { id: document.id },
        data: { status: "NEEDS_REVIEW", summary },
      });
      documentUpdates.push({ documentId: document.id, chunkCount: chunks.length, summary });
    }

    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: "NEEDS_REVIEW", processedAt: new Date() },
    });

    const completed = await prisma.knowledgeImportJob.update({
      where: { id: started.id },
      data: {
        status: "NEEDS_REVIEW",
        proposedChanges: { documents: documentUpdates },
        completedAt: new Date(),
      },
    });

    return { source: await getKnowledgeSource(prisma, sourceId), importJob: completed };
  } catch (error) {
    await prisma.knowledgeSource.update({
      where: { id: sourceId },
      data: { status: "FAILED", processedAt: new Date() },
    }).catch(() => null);
    const failed = await prisma.knowledgeImportJob.update({
      where: { id: started.id },
      data: { status: "FAILED", errorMessage: error.message, completedAt: new Date() },
    });
    throw Object.assign(error, { importJob: failed });
  }
}

export async function searchKnowledge(prisma, query, limit = 20) {
  const q = cleanText(query);
  if (!q) return { documents: [], chunks: [], sources: [] };
  const take = Math.min(Number(limit) || 20, 50);

  const [sources, documents, chunks] = await Promise.all([
    prisma.knowledgeSource.findMany({
      where: {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { sourceUrl: { contains: q, mode: "insensitive" } },
          { originalFilename: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take,
    }),
    prisma.knowledgeDocument.findMany({
      where: {
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { category: { contains: q, mode: "insensitive" } },
          { summary: { contains: q, mode: "insensitive" } },
          { content: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take,
      include: { source: true, _count: { select: { chunks: true } } },
    }),
    prisma.knowledgeChunk.findMany({
      where: { content: { contains: q, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      take,
      include: { document: { include: { source: true } } },
    }),
  ]);

  return { sources, documents, chunks };
}
