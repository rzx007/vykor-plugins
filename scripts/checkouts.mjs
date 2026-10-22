import {mkdir,mkdtemp,rm,realpath} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {execFileSync} from 'node:child_process';

// A pool lasts for one build only. Previously generated files are never reused.
export async function withBuildCheckouts(workRoot,callback){
 await mkdir(workRoot,{recursive:true});
 const parent=await realpath(workRoot);
 const buildRoot=await mkdtemp(join(parent,'build-'));
 const cache=new Map();
 async function getCheckout(source){
  if(cache.has(source.commit))return cache.get(source.commit);
  if(!/^[a-f0-9]{40}$/.test(source.commit))throw Error('Fixed commit required');
  const checkout=join(buildRoot,source.commit);await mkdir(checkout);
  const git=args=>execFileSync('git',args,{cwd:checkout,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git(['init']);git(['remote','add','origin',source.repository]);git(['fetch','--depth=1','origin',source.commit]);git(['config','core.autocrlf','false']);git(['checkout','--detach','FETCH_HEAD']);
  if(git(['rev-parse','HEAD'])!==source.commit)throw Error('Commit mismatch');
  cache.set(source.commit,checkout);return checkout;
 }
 try{return await callback(getCheckout);}finally{
  // Resolve the actual directory immediately before recursive deletion, including on Windows.
  const target=await realpath(buildRoot);
  if(!target.startsWith(parent+sep)||!target.slice(parent.length+1).startsWith('build-')||resolve(target)===resolve(parent))throw Error('Unsafe build cleanup target');
  await rm(target,{recursive:true,force:true});
 }
}
