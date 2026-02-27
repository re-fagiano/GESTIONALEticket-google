import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis

const runtimeEnv = globalThis?.process?.env || {}
const databaseUrl = (runtimeEnv.DATABASE_URL || '').trim()

const prisma = databaseUrl
  ? (globalForPrisma.__prisma ?? new PrismaClient())
  : null

if (databaseUrl && runtimeEnv.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma
}

export const isDatabaseConfigured = Boolean(databaseUrl)

export default prisma
