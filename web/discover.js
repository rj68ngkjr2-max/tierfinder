// Shuffle a fresh deck once. Subsequent swipes retain its order.
export function shuffleAnimals(animals,random=Math.random){
 const deck=[...animals];
 for(let i=deck.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
 return deck;
}

// Apply the current profile even to a deck loaded before a preference change.
export function preferredAnimals(animals,species=[]){
 const preferred=new Set(species);
 return animals.filter(animal=>preferred.has(animal.species));
}

// Keep only IDs between visits: every reconciliation uses fresh server records.
export function createDiscoverDeck(random=Math.random){
 let order=[],initialized=false;const removed=new Set();
 return {
  get initialized(){return initialized;},
  reset(){order=[];removed.clear();initialized=false;},
  remove(id){removed.add(id);order=order.filter(x=>x!==id);},
  restore(animal){if(!animal)return;removed.delete(animal.animal_id);order=[animal.animal_id,...order.filter(x=>x!==animal.animal_id)];initialized=true;},
  reconcile(animals,species){
   const eligible=preferredAnimals(animals,species).filter(a=>a.status==='AVAILABLE'&&!a.deleted&&!removed.has(a.animal_id));
   const fresh=new Map(eligible.map(a=>[a.animal_id,a]));
   order=order.filter(id=>fresh.has(id));const kept=new Set(order);
   order.push(...shuffleAnimals([...fresh.keys()].filter(id=>!kept.has(id)),random));initialized=true;
   return order.map(id=>fresh.get(id));
  }
 };
}
