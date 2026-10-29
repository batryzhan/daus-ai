import {speechRoutes} from './speech.js';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { Redis } from '@upstash/redis';

const app = express();
app.use(cors(process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',').map(v=>v.trim()) } : undefined));
app.use(express.json({ limit: '32kb' }));
const PORT = Number(process.env.PORT) || 3000;
type Stone = { id: string; color: string; colorName: string; position: string; positionName: string; x: number; y: number; size: number };
type Round = { targetId: string; answered: boolean; result?: { correct: boolean; points: number; targetId: string } };
const rounds = new Map<string, Round>();
const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = redisUrl && redisToken ? new Redis({url:redisUrl, token:redisToken}) : null;
const analyzeHits = new Map<string, { count:number; start:number }>();
const stones: Stone[] = [
  {id:'blue-center',color:'#496f80',colorName:'көк',position:'ортасында',positionName:'ортада',x:50,y:48,size:54},
  {id:'red-left',color:'#b9513c',colorName:'қызыл',position:'сол жақта',positionName:'сол жақта',x:19,y:67,size:47},
  {id:'gold-right',color:'#d3a454',colorName:'сары',position:'оң жақта',positionName:'оң жақта',x:81,y:26,size:44},
  {id:'green-top',color:'#59724c',colorName:'жасыл',position:'жоғарыда',positionName:'жоғарыда',x:49,y:17,size:42},
  {id:'cream-bottom',color:'#e2d0ae',colorName:'ақ',position:'төменде',positionName:'төменде',x:72,y:77,size:41},
  {id:'rust-top-left',color:'#a9553c',colorName:'қызыл',position:'жоғары сол жақта',positionName:'жоғары сол жақта',x:28,y:29,size:39},
  {id:'blue-bottom-left',color:'#496f80',colorName:'көк',position:'төменгі сол жақта',positionName:'төменгі сол жақта',x:29,y:84,size:38},
];
app.get('/api/health', (_req,res) => res.json({status:'ok', aiConfigured:Boolean(process.env.GROQ_API_KEY)}));
app.post('/api/game/round', async (_req,res) => {
  const id = randomUUID(); const target = stones[0];
  try {
    if (redis) await redis.set(`round:${id}`, target.id, {ex: 3600});
    else if (process.env.VERCEL) return res.status(503).json({error:'Ойын деректер қоймасы бапталмаған.'});
    else rounds.set(id,{targetId:target.id,answered:false});
  } catch { return res.status(503).json({error:'Ойын серверіне қосыла алмадық.'}); }
  res.json({id,stones,target:{id:target.id,color:target.colorName,position:target.position}, targetId:target.id});
});
app.post('/api/game/round/:id/answer', async (req,res) => {
  const choice=req.body?.choiceId;
  if (typeof choice!=='string' || !stones.some(s=>s.id===choice)) return res.status(400).json({error:'Асықты таңдаңыз.'});
  let targetId: string;
  try {
    if (redis) {
      const result = await redis.eval<[], number>("local v = redis.call('GET', KEYS[1]); if not v then return 0 end; if v == 'answered' then return -1 end; redis.call('SET', KEYS[1], 'answered', 'KEEPTTL'); return 1", [`round:${req.params.id}`], []);
      if (result === 0) return res.status(404).json({error:'Бұл раунд табылмады. Жаңа раунд бастаңыз.'});
      if (result === -1) return res.status(409).json({error:'Бұл раундқа жауап беріліп қойды.'});
      targetId = stones[0].id;
    } else {
      if (process.env.VERCEL) return res.status(503).json({error:'Ойын деректер қоймасы бапталмаған.'});
      const round=rounds.get(req.params.id);
      if (!round) return res.status(404).json({error:'Бұл раунд табылмады. Жаңа раунд бастаңыз.'});
      if (round.answered) return res.status(409).json({error:'Бұл раундқа жауап беріліп қойды.'});
      round.answered=true; targetId=round.targetId;
    }
  } catch { return res.status(503).json({error:'Ойын серверіне қосыла алмадық.'}); }
  const correct=choice===targetId;
  const target=stones.find(s=>s.id===targetId)!;
  res.json({correct,points:correct?1:0,targetId,target:{color:target.colorName,position:target.position}});
});
app.post('/api/instruction/analyze', async (req,res) => {
  const ip=req.ip || req.socket.remoteAddress || 'unknown'; const now=Date.now(); const hits=analyzeHits.get(ip);
  if(hits&&now-hits.start<60_000&&hits.count>=12) return res.status(429).json({error:'Талдау сұранысы жиі жіберілді. Бір минуттан кейін қайталаңыз.'});
  if(!hits||now-hits.start>=60_000) analyzeHits.set(ip,{count:1,start:now}); else hits.count++;
  const {instruction,target,result}=req.body ?? {};
  if(typeof instruction!=='string'||!instruction.trim()||instruction.length>240) return res.status(400).json({error:'Нұсқау 1–240 таңба аралығында болуы керек.'});
  if(!target||typeof target.color!=='string'||typeof target.position!=='string'||typeof result?.correct!=='boolean') return res.status(400).json({error:'Талдау деректері толық емес.'});
  if(!process.env.GROQ_API_KEY) return res.status(503).json({error:'AI талдауы әзірге қолжетімсіз.'});
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),12000);
  try {
    const response=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${process.env.GROQ_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.GROQ_LLM_MODEL||'openai/gpt-oss-120b',temperature:0.2,response_format:{type:'json_object'},messages:[{role:'system',content:'Сен қазақ тіліндегі ойын нұсқауын қысқа әрі жылы талдайсың. Ойын нәтижесін өзгертпе. Тек JSON қайтар: instruction_clear(boolean), mentioned_color(string|null), mentioned_position(string|null), language_feedback_kk(string), suggested_instruction_kk(string). Дәлелсіз қорытынды жасама; белгісіз болса instruction_clear=false және бейтарап пікір бер.'},{role:'user',content:JSON.stringify({instruction:instruction.trim(),target:{color:target.color,position:target.position},game_result:result.correct?'дұрыс':'қате'})}]})});
    if(!response.ok) return res.status(response.status===429?429:502).json({error:'AI талдауы қазір жауап бермеді.'});
    const data:any=await response.json(); const raw=data.choices?.[0]?.message?.content; const parsed=JSON.parse(raw);
    if(typeof parsed.instruction_clear!=='boolean'||typeof parsed.language_feedback_kk!=='string'||typeof parsed.suggested_instruction_kk!=='string') throw new Error('Invalid schema');
    res.json({instruction_clear:parsed.instruction_clear,mentioned_color:typeof parsed.mentioned_color==='string'?parsed.mentioned_color:null,mentioned_position:typeof parsed.mentioned_position==='string'?parsed.mentioned_position:null,language_feedback_kk:parsed.language_feedback_kk.slice(0,240),suggested_instruction_kk:parsed.suggested_instruction_kk.slice(0,240)});
  } catch(error) {res.status(502).json({error:error instanceof Error&&error.name==='AbortError'?'AI талдауы уақытында жауап бермеді.':'AI жауабын оқу мүмкін болмады.'});} finally {clearTimeout(timer);}
});
speechRoutes(app);
const clientDist=path.resolve(process.cwd(),'dist');
if(fs.existsSync(clientDist)){app.use(express.static(clientDist));app.get('*',(req,res,next)=>req.path.startsWith('/api/')?next():res.sendFile(path.join(clientDist,'index.html')));}
if (!process.env.VERCEL) app.listen(PORT,()=>console.log(`Daus AI server listening on ${PORT}`));
export default app;



