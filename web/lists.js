export function byAvailability(animals,status='ALL'){
 return status==='ALL'?[...animals]:animals.filter(a=>a.status===status);
}
export function openRequestCount(animals){return animals.reduce((n,a)=>n+Number(a.metrics?.pending||0),0);}
export function requestsInOrder(requests){
 return [...requests].sort((a,b)=>Number(b.status==='PENDING')-Number(a.status==='PENDING')||Date.parse(b.created_at)-Date.parse(a.created_at));
}
