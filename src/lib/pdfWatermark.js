import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'

// Stamps every page of a base64 PDF with a translucent diagonal watermark
// (the recipient's name) plus a small footer line, and returns new base64.
// Used on welcome-email attachments so each copy is personal to its recipient.
export async function watermarkPdfBase64(base64, watermarkText, footerText) {
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  const pdf   = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const font  = await pdf.embedFont(StandardFonts.HelveticaBold)
  const small = await pdf.embedFont(StandardFonts.Helvetica)

  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize()

    // Diagonal name across the middle: pick the largest size (within bounds)
    // whose rotated text still fits inside ~70% of the page diagonal, then
    // start it half its width down-left of the centre so its midpoint is the
    // page centre.
    const diag = Math.sqrt(width * width + height * height)
    let size = 76
    let tw = font.widthOfTextAtSize(watermarkText, size)
    if (tw > diag * 0.9) {
      size = Math.max(18, size * (diag * 0.9) / tw)
      tw = font.widthOfTextAtSize(watermarkText, size)
    }
    const half = tw / 2 * Math.SQRT1_2
    page.drawText(watermarkText, {
      x: width / 2 - half,
      y: height / 2 - half,
      size,
      font,
      color: rgb(0.55, 0.55, 0.6),
      opacity: 0.16,
      rotate: degrees(45),
    })

    if (footerText) {
      page.drawText(footerText, {
        x: 24,
        y: 12,
        size: 7,
        font: small,
        color: rgb(0.45, 0.45, 0.5),
        opacity: 0.9,
      })
    }
  }

  const out = await pdf.save()
  let bin = ''
  const arr = new Uint8Array(out)
  const CHUNK = 0x8000
  for (let i = 0; i < arr.length; i += CHUNK) {
    bin += String.fromCharCode(...arr.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export const isPdfAttachment = att =>
  /\.pdf$/i.test(att.name ?? '') || String(att.type ?? '').includes('pdf')
