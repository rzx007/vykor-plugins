import {mkdir,readFile,writeFile,cp,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pack,validateInventory} from './lib.mjs';
const inventory=JSON.parse(await readFile('marketplace.json'));validateInventory(inventory);
const output=resolve('dist');await mkdir(output,{recursive:true});const cache=new Map();
function run(cmd,args,cwd){execFileSync(cmd,args,{cwd,stdio:'inherit',shell:process.platform==='win32'});}
const index={schemaVersion:1,id:'vykor-official',name:'Vykor 插件市场',owner:{name:'Vykor'},plugins:[]};
for(const spec of inventory.plugins){const source=spec.source;let checkout=cache.get(source.commit);if(!checkout){checkout=resolve('.work',source.commit);await mkdir(checkout,{recursive:true});try{await access(join(checkout,'.git'));}catch{run('git',['init'],checkout);run('git',['remote','add','origin',source.repository],checkout);}run('git',['fetch','--depth=1','origin',source.commit],checkout);run('git',['config','core.autocrlf','false'],checkout);run('git',['checkout','--detach','FETCH_HEAD'],checkout);run('git',['checkout-index','--force','--all'],checkout);if(execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8'}).trim()!==source.commit)throw Error('Commit mismatch');cache.set(source.commit,checkout);}
const root=join(checkout,source.path),pkg=JSON.parse(await readFile(join(root,'package.json')));run('npm',['ci','--ignore-scripts',...(spec.id==='dev.vykor.excalidraw'?['--legacy-peer-deps']:[])],root);for(const script of ['build','test','typecheck'])if(pkg.scripts?.[script])run('npm',['run',script],root);
const result=await pack(root),m=result.manifest;if(m.id!==spec.id)throw Error('ID mismatch');const tag=`${m.name}-v${m.version}`,asset=`${m.name}-${m.version}.zip`;await writeFile(join(output,asset),result.bytes);const requires={host:'>=1.2.20'};if(pkg.engines?.node){if(!/^>=\d+\.\d+\.\d+$/.test(pkg.engines.node))throw Error('Unsupported node requirement');requires.node=pkg.engines.node;}if(m.id==='dev.vykor.excalidraw')requires.node='>=24.0.0';const entry={};for(const k of ['id','name','version','displayName','description','author','license','keywords'])if(m[k]!==undefined)entry[k]=m[k];index.plugins.push({...entry,category:spec.category,componentTypes:result.componentTypes,artifact:{url:`https://github.com/rzx007/vykor-plugins/releases/download/${tag}/${asset}`,sha256:result.sha256,size:result.size},requires,source});}
await writeFile(join(output,'marketplace.json'),JSON.stringify(index,null,2)+'\n');for(const f of ['index.html','.nojekyll'])await cp(f,join(output,f));console.log('Built verified fixed-commit plugin artifacts');


