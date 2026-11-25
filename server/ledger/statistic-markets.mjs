/** Full-match team statistics are separate from goals and player event props. */
import {statisticNumber} from '../match-statistics.mjs';
const text=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/over\s*\/\s*under/g,'over under').replace(/[_:.,()]+/g,' ').replace(/\s+/g,' ').trim();
const nameOf=line=>text(line?.market_name??line?.marketName??line?.name);
const number=value=>value!=null&&/^\d+(?:[.,]\d+)?$/.test(String(value).trim())?Number(String(value).replace(',','.')):null;
export function isStatisticMarket(line){
 const name=nameOf(line),hasLine=number(line?.line??line?.specifier)!==null;
 return /\b(?:shots?|fouls?|offsides?)\b|goditj|faulle?/.test(name)||
  ((/\b(?:total|number of|over|under)\b/.test(name)||hasLine)&&/\b(?:cards?|bookings?)\b|karton/.test(name));
}
export function statisticMarketContract(line){
 if(!isStatisticMarket(line))return null;
 const name=nameOf(line);
 const stat=/\byellow\b/.test(name)?'yellow':/\bred\b/.test(name)?'red':
  /\bcorners?\b/.test(name)?'corners':
  /\bcards?\b|\bbookings?\b|karton/.test(name)?'cards':
  /\bshots? (?:on target|on goal)\b|goditj\w* ne porte/.test(name)?'shotsOnTarget'
  :/\bfouls?\b|faulle?/.test(name)?'fouls':/\bshots?\b|goditj/.test(name)?'shots':null;
 const unsupported=!stat||Number(line?.period??0)!==0||/\b(?:players?|scorer|first|1st|second|2nd|half|halves|ht|1h|2h|quarter|period|minute|minutes|next|last|race|handicap|asian|overtime|extra|both|each|off target|blocked|odd|even|exact|range)\b|[+&/]|lojtari|pjesa|minut/.test(name);
 const home=/\b(?:team 1|1 team|home\s*team|home)\b|skuadra 1|ekipi 1/.test(name);
 const away=/\b(?:team 2|2 team|away\s*team|away)\b|skuadra 2|ekipi 2/.test(name);
 const result=/\b1x2\b/.test(name);
 const unclearResult=!result&&/\b(?:result|winner|most)\b/.test(name);
 const lineValue=number(line?.line??line?.specifier);
 const total=/\btotal|over\s*under|number of/.test(name)||lineValue!==null;
 const scope=home?'home':away?'away':result?'result':'total';
 const comparison=result?name.replace(/\b(?:which team|who)\s+(?:has|have|commits?|makes?|takes?|will have)\s+(?:the\s+)?(?:most|more)\b/g,' '):name;
 let remainder=comparison
  .replace(/\bshots? on (?:target|goal)\b|\bshots?\b|\bfouls?(?: committed)?\b|\boffside(?:s)?\b|goditj\w* ne porte|goditj\w*|faulle?/g,' ')
  .replace(/\b(?:yellow|red)?\s*cards?\b|\bbookings?\b|karton\w*|\bcorners?\b/g,' ')
  .replace(/\b(?:home\s*team|home|away\s*team|away|team [12]|[12] team)\b|skuadra [12]|ekipi [12]/g,' ')
  .replace(/\b(?:full time|regular time|match|total|totals|over|under|number of|result|winner|most|1x2|totali|totalit|ndeshjes|ndeshja|lart|poshte|mbi|nen)\b/g,' ');
 if((home||away))remainder=remainder.replace(/\bby\b/g,' ');
 if(lineValue!==null){const literal=text(line.line??line.specifier).replace(/[.*+?^\$\{\}()|[\]\\]/g,'\\$&');remainder=remainder.replace(new RegExp('\\b'+literal+'\\b','g'),' ');}
 const unrecognized=/[a-z0-9]/.test(remainder);
 return {stat,scope,supported:!unsupported&&!unrecognized&&!unclearResult&&!(home&&away)&&(result?!home&&!away:total&&lineValue!==null&&Number.isInteger(lineValue*2)),line:lineValue};
}
function pair(result,stat){
 let stats=result?.statistics;
 if(typeof stats==='string'){try{stats=JSON.parse(stats);}catch{stats=null;}}
 const values=stats?.[stat]??(stat==='corners'?{home:result?.corners_home,away:result?.corners_away}:stat==='cards'?{home:result?.cards_home,away:result?.cards_away}:null);
 return {home:statisticNumber(values?.home),away:statisticNumber(values?.away)};
}
export function hasStatisticEvidence(line,result){
 const contract=statisticMarketContract(line);if(!contract?.supported||!result)return false;
 const values=pair(result,contract.stat);
 return contract.scope==='home'?values.home!==null:contract.scope==='away'?values.away!==null:values.home!==null&&values.away!==null;
}
export function gradeStatisticLine(line,result){
 const contract=statisticMarketContract(line);if(!contract||!hasStatisticEvidence(line,result))return 'VOID';
 const values=pair(result,contract.stat),key=text(line.outcome_key??line.code),label=text(line.outcome_name??line.outcomeName);
 const selected=`${key} ${label}`;
 if(contract.scope==='result'){
  const side=key==='1'||key==='home'||label==='home'||label!==''&&label===text(result.home_team)?'home'
   :key==='2'||key==='away'||label==='away'||label!==''&&label===text(result.away_team)?'away'
   :key==='x'||key==='draw'||label==='x'||label==='draw'?'draw':null;
  if(!side)return 'VOID';
  return (side==='home'?values.home>values.away:side==='away'?values.away>values.home:values.home===values.away)?'WON':'LOST';
 }
 if(contract.line===null)return 'VOID';
 const over=/\b(?:over|lart|mbi)\b/.test(selected),under=/\b(?:under|poshte|nen)\b/.test(selected);
 if(over===under)return 'VOID';
 const target=contract.scope==='home'?values.home:contract.scope==='away'?values.away:values.home+values.away;
 if(target===contract.line)return 'VOID';
 return (over?target>contract.line:target<contract.line)?'WON':'LOST';
}
