/**
 * HT/FT compound markets — Halftime/Fulltime combined with a second condition:
 *
 *  - "Halftime/Fulltime & 1st half total goals"  — HT/FT + 1H total
 *  - "Halftime/fulltime & total goals"            — HT/FT + FT total
 *  - "Halftime/fulltime & exact goals"            — HT/FT + exact FT goal count
 *  - "Halftime/Fulltime correct score"            — HT/FT + FT correct score
 *  - "Corners Halftime/Fulltime"                  — corner-based HT/FT
 *
 * Both conditions must win for the bet to win.
 * Outcomes are like "1/1 and Over 2.5", "1/2 and 3-1" etc.
 */
import {isHtFtMarket,parseHtFtOutcome,gradeHtFt} from './ht-ft.mjs';

const int=v=>v!=null&&v!==''&&Number.isSafeInteger(Number(v))&&
 Number(v)>=0&&Number(v)<=200?Number(v):null;

export function isHtFtComboMarket(name='') {
 const n=String(name).trim();
 if(isHtFtMarket(n)&&/\b(?:correct score|exact goals?|total goals?)\b/i.test(n))return true;
 // "Corners Halftime/Fulltime"
 if(/\bcorners?\b/i.test(n)&&isHtFtMarket(n))return true;
 return false;
}

export function isCornersHtFtMarket(name='') {
 return /\bcorners?\b/i.test(name)&&isHtFtMarket(name)&&
  !/\b(?:correct score|exact goals?|total goals?|both teams?|btts)\b/i.test(name);
}

export function gradeHtFtCombo(line,result) {
 const name=String(line?.market_name??'');

 // --- Corners Halftime/Fulltime ---
 if(isCornersHtFtMarket(name)){
  // Corner-based HT/FT: like standard HT/FT but for corner counts
  const ch=int(result?.corners_home),ca=int(result?.corners_away);
  if(ch===null||ca===null)return null;
  // We'd need 1st half corner counts for HT corner result;
  // these are not standard fields. Skip until evidence is available.
  return null;
 }

 // --- HT/FT with second condition ---
 const hh=int(result?.half_home_score),ha=int(result?.half_away_score);
 const fh=int(result?.home_score),fa=int(result?.away_score);
 if(hh===null||ha===null||fh===null||fa===null)return null;
 if(hh>fh||ha>fa)return null;

 const raw=String(line.outcome_name??line.outcome_key??'').trim();
 // Split on " and " or " & "
 const andIdx=raw.search(/\s+(?:and|&)\s+/i);
 if(andIdx<0){
  // "Halftime/Fulltime correct score" may have outcome like "1:0 / 2:1" or "1/1 2:1"
  if(/\bcorrect score\b/i.test(name)){
   const doubleScore = raw.match(/^(\d+)\s*[-:]\s*(\d+)\s*[/\\-]\s*(\d+)\s*[-:]\s*(\d+)$/);
   if(doubleScore){
    return hh===Number(doubleScore[1])&&ha===Number(doubleScore[2])&&
           fh===Number(doubleScore[3])&&fa===Number(doubleScore[4])?'WON':'LOST';
   }
   const m=raw.match(/^([12xX][/\\-][12xX])\s+(\d+)\s*[-:]\s*(\d+)$/);
   if(m){
    const htftOption=parseHtFtOutcome(m[1]);
    const htftGrade=gradeHtFt(htftOption,hh,ha,fh,fa);
    if(htftGrade!=='WON')return 'LOST';
    return fh===Number(m[2])&&fa===Number(m[3])?'WON':'LOST';
   }
  }
  return null;
 }

 const htftPart=raw.slice(0,andIdx).trim();
 const condPart=raw.slice(andIdx).replace(/^\s+(?:and|&)\s+/i,'').trim();

 // Grade HT/FT part
 const htftOption=parseHtFtOutcome(htftPart,htftPart);
 const htftGrade=gradeHtFt(htftOption,hh,ha,fh,fa);
 if(htftGrade!=='WON')return 'LOST';

 const isHalf1Total=/1st\s+half\s+total/i.test(name);
 const isFtTotal=/\btotal\s+goals\b/i.test(name)&&!isHalf1Total;
 const isExact=/\bexact\s+goals?\b/i.test(name);
 const isCorrectScore=/\bcorrect\s+score\b/i.test(name);

 // Correct score
 if(isCorrectScore){
  const cs=condPart.match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if(!cs)return null;
  return fh===Number(cs[1])&&fa===Number(cs[2])?'WON':'LOST';
 }

 const targetGoals=isHalf1Total?hh+ha:fh+fa;

 // Exact goals
 if(isExact){
  const n=condPart.match(/^(\d+)$/);
  if(!n)return null;
  return targetGoals===Number(n[1])?'WON':'LOST';
 }

 // Total over/under
 const totalM=condPart.match(/^(over|under)\s*(\d+(?:[.,]\d+)?)$/i);
 if(totalM){
  const side=totalM[1].toLowerCase();
  const line=Number(totalM[2].replace(',','.'));
  if(targetGoals===line)return 'LOST'; // push on combo = lost
  return (side==='over'?targetGoals>line:targetGoals<line)?'WON':'LOST';
 }

 // Plain number (exact goals variant without keyword)
 const plainN=condPart.match(/^(\d+)$/);
 if(plainN&&(isExact||isFtTotal))return targetGoals===Number(plainN[1])?'WON':'LOST';

 return null;
}
