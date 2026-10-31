require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const {
  REPLICATE_API_TOKEN, ANTHROPIC_API_KEY, ACCESS_KEY,
  CHAT_MODEL = 'claude-sonnet-4-5',
  IMAGE_MODEL = 'black-forest-labs/flux-schnell',
  VIDEO_MODEL = 'minimax/video-01',
  VIDEO_IMAGE_FIELD = 'first_frame_image', // reference image ka field name (model ke hisaab se badlo)
  ELEVENLABS_API_KEY,
  VOICE_MODEL = 'eleven_multilingual_v2', // Hindi/Hinglish ke liye multilingual
  PORT = 3000,
} = process.env;

// Simple password so strangers cannot burn your credits
app.use('/api', (req, res, next) => {
  if (ACCESS_KEY && req.get('x-access-key') !== ACCESS_KEY)
    return res.status(401).json({ error: 'Galat access key' });
  next();
});

const rep = (path, opts = {}) =>
  fetch('https://api.replicate.com/v1' + path, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + REPLICATE_API_TOKEN,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  }).then(r => r.json());

const shape = p => ({
  id: p.id,
  status: p.status || 'failed',
  error: p.error || p.detail || null,
  url: [].concat(p.output || [])[0] || null,
});

const start = (model, imgField) => async (req, res) => {
  try {
    const prompt = String(req.body.prompt || '').slice(0, 2000);
    if (!prompt) return res.status(400).json({ error: 'Prompt likho' });
    const input = { prompt };
    if (imgField && req.body.image) input[imgField] = req.body.image;
    const p = await rep(`/models/${model}/predictions`, {
      method: 'POST',
      headers: { Prefer: 'wait=30' },
      body: JSON.stringify({ input }),
    });
    res.json(shape(p));
  } catch (e) { res.status(500).json({ error: e.message }); }
};

app.post('/api/image', start(IMAGE_MODEL));
app.post('/api/video', start(VIDEO_MODEL, VIDEO_IMAGE_FIELD));

app.get('/api/status/:id', async (req, res) => {
  try { res.json(shape(await rep('/predictions/' + encodeURIComponent(req.params.id)))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/chat', async (req, res) => {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        max_tokens: 2000,
        system: 'Tum ek helpful AI assistant ho. User ki language (Hindi/Hinglish/English) mein jawab do.',
        messages: req.body.messages,
      }),
    });
    const d = await r.json();
    if (!r.ok) return res.status(500).json({ error: d.error?.message || 'API error' });
    res.json({ text: d.content.map(c => c.text || '').join('') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ---- Voice (ElevenLabs text-to-speech) ----
const EL = 'https://api.elevenlabs.io/v1';
app.get('/api/voices', async (req, res) => {
  try {
    const r = await fetch(EL + '/voices', { headers: { 'xi-api-key': ELEVENLABS_API_KEY } });
    const d = await r.json();
    if (!r.ok) return res.status(500).json({ error: d.detail?.message || 'ElevenLabs error' });
    res.json({ voices: d.voices.map(v => ({ id: v.voice_id, name: v.name })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/voice', async (req, res) => {
  try {
    const text = String(req.body.text || '').slice(0, 5000);
    if (!text || !req.body.voice) return res.status(400).json({ error: 'Text aur voice chuno' });
    const r = await fetch(EL + '/text-to-speech/' + encodeURIComponent(req.body.voice), {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, model_id: VOICE_MODEL }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return res.status(500).json({ error: d.detail?.message || 'ElevenLabs error ' + r.status });
    }
    res.set('Content-Type', 'audio/mpeg').send(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.status(500).json({ error: e.message }); }
});



module.exports = app;
