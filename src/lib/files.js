import { qs, request } from './api'

export const MAX_UPLOAD_MB = 15
const MAX_SIDE = 2000

// Le foto del telefono pesano 3–8 MB: le ridimensioniamo (lato lungo 2000 px, JPEG 0,82) prima
// dell'invio. Restano nitide per targhette e matricole ma pesano ~10 volte meno.
export const compressImage = async (file) => {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || typeof createImageBitmap !== 'function') return file
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) { bitmap.close?.(); return file }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

// Carica un file sul server e restituisce i metadati da salvare nell'intervento.
export const uploadFile = async (file, { kind = 'attachment', interventionId } = {}) => {
  const prepared = await compressImage(file)
  if (prepared.size > MAX_UPLOAD_MB * 1024 * 1024) throw new Error(`${file.name} supera ${MAX_UPLOAD_MB} MB.`)
  const type = prepared.type || 'application/octet-stream'
  return request('POST', `/api/files${qs({ name: prepared.name, type, kind, interventionId })}`, prepared)
}
