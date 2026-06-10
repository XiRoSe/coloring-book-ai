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

// Story worlds — each defines image + story direction
const THEMES = {
  jungle:     { imageBase: "lush jungle adventure, cute animals, tropical plants, vibrant greenery, exotic birds",       storyBase: "הרפתקה בג'ונגל — גילויים, חיות חמודות, אמץ ועזרה הדדית" },
  space:      { imageBase: "cute child astronaut, colorful planets, stars, rocket ship, space adventure",                storyBase: "מסע לחלל — גילוי כוכבים, פגישת יצורים ידידותיים מחלל" },
  ocean:      { imageBase: "underwater kingdom, friendly mermaid, colorful tropical fish, coral reef, treasure",         storyBase: "ממלכה מתחת לים — בת ים, אלמוגים ואוצרות נסתרים" },
  dragon:     { imageBase: "friendly dragon, magical forest, glowing cave, young hero, fantasy adventure",              storyBase: "דרקון שנראה מפחיד אבל לבו זהב — שיפוט לעומת פתיחת לב" },
  princess:   { imageBase: "brave princess, enchanted castle, magical forest quest, adventure, sword or wand",          storyBase: "נסיכה אמיצה שפותרת הכל בעצמה — עצמאות ותושייה" },
  dinos:      { imageBase: "cute friendly dinosaurs, prehistoric jungle, volcanoes, ferns, colorful dinos together",    storyBase: "חברות בין דינוזאורים שונים — שיתוף פעולה למרות ההבדלים" },
  garden:     { imageBase: "magical garden, talking flowers, tiny fairies, butterflies, glowing mushrooms, nature",     storyBase: "גן קסום עם פיות, פרחים מדברים ופרפרים — קסמי טבע ופלא" },
  pirates:    { imageBase: "friendly young pirates, treasure map, sailing ship, tropical island, ocean adventure",      storyBase: "פיראטים עם לב טוב — הרפתקת ים, מפה לאוצר ועבודת צוות" },
  heroes:     { imageBase: "cute child superhero, colorful cape and costume, city rooftops, saving the day, powers",   storyBase: "ילד/ה שמגלה כוח מיוחד ומשתמש בו לעזור לאחרים — אחריות" },
  farm:       { imageBase: "cheerful farm animals, red barn, green fields, chickens cows pigs together, countryside",   storyBase: "יום בפרחה — חיות עוזרות זו לזו, לימוד על שיתוף ואחריות" },
  custom:     { imageBase: null, storyBase: null }
};

const STYLE_SUFFIX = {
  coloring: (age) => {
    const c = age === 'young' ? 'very simple large shapes, minimal detail, very thick lines' : age === 'mid' ? 'medium detail, clear bold outlines' : 'detailed, intricate patterns';
    return `children's coloring book page, thick bold black outlines, pure white background, NO color NO shading NO gray, clean line art only, ${c}. Black lines on white only, printable style`;
  },
  dotted: (age) => {
    const d = age === 'young' ? '15 to 25 large numbered dots' : age === 'mid' ? '30 to 50 numbered dots' : '60 to 100 numbered dots';
    return `connect the dots activity worksheet, white background, ${d} forming the outline, clear black numbered circles, printable educational worksheet`;
  },
  maze: (age) => {
    const m = age === 'young' ? 'very easy wide paths' : age === 'mid' ? 'medium difficulty' : 'challenging complex';
    return `${m} maze puzzle for children, white background, black walls, clear start and end markers, printable worksheet`;
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
  const { theme = 'custom', customSubject = '', style = 'coloring', age = 'mid', count = 1 } = req.body;
  const themeData = THEMES[theme] || THEMES.custom;
  const subject = themeData.imageBase || customSubject.trim();
  if (!subject) return res.status(400).json({ error: 'Subject required' });
  if (count > 6) return res.status(400).json({ error: 'Max 6 pages' });

  try {
    const styleSuffix = STYLE_SUFFIX[style]?.(age) || STYLE_SUFFIX.coloring(age);
    const prompt = `${subject}, ${styleSuffix}`;

    const outputs = await Promise.all(
      Array.from({ length: Math.min(count, 6) }, () =>
        replicate.run('black-forest-labs/flux-1.1-pro', {
          input: { prompt, aspect_ratio: '3:4', output_format: 'png', safety_tolerance: 5 }
        })
      )
    );
    const urls = outputs.map(o => Array.isArray(o) ? o[0] : String(o));
    res.json({ urls });
  } catch (err) {
    console.error('Generate error:', err.message);
    res.status(500).json({ error: 'שגיאה ביצירת התמונה' });
  }
});

app.post('/api/generate-story', async (req, res) => {
  const { theme = 'custom', customSubject = '', age = 'mid', count = 1, style = 'coloring' } = req.body;
  const themeData = THEMES[theme] || THEMES.custom;
  const storyBase = themeData.storyBase || customSubject.trim();
  if (!storyBase) return res.status(400).json({ error: 'Subject required' });

  const ageDesc   = { young: 'גיל 2–4: משפטים קצרים מאוד, מילים פשוטות', mid: 'גיל 5–7: שפה נגישה וסיפורית', older: 'גיל 8–12: שפה עשירה, עלילה מורכבת' }[age] || 'גיל 5–7';
  const perPage   = { young: '1–2 משפטים קצרים', mid: '2–3 משפטים', older: '3–4 משפטים' }[age];
  const pageCount = Math.min(count, 6);
  const styleHeb  = { coloring: 'דפי צביעה', dotted: 'חיבור נקודות', maze: 'מבוכים' }[style] || 'דפים';

  try {
    const content = `אתה סופר ספרי ילדים מקצועי. צור סיפור קצר, מרתק ובעל ערך בעברית.

עולם / נושא: ${storyBase}
גיל: ${ageDesc}
מספר עמודים: ${pageCount}
סוג פעילות: ${styleHeb}

כללים:
- כל עמוד: ${perPage} שמלווים איור
- עלילה ברורה: פתיחה ← אתגר ← פתרון ← סיום מרגש
- שפה חמה, קצבית ומלאת דמיון
- מוסר השכל פשוט, חיובי ואמיתי
- החזר JSON בלבד, ללא markdown:
{
  "title": "כותרת הספר",
  "subtitle": "תת-כותרת קצרה",
  "pages": [{"page":1,"text":"..."}],
  "moral": "מוסר השכל: ..."
}`;

    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content }]
    });

    const raw = msg.content[0].text.trim();
    const jsonStr = raw.startsWith('{') ? raw : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const story = JSON.parse(jsonStr);
    res.json(story);
  } catch (err) {
    console.error('Story error:', err.message);
    res.status(500).json({ error: 'שגיאה ביצירת הסיפור' });
  }
});

app.get('/api/proxy-image', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('url required');
  try {
    const buf = await fetchBuffer(url);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch { res.status(500).send('fetch failed'); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Coloring Book running on port ${PORT}`));
