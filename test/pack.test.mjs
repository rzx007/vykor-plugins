import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import JSZip from 'jszip';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pack, validateInventory} from '../scripts/lib.mjs';
async function fixture(fn) { const dir=await mkdtemp(join(tmpdir(),'vykor-test-')); try {await mkdir(join(dir,'.vykor-plugin')); await writeFile(join(dir,'.vykor-plugin/plugin.json'),JSON.stringify({schemaVersion:1,id:'test.plugin',name:'test',version:'1.0.0',license:'MIT',components:{tools:[{entry:'./main.mjs'}]}})); await writeFile(join(dir,'LICENSE'),'MIT license'); await writeFile(join(dir,'main.mjs'),'export {};'); await fn(dir);} finally {await rm(dir,{recursive:true,force:true});} }
test('identical payload has identical zip and digest',()=>fixture(async dir=>{const a=await pack(dir),b=await pack(dir);assert.deepEqual(a.bytes,b.bytes);assert.equal(a.sha256,b.sha256);}));
for (const [label,file,value] of [['manifest','.vykor-plugin/plugin.json',null],['license','LICENSE',null],['entrypoint','main.mjs',null],['version','.vykor-plugin/plugin.json','{"schemaVersion":1,"id":"test","name":"test","version":"1.0.0-beta","license":"MIT","components":{}}']]) test(`rejects invalid ${label}`,()=>fixture(async dir=>{if(value===null)await rm(join(dir,file));else await writeFile(join(dir,file),value);await assert.rejects(pack(dir));}));
test('rejects duplicate plugin IDs',()=>assert.throws(()=>validateInventory({plugins:[{id:'same'},{id:'same'}]}),/duplicate/i));

test('rejects relative icons that the host manifest cannot install',()=>fixture(async dir=>{
  const path=join(dir,'.vykor-plugin/plugin.json');
  const manifest=JSON.parse(await readFile(path));manifest.icon='./icon.svg';
  await writeFile(path,JSON.stringify(manifest));
  await writeFile(join(dir,'icon.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
  await assert.rejects(pack(dir),/icon/i);
}));

test('publishes author icons and introductions without rewriting the plugin archive',()=>fixture(async dir=>{
  const path=join(dir,'.vykor-plugin/plugin.json');
  const manifest=JSON.parse(await readFile(path));
  Object.assign(manifest,{icon:'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',introduction:'## Notes\nKeep drafts.',homepage:'https://example.com/notes',prompts:[{title:'Notes',prompt:'Organize these notes.'}]});
  await writeFile(path,JSON.stringify(manifest));
  const result=await pack(dir);
  assert.deepEqual(result.presentation,{license:'MIT',icon:'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=',introduction:'## Notes\nKeep drafts.',homepage:'https://example.com/notes',prompts:[{title:'Notes',prompt:'Organize these notes.'}]});
  const archive=await JSZip.loadAsync(result.bytes);
  assert.equal(JSON.parse(await archive.file('test/.vykor-plugin/plugin.json').async('string')).icon,manifest.icon);
}));
test('rejects missing MCP server script',()=>fixture(async dir=>{const m=JSON.parse(await (await import('node:fs/promises')).readFile(join(dir,'.vykor-plugin/plugin.json')));m.components={mcpServers:['./mcp.json']};await writeFile(join(dir,'.vykor-plugin/plugin.json'),JSON.stringify(m));await writeFile(join(dir,'mcp.json'),JSON.stringify({servers:{demo:{command:'node',args:['missing.mjs']}}}));await assert.rejects(pack(dir),/Missing/);}));

test('packages directory components used by research and office plugins',()=>fixture(async dir=>{
  const path=join(dir,'.vykor-plugin/plugin.json');
  const manifest=JSON.parse(await readFile(path));
  manifest.components={agents:['./agents'],skills:['./skills','./vendor/officecli/skills']};
  await writeFile(path,JSON.stringify(manifest));
  for(const [folder,file] of [['agents','writer.md'],['skills/research','SKILL.md'],['vendor/officecli/skills/pptx','SKILL.md']]){
    await mkdir(join(dir,folder),{recursive:true});
    await writeFile(join(dir,folder,file),'---\nname: example\ndescription: Example\n---\nInstructions.');
  }
  const result=await pack(dir);
  assert.deepEqual(result.componentTypes,['agents','skills']);
  const zip=await JSZip.loadAsync(result.bytes);
  assert.ok(zip.file('test/vendor/officecli/skills/pptx/SKILL.md'));
}));

for(const kind of ['agents','skills','tools'])test(`rejects missing or invalid ${kind} directory entry`,()=>fixture(async dir=>{
  const path=join(dir,'.vykor-plugin/plugin.json');
  const manifest=JSON.parse(await readFile(path));manifest.components={[kind]:['./empty']};
  await writeFile(path,JSON.stringify(manifest));
  await mkdir(join(dir,'empty'));
  await writeFile(join(dir,'empty','README.txt'),'Not a component.');
  await assert.rejects(pack(dir),/Missing|Invalid/);
}));
