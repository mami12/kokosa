/**
 * HT/FT compound markets. Both quoted conditions must win, but a losing
 * full-time condition can be proved without knowing the half-time score.
 */
import {isHtFtMarket,parseHtFtOutcome,gradeHtFt} from './ht-ft.mjs';

const int=v=>v!=null&&v!==''&&Number.isSafeInteger(Number(v))&&
 Number(v)>=0&&Number(v)<=200?Number(v):null;
const scorePart=(part,home,away)=>{
 const value=String(part??'').replace(/\s+/g,'');
 if(value.endsWith('+'))return home+away>=Number(value.slice(0,-1));
 const match=value.match(/^(\d+)[-:](\d+)$/);
 return match?home===Number(match[1])&&away===Number(match[2]):null;
};
const htFtGrade=(raw,hh,ha,fh,fa)=>{
 const selection=parseHtFtOutcome(raw,raw);
 if(!selection)return null;
 const full=fh>fa?'1':fa>fh?'2':'X';
 // The FT leg is immutable after full time. A mismatch is a certain loss
 // even when no verified half-time score was archived.
 if(selection.full!==full)return 'LOST';
 if(hh===null||ha===null)return null;
 return gradeHtFt(selection,hh,ha,fh,fa);
};
const totalCondition=(condition,line,name,total)=>{
 const match=String(condition??'').trim().match(/^(over|under)(?:\s*(\d+(?:[.,]\d+)?))?$/i);
 if(!match||total===null)return null;
 const side=match[1].toLowerCase();
 let threshold=match[2]?Number(match[2].replace(',','.')):NaN;
 if(!Number.isFinite(threshold)&&line!=null&&line!=='')threshold=Number(line);
 if(!Number.isFinite(threshold)){
  const fromTitle=String(name??'').match(/\((\d+(?:\.\d+)?)\)/);
  if(fromTitle)threshold=Number(fromTitle[1]);
 }
 if(!Number.isFinite(threshold))return null;
 if(total===threshold)return 'LOST';
 return (side==='over'?total>threshold:total<threshold)?'WON':'LOST';
};
const combine=(htftStatus,otherStatus)=>{
 if(htftStatus==='LOST'||otherStatus==='LOST')return 'LOST';
 return htftStatus==='WON'&&otherStatus==='WON'?'WON':null;
};

export function isHtFtComboMarket(name='') {
 const n=String(name).trim();
 if(isHtFtMarket(n)&&/\b(?:correct score|exact goals?|total goals?|both teams?|btts)\b/i.test(n))return true;
 return /\bcorners?\b/i.test(n)&&isHtFtMarket(n);
}

export function isCornersHtFtMarket(name='') {
 return /\bcorners?\b/i.test(name)&&isHtFtMarket(name)&&
  !/\b(?:correct score|exact goals?|total goals?|both teams?|btts)\b/i.test(name);
}

export function gradeHtFtCombo(line,result) {
 const name=String(line?.market_name??'');
 if(isCornersHtFtMarket(name))return null;

 const hh=int(result?.half_home_score),ha=int(result?.half_away_score);
 const fh=int(result?.home_score),fa=int(result?.away_score);
 if(fh===null||fa===null||((hh!==null&&hh>fh)||(ha!==null&&ha>fa)))return null;

 const raw=String(line?.outcome_name??line?.outcome_key??'').trim();
 const isHalf1Total=/1st\s+half\s+total/i.test(name);
 const isExact=/\bexact\s+goals?\b/i.test(name);
 const isCorrectScore=/\bcorrect\s+score\b/i.test(name);
 const isBtts=/\b(?:both\s+teams?\s+(?:to\s+)?score|btts)\b/i.test(name);
 const totalFt=fh+fa;
 const totalHt=hh===null||ha===null?null:hh+ha;

 if(isCorrectScore){
  // Format: "1/1 2:1" (HT/FT 1X2 + exact FT score).
  const combined=raw.match(/^([12xX][/\\-][12xX])\s+(\d+)\s*[-:]\s*(\d+)$/);
  if(combined){
   if(fh!==Number(combined[2])||fa!==Number(combined[3]))return 'LOST';
   return htFtGrade(combined[1],hh,ha,fh,fa);
  }
  // Format: "1-0 2-1", "1-0 / 4+", "4+ / 4+".
  const scores=raw.match(/^(\d+\s*[-:]\s*\d+|\d+\+)\s*(?:[/\\|&]\s*|\s+(?:and|&)\s+|\s+)(\d+\s*[-:]\s*\d+|\d+\+)$/i);
  if(!scores)return null;
  const ftWon=scorePart(scores[2],fh,fa);
  if(ftWon===false)return 'LOST';
  if(ftWon!==true||hh===null||ha===null)return null;
  return scorePart(scores[1],hh,ha)===true?'WON':'LOST';
 }

 const pair=raw.match(/^([12xX][/\\-][12xX])\s*(?:and|&|-)\s*(.+)$/i);
 if(!pair)return null;
 const htftPart=pair[1],condition=pair[2].trim();
 const htftStatus=htFtGrade(htftPart,hh,ha,fh,fa);

 if(isExact){
  // The exact-goals leg uses the final total unless the title explicitly
  // scopes it to the first half. FT total is an upper bound for 1H goals.
  const target= isHalf1Total?totalHt:totalFt;
  let other=null;
  if(target!==null){
   if(condition.endsWith('+')){
    const minimum=Number(condition.slice(0,-1));
    if(Number.isFinite(minimum))other=target>=minimum?'WON':'LOST';
   }else{
    const exact=Number(condition);
    if(Number.isFinite(exact))other=target===exact?'WON':'LOST';
   }
  }else if(isHalf1Total&&condition.endsWith('+')){
   const minimum=Number(condition.slice(0,-1));
   if(Number.isFinite(minimum)&&totalFt<minimum)other='LOST';
  }
  return combine(htftStatus,other);
 }

 if(isBtts){
  const btts=fh>0&&fa>0;
  const pick=condition.toLowerCase();
  const wantsYes=/^(?:yes|po|gg)$/.test(pick);
  const wantsNo=/^(?:no|jo|ng)$/.test(pick);
  if(wantsYes===wantsNo)return null;
  const other=btts===wantsYes?'WON':'LOST';
  return combine(htftStatus,other);
 }

 // HT/FT + full-time or first-half Over/Under.
 const target=isHalf1Total?totalHt:totalFt;
 let other=totalCondition(condition,line?.line,name,target);
 if(other===null&&isHalf1Total&&totalHt===null){
  const match=condition.match(/^over\s*(\d+(?:[.,]\d+)?)?$/i);
  const threshold=Number(match?.[1]?.replace(',','.')??line?.line??name.match(/\((\d+(?:\.\d+)?)\)/)?.[1]);
  // If even the entire FT total cannot reach the 1H Over line, it is lost.
  if(Number.isFinite(threshold)&&totalFt<=threshold)other='LOST';
 }
 return combine(htftStatus,other);
}
