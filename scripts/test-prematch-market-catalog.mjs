import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {PROVIDER_OFFER_ARCHIVE_SQL,persistProviderMarketDefinitions} from '../server/ledger/provider-offer-archive.mjs';
import {refreshMarketCatalog,seedNativeMarketCatalog} from '../server/ledger/market-catalog-store.mjs';

const db=new PGlite();
const database={query:(...args)=>db.query(...args)};
try{
 await db.exec(PROVIDER_OFFER_ARCHIVE_SQL);
 await refreshMarketCatalog({initialize:true,database});
 const archived=await persistProviderMarketDefinitions([
  {provider:'ZIZOBET',sportId:1,scope:'LIVE',id:800,name:'Total Corners',definition:{ID:800,Name:'Total Corners'}},
  {provider:'ZIZOBET',sportId:1,scope:'PREMATCH',id:448,name:'Match result',definition:{ID:448,Name:'Match result'}},
  {provider:'ZIZOBET',sportId:1,scope:'PREMATCH',id:800,name:'Total Corners',definition:{ID:800,Name:'Total Corners'}},
  {provider:'ZIZOBET',sportId:1,scope:'PREMATCH',id:449,name:'Total Cards',definition:{ID:449,Name:'Total Cards'}},
  {provider:'ZIZOBET',sportId:1,scope:'PREMATCH',id:450,name:'Double Chance and Total Goals',definition:{ID:450,Name:'Double Chance and Total Goals'}},
  {provider:'ZIZOBET',sportId:1,scope:'PREMATCH',id:451,name:'Odd/Even',definition:{ID:451,Name:'Odd/Even'}},
  {provider:'ZIZOBET',sportId:1,scope:'PREMATCH',id:452,name:'Goals in minutes 1-15',definition:{ID:452,Name:'Goals in minutes 1-15'}},
  {provider:'ZIZOBET',sportId:1,scope:'PREMATCH',id:453,name:'Total Goals',definition:{ID:453,Name:'Total Goals'}},
  {provider:'ZIZOBET',sportId:1,scope:'LIVE',id:27073,name:'1X2 (XUP)',definition:{ID:27073,Name:'1X2 (XUP)'}},
  {provider:'ZIZOBET',sportId:2,scope:'LIVE',id:991,name:'Winner',definition:{ID:991,Name:'Winner'}},
  {provider:'ZIZOBET',sportId:3,scope:'LIVE',id:992,name:'Set Winner',definition:{ID:992,Name:'Set Winner'}},
  {provider:'ZIZOBET',scope:'LIVE',id:993,name:'Total Points',definition:{ID:993,Name:'Total Points'}}
 ],{execute:(...args)=>database.query(...args)});
 assert.equal(archived.seen,9,'only explicit football LIVE/PREMATCH definitions are archived');
 const catalog=await seedNativeMarketCatalog({database});
 const byKey=new Map(catalog.map(row=>[row.key,row]));
 for(const id of ['448','449','450','451','452','453','800'])
  assert.ok(byKey.has('zizobet:prematch:'+id),'PREMATCH market missing from admin catalog: '+id);
 const categories=id=>byKey.get('zizobet:prematch:'+id)?.categories??[];
 for(const [id,category] of [['448','results'],['449','cards'],['450','combos'],['451','other'],
  ['452','intervals'],['453','totals'],['800','corners']])
  assert.ok(categories(id).includes(category),'PREMATCH market '+id+' missing category '+category);
 assert.ok(categories('452').includes('goals'),'Timed-goal PREMATCH offers belong to Goals and Intervals');
 assert.ok(categories('453').includes('goals'),'PREMATCH Total Goals belongs to Goals and Totals');
 assert.ok(categories('450').includes('totals'),'PREMATCH Double Chance and Total Goals retains its Totals category');
 assert.equal(byKey.has('zizobet:live:27073'),false,'Early Payout remains excluded from the admin catalog');
 assert.equal(byKey.has('zizobet:live:991'),false,'non-football LIVE dictionary IDs stay excluded');
 assert.equal(byKey.has('zizobet:live:992'),false,'non-football LIVE dictionary IDs stay excluded');
 console.log('PASS PREMATCH admin catalog: cards, combos, other, intervals, corners, results, totals and goals');
}finally{
 await db.close();
}
