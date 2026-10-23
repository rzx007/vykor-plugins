import {mkdir,readFile,writeFile,cp,rm,lstat,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pack,validateInventory} from './lib.mjs';
import {withBuildSources} from './sources.mjs';
import {checkoutState,writeProvenance} from './provenance.mjs';
const inventory=JSON.parse(await readFile('marketplace.json'));validateInventory(inventory);
const repositoryRoot=await realpath(resolve('.')),initial=checkoutState(repositoryRoot,process.env.MARKET_BUILD_COMMIT||undefined);
const output=join(repositoryRoot,'dist');
try{if((await lstat(output)).isSymbolicLink()||await realpath(output)!==output)throw Error('Unsafe output cleanup target');await rm(output,{recursive:true,force:true});}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir(output,{recursive:true});
function run(cmd,args,cwd){execFileSync(cmd,args,{cwd,stdio:'inherit',shell:process.platform==='win32'});}
const index={schemaVersion:1,id:'vykor-official',name:'Vykor 插件市场',owner:{name:'Vykor'},plugins:[]};
await withBuildSources(repositoryRoot,initial.commit,async getSource=>{
for(const spec of inventory.plugins){const {root,source}=await getSource(spec);
const pkg=JSON.parse(await readFile(join(root,'package.json')));run('npm',['ci','--ignore-scripts',...(spec.id==='dev.vykor.excalidraw'?['--legacy-peer-deps']:[])],root);for(const script of ['build','test','typecheck','test:stdio'])if(pkg.scripts?.[script])run('npm',['run',script],root);
const result=await pack(root),m=result.manifest;if(m.id!==spec.id)throw Error('ID mismatch');const tag=`${m.name}-v${m.version}`,asset=`${m.name}-${m.version}.zip`;await writeFile(join(output,asset),result.bytes);const requires={host:'>=1.2.20'};if(pkg.engines?.node){if(!/^>=\d+\.\d+\.\d+$/.test(pkg.engines.node))throw Error('Unsupported node requirement');requires.node=pkg.engines.node;}if(m.id==='dev.vykor.excalidraw')requires.node='>=24.0.0';index.plugins.push({id:m.id,name:m.name,version:m.version,...result.presentation,category:spec.category,componentTypes:result.componentTypes,artifact:{url:`https://github.com/rzx007/vykor-plugins/releases/download/${tag}/${asset}`,sha256:result.sha256,size:result.size},requires,source});}
});
const final=checkoutState(repositoryRoot,initial.commit);
validateInventory(index,{allowLocal:false});
const serialized=JSON.stringify(index,null,2)+'\n';if(Buffer.byteLength(serialized)>2*1024*1024)throw Error('Marketplace catalog limit exceeded');await writeFile(join(output,'marketplace.json'),serialized);for(const f of ['index.html','.nojekyll'])await cp(f,join(output,f));
const provenance=await writeProvenance(output,{commit:initial.commit,dirty:initial.dirty||final.dirty},serialized);
console.log(provenance.preview?'Built PREVIEW from uncommitted changes; publication is blocked':'Built verified plugin artifacts from clean checkout '+initial.commit);
