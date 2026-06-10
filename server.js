import express from 'express';
import Replicate from 'replicate';
import Anthropic from '@anthropic-ai/sdk';
import https from 'https';
import http from 'http';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const STYLE_PROMPTS = {
  coloring: (subject, age) => {
    const complexity = age === 'young' ? 'very simple large shapes, minimal detail, thick lines' : age === 'mid' ? 'medium detail, clear bold outlines' : 'detailed, intricate patterns, fine lines';
    return `children's coloring book page, thick bold black outlines, pure white background, NO color NO shading NO gray fills, clean line art only, ${complexity}, cute friendly illustration of: ${subject}. IMPORTANT: black lines on white only, printable coloring page style`;
  },
  dotted: (subject, age) => {
    const dots = age === 'young' ? '15 to 25 numbered dots' : age === 'mid' ? '30 to 50 numbered dots' : '60 to 100 numbered dots';
    return `connect the dots activity worksheet for children, white background, ${dots} arranged to form the outline of: ${subject}, large clear black numbered circles, minimal other decoration, printable educational activity sheet`;
  },
  maze: (subject, age) => {
    const difficulty = age === 'young' ? 'very easy wide paths, simple' : age === 'mid' ? 'medium difficulty' : 'challenging complex';
    return `${difficulty} maze puzzle for children, white background, black maze walls, clear start and end markers, theme: ${subject}, printable activity worksheet, clean design`;
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
  if (count > 6) return res.status(400).json({ error: 'Max 6 pages at once' });

  try {
    const promptFn = STYLE_PROMPTS[style] || STYLE_PROMPTS.coloring;
    const prompt = promptFn(subject.trim(), age);

    const promises = Array.from({ length: Math.min(count, 6) }, () =>
      replicate.run('black-forest-labs/flux-1.1-pro', {
        input: { prompt, aspect_ratio: '3:4', output_format: 'png', safety_tolerance: 5 }
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

app.post('/api/generate-story', async (req, res) => {
  const { subject, age = 'mid', count = 1, style = 'coloring' } = req.body;
  if (!subject?.trim()) return res.status(400).json({ error: 'Subject required' });

  const ageDesc = { young: 'גיל 2-4 (משפטים קצרים מאוד, מילים פשוטות)', mid: 'גיל 5-7 (שפה נגישה, מעט ריגוש)', older: 'גיל 8-12 (שפה עשירה יותר, עלילה מורכבת)' }[age] || 'גיל 5-7';
  const sentenceCount = { young: '1-2 משפטים קצרים', mid: '2-3 משפטים', older: '3-4 משפטים' }[age] || '2-3 משפטים';
  const pageCount = Math.min(count, 6);
  const styleHeb = { coloring: 'דף צביעה', dotted: 'חיבור נקודות', maze: 'מבוך' }[style] || 'דף';

  try {
    const prompt = `אתה כותב סיפורי ילדים מקצועי. צור סיפור קצר ומרתק בעברית.

נושא: ${subject}
גיל: ${ageDesc}
מספר עמודים: ${pageCount}
סוג פעילות: ${styleHeb}

הנחיות:
- כל עמוד: ${sentenceCount} שמלווים איור של ${subject}
- עלילה: התחלה → אמצע עם אתגר קטן → סוף מרגש ומאושר
- שפה חמה, מלאת קסם ואהבה
- מוסר השכל פשוט וחיובי בסוף
- החזר JSON בלבד, ללא כל markdown:
{
  "title": "כותרת קצרה וקסומה",
  "subtitle": "תת כותרת קצרה (אופציונלי)",
  "pages": [
    {"page": 1, "text": "..."},
    {"page": 2, "text": "..."}
  ],
  "moral": "מוסר השכל: ..."
}`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = message.content[0].text.trim();
    const jsonStr = raw.startsWith('{') ? raw : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const story = JSON.parse(jsonStr);
    res.json(story);
  } catch (err) {
    console.error('Story error:', err.message);
    res.status(500).json({ error: 'שגיאה ביצירת הסיפור' });
  }
});

// Proxy images to avoid CORS in html2canvas
app.get('/api/proxy-image', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('url required');
  try {
    const buf = await fetchBuffer(url);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch {
    res.status(500).send('fetch failed');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Coloring Book running on port ${PORT}`));
