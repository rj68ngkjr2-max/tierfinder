// Shuffle a fresh deck once. Subsequent swipes retain its order.
export function shuffleAnimals(animals,random=Math.random){
 const deck=[...animals];
 for(let i=deck.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
 return deck;
}
