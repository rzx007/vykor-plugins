import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withBuildCheckouts} from '../scripts/checkouts.mjs';
import {pack} from '../scripts/lib.mjs';
test('dirty prior build cannot leak untracked files into the next build',async()=>{
 const root=await mkdtemp(join(tmpdir(),'vykor-checkouts-test-'));try{
 const repo=join(root,'upstream');await mkdir(join(repo,'.vykor-plugin'),{recursive:true});
 await writeFile(join(repo,'.vykor-plugin/plugin.json'),JSON.stringify({schemaVersion:1,id:'test.plugin',name:'test',version:'1.0.0',license:'MIT',components:{tools:[{entry:'./main.mjs'}]}}));await writeFile(join(repo,'LICENSE'),'MIT');await writeFile(join(repo,'main.mjs'),'export {};');
 const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();git(['init']);git(['add','.']);git(['-c','user.name=Test','-c','user.email=test@example.com','commit','-m','fixture']);const source={repository:repo,commit:git(['rev-parse','HEAD'])};const work=join(root,'work');let clean;
 await withBuildCheckouts(work,async get=>{const checkout=await get(source);assert.equal(await get(source),checkout,'same build reuses fixed commit');clean=await pack(checkout);await writeFile(join(checkout,'old-bundle.txt'),'stale untracked output');});
 await withBuildCheckouts(work,async get=>{const checkout=await get(source);await assert.rejects(access(join(checkout,'old-bundle.txt')));assert.deepEqual((await pack(checkout)).bytes,clean.bytes);});
 }finally{await rm(root,{recursive:true,force:true});}
});
