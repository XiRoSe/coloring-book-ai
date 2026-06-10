import express from 'express';
import Replicate from 'replicate';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import https from 'https';
import http from 'http';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

const STYLE_PROMPTS = {
  coloring: (subject, age) => {
    const complexity = age === 'young' ? 'very simple large shapes, minimal detail' : age === 'mid' ? 'medium detail, clear outlines' : 'detailed, intricate patterns';
    return `children's coloring book page, thick bold black outlines, pure white background, NO color NO shading NO gray fills, clean line art only, ${complexity}, cute friendly illustration of: ${subject}. IMPORTANT: black lines on white only, printable coloring page style`;
  },
  dotted: (subject, age) => {
    const dots = age === 'young' ? '15 to 25 numbered dots' : age === 'mid' ? '30 to 50 numbered dots' : '60 to 100 numbered dots';
    return `connect the dots activity worksheet for children, white background, ${dots} arranged to form the outline of: ${subject}, large clear black numbered circles, minimal other decoration, printable educational activity sheet, clean professional worksheet design`;
  },
  maze: (subject, age) => {
    const difficulty = age === 'young' ? 'very easy wide paths, simple' : age === 'mid' ? 'medium difficulty' : 'challenging complex';
    return `${difficulty} maze puzzle for children, white background, black maze walls, clear start and end markers, theme: ${subject}, printable activity worksheet, clean professional design, top-down view`;
  }
};

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

app.post('/api/generate', async (req, res) => {
  const { subject, style = 'coloring', age = 'mid', count = 1 } = req.body;

  if (!subject?.trim()) return res.status(400).json({ error: 'Subject required' });
  if (count > 4) return res.status(400).json({ error: 'Max 4 pages at once' });

  try {
    const promptFn = STYLE_PROMPTS[style] || STYLE_PROMPTS.coloring;
    const prompt = promptFn(subject.trim(), age);

    const promises = Array.from({ length: Math.min(count, 4) }, () =>
      replicate.run('black-forest-labs/flux-1.1-pro', {
        input: { prompt, aspect_ratio: '3:4', output_format: 'png', safety_tolerance: 2 }
      })
    );

    const outputs = await Promise.all(promises);
    const urls = outputs.map(o => Array.isArray(o) ? o[0] : String(o));
    res.json({ urls });
  } catch (err) {
    console.error('Generate error:', err.message);
    res.status(500).json({ error: 'שגיאה ביצירת התמונה, נסה שוב' });
  }
});

app.post('/api/generate-pdf', async (req, res) => {
  const { urls, title = 'My Coloring Book' } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls array required' });
  }

  try {
    const doc = await PDFDocument.create();
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    const font = await doc.embedFont(StandardFonts.Helvetica);

    // Sanitize title to ASCII only
    const safeTitle = title.replace(/[^\x20-\x7E]/g, '').trim() || 'My Coloring Book';

    // Cover page
    const cover = doc.addPage([595, 842]);
    const { width, height } = cover.getSize();
    cover.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
    cover.drawRectangle({ x: 0, y: height - 130, width, height: 130, color: rgb(1, 0.42, 0.21) });

    const titleSize = safeTitle.length > 20 ? 28 : 36;
    cover.drawText(safeTitle, { x: 40, y: height - 75, size: titleSize, font: boldFont, color: rgb(1, 1, 1) });
    cover.drawText(`${urls.length} pages inside`, { x: 40, y: height - 110, size: 20, font, color: rgb(1, 0.9, 0.75) });

    // First image on cover
    const coverBuf = await fetchBuffer(urls[0]);
    const coverImg = await doc.embedPng(coverBuf);
    const sc = Math.min((width - 80) / coverImg.width, (height - 200) / coverImg.height);
    const iw = coverImg.width * sc, ih = coverImg.height * sc;
    cover.drawImage(coverImg, { x: (width - iw) / 2, y: 80, width: iw, height: ih });
    cover.drawText('coloringbook.app', {
      x: (width - font.widthOfTextAtSize('coloringbook.app', 12)) / 2,
      y: 25, size: 12, font, color: rgb(0.7, 0.7, 0.7)
    });

    // Content pages
    for (let i = 0; i < urls.length; i++) {
      const page = doc.addPage([595, 842]);
      page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
      page.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: rgb(1, 0.42, 0.21) });
      page.drawText('Color Me!', { x: 30, y: height - 46, size: 28, font: boldFont, color: rgb(1, 1, 1) });
      page.drawText(`${i + 1} / ${urls.length}`, {
        x: width - boldFont.widthOfTextAtSize(`${i + 1} / ${urls.length}`, 20) - 30,
        y: height - 46, size: 20, font: boldFont, color: rgb(1, 0.85, 0.65)
      });

      const imgBuf = i === 0 ? coverBuf : await fetchBuffer(urls[i]);
      const img = await doc.embedPng(imgBuf);
      const imgSc = Math.min((width - 60) / img.width, (height - 130) / img.height);
      const imgW = img.width * imgSc, imgH = img.height * imgSc;
      page.drawImage(img, { x: (width - imgW) / 2, y: 40, width: imgW, height: imgH });
    }

    const pdfBytes = await doc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="coloring-book.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('PDF error:', err.message);
    res.status(500).json({ error: 'PDF generation failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Coloring Book running on port ${PORT}`));
