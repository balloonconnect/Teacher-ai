import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require_ = createRequire(import.meta.url);
const fontFile = (pkg: string, file: string) => join(dirname(require_.resolve(`${pkg}/package.json`)), 'files', file);
const F = {
  latin: fontFile('@fontsource/noto-sans', 'noto-sans-latin-400-normal.woff'),
  latinB: fontFile('@fontsource/noto-sans', 'noto-sans-latin-700-normal.woff'),
  tamil: fontFile('@fontsource/noto-sans-tamil', 'noto-sans-tamil-tamil-400-normal.woff'),
  tamilB: fontFile('@fontsource/noto-sans-tamil', 'noto-sans-tamil-tamil-700-normal.woff'),
};
export type CertData = { ref: string; verifyUrl: string; snapshot: any; status: string };
const GOLD = '#B8892B', INK = '#1F2340', MUTED = '#6B7085', PRIMARY = '#4F46E5';
const hasTamil = (s: string) => /[஀-௿]/.test(s);

/** Generates a real A4-landscape PDF with Tamil shaping support and a QR code linking to the verification page. */
export async function renderCertificatePdf(d: CertData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: `Certificate ${d.ref}`, Author: 'AI Learning Platform' } });
  const chunks: Buffer[] = []; doc.on('data', c => chunks.push(c));
  const done = new Promise<Buffer>(res => doc.on('end', () => res(Buffer.concat(chunks))));
  doc.registerFont('L', F.latin); doc.registerFont('LB', F.latinB); doc.registerFont('T', F.tamil); doc.registerFont('TB', F.tamilB);
  const W = doc.page.width, H = doc.page.height; const s = d.snapshot;
  const text = (t: string, y: number, size: number, color: string, bold = false, opts: any = {}) => {
    const ta = hasTamil(t); doc.font(ta ? (bold ? 'TB' : 'T') : bold ? 'LB' : 'L').fontSize(size).fillColor(color).text(t, 60, y, { width: W - 120, align: 'center', ...opts });
  };
  doc.rect(0, 0, W, H).fill('#FBF3DC');
  doc.rect(22, 22, W - 44, H - 44).lineWidth(3).strokeColor(GOLD).fillAndStroke('#FFFFFF', GOLD);
  doc.rect(32, 32, W - 64, H - 64).lineWidth(0.8).strokeColor(GOLD).stroke();
  text('AI Learning Platform', 56, 14, PRIMARY, true);
  text('WEEKLY TEST ACHIEVEMENT CERTIFICATE', 82, 26, GOLD, true);
  text('வாராந்திர தேர்வு சாதனைச் சான்றிதழ்', 118, 15, GOLD, true);
  text('This certificate is proudly presented to', 158, 12, MUTED);
  text(s.student_name, 180, 34, INK, true);
  if (s.student_name_ta) text(s.student_name_ta, 226, 20, INK, true);
  const date = new Date(s.achieved_on).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  text(`for passing ${s.test_title} (Class ${s.class_level}, ${s.subject_en}) with ${s.marks} out of ${s.total} marks (${s.pct}%).`, 272, 13, INK);
  text(`Pass mark: ${s.pass_pct}%  ·  Academic year ${s.academic_year}  ·  Achieved on ${date}`, 296, 10.5, MUTED);
  const qr = await QRCode.toBuffer(d.verifyUrl, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
  doc.image(qr, 60, H - 150, { width: 92 });
  doc.font('LB').fontSize(10).fillColor(INK).text(`Reference No. ${d.ref}`, 166, H - 140, { width: 420 });
  doc.font('L').fontSize(8.5).fillColor(PRIMARY).text(`Verify: ${d.verifyUrl}`, 166, H - 124, { width: 420 });
  doc.font('L').fontSize(8).fillColor(MUTED).text('Scan the QR code or open the link to check that this certificate is valid.', 166, H - 108, { width: 420 });
  doc.font('L').fontSize(7.5).fillColor(MUTED).text('Platform-issued achievement certificate. Not an official board, school or government certificate.', W - 330, H - 120, { width: 270, align: 'right' });
  if (d.status !== 'valid') { doc.save().rotate(-20, { origin: [W / 2, H / 2] }).font('LB').fontSize(70).fillColor('#B91C1C').opacity(0.18).text(d.status.toUpperCase(), 0, H / 2 - 40, { width: W, align: 'center' }).restore(); }
  doc.end(); return done;
}
