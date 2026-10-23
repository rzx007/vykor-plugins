import {mkdir,mkdtemp,lstat,realpath,copyFile} from 'node:fs/promises';
import {join,dirname,relative,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withBuildCheckouts} from './checkouts.mjs';
import {safePath,validateLocalPath} from './lib.mjs';
import {marketRepository} from './provenance.mjs';

// Copy only Git-visible source files into a fresh build directory. Ignored output
// (dist, node_modules, downloaded engines) cannot leak in from a prior local build.
async function snapshotOfficial(repositoryRoot,localPath,buildRoot){
 validateLocalPath(localPath);
 const plugins=join(repositoryRoot,'plugins'),root=join(repositoryRoot,localPath);
 try{
  for(const directory of [plugins,root]){
   if((await lstat(directory)).isSymbolicLink()||!(await lstat(directory)).isDirectory())throw Error('Unsupported directory link');
  }
  const actual=await realpath(root);
  if(actual!==root||!(await realpath(plugins)).startsWith(repositoryRoot+sep)||!actual.startsWith(plugins+sep))throw Error('Expected directory inside plugins');
 }catch(cause){throw Error(`Invalid localPath: ${localPath}`,{cause});}
 const snapshot=await mkdtemp(join(buildRoot,'official-'));
 const files=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard','--',localPath],{cwd:repositoryRoot,encoding:'utf8'}).split('\0').filter(Boolean);
 for(const file of new Set(files)){
  safePath(file);
  const from=join(repositoryRoot,file),path=relative(root,from);
  if(!path||path.startsWith('..'+sep)||path==='..')throw Error('Invalid localPath source file');
  let info;
  try{info=await lstat(from);}catch(error){if(error.code==='ENOENT')continue;throw error;}
  // Check every ancestor too: Git may list tracked files under a replaced directory.
  for(let current=from;current!==root;current=dirname(current)){
   if((await lstat(current)).isSymbolicLink())throw Error(`Unsupported link in localPath: ${file}`);
  }
  if(!info.isFile())throw Error(`Unsupported link/file in localPath: ${file}`);
  const to=join(snapshot,path);await mkdir(dirname(to),{recursive:true});await copyFile(from,to);
 }
 return snapshot;
}

export async function withBuildSources(repositoryRoot,commit,callback){
 repositoryRoot=await realpath(repositoryRoot);
 return withBuildCheckouts(join(repositoryRoot,'.work'),async(getCheckout,buildRoot)=>{
  const official=new Map();
  async function getSource(spec){
   if(Object.hasOwn(spec,'localPath')){
    if(!official.has(spec.localPath))official.set(spec.localPath,await snapshotOfficial(repositoryRoot,spec.localPath,buildRoot));
    return {root:official.get(spec.localPath),source:{repository:marketRepository,commit,path:spec.localPath}};
   }
   const checkout=await getCheckout(spec.source);
   return {root:join(checkout,spec.source.path),source:spec.source};
  }
  return callback(getSource);
 });
}
