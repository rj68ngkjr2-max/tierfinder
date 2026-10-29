import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('work',{recursive:true});
await build({entryPoints:['supabase/functions/tierfinder-api/index.ts'],bundle:true,format:'esm',platform:'neutral',target:'es2022',external:['npm:*'],outfile:'work/tierfinder-api.deploy.ts'});
console.log('Edge Function bundle ready: work/tierfinder-api.deploy.ts');
