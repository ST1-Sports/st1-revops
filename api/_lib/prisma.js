import { PrismaClient } from '@prisma/client';

// Singleton to prevent exhausting DB connections in serverless hot-reload
const globalForPrisma = globalThis;
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
