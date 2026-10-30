import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shuffleAnimals,preferredAnimals,createDiscoverDeck} from '../web/discover.js';
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

test('current preferences filter stale or restored cards without changing their shuffled order',()=>{
 const deck=[{id:1,species:'BIRD'},{id:2,species:'CAT'},{id:3,species:'DOG'},{id:4,species:'CAT'},{id:5,species:'RABBIT'}];
 const before=structuredClone(deck);
 assert.deepEqual(preferredAnimals(deck,['CAT']).map(a=>a.id),[2,4]);
 assert.deepEqual(preferredAnimals(deck,['DOG','CAT']).map(a=>a.id),[2,3,4]);
 assert.deepEqual(preferredAnimals(deck,[]),[]);
 assert.deepEqual(preferredAnimals([deck[0]],['CAT']),[]);
 assert.deepEqual(deck,before);
});

test('deck keeps the current card on return and uses fresh records, removes unavailable animals, appends new ones',()=>{
 const deck=createDiscoverDeck(()=>0.5),pets=['a','b','c'].map(animal_id=>({animal_id,species:'CAT',status:'AVAILABLE',name:animal_id}));
 const first=deck.reconcile(pets,['CAT']);const order=first.map(a=>a.animal_id);
 const fresh=deck.reconcile([...pets].reverse().map(a=>({...a,name:'updated'})),['CAT']);
 assert.deepEqual(fresh.map(a=>a.animal_id),order);assert.equal(fresh[0].name,'updated');
 const refreshed=deck.reconcile([...pets.filter(a=>a.animal_id!==order[1]),{animal_id:'new',species:'CAT',status:'AVAILABLE'}],['CAT']);
 assert.deepEqual(refreshed.map(a=>a.animal_id),[order[0],order[2],'new']);
 assert.deepEqual(deck.reconcile(pets.map(a=>({...a,status:'PAUSED'})),['CAT']),[]);
});
test('successful swipe stays removed even in a racing server response; undo restores it once at the front',()=>{
 const deck=createDiscoverDeck(()=>0.5),pets=['a','b'].map(animal_id=>({animal_id,species:'CAT',status:'AVAILABLE'}));
 deck.reconcile(pets,['CAT']);deck.remove('a');assert.deepEqual(deck.reconcile(pets,['CAT']).map(a=>a.animal_id),['b']);
 deck.restore(pets[0]);assert.deepEqual(deck.reconcile(pets,['CAT']).map(a=>a.animal_id),['a','b']);
 deck.restore(pets[0]);assert.equal(deck.reconcile(pets,['CAT']).length,2);
 assert.deepEqual(deck.reconcile(pets,['DOG']),[]);deck.reset();assert.equal(deck.initialized,false);assert.equal(deck.reconcile(pets,['CAT']).length,2);
});
