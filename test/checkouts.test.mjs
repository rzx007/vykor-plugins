import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,access,symlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withBuildCheckouts} from '../scripts/checkouts.mjs';
import {pack} from '../scripts/lib.mjs';

const gitAt=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function withRepository(fn){
 const root=await mkdtemp(join(tmpdir(),'vykor-sources-test-'));try{
  const repo=join(root,'upstream');await mkdir(join(repo,'plugin'),{recursive:true});await writeFile(join(repo,'plugin','main.mjs'),'export {};');
  gitAt(repo,['init']);gitAt(repo,['add','.']);gitAt(repo,['-c','user.name=Test','-c','user.email=test@example.com','commit','-m','fixture']);
  await fn({root,repo,source:{repository:repo,commit:gitAt(repo,['rev-parse','HEAD'])},work:join(root,'work')});
 }finally{await rm(root,{recursive:true,force:true});}
}

test('same commit from different repositories has distinct verified checkouts',()=>withRepository(async({root,repo,source,work})=>{
 const other=join(root,'other');gitAt(root,['clone',repo,other]);
 await withBuildCheckouts(work,async get=>{
  const first=await get(source),second=await get({...source,repository:other});
  assert.notEqual(first,second,'repositories must not share a checkout even when their commits match');
  assert.equal(gitAt(first,['remote','get-url','origin']),repo);assert.equal(gitAt(second,['remote','get-url','origin']),other);
  assert.equal(gitAt(first,['rev-parse','HEAD']),source.commit);assert.equal(gitAt(second,['rev-parse','HEAD']),source.commit);
  assert.equal(await get({...source,repository:other}),second,'same source still reuses its checkout within a build');
 });
 assert.deepEqual(await readdir(work),[],'build checkouts are removed');
}));

test('a cached commit cannot stand in for a repository that does not contain it',()=>withRepository(async({root,source,work})=>{
 const empty=join(root,'empty');await mkdir(empty);gitAt(empty,['init']);
 await withBuildCheckouts(work,async get=>{
  await get(source);
  await assert.rejects(get({...source,repository:empty}));
 });
 assert.deepEqual(await readdir(work),[],'failed checkouts are removed');
}));

test('source path accepts an existing canonical subdirectory',()=>withRepository(async({source,work})=>{
 await withBuildCheckouts(work,async get=>{
  const checkout=await get({...source,path:'plugin'});
  assert.equal(await get({...source,path:'plugin'}),checkout);
 });
}));

for(const path of ['missing','plugin/main.mjs','../outside','.','./plugin','plugin/','plugin/.','plugin//nested','plugin:dir'])test(`rejects source path before it can run scripts: ${path}`,()=>withRepository(async({source,work})=>{
 await withBuildCheckouts(work,async get=>{await assert.rejects(get({...source,path}),/source path|unsafe path/i);});
}));

test('a source path cannot escape a cached checkout through a directory link',()=>withRepository(async({root,source,work})=>{
 const outside=join(root,'outside');await mkdir(outside);
 await withBuildCheckouts(work,async get=>{
  const checkout=await get(source);await symlink(outside,join(checkout,'escape'),'junction');
  await assert.rejects(get({...source,path:'escape'}),/source path/i);
 });
 assert.deepEqual(await readdir(work),[],'cleanup removes the checkout without following its link');
 await access(outside);
}));
test('dirty prior build cannot leak untracked files into the next build',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vykor-checkouts-test-'));try{
 const repo=join(root,'upstream');await mkdir(join(repo,'.vykor-plugin'),{recursive:true});
 await writeFile(join(repo,'.vykor-plugin/plugin.json'),JSON.stringify({schemaVersion:1,id:'test.plugin',name:'test',version:'1.0.0',license:'MIT',components:{tools:[{entry:'./main.mjs'}]}}));await writeFile(join(repo,'LICENSE'),'MIT');await writeFile(join(repo,'main.mjs'),'export {};');
 const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git(['init']);git(['add','.']);git(['-c','user.name=Test','-c','user.email=test@example.com','commit','-m','fixture']);const source={repository:repo,commit:git(['rev-parse','HEAD'])};const work=join(root,'work');let clean;
 await withBuildCheckouts(work,async get=>{const checkout=await get(source);assert.equal(await get(source),checkout,'same build reuses fixed commit');clean=await pack(checkout);await writeFile(join(checkout,'old-bundle.txt'),'stale untracked output');});
 await withBuildCheckouts(work,async get=>{const checkout=await get(source);await assert.rejects(access(join(checkout,'old-bundle.txt')));assert.deepEqual((await pack(checkout)).bytes,clean.bytes);});
 }finally{await rm(root,{recursive:true,force:true});}
});
