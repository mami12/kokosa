import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {marketIsEnabled,nativeMarketPolicyKeys} from '../server/market-catalog.mjs';
import {refreshMarketCatalog,seedNativeMarketCatalog,assertMarketEnabled} from '../server/ledger/market-catalog-store.mjs';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {oddsOf} from '../server/zizobet/normalize.mjs';

assert.match(LEDGER_SQL,/create table if not exists app_supplemental_match_incident/i,
 'Supplemental incidents must be created on ledger boot even with STATS_PROVIDERS_ENABLED=false');
assert.match(LEDGER_SQL,/create table if not exists app_supplemental_match_snapshot/i);

const db=new PGlite(),database={query:(...args)=>db.query(...args)};
try{
 await db.exec(`create table app_provider_market_definition(
    provider_id text not null,scope text not null,native_market_id text not null,
    native_market_name text not null,definition jsonb not null,
    primary key(provider_id,scope,native_market_id));`);
 await refreshMarketCatalog({initialize:true,database});
 await db.query(`insert into app_provider_market_definition
   (provider_id,scope,native_market_id,native_market_name,definition)
   values ('ZIZOBET','LIVE','800','Total Corners','{}'::jsonb),
          ('ZIZOBET','PREMATCH','448','Match result','{}'::jsonb),
          ('ZIZOBET','PREMATCH','800','Total Corners','{}'::jsonb)`);
 const list=await seedNativeMarketCatalog({database});
 const keys=['zizobet:live:800','zizobet:prematch:448','zizobet:prematch:800'];
 for(const key of keys)assert.ok(list.find(row=>row.key===key),'Dictionary market missing: '+key);
 const quoted={market_key:'zz800@e30',market_name:'Total Corners'};
 const live={service:'LIVE'},prematch={service:'PREMATCH'};
 assert.deepEqual(nativeMarketPolicyKeys(quoted,live),['zizobet:live:800']);
 assert.deepEqual(nativeMarketPolicyKeys(quoted,prematch),['zizobet:prematch:800']);
 await db.query("update app_market_catalog set enabled=false where key='zizobet:live:800'");
 await refreshMarketCatalog({database});
 assert.equal(marketIsEnabled(quoted,live),false,'Live native ID admin switch blocks this quote');
 assert.equal(marketIsEnabled(quoted,prematch),true,'Live switch does not block prematch scope');
 await assert.rejects(assertMarketEnabled(quoted,(...args)=>db.query(...args),live),
  error=>error?.code==='MARKET_NOT_OFFERED');
 await assertMarketEnabled(quoted,(...args)=>db.query(...args),prematch);
 await db.query("update app_market_catalog set enabled=false where key='zizobet:prematch:800'");
 await refreshMarketCatalog({database});
 assert.equal(marketIsEnabled(quoted,prematch),false,'Prematch native ID block applies');

const totalDefinition={Name:'Total Goals',IsOverUnder:true,N:1,
 pos:[{id:1,nm:'Over'},{id:2,nm:'Under'}]};
const totalMeta={positions:new Map(),liveMarkets:new Map(),
 preMarkets:new Map([[901,totalDefinition]])};
const quarterTotals=oddsOf({match_id:55},[
 {mid:901,id:1,pos:1,h:0.25,coef:1.91},
 {mid:901,id:2,pos:2,h:0.25,coef:1.91},
 {mid:901,id:3,pos:1,h:0.75,coef:2.1},
 {mid:901,id:4,pos:2,h:0.75,coef:1.72}
],totalMeta,false,true);
assert.deepEqual(quarterTotals.map(row=>row.line),['0.25','0.25','0.75','0.75'],
 'valid native quarter goal-total lines must not be discarded by a generic IsOverUnder filter');

const incompleteDictionaryQuote=oddsOf({match_id:56},[
 {mid:902,id:5,pos:99,pn:'Over',coef:1.95}
],{positions:new Map(),liveMarkets:new Map(),
 preMarkets:new Map([[902,{Name:'Total [total]',IsOverUnder:true}]])},false,true);
assert.equal(incompleteDictionaryQuote.length,1,
 'a quoted offer with a missing dictionary position must use its own native label');
assert.equal(incompleteDictionaryQuote[0].marketName,'Total [total]',
 'an unresolved native template remains visible under its exact provider title');
assert.equal(incompleteDictionaryQuote[0].outcomeName,'Over');
}finally{await db.close();}
console.log('PASS complete native market catalog, LIVE/PREMATCH scoping, wager preflight and optional table migration');
