import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {digest} from './lib.mjs';
function gh(args){return execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','inherit']}).trim();}
const repo='rzx007/vykor-plugins';const index=JSON.parse(await readFile('dist/marketplace.json'));
// Only verified files from the build artifact are uploaded. This script never runs upstream code.
for(const p of index.plugins){const tag=`${p.name}-v${p.version}`,asset=basename(new URL(p.artifact.url).pathname);let release;try{release=JSON.parse(gh(['api',`repos/${repo}/releases/tags/${tag}`]));}catch{release=JSON.parse(gh(['api',`repos/${repo}/releases`,'-X','POST','-f',`tag_name=${tag}`,'-f',`name=${tag}`,'-F','draft=true']));}
const existing=release.assets.find(a=>a.name===asset);if(existing){const dir=await mkdtemp(join(tmpdir(),'vykor-release-'));try{gh(['release','download',tag,'--repo',repo,'--pattern',asset,'--dir',dir]);if(digest(await readFile(join(dir,asset)))!==p.artifact.sha256)throw Error(`Refusing different bytes for published version ${tag}`);}finally{await rm(dir,{recursive:true,force:true});}}else{if(!release.draft)throw Error(`Published release missing asset ${tag}`);gh(['release','upload',tag,`dist/${asset}`,'--repo',repo]);}
if(release.draft)gh(['api',`repos/${repo}/releases/${release.id}`,'-X','PATCH','-F','draft=false']);console.log(`Published ${tag}`);}
