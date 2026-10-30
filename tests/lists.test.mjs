import {test} from 'node:test';
import assert from 'node:assert/strict';
import {byAvailability,openRequestCount,requestsInOrder} from '../web/lists.js';
test('availability filters preserve paused favorites and do not modify the source',()=>{
 const pets=[{status:'AVAILABLE',metrics:{pending:2}},{status:'PAUSED',metrics:{pending:1}},{status:'ADOPTED'}];
 assert.deepEqual(byAvailability(pets,'AVAILABLE'),[pets[0]]);assert.equal(byAvailability(pets).length,3);assert.equal(byAvailability(pets,'DRAFT').length,0);assert.equal(openRequestCount(pets),3);
});
test('open requests precede completed ones, newest first within each group',()=>{
 const rows=[{id:1,status:'APPROVED',created_at:'2026-10-30'},{id:2,status:'PENDING',created_at:'2026-10-28'},{id:3,status:'PENDING',created_at:'2026-10-29'}];
 assert.deepEqual(requestsInOrder(rows).map(r=>r.id),[3,2,1]);assert.deepEqual(rows.map(r=>r.id),[1,2,3]);
});
