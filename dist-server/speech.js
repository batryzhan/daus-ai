import multer from 'multer';
export function speechRoutes(app) { const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 }, fileFilter: (_r, f, cb) => cb(null, /^audio\/(webm|ogg|mp4|mpeg|wav)/.test(f.mimetype)) }); app.post('/api/speech/transcribe', upload.single('audio'), async (req, res) => { if (!req.file)
    return res.status(400).json({ error: 'Қолдау көрсетілетін аудио қажет (8 MB дейін).' }); if (!process.env.GROQ_API_KEY)
    return res.status(503).json({ error: 'Дауыс қызметі бапталмаған. Мәтін өрісін пайдаланыңыз.' }); try {
    const body = new FormData();
    body.append('file', new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype }), req.file.originalname);
    body.append('model', 'whisper-large-v3');
    body.append('language', 'kk');
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, body, signal: AbortSignal.timeout(20000) });
    if (!r.ok)
        return res.status(r.status === 429 ? 429 : 502).json({ error: 'Дауысты тану қолжетімсіз. Қайталап көріңіз.' });
    const data = await r.json();
    if (!data.text?.trim())
        return res.status(422).json({ error: 'Дауыс естілмеді.' });
    res.json({ text: data.text.slice(0, 240) });
}
catch {
    res.status(502).json({ error: 'Дауысты тану уақыты аяқталды.' });
} }); }
