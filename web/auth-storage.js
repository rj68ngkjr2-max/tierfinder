// Store Supabase sessions, never passwords. Persistence is an explicit login choice.
export function createAuthStorage({session=()=>sessionStorage,local=()=>localStorage}={}){
 const preference='tierfinder.remember-login',memory=new Map(),keys=new Set();
 const read=(store,key)=>{try{return store().getItem(key);}catch{return null;}};
 const remove=(store,key)=>{try{store().removeItem(key);}catch{}};
 let remember=read(local,preference)==='true';
 const storage={
  get remembered(){return remember;},
  getItem(key){
   keys.add(key);
   return read(remember?local:session,key)??memory.get(key)??null;
  },
  setItem(key,value){
   keys.add(key);
   remove(remember?session:local,key);
   try{(remember?local:session)().setItem(key,value);memory.delete(key);}
   catch{memory.set(key,value);}
  },
  removeItem(key){remove(session,key);remove(local,key);memory.delete(key);keys.delete(key);},
  setRemember(value){
   const saved=[...keys].map(key=>[key,storage.getItem(key)]);
   remember=value===true;
   try{local().setItem(preference,String(remember));}catch{}
   for(const [key,item] of saved)if(item!==null)storage.setItem(key,item);
  }
 };
 return storage;
}
