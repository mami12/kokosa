import {useEffect,useState} from 'react';
import {CheckCircle2,Play,RefreshCw,Ticket} from 'lucide-react';
import {apiClient} from '../../api/client';
import {createClientRequestId} from '../../utils/clientRequestId.mjs';
import {useLanguage} from '../../context/LanguageContext';

type Player={id:string;username:string;role:string;status:string;balance:number};
type Match={id:string;name:string;status:'LIVE'|'PREMATCH';startTime?:string|null;league?:string};
type Preview={stakePerTicket:number;ticketCount:number;totalStake:number;matches:{id:string;name:string;status:string;marketCount:number;ticketCount:number}[]};
type Result={test:true;player:string;date:string;matchCount:number;ticketCount:number;stakePerTicket:number;matches:{id:string;name:string;status:string;marketCount:number;quoteCount:number;ticketCount:number}[]};
const money=(value:number)=>`${Number(value||0).toLocaleString('sq-AL',{minimumFractionDigits:2,maximumFractionDigits:2})} Lek`;
const dateLabel=(value?:string|null)=>{if(!value)return '—';const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('sq-AL',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Tirane'}):'—';};

export default function SettlementCheckTickets(){
 const {lang}=useLanguage(),tr=(sq:string,en:string)=>lang==='en'?en:sq;
 const [players,setPlayers]=useState<Player[]>([]),[matches,setMatches]=useState<Match[]>([]);
 const [playerId,setPlayerId]=useState(''),[first,setFirst]=useState(''),[second,setSecond]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [preview,setPreview]=useState<Preview|null>(null),[result,setResult]=useState<Result|null>(null),[error,setError]=useState('');
 const ready=Boolean(playerId&&first&&second&&first!==second);
 const load=async()=>{
  setLoading(true);setError('');
  try{
   const [usersResponse,matchesResponse]=await Promise.all([
    apiClient.get<Player[]>('/admin/users'),
    apiClient.get('/admin/settlement-check/matches')
   ]);
   setPlayers((Array.isArray(usersResponse.data)?usersResponse.data:[]).filter(user=>user.role==='PLAYER'&&user.status==='ACTIVE'));
   setMatches(Array.isArray(matchesResponse.data?.matches)?matchesResponse.data.matches:[]);
  }catch(e:any){setError(e.response?.data?.message||tr('Nuk u ngarkuan llogaritë ose ndeshjet.','Accounts or fixtures could not be loaded.'));}
  finally{setLoading(false);}
 };
 useEffect(()=>{void load();},[]);
 const previewTickets=async()=>{
  if(!ready||busy)return;
  setBusy(true);setError('');setResult(null);
  try{
   const response=await apiClient.post<Preview>('/admin/settlement-check/preview',{matchIds:[first,second]});
   setPreview(response.data);
  }catch(e:any){setPreview(null);setError(e.response?.data?.message||tr('Kontrolli nuk u krijua.','The preview could not be created.'));}
  finally{setBusy(false);}
 };
 const place=async()=>{
  if(!ready||!preview||busy)return;
  setBusy(true);setError('');
  try{
   const response=await apiClient.post<Result>('/admin/settlement-check/place-all',{
    playerId,matchIds:[first,second],runId:createClientRequestId()
   });
   setResult(response.data);setPreview(null);
  }catch(e:any){setError(e.response?.data?.message||tr('Biletat e testimit nuk u krijuan.','Test tickets could not be created.'));}
  finally{setBusy(false);}
 };
 const changeMatch=(slot:'first'|'second',value:string)=>{
  if(slot==='first')setFirst(value);else setSecond(value);
  setPreview(null);setResult(null);
 };
 return <section className="mx-auto max-w-5xl space-y-5 px-3 py-5 sm:px-6" data-testid="settlement-check-tickets">
  <div className="rounded-2xl border border-tertiary bg-secondary p-4 sm:p-6">
   <div className="flex gap-3"><Ticket className="shrink-0 text-accent-green" size={22}/><div>
    <h2 className="font-black text-white">{tr('Kontrolli i shlyerjes me bileta','Settlement check with tickets')}</h2>
    <p className="mt-1 text-sm text-text-secondary">{tr('Zgjidh dy ndeshje dhe një lojtar. Sistemi krijon një biletë prove 100 Lek për çdo kuotë aktive të lejueshme në të dyja ndeshjet. Kuotat e fshehura, të pezulluara, të skaduara ose të përfunduara nuk përfshihen.','Choose two fixtures and a player. The system creates one 100 Lek test ticket for every eligible active quote across both fixtures. Hidden, suspended, stale or already decided quotes are excluded.')}</p>
    <p className="mt-2 text-xs font-semibold text-accent-green">{tr('BILETA TESTIMI · PA DEBITIM OSE FITIM REAL','TEST TICKETS · NO REAL DEBIT OR PAYOUT')}</p>
   </div></div>
  </div>
  {error&&<p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}
  <div className="rounded-2xl border border-tertiary bg-secondary p-4 sm:p-6">
   <div className="flex items-center justify-between gap-3"><h3 className="font-bold text-white">{tr('Përzgjedhja','Selection')}</h3>
    <button type="button" onClick={()=>void load()} disabled={loading||busy} className="rounded-lg border border-tertiary p-2 text-text-secondary disabled:opacity-50" aria-label={tr('Rifresko','Refresh')}><RefreshCw size={17} className={loading?'animate-spin':''}/></button>
   </div>
   <div className="mt-4 grid gap-4 md:grid-cols-3">
    <label className="text-sm text-text-secondary">{tr('Llogaria e lojtarit','Player account')}
     <select value={playerId} disabled={loading||busy} onChange={event=>{setPlayerId(event.target.value);setPreview(null);setResult(null);}} className="mt-1 w-full rounded-xl border border-tertiary bg-primary px-3 py-3 text-white">
      <option value="">{tr('Zgjidh lojtarin','Choose player')}</option>
      {players.map(player=><option key={player.id} value={player.id}>{player.username} · {money(player.balance)}</option>)}
     </select>
    </label>
    <label className="text-sm text-text-secondary">{tr('Ndeshja e parë','First match')}
     <select value={first} disabled={loading||busy} onChange={event=>changeMatch('first',event.target.value)} className="mt-1 w-full rounded-xl border border-tertiary bg-primary px-3 py-3 text-white">
      <option value="">{tr('Zgjidh ndeshjen','Choose match')}</option>
      {matches.filter(match=>match.id!==second).map(match=><option key={match.id} value={match.id}>{match.status==='LIVE'?'LIVE':'PRE'} · {match.name}</option>)}
     </select>
    </label>
    <label className="text-sm text-text-secondary">{tr('Ndeshja e dytë','Second match')}
     <select value={second} disabled={loading||busy} onChange={event=>changeMatch('second',event.target.value)} className="mt-1 w-full rounded-xl border border-tertiary bg-primary px-3 py-3 text-white">
      <option value="">{tr('Zgjidh ndeshjen','Choose match')}</option>
      {matches.filter(match=>match.id!==first).map(match=><option key={match.id} value={match.id}>{match.status==='LIVE'?'LIVE':'PRE'} · {match.name}</option>)}
     </select>
    </label>
   </div>
   <div className="mt-5 flex flex-wrap gap-3">
    <button type="button" disabled={!ready||busy} onClick={()=>void previewTickets()} className="rounded-xl border border-accent-green/50 px-5 py-3 font-bold text-accent-green disabled:opacity-40">{busy?<RefreshCw size={17} className="inline animate-spin"/>:null} {tr('Kontrollo biletat që do krijohen','Preview tickets')}</button>
    {preview&&<button type="button" disabled={busy||preview.ticketCount===0} onClick={()=>void place()} className="flex items-center gap-2 rounded-xl bg-accent-green px-5 py-3 font-bold text-primary disabled:opacity-40"><Play size={17}/>{tr(`Krijo ${preview.ticketCount} bileta × 100 Lek`,`Create ${preview.ticketCount} tickets × 100 Lek`)}</button>}
   </div>
   {loading&&<p className="mt-3 text-xs text-text-secondary">{tr('Po ngarkohen ndeshjet e sotme…','Loading today’s fixtures…')}</p>}
  </div>
  {preview&&<div className="rounded-2xl border border-tertiary bg-secondary p-4 sm:p-6">
   <h3 className="font-bold text-white">{tr('Parapamja','Preview')}</h3>
   <div className="mt-4 grid gap-3 sm:grid-cols-3">
    <div className="rounded-xl bg-primary/60 p-4"><strong className="block text-2xl text-white">{preview.ticketCount}</strong><span className="text-xs text-text-secondary">{tr('Bileta teke','Single tickets')}</span></div>
    <div className="rounded-xl bg-primary/60 p-4"><strong className="block text-2xl text-white">{money(preview.stakePerTicket)}</strong><span className="text-xs text-text-secondary">{tr('Për biletë','Per ticket')}</span></div>
    <div className="rounded-xl bg-primary/60 p-4"><strong className="block text-2xl text-white">{money(preview.totalStake)}</strong><span className="text-xs text-text-secondary">{tr('Shuma totale virtuale','Total virtual stake')}</span></div>
   </div>
   <ul className="mt-4 divide-y divide-tertiary">{preview.matches.map(match=><li key={match.id} className="flex justify-between gap-3 py-3 text-sm"><span className="text-white">{match.name}<small className="block text-text-secondary">{match.status} · {match.marketCount} {tr('markete aktive','active markets')}</small></span><strong className="text-accent-green">{match.ticketCount} {tr('bileta','tickets')}</strong></li>)}</ul>
  </div>}
  {result&&<div role="status" className="rounded-2xl border border-accent-green/30 bg-accent-green/10 p-4 sm:p-6">
   <div className="flex gap-3"><CheckCircle2 className="shrink-0 text-accent-green" size={22}/><div>
    <h3 className="font-bold text-white">{tr('Biletat e testimit u krijuan','Test tickets created')}</h3>
    <p className="mt-1 text-sm text-text-secondary">{tr(`${result.ticketCount} bileta prove u krijuan për dy ndeshjet. Bilanci real nuk u prek.`,`${result.ticketCount} test tickets were created for the two fixtures. The real balance was not changed.`)}</p>
   </div></div>
   <div className="mt-4 space-y-2">{result.matches.map(match=><p key={match.id} className="text-xs text-text-secondary">{match.name}: {match.marketCount} {tr('markete','markets')} · {match.quoteCount} {tr('kuota','quotes')} · {match.ticketCount} {tr('bileta','tickets')}</p>)}</div>
  </div>}
 </section>;
}
