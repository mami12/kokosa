import {useCallback,useEffect,useState} from 'react';
import {AlertTriangle,CheckCircle2,Clock3,Play,RefreshCw,Ticket} from 'lucide-react';
import {apiClient} from '../../api/client';
import {createClientRequestId} from '../../utils/clientRequestId.mjs';
import {useLanguage} from '../../context/LanguageContext';

type Player={id:string;username:string;role:string;status:string;balance:number};
type MatchSummary={id:string;name:string;status:'LIVE'|'PREMATCH';startTime?:string|null;league?:string};
type Group={key:string;name:string;categories:string[];matchesAvailable:number;activeOptions:number;match:MatchSummary};
type Option={outcomeId:string;name:string;code?:string|null;odds:number;marketName:string;line:string;selection:{outcomeId:string;oddsAtPlacement:number}};
type Market={name:string;line:string;options:Option[]};
type MarketDetail=Group&{markets:Market[]};
type TestTicket={id:string;isSettlementTest?:boolean;status:string;stake:number;placedAt:string;lines:{marketName:string;outcomeName:string;matchName:string;oddsAtPlacement:number;status:string}[]};
type PlaceResult={test:true;player:string;date:string;ticketCount:number;stakePerTicket:number;match:MatchSummary;placed:{id:string;matchId:string;marketName:string;outcomeName:string;odds:number;reused:boolean}[]};
type Category={id:string;name:string};
const categoryLabels:Record<string,[string,string]>={
 goals:['Golat','Goals'],corners:['Kornerat','Corners'],totals:['Totale','Totals'],
 intervals:['Intervale','Intervals'],results:['Rezultate','Results'],
 combos:['Kombinime','Combos'],other:['Të tjera','Other']
};
const money=(value:number)=>\`\${Number(value||0).toLocaleString('sq-AL',{minimumFractionDigits:2,maximumFractionDigits:2})} Lek\`;
const dateLabel=(value?:string|null)=>{
 if(!value)return '—';
 const date=new Date(value);
 return Number.isFinite(date.getTime())?date.toLocaleString('sq-AL',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Tirane'}):'—';
};
const stateLabel=(status:string,tr:(sq:string,en:string)=>string)=>{
 switch(status){
  case 'PENDING':return tr('Në pritje','Pending');
  case 'WON':return tr('Fitore','Won');
  case 'LOST':return tr('Humbje','Lost');
  case 'VOID':return tr('Anuluar','Void');
  default:return status;
 }
};
export default function SettlementCheckTickets(){
 const{lang}=useLanguage(),tr=(sq:string,en:string)=>lang==='en'?en:sq;
 const[players,setPlayers]=useState<Player[]>([]);
 const[playerId,setPlayerId]=useState('');
 const[category,setCategory]=useState('corners');
 const[categories,setCategories]=useState<Category[]>([]);
 const[groups,setGroups]=useState<Group[]>([]);
 const[detail,setDetail]=useState<MarketDetail|null>(null);
 const[tickets,setTickets]=useState<TestTicket[]>([]);
 const[loading,setLoading]=useState(true),[detailLoading,setDetailLoading]=useState(false);
 const[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const[result,setResult]=useState<PlaceResult|null>(null);
 const loadPlayers=useCallback(async()=>{
  try{
   const response=await apiClient.get<Player[]>('/admin/users');
   setPlayers((Array.isArray(response.data)?response.data:[]).filter(player=>player.role==='PLAYER'&&player.status==='ACTIVE'));
  }catch(e:any){setError(e.response?.data?.message??tr('Llogaritë nuk u ngarkuan.','Player accounts could not be loaded.'));}
 },[lang]);
 const loadCatalog=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const response=await apiClient.get('/admin/settlement-check/catalog',{params:{category}});
   setCategories(Array.isArray(response.data?.categories)?response.data.categories:[]);
   setGroups(Array.isArray(response.data?.groups)?response.data.groups:[]);
   setDetail(null);setResult(null);
  }catch(e:any){setError(e.response?.data?.message??tr('Marketet aktive nuk u ngarkuan.','Active markets could not be loaded.'));}
  finally{setLoading(false);}
 },[category,lang]);
 const loadTickets=useCallback(async()=>{
  try{
   const response=await apiClient.get<TestTicket[]>('/admin/settlement-check/tickets',{params:{playerId:playerId||undefined,limit:100}});
   setTickets(Array.isArray(response.data)?response.data:[]);
  }catch(e:any){setError(e.response?.data?.message??tr('Biletat e testimit nuk u ngarkuan.','Test tickets could not be loaded.'));}
 },[playerId,lang]);
 useEffect(()=>{void loadPlayers();},[loadPlayers]);
 useEffect(()=>{void loadCatalog();},[loadCatalog]);
 useEffect(()=>{
  void loadTickets();
  const timer=window.setInterval(()=>void loadTickets(),15000);
  return()=>window.clearInterval(timer);
 },[loadTickets]);
 const openMarket=async(family:string)=>{
  setDetailLoading(true);setError('');setNotice('');setResult(null);setDetail(null);
  try{
   const response=await apiClient.get<MarketDetail>('/admin/settlement-check/market',{params:{family}});
   setDetail(response.data);
  }catch(e:any){setError(e.response?.data?.message??tr('Marketi nuk është më aktiv për sot.','This market is no longer active for today.'));}
  finally{setDetailLoading(false);}
 };
 const place=async()=>{
  if(!playerId||!detail||busy)return;
  setBusy(true);setError('');setNotice('');setResult(null);
  try{
   const response=await apiClient.post<PlaceResult>('/admin/settlement-check/place',{
    playerId,family:detail.key,runId:createClientRequestId()
   });
   setResult(response.data);
   setNotice(tr(
    \`\${response.data.ticketCount} bileta testimi u krijuan për \${response.data.match.name}. Nuk u prek bilanci i lojtarit.\`,
    \`\${response.data.ticketCount} test tickets were created for \${response.data.match.name}. The player's balance was not changed.\`
   ));
   await loadTickets();
   await loadCatalog();
  }catch(e:any){setError(e.response?.data?.message??tr('Biletat e testimit nuk u krijuan.','Test tickets could not be created.'));}
  finally{setBusy(false);}
 };
 const activeOptionCount=detail?.markets.reduce((sum,market)=>sum+market.options.length,0)??0;
 return <section className="mx-auto max-w-6xl space-y-5 px-3 py-5 sm:px-6" data-testid="settlement-check-tickets">
  <div className="rounded-2xl border border-tertiary bg-secondary p-4 sm:p-6">
   <div className="flex gap-3">
    <Ticket className="shrink-0 text-accent-green" size={22}/>
    <div>
     <h2 className="font-black text-white">{tr('Testimi automatik i marketeve dhe shlyerjes','Automatic market and settlement testing')}</h2>
     <p className="mt-1 text-sm text-text-secondary">{tr('Shfaqen vetëm marketet me kuota aktive në ndeshjet që nisin sot, sipas orës Europe/Tirane. Zgjidh një market dhe lojtarin; serveri gjen vetë ndeshjen dhe krijon një biletë testimi për çdo opsion aktiv.','Only markets with active quotes on fixtures kicking off today are shown, using Europe/Tirane time. Choose a market and player; the server finds the fixture and creates one test ticket for every active outcome.')}</p>
     <p className="mt-2 text-xs font-semibold text-accent-green">{tr('BILETA TESTIMI · PA DEBITIM OSE FITIM REAL','TEST TICKETS · NO REAL DEBIT OR PAYOUT')}</p>
    </div>
   </div>
  </div>
  {error&&<p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}
  {notice&&<p role="status" className="rounded-xl border border-accent-green/30 bg-accent-green/10 p-4 text-sm text-emerald-100">{notice}</p>}
  <div className="rounded-2xl border border-tertiary bg-secondary p-4 sm:p-6">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <div><h3 className="font-bold text-white">{tr('Kategoritë dhe marketet aktive','Active categories and markets')}</h3><p className="mt-1 text-xs text-text-secondary">{tr('Data e kërkimit: sot në Europe/Tirane','Search date: today in Europe/Tirane')}</p></div>
    <button type="button" onClick={()=>void loadCatalog()} disabled={loading||busy} className="rounded-lg border border-tertiary p-2 text-text-secondary disabled:opacity-50" aria-label={tr('Rifresko marketet','Refresh markets')}><RefreshCw size={17} className={loading?'animate-spin':''}/></button>
   </div>
   <label className="mt-4 block max-w-lg text-sm text-text-secondary">{tr('Llogaria e lojtarit','Player account')}
    <select value={playerId} disabled={busy} onChange={event=>setPlayerId(event.target.value)} className="mt-1 w-full rounded-xl border border-tertiary bg-primary px-3 py-3 text-white">
     <option value="">{tr('Zgjidh lojtarin','Choose player')}</option>
     {players.map(player=><option key={player.id} value={player.id}>{player.username}</option>)}
    </select>
   </label>
   <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label={tr('Kategoritë','Categories')}>
    {categories.map(item=><button key={item.id} type="button" role="tab" aria-selected={category===item.id}
     onClick={()=>setCategory(item.id)} className={\`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors \${category===item.id?'border-accent-green bg-accent-green text-primary':'border-tertiary bg-primary text-text-secondary hover:text-white'}\`}>
     {categoryLabels[item.id]?.[lang==='en'?1:0]??item.name}
    </button>)}
   </div>
   {loading?<div role="status" className="py-8 text-center text-sm text-text-secondary">{tr('Po kërkohen marketet aktive të sotme…','Searching today’s active markets…')}</div>:
    groups.length===0?<p className="py-8 text-center text-sm text-text-secondary">{tr('Nuk ka markete me kuota aktive në këtë kategori për ndeshjet e sotme.','No markets in this category have active quotes on today’s fixtures.')}</p>:
    <div className="mt-4 grid gap-3 md:grid-cols-2">
     {groups.map(group=><button key={group.key} type="button" onClick={()=>void openMarket(group.key)}
      className={\`rounded-xl border p-4 text-left transition-colors \${detail?.key===group.key?'border-accent-green bg-accent-green/10':'border-tertiary bg-primary hover:border-slate-500'}\`}>
      <div className="flex items-start justify-between gap-3"><strong className="text-sm text-white">{group.name}</strong><span className="shrink-0 rounded-md bg-secondary px-2 py-1 text-xs font-bold text-accent-green">{group.activeOptions} {tr('opsione','options')}</span></div>
      <p className="mt-2 text-xs text-text-secondary">{group.match.name}</p>
      <p className="mt-1 text-[11px] text-text-secondary">{group.match.status} · {group.matchesAvailable} {tr('ndeshje me këtë market','fixtures with this market')}</p>
     </button>)}
    </div>}
  </div>
  {detailLoading&&<div role="status" className="rounded-xl border border-tertiary bg-secondary p-5 text-center text-sm text-text-secondary">{tr('Po verifikohen kuotat e marketit…','Verifying market quotes…')}</div>}
  {detail&&<div className="rounded-2xl border border-tertiary bg-secondary p-4 sm:p-6">
   <div className="flex flex-wrap items-start justify-between gap-3">
    <div><h3 className="font-bold text-white">{detail.name}</h3><p className="mt-1 text-xs text-text-secondary">{detail.match.name} · {detail.match.status} · {dateLabel(detail.match.startTime)}</p></div>
    <span className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-accent-green">{activeOptionCount} {tr('kuota aktive','active quotes')}</span>
   </div>
   <div className="mt-4 space-y-4">
    {detail.markets.map((market,index)=><div key={market.name+'|'+market.line+'|'+index} className="rounded-xl border border-tertiary bg-primary p-3">
     <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-white">{market.name}</strong>{market.line&&<span className="text-xs text-text-secondary">{market.line}</span>}</div>
     <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {market.options.map(option=><div key={option.outcomeId} className="flex items-center justify-between gap-3 rounded-lg border border-tertiary/70 bg-secondary px-3 py-2 text-xs">
       <span className="min-w-0 break-words text-slate-200">{option.name}</span>
       <strong className="shrink-0 font-mono tabular-nums text-white">@{option.odds.toFixed(2)}</strong>
      </div>)}
     </div>
    </div>)}
   </div>
   <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
    <p className="text-xs text-text-secondary">{tr('Krijohet një biletë testimi 100 Lek për çdo opsion. Këto shuma janë virtuale dhe nuk prekin bilancin.','One virtual 100 Lek test ticket is created for each outcome. These amounts do not affect the wallet.')}</p>
    <button type="button" disabled={!playerId||busy||activeOptionCount===0} onClick={()=>void place()}
     className="flex min-h-11 items-center gap-2 rounded-xl bg-accent-green px-5 py-3 text-sm font-bold text-primary disabled:opacity-40">
     {busy?<RefreshCw size={16} className="animate-spin"/>:<Play size={16}/>}
     {tr(\`Vendos \${activeOptionCount} teste\`,\`Place \${activeOptionCount} tests\`)}
    </button>
   </div>
   {!playerId&&<p className="mt-2 text-xs text-amber-200">{tr('Zgjidh fillimisht llogarinë e lojtarit.','Choose a player account first.')}</p>}
  </div>}
  {result&&<div role="status" className="rounded-2xl border border-accent-green/30 bg-accent-green/10 p-4 sm:p-6">
   <div className="flex gap-3"><CheckCircle2 className="shrink-0 text-accent-green" size={22}/><div>
    <h3 className="font-bold text-white">{tr('Testet u regjistruan','Tests were recorded')}</h3>
    <p className="mt-1 text-sm text-text-secondary">{result.ticketCount} · {result.match.name} · {tr('llogaria','account')}: {result.player}</p>
   </div></div>
  </div>}
  <div className="rounded-2xl border border-tertiary bg-secondary p-4 sm:p-6">
   <div className="flex items-center justify-between gap-3"><div><h3 className="font-bold text-white">{tr('Biletat e testimit','Test tickets')}</h3><p className="mt-1 text-xs text-text-secondary">{tr('PENDING, WON, LOST ose VOID nga motori real i shlyerjes; pa pagesa reale.','PENDING, WON, LOST or VOID from the real settlement engine; no real payouts.')}</p></div>
    <button type="button" onClick={()=>void loadTickets()} className="rounded-lg border border-tertiary p-2 text-text-secondary" aria-label={tr('Rifresko biletat','Refresh test tickets')}><RefreshCw size={16}/></button>
   </div>
   {tickets.length===0?<p className="py-6 text-center text-sm text-text-secondary">{tr('Nuk ka ende bileta testimi.','No test tickets yet.')}</p>:
    <div className="mt-4 divide-y divide-tertiary">
     {tickets.map(ticket=>{
      const line=ticket.lines?.[0];
      const status=ticket.status;
      const Icon=status==='WON'?CheckCircle2:status==='LOST'?AlertTriangle:Clock3;
      return <div key={ticket.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
       <div className="min-w-0"><p className="break-words text-sm font-semibold text-white">{line?.marketName??ticket.settlementTestFamily??'Test'} · {line?.outcomeName??ticket.id.slice(0,8)}</p><p className="mt-1 text-xs text-text-secondary">{line?.matchName??'—'} · @{Number(line?.oddsAtPlacement??0).toFixed(2)}</p></div>
       <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200"><Icon size={14}/>{stateLabel(status,tr)}</span>
      </div>;
     })}
    </div>}
  </div>
 </section>;
}
