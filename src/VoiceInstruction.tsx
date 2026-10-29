import { useEffect, useRef, useState } from 'react';

type Capture = { stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode; chunks: Float32Array[]; timer: ReturnType<typeof setTimeout> };

function makeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const samples = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (const sample of chunk) {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, value < 0 ? value * 32768 : value * 32767, true); offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function VoiceInstruction({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const [status, setStatus] = useState('');
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const capture = useRef<Capture | null>(null);

  function release(active: Capture) {
    clearTimeout(active.timer); active.processor.disconnect(); active.source.disconnect();
    active.processor.onaudioprocess = null; active.stream.getTracks().forEach(track => track.stop());
    void active.context.close();
  }

  useEffect(() => () => { if (capture.current) { release(capture.current); capture.current = null; } }, []);

  async function stop() {
    const active = capture.current;
    if (!active) return;
    capture.current = null;
    const audio = makeWav(active.chunks, active.context.sampleRate);
    release(active); setRecording(false); setProcessing(true); setStatus('Дауыс өңделіп жатыр…');
    try {
      const body = new FormData(); body.append('audio', audio, 'instruction.wav');
      const response = await fetch('/api/speech/transcribe', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      onChange(data.text); setStatus('Мәтінді тексеріп, нұсқауды бекітіңіз.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Дауысты тану мүмкін болмады.'); }
    finally { setProcessing(false); }
  }

  async function start() {
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = event => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      source.connect(processor); processor.connect(context.destination);
      const timer = setTimeout(() => void stop(), 15000);
      capture.current = { stream, context, source, processor, chunks, timer };
      await context.resume();
      setRecording(true); setStatus('Сөйлей беріңіз.');
    } catch {
      if (capture.current) { release(capture.current); capture.current = null; }
      else { stream?.getTracks().forEach(track => track.stop()); if (context) void context.close(); }
      setStatus('Микрофон қолжетімсіз. Қосымша мәтін өрісін пайдаланыңыз.');
    }
  }

  return <div>
    <button className="primary-btn full-btn" disabled={processing} onClick={() => recording ? void stop() : void start()}>{recording ? 'Жазуды тоқтату' : 'Сөйлеу · микрофон'}</button>
    <p role="status">{status}</p>
    {value && <blockquote>{value}</blockquote>}
    <details><summary>Мәтінмен енгізу немесе түзету</summary><textarea aria-label="Қосымша мәтін" value={value} maxLength={240} onChange={e => onChange(e.target.value)} /></details>
  </div>;
}
