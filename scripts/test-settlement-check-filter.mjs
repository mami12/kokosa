import assert from 'node:assert/strict';
import {isCurrentSettlementCheckQuote} from '../server/ledger/settlement-check.mjs';

const now=1000;
const market={id:'m1',status:'ACTIVE',suspended:false};
const fresh={id:'o1',status:'ACTIVE',odds:2.25,priceValidUntil:2000};
assert.equal(isCurrentSettlementCheckQuote(market,fresh,now),true,
 'an active quote with a future provider freshness deadline is selectable');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,priceValidUntil:now},now),false,
 'a quote expiring at this instant is stale');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,priceValidUntil:999},now),false,
 'an expired quote is excluded');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,priceValidUntil:null},now),false,
 'a quote without a freshness deadline is excluded');
assert.equal(isCurrentSettlementCheckQuote({...market,status:'SUSPENDED'},fresh,now),false,
 'a suspended market is excluded');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,status:'SUSPENDED'},now),false,
 'a suspended outcome is excluded');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,quoteSuspended:true},now),false,
 'a quote explicitly marked stale is excluded');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,decided:true},now),false,
 'a provider-decided outcome is excluded');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,odds:1},now),false,
 'an invalid price is excluded');
console.log('PASS settlement-check bulk quote freshness and active-status filters');
