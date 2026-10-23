import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,access,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import JSZip from 'jszip';
import {digest} from '../scripts/lib.mjs';

const scripts=fileURLToPath(new URL('../scripts/',import.meta.url));
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function run(script,cwd,env={}){
 return spawnSync(process.execPath,[join(scripts,script)],{cwd,encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'false',MARKET_BUILD_COMMIT:'',...env}});
}
function succeeds(result){assert.equal(result.status,0,result.stderr+'\n'+result.stdout);}
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'vykor-official-test-'));
 try{
  const plugin=join(root,'plugins','test-plugin');await mkdir(join(plugin,'.vykor-plugin'),{recursive:true});
  await writeFile(join(root,'.gitignore'),'dist/\n.work/\nnode_modules/\n');
  await writeFile(join(root,'marketplace.json'),JSON.stringify({plugins:[{id:'test.plugin',category:'development',localPath:'plugins/test-plugin'}]}));
  await writeFile(join(root,'index.html'),'<h1>Market</h1>');await writeFile(join(root,'.nojekyll'),'');
  const pkg={name:'test-plugin',version:'1.0.0',type:'module',license:'MIT',scripts:{build:'node build.mjs'}};
  await writeFile(join(plugin,'package.json'),JSON.stringify(pkg));
  await writeFile(join(plugin,'package-lock.json'),JSON.stringify({name:'test-plugin',version:'1.0.0',lockfileVersion:3,requires:true,packages:{'':{name:'test-plugin',version:'1.0.0',license:'MIT'}}}));
  await writeFile(join(plugin,'.vykor-plugin','plugin.json'),JSON.stringify({schemaVersion:1,id:'test.plugin',name:'test-plugin',version:'1.0.0',license:'MIT',components:{tools:[{entry:'./dist/main.mjs'}]}}));
  await writeFile(join(plugin,'LICENSE'),'MIT license');await writeFile(join(plugin,'main.mjs'),'export const value = 1;');
  await writeFile(join(plugin,'build.mjs'),"import {mkdir,copyFile} from 'node:fs/promises'; await mkdir('dist',{recursive:true}); await copyFile('main.mjs','dist/main.mjs');");
  git(root,['init','-b','main']);git(root,['add','.']);git(root,['-c','user.name=Test','-c','user.email=test@example.com','commit','-m','fixture']);
  await fn({root,plugin,commit:git(root,['rev-parse','HEAD'])});
 }finally{await rm(root,{recursive:true,force:true});}
}
const ci=commit=>({GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'rzx007/vykor-plugins',GITHUB_SHA:commit});

test('official build records actual market commit and excludes ignored stale output',()=>fixture(async({root,plugin,commit})=>{
 await mkdir(join(plugin,'dist'));await writeFile(join(plugin,'dist','stale.mjs'),'old bundle');await writeFile(join(plugin,'dist','main.mjs'),'old main');
 await mkdir(join(root,'dist'));await writeFile(join(root,'dist','old.zip'),'stale release');
 succeeds(run('build.mjs',root));
 const indexBytes=await readFile(join(root,'dist','marketplace.json'));const index=JSON.parse(indexBytes);
 assert.deepEqual(index.plugins[0].source,{repository:'https://github.com/rzx007/vykor-plugins',commit,path:'plugins/test-plugin'});
 assert.equal(index.plugins[0].localPath,undefined,'authoring-only fields must not enter public schema');
 const zip=await JSZip.loadAsync(await readFile(join(root,'dist','test-plugin-1.0.0.zip')));
 assert.equal(await zip.file('test-plugin/dist/main.mjs').async('string'),'export const value = 1;');
 assert.equal(zip.file('test-plugin/dist/stale.mjs'),null);await assert.rejects(access(join(root,'dist','old.zip')));
 assert.equal(await readFile(join(plugin,'dist','main.mjs'),'utf8'),'old main','builds run in fresh snapshots');
 const provenance=JSON.parse(await readFile(join(root,'dist','build-provenance.json')));
 assert.equal(provenance.commit,commit);assert.equal(provenance.preview,false);
 assert.deepEqual(await readdir(join(root,'.work')),[]);
 succeeds(run('verify.mjs',root));succeeds(run('check-publish.mjs',root,ci(commit)));
}));

test('uncommitted official changes build as previews and cannot publish',()=>fixture(async({root,plugin,commit})=>{
 await writeFile(join(plugin,'main.mjs'),'export const value = 2;');succeeds(run('build.mjs',root));
 const provenance=JSON.parse(await readFile(join(root,'dist','build-provenance.json')));assert.equal(provenance.commit,commit);assert.equal(provenance.preview,true);
 const zip=await JSZip.loadAsync(await readFile(join(root,'dist','test-plugin-1.0.0.zip')));
 assert.equal(await zip.file('test-plugin/dist/main.mjs').async('string'),'export const value = 2;');
 const check=run('check-publish.mjs',root,ci(commit));assert.notEqual(check.status,0);assert.match(check.stderr,/preview|uncommitted/i);
 const publish=run('publish.mjs',root,ci(commit));assert.notEqual(publish.status,0);assert.match(publish.stderr,/preview|uncommitted/i,'publish refuses before calling gh');
}));

test('official release runs declared stdio checks and blocks packaging on failure',()=>fixture(async({root,plugin})=>{
 const file=join(plugin,'package.json'),pkg=JSON.parse(await readFile(file));
 pkg.scripts['test:stdio']='node stdio-check.mjs';await writeFile(file,JSON.stringify(pkg));
 await writeFile(join(plugin,'stdio-check.mjs'),"import {readFile} from 'node:fs/promises'; import assert from 'node:assert/strict'; assert.equal(await readFile('dist/main.mjs','utf8'),'export const value = 1;'); console.log('stdio-release-check-passed');");
 const passed=run('build.mjs',root);succeeds(passed);assert.match(passed.stdout,/stdio-release-check-passed/);
 await writeFile(join(plugin,'stdio-check.mjs'),"throw Error('stdio-release-check-failed');");
 const failed=run('build.mjs',root);assert.notEqual(failed.status,0,'failed stdio checks must stop the release');assert.match(failed.stderr,/stdio-release-check-failed/);
 await assert.rejects(access(join(root,'dist','marketplace.json')));
 await assert.rejects(access(join(root,'dist','test-plugin-1.0.0.zip')));
}));

test('an untracked official file marks the build as a preview',()=>fixture(async({root,plugin,commit})=>{
 await writeFile(join(plugin,'new.txt'),'local addition');succeeds(run('build.mjs',root));
 const provenance=JSON.parse(await readFile(join(root,'dist','build-provenance.json')));assert.equal(provenance.preview,true);
 const check=run('check-publish.mjs',root,ci(commit));assert.notEqual(check.status,0);assert.match(check.stderr,/preview|uncommitted/i);
}));

test('CI cannot label a build with a different checkout SHA',()=>fixture(async({root})=>{
 const result=run('build.mjs',root,{MARKET_BUILD_COMMIT:'f'.repeat(40)});assert.notEqual(result.status,0);assert.match(result.stderr,/checkout commit mismatch/i);
 await assert.rejects(access(join(root,'dist','marketplace.json')));
}));

test('publication guard rejects stale index and mismatched or non-main CI provenance',()=>fixture(async({root,commit})=>{
 succeeds(run('build.mjs',root));
 for(const env of [{GITHUB_REF:'refs/heads/feature'},{GITHUB_SHA:'f'.repeat(40)},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_ACTIONS:'false'}]){
  const result=run('check-publish.mjs',root,{...ci(commit),...env});assert.notEqual(result.status,0);assert.match(result.stderr,/publish|main|commit|CI|checkout/i);
 }
 await writeFile(join(root,'dist','marketplace.json'),'{}');const result=run('check-publish.mjs',root,ci(commit));assert.notEqual(result.status,0);assert.match(result.stderr,/provenance|index|catalog/i);
}));

test('publication guard rejects missing build provenance',()=>fixture(async({root,commit})=>{
 succeeds(run('build.mjs',root));await rm(join(root,'dist','build-provenance.json'));
 const result=run('publish.mjs',root,ci(commit));assert.notEqual(result.status,0);assert.match(result.stderr,/provenance/i);
}));

test('official source cannot be a directory link outside plugins',()=>fixture(async({root,plugin})=>{
 const outside=join(root,'outside');await mkdir(outside);await rm(plugin,{recursive:true});await symlink(outside,plugin,'junction');
 const result=run('build.mjs',root);assert.notEqual(result.status,0);assert.match(result.stderr,/Invalid localPath|Unsupported link|directory link/i);
 await assert.rejects(access(join(root,'dist','marketplace.json')));
}));

test('official source rejects linked files before executing build code',()=>fixture(async({root,plugin})=>{
 await symlink(resolve(root,'index.html'),join(plugin,'linked.txt'),'file');
 const result=run('build.mjs',root);assert.notEqual(result.status,0);assert.match(result.stderr,/link|localPath/i);
}));

test('verify rejects incompatible source paths in a complete generated catalog even with a future host minimum',()=>fixture(async({root})=>{
 succeeds(run('build.mjs',root));succeeds(run('verify.mjs',root));
 const catalog=JSON.parse(await readFile(join(root,'dist','marketplace.json')));
 const provenance=JSON.parse(await readFile(join(root,'dist','build-provenance.json')));
 catalog.plugins[0].requires.host='>=999.0.0';
 for(const path of ['.','./','./plugins/test-plugin','plugins/test-plugin/.','plugins//test-plugin','plugins/test-plugin/','plugins/../test-plugin','plugins:official/test-plugin','']){
  catalog.plugins[0].source.path=path;const serialized=JSON.stringify(catalog,null,2)+'\n';
  await writeFile(join(root,'dist','marketplace.json'),serialized);
  await writeFile(join(root,'dist','build-provenance.json'),JSON.stringify({...provenance,catalogSha256:digest(serialized)}));
  const result=run('verify.mjs',root);assert.notEqual(result.status,0,`must reject source.path ${JSON.stringify(path)} before publishing`);assert.match(result.stderr,/source.*path|path.*source|unsafe path/i);
 }
}));
