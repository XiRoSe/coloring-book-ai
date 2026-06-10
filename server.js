import express from 'express';
import Replicate from 'replicate';

const app = express();
app.use(express.json({ limit: '1mb' }));
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎨 ציורי running on port ${PORT}`));
