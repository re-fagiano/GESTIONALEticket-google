import crypto from 'node:crypto'
import pg from 'pg'

// TIMESTAMP(3) senza timezone: Prisma salva in UTC. Lo leggiamo come UTC per non spostare le ore.
pg.types.setTypeParser(1114, (value) => (value ? new Date(`${value.replace(' ', 'T')}Z`) : null))
// ...e scriviamo le Date in UTC, qualunque sia il fuso del server.
pg.defaults.parseInputDatesAsUTC = true

export const newId = () => crypto.randomUUID()

export const createDb = (connectionString, { max = 10 } = {}) => {
  const useSsl = /sslmode=require/.test(connectionString)
  // timezone=UTC: le colonne TIMESTAMP(3) (senza fuso) sono sempre in UTC, anche per NOW() lato database.
  const pool = new pg.Pool({ connectionString, max, options: '-c timezone=UTC', ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}) })

  const query = async (text, params = []) => (await pool.query(text, params)).rows
  const one = async (text, params = []) => (await pool.query(text, params)).rows[0] || null

  // Esegue fn dentro una transazione: commit se va a buon fine, rollback in caso di errore.
  const tx = async (fn) => {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const scoped = {
        query: async (text, params = []) => (await client.query(text, params)).rows,
        one: async (text, params = []) => (await client.query(text, params)).rows[0] || null,
      }
      const result = await fn(scoped)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  return { pool, query, one, tx, close: () => pool.end() }
}
