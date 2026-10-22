import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pack, validateInventory} from '../scripts/lib.mjs';
async function fixture(fn) { const dir=await mkdtemp(join(tmpdir(),'vykor-test-')); try {await mkdir(join(dir,'.vykor-plugin')); await writeFile(join(dir,'.vykor-plugin/plugin.json'),JSON.stringify({schemaVersion:1,id:'test.plugin',name:'test',version:'1.0.0',license:'MIT',components:{tools:[{entry:'./main.mjs'}]}})); await writeFile(join(dir,'LICENSE'),'MIT license'); await writeFile(join(dir,'main.mjs'),'export {};'); await fn(dir);} finally {await rm(dir,{recursive:true,force:true});} }
test('identical payload has identical zip and digest',()=>fixture(async dir=>{const a=await pack(dir),b=await pack(dir);assert.deepEqual(a.bytes,b.bytes);assert.equal(a.sha256,b.sha256);}));
for (const [label,file,value] of [['manifest','.vykor-plugin/plugin.json',null],['license','LICENSE',null],['entrypoint','main.mjs',null],['version','.vykor-plugin/plugin.json','{"schemaVersion":1,"id":"test","name":"test","version":"1.0.0-beta","license":"MIT","components":{}}']]) test(`rejects invalid ${label}`,()=>fixture(async dir=>{if(value===null)await rm(join(dir,file));else await writeFile(join(dir,file),value);await assert.rejects(pack(dir));}));
test('rejects duplicate plugin IDs',()=>assert.throws(()=>validateInventory({plugins:[{id:'same'},{id:'same'}]}),/duplicate/i));
test('rejects missing MCP server script',()=>fixture(async dir=>{const m=JSON.parse(await (await import('node:fs/promises')).readFile(join(dir,'.vykor-plugin/plugin.json')));m.components={mcpServers:['./mcp.json']};await writeFile(join(dir,'.vykor-plugin/plugin.json'),JSON.stringify(m));await writeFile(join(dir,'mcp.json'),JSON.stringify({servers:{demo:{command:'node',args:['missing.mjs']}}}));await assert.rejects(pack(dir),/Missing/);}));
