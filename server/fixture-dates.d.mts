export function isFixtureOnDay(start:string,filter:'today'|'tomorrow'|'dayAfterTomorrow',now?:Date):boolean;
export function filterFixtureRowsByDay<T>(rows:T[],day:unknown,now?:Date):T[];

export function isSettlementCheckFixture(row:Record<string,unknown>,now?:Date):boolean;
export function tiraneDateKey(now?:Date):string;
