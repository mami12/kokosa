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
type AllMatch={id:string;name:string;status:'LIVE'|'PREMATCH';startTime?:string|null;league?:string};
type AllResult={test:true;player:string;date:string;matchCount:number;ticketCount:number;stakePerTicket:number;matches:{id:string;name:string;status:string;marketCount:number;quoteCount:number;ticketCount:number}[]};
const categoryLabels:Record<string,[string,string]>={
 goals:['Golat','Goals'],corners:['Kornerat','Corners'],cards:['Kartonat','Cards'],totals:['Totale','Totals'],
 intervals:['Intervale','Intervals'],results:['Rezultate','Results'],
 combos:['Kombinime','Combos'],other:['Të tjera','Other']
};
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
 const[allMatches,setAllMatches]=useState<AllMatch[]>([]);
 const[selectedMatchIds,setSelectedMatchIds]=useState<string[]>([]);
 const[allLoading,setAllLoading]=useState(false),[allBusy,setAllBusy]=useState(false);
 const[allResult,setAllResult]=useState<AllResult|null>(null);
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
 useEffect(()=>{void loadAllMatches();},[loadAllMatches]);
 useEffect(()=>{
  void loadTickets();
  const timer=window.setInterval(()=>void loadTickets(),15000);
  return()=>window.clearInterval(timer);
 },[loadTickets]);
 const loadAllMatches=useCallback(async()=>{
  setAllLoading(true);setError('');
  try{
   const response=await apiClient.get('/admin/settlement-check/matches');
   setAllMatches(Array.isArray(response.data?.matches)?response.data.matches:[]);
   setSelectedMatchIds(current=>current.filter(id=>(response.data?.matches??[]).some((match:AllMatch)=>match.id===id)));
  }catch(e:any){setError(e.response?.data?.message??tr('Ndeshjet e sotme nuk u ngarkuan.','Today’s fixtures could not be loaded.'));}
  finally{setAllLoading(false);}
 },[lang]);
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
    `${response.data.ticketCount} bileta testimi u krijuan për ${response.data.match.name}. Nuk u prek bilanci i lojtarit.`,
    `${response.data.ticketCount} test tickets were created for ${response.data.match.name}. The player's balance was not changed.`
   ));
   await loadTickets();
   await loadCatalog();
  }catch(e:any){setError(e.response?.data?.message??tr('Biletat e testimit nuk u krijuan.','Test tickets could not be created.'));}
  finally{setBusy(false);}
 };
 const placeAll=async()=>{
  if(!playerId||selectedMatchIds.length!==2||allBusy)return;
  setAllBusy(true);setError('');setNotice('');setAllResult(null);
  try{
   const response=await apiClient.post<AllResult>('/admin/settlement-check/place-all',{
    playerId,matchIds:selectedMatchIds,runId:createClientRequestId()
   });
   setAllResult(response.data);
   setNotice(tr(
    `${response.data.ticketCount} bileta testimi u krijuan për 2 ndeshjet dhe të gjitha kuotat aktive të lejueshme. Bilanci nuk u prek.`,
    `${response.data.ticketCount} test tickets were created for both fixtures and all eligible active quotes. No balance was changed.`
   ));
   await loadTickets();
  }catch(e:any){setError(e.response?.data?.message??tr('Testimi i dy ndeshjeve dështoi.','The two-fixture test failed.'));}
  finally{setAllBusy(false);}
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
     onClick={()=>{setDetail(null);setResult(null);setCategory(item.id);}} className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${category===item.id?'border-accent-green bg-accent-green text-primary':'border-tertiary bg-primary text-text-secondary hover:text-white'}`}>
     {categoryLabels[item.id]?.[lang==='en'?1:0]??item.name}
    </button>)}
   </div>
   {loading?<div role="status" className="py-8 text-center text-sm text-text-secondary">{tr('Po kërkohen marketet aktive të sotme…','Searching today’s active markets…')}</div>:
    groups.length===0?<p className="py-8 text-center text-sm text-text-secondary">{tr('Nuk ka markete me kuota aktive në këtë kategori për ndeshjet e sotme.','No markets in this category have active quotes on today’s fixtures.')}</p>:
    <div className="mt-4 grid gap-3 md:grid-cols-2">
     {groups.map(group=><button key={group.key} type="button" onClick={()=>void openMarket(group.key)}
      className={`rounded-xl border p-4 text-left transition-colors ${detail?.key===group.key?'border-accent-green bg-accent-green/10':'border-tertiary bg-primary hover:border-slate-500'}`}>
      <div className="flex items-start justify-between gap-3"><strong className="text-sm text-white">{group.name}</strong><span className="shrink-0 rounded-md bg-secondary px-2 py-1 text-xs font-bold text-accent-green">{group.activeOptions} {tr('opsione','options')}</span></div>
      <p className="mt-2 text-xs text-text-secondary">{group.match.name}</p>
      <p className="mt-1 text-[11px] text-text-secondary">{group.match.status} · {group.matchesAvailable} {tr('ndeshje me këtë market','fixtures with this market')}</p>
     </button>)}
    </div>}
  </div>
  <div className="rounded-2xl border border-tertiary bg-secondary p-4 sm:p-6" data-testid="settlement-check-all-markets">
   <div className="flex flex-wrap items-start justify-between gap-3">
    <div><h3 className="font-bold text-white">{tr('Testimi i vjetër: 2 ndeshje · të gjitha marketet','Legacy test: 2 fixtures · all markets')}</h3>
     <p className="mt-1 text-xs text-text-secondary">{tr('Zgjidh saktësisht dy ndeshje të sotme ose live. Krijohet një biletë testimi për çdo kuotë aktive të lejueshme në të dyja ndeshjet. Marketet e përjashtuara nga politika e Kokosa nuk përfshihen.','Choose exactly two fixtures from today or currently live. One test ticket is created for every eligible active quote across both fixtures. Markets excluded by Kokosa policy are omitted.')}</p>
    </div>
    <button type="button" onClick={()=>void loadAllMatches()} disabled={allLoading||allBusy} className="rounded-lg border border-tertiary p-2 text-text-secondary disabled:opacity-50" aria-label={tr('Rifresko ndeshjet','Refresh fixtures')}><RefreshCw size={17} className={allLoading?'animate-spin':''}/></button>
   </div>
   {allLoading?<p className="py-6 text-center text-sm text-text-secondary">{tr('Po ngarkohen ndeshjet e sotme…','Loading today’s fixtures…')}</p>:
    allMatches.length===0?<p className="py-6 text-center text-sm text-text-secondary">{tr('Nuk ka ndeshje aktive për testim sot.','No active fixtures are available for testing today.')}</p>:
    <div className="mt-4 grid gap-2 md:grid-cols-2">
     {allMatches.map(match=><label key={match.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${selectedMatchIds.includes(match.id)?'border-accent-green bg-accent-green/10':'border-tertiary bg-primary'}`}>
      <input type="checkbox" checked={selectedMatchIds.includes(match.id)} disabled={allBusy||(!selectedMatchIds.includes(match.id)&&selectedMatchIds.length>=2)}
       onChange={event=>setSelectedMatchIds(current=>event.target.checked?[...current,match.id].slice(0,2):current.filter(id=>id!==match.id))}
       className="mt-1 accent-emerald-500"/>
      <span className="min-w-0"><strong className="block text-sm text-white">{match.name}</strong>
       <span className="mt-1 block text-[11px] text-text-secondary">{match.status}{match.league? ` · ${match.league}`:''}{match.startTime? ` · ${dateLabel(match.startTime)}`:''}</span>
      </span>
     </label>)}
    </div>}
   <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
    <p className="text-xs text-text-secondary">{tr(`${selectedMatchIds.length}/2 ndeshje të zgjedhura`,`${selectedMatchIds.length}/2 fixtures selected`)}</p>
    <button type="button" disabled={!playerId||selectedMatchIds.length!==2||allBusy||allLoading} onClick={()=>void placeAll()}
     className="flex min-h-11 items-center gap-2 rounded-xl bg-accent-green px-5 py-3 text-sm font-bold text-primary disabled:opacity-40">
     {allBusy?<RefreshCw size={16} className="animate-spin"/>:<Play size={16}/>}
     {tr('Vendos testet për të gjitha kuotat','Place tests for all quotes')}
    </button>
   </div>
   {!playerId&&<p className="mt-2 text-xs text-amber-200">{tr('Zgjidh fillimisht llogarinë e lojtarit më sipër.','Choose the player account above first.')}</p>}
   {allResult&&<div role="status" className="mt-4 rounded-xl border border-accent-green/30 bg-accent-green/10 p-4">
    <strong className="text-sm text-white">{allResult.ticketCount} {tr('bileta testimi','test tickets')} · {tr('2 ndeshje','2 fixtures')}</strong>
    <div className="mt-2 space-y-1">{allResult.matches.map(match=><p key={match.id} className="text-xs text-text-secondary">{match.name}: {match.marketCount} {tr('markete','markets')} · {match.quoteCount} {tr('kuota','quotes')} · {match.ticketCount} {tr('bileta','tickets')}</p>)}</div>
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
     {tr(`Vendos ${activeOptionCount} teste`,`Place ${activeOptionCount} tests`)}
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
