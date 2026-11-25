import crypto from 'node:crypto'

// Impostazioni chiave/valore su Postgres. I valori segreti (es. refresh token Google)
// vengono cifrati con AES-256-GCM usando una chiave derivata da JWT_SECRET.
export const createSettings = (db, config) => {
  const key = crypto.createHash('sha256').update(`fixlab-settings:${config.JWT_SECRET || 'dev'}`).digest()

  const encrypt = (plain) => {
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
    return { enc: 'v1', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
  }

  const decrypt = (value) => {
    if (!value || value.enc !== 'v1') return ''
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'))
      decipher.setAuthTag(Buffer.from(value.tag, 'base64'))
      return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8')
    } catch {
      return ''
    }
  }

  const get = async (name, fallback = null) => {
    const row = await db.one('SELECT "value" FROM "app_settings" WHERE "key" = $1', [name])
    return row ? row.value : fallback
  }

  const set = async (name, value) => {
    await db.query(
      `INSERT INTO "app_settings" ("key", "value", "updatedAt") VALUES ($1, $2, NOW())
       ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()`,
      [name, JSON.stringify(value)],
    )
  }

  const remove = async (name) => { await db.query('DELETE FROM "app_settings" WHERE "key" = $1', [name]) }

  const getSecret = async (name) => decrypt(await get(name))
  const setSecret = async (name, plain) => set(name, encrypt(plain))

  return { get, set, remove, getSecret, setSecret }
}
