/**
 * Zizobet correlated "team wins OR total goals over/under" markets.
 * YES means at least one quoted condition is true; NO means neither is true.
 * Title and line must agree. Unknown labels and unsupported quarter lines stay pending.
 */
const fold=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[_–—]+/g,' ')
 .replace(/\bhome(team)?\b/g,'home team').replace(/\baway(team)?\b/g,'away team')
 .replace(/\s+/g,' ').trim();
const titleContract=value=>{
 const m=fold(value).match(/^((?:home|away)(?: team)?|draw)\s+(?:wins?|to win)\s+or\s+total(?:\s+goals?)?\s+(over|under)(?:\s+(\d{1,3}(?:[.,]\d+)?))?$/);
 if(!m)return null;
 return {result:m[1].startsWith('home')?'home':m[1].startsWith('away')?'away':'draw',
  direction:m[2],titleLine:m[3]==null?null:Number(m[3].replace(',','.'))};
};
export const isOrTotalMarket=value=>titleContract(value)!==null;
const numeric=value=>{if(value==null||String(value).trim()==='')return null;
 const n=Number(String(value).trim().replace(',','.'));return Number.isFinite(n)?n:null;};
export function parseOrTotalSelection(line={}){
 const parsed=titleContract(line.market_name??line.marketName??line.name);
 if(!parsed)return null;
 const quoted=numeric(line.line??line.marketLine??line.market_line??line.accepted_contract?.line);
 const values=[parsed.titleLine,quoted].filter(v=>v!==null);
 if(!values.length||values.some(v=>v!==values[0]))return null;
 const threshold=values[0];
 if(threshold<0||threshold>100||!Number.isInteger(threshold*2))return null;
 let selected=null;
 for(const value of [line.outcome_name,line.outcomeName,line.outcome_key,line.outcomeKey]){
  const answer=fold(value);
  if(['yes','po'].includes(answer)){selected=true;break;}
  if(['no','jo'].includes(answer)){selected=false;break;}
 }
 return selected===null?null:{...parsed,threshold,selected};
}
export function gradeOrTotalSelection(selection,homeScore,awayScore){
 const home=Number(homeScore),away=Number(awayScore);
 if(!selection||!Number.isSafeInteger(home)||home<0||!Number.isSafeInteger(away)||away<0)return null;
 const resultMet=selection.result==='home'?home>away:selection.result==='away'?away>home:
  selection.result==='draw'?home===away:null;
 if(resultMet===null||!['over','under'].includes(selection.direction)||!Number.isFinite(selection.threshold))return null;
 const total=home+away,totalMet=selection.direction==='over'?total>selection.threshold:total<selection.threshold;
 return (resultMet||totalMet)===selection.selected?'WON':'LOST';
}
