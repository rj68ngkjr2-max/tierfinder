import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shuffleAnimals} from '../web/discover.js';
test('deck shuffling mixes species, keeps every animal and leaves the cached input intact',()=>{
 const input=[{id:1,species:'DOG'},{id:2,species:'DOG'},{id:3,species:'CAT'},{id:4,species:'CAT'},{id:5,species:'BIRD'},{id:6,species:'BIRD'}];
 const before=structuredClone(input),deck=shuffleAnimals(input,()=>0.4);
 assert.deepEqual(input,before);assert.notDeepEqual(deck,input);
 assert.deepEqual(deck.map(x=>x.id).sort(),input.map(x=>x.id).sort());
 assert.ok(deck.some((x,i)=>i>0&&x.species!==deck[i-1].species));
});
test('empty and single-animal decks work without mutating the source',()=>{
 assert.deepEqual(shuffleAnimals([]),[]);const one=[{id:1}];assert.deepEqual(shuffleAnimals(one),one);assert.notEqual(shuffleAnimals(one),one);
});
