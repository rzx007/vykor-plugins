import {readFile,readdir} from 'node:fs/promises';
import {basename} from 'node:path';
import JSZip from 'jszip';
import {digest,pack,validateInventory,safePath} from './lib.mjs';
const index=JSON.parse(await readFile('dist/marketplace.json'));validateInventory(index);
for(const p of index.plugins){const filename=basename(new URL(p.artifact.url).pathname);const bytes=await readFile(`dist/${filename}`);if(digest(bytes)!==p.artifact.sha256||bytes.length!==p.artifact.size||bytes.length>100*1024*1024)throw Error('Artifact mismatch');const zip=await JSZip.loadAsync(bytes);const entries=Object.values(zip.files);if(entries.length>5000)throw Error('Entry limit');let total=0;const names=new Set();for(const f of entries){safePath(f.name);if((f.unixPermissions&0o170000)===0o120000)throw Error('Link');if(f.dir)continue;total+=(await f.async('nodebuffer')).length;names.add(f.name);}if(total>250*1024*1024)throw Error('Extracted limit');const m=JSON.parse(await zip.file(`${p.name}/.vykor-plugin/plugin.json`).async('string'));if(m.id!==p.id||m.version!==p.version||!names.has(`${p.name}/LICENSE`))throw Error('Manifest/license mismatch');}
console.log(`Verified ${index.plugins.length} archives`);
