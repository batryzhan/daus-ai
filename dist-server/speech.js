import multer from 'multer';
export function speechRoutes(app) {
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 8 * 1024 * 1024 },
        fileFilter: (_req, file, cb) => cb(null, /^audio\/(webm|ogg|mp4|mpeg|wav)/.test(file.mimetype)),
    });
    app.post('/api/speech/transcribe', upload.single('audio'), async (req, res) => {
        if (!req.file)
            return res.status(400).json({ error: 'Қолдау көрсетілетін аудио қажет (8 MB дейін).' });
        if (!process.env.ALEM_API_KEY)
            return res.status(503).json({ error: 'Дауыс қызметі бапталмаған. Мәтін өрісін пайдаланыңыз.' });
        try {
            const body = new FormData();
            body.append('file', new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype }), req.file.originalname);
            body.append('model', 'speech-to-text-kk');
            const response = await fetch('https://llm.alem.ai/v1/audio/transcriptions', {
                method: 'POST',
                headers: { Authorization: `Bearer ${process.env.ALEM_API_KEY}` },
                body,
                signal: AbortSignal.timeout(20000),
            });
            if (!response.ok) {
                console.error(`Alem transcription failed: HTTP ${response.status}`);
                return res.status(response.status === 429 ? 429 : 502).json({ error: 'Дауысты тану қолжетімсіз. Қайталап көріңіз.' });
            }
            const data = await response.json();
            if (typeof data.text !== 'string' || !data.text.trim())
                return res.status(422).json({ error: 'Дауыс естілмеді.' });
            return res.json({ text: data.text.slice(0, 240) });
        }
        catch (error) {
            console.error('Alem transcription request failed:', error instanceof Error ? error.message : 'unknown error');
            return res.status(502).json({ error: 'Дауысты тану қолжетімсіз. Қайталап көріңіз.' });
        }
    });
}
