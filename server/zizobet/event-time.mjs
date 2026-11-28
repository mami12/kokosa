/**
 * Parse the provider's event minute and precise clock consistently for both
 * the displayed timeline and the canonical settlement evidence.
 *
 * Zizobet may encode first/second-half added time either as "45+2"/"90+3",
 * or as the next minute plus a clock still inside the boundary minute, e.g.
 * gt="46", clk="45:56" or gt="91", clk="90:18".
 */
export function zizobetEventTime(value,clock,fallbackAdded=0){
 const raw=String(value??'').trim();
 const match=raw.match(/^(\d{1,3})(?:\s*\+\s*(\d{1,2}))?$/);
 if(!match)return {minute:null,seconds:null,added:0,phase:null,label:raw||null};
 let base=Number(match[1]);
 let added=match[2]!==undefined?Number(match[2]):Number(fallbackAdded??0);
 if(!Number.isSafeInteger(added)||added<0||added>30)added=0;
 const clockMatch=String(clock??'').match(/^(\d{1,3}):([0-5]\d)$/);
 const clockMinute=clockMatch?Number(clockMatch[1]):null;
 const seconds=clockMatch?clockMinute*60+Number(clockMatch[2]):null;

 // A next-minute gt can describe an event still occurring before the clock
 // crosses 46:00 / 91:00. Rebuild the conventional 45+1 / 90+1 label and,
 // importantly, retain the correct half for period-specific grading.
 if(match[2]===undefined&&added===0&&seconds!==null&&
    ((base===46&&clockMinute===45&&seconds>45*60)||
     (base===91&&clockMinute===90&&seconds>90*60))){
  base-=1;
  added=1;
 }
 // Older Zizobet payloads keep gt at 45/90 but put the stoppage clock in clk.
 // Preserve that provider convention without inventing extra time elsewhere.
 if(added===0&&(base===45||base===90)&&clockMinute!==null&&
    clockMinute>base&&clockMinute<=base+15)
  added=clockMinute-base;
 const minute=base+added;
 const preciseSeconds=seconds!==null&&Math.abs(seconds/60-minute)<=1?seconds:null;
 const phase=added>0?(base===45?'1st half':base===90?'2nd half':null):null;
 return {minute,seconds:preciseSeconds,added,phase,label:added>0?base+'+'+added:raw};
}
