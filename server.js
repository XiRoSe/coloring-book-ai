import express from 'express';
import Replicate from 'replicate';
import { createServer } from 'http';

const app = express();
app.use(express.json());
app.use(express.static('public'));

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// Generate coloring book page
app.post('/api/generate', async (req, res) => {
  const { prompt, style = 'coloring' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt required' });

  try {
    let fullPrompt;
    if (style === 'coloring') {
      fullPrompt = `children's coloring book page, thick black outlines, white background, simple clean line art, no shading, no color, black and white only, cute illustration of: ${prompt}. Style: cartoon, simple shapes, bold outlines suitable for coloring`;
    } else if (style === 'dotted') {
      fullPrompt = `connect the dots activity page for children, numbered dots forming a cute image of: ${prompt}, white background, black dots with numbers, simple clean design, printable worksheet style`;
    } else if (style === 'tracing') {
      fullPrompt = `children's letter tracing worksheet, dashed lines to trace, clean educational layout, white background, printable activity sheet, featuring: ${prompt}`;
    }

    const output = await replicate.run('black-forest-labs/flux-1.1-pro', {
      input: {
        prompt: fullPrompt,
        aspect_ratio: '3:4',
        output_format: 'png',
        safety_tolerance: 2
      }
    });

    const imageUrl = Array.isArray(output) ? output[0] : output;
    res.json({ url: imageUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
