import {readFile,readdir,lstat} from 'node:fs/promises';
import {join,posix} from 'node:path';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
export const digest=b=>createHash('sha256').update(b).digest('hex');
export const version=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function safePath(p){if(typeof p!=='string'||!p||p.includes('\\')||p.startsWith('/')||/^[a-z]:/i.test(p)||p.split('/').includes('..'))throw Error(`Unsafe path: ${p}`);return p.replace(/^\.\//,'');}
export function validateInventory(inventory){const ids=new Set();for(const p of inventory.plugins){if(ids.has(p.id))throw Error(`Duplicate ID ${p.id}`);ids.add(p.id);if(p.source){if(!/^[a-f0-9]{40}$/.test(p.source.commit))throw Error('Fixed commit required');safePath(p.source.path);if(p.source.repository!=='https://github.com/rzx007/Vykor')throw Error('Unsupported repository');}}}

function catalogPresentation(manifest) {
  const result = {};
  for (const key of ['displayName','description','introduction','prompts','author','license','keywords','homepage'])
    if (manifest[key] !== undefined) result[key] = manifest[key];
  if (!manifest.icon) return result;
  const icon = manifest.icon;
  if (icon.startsWith('data:')) {
    if (icon.length > 1_048_576 || !/^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(icon)
      || !icon.slice(icon.indexOf(',') + 1)) throw Error('Invalid catalog icon');
    result.icon = icon;
  } else if (icon.startsWith('https:')) {
    const url = new URL(icon);
    if (url.username || url.password || url.hash || url.port && url.port !== '443') throw Error('Invalid icon URL');
    result.icon = url.href;
  } else throw Error('Invalid catalog icon: use a base64 image data URI or HTTPS URL supported by the host');
  return result;
}
export async function pack(root){
 const files=new Map();let total=0;
 async function walk(rel=''){for(const name of (await readdir(join(root,rel))).sort()){if(['node_modules','.git','.plugin-data','plugin-data','.runtime','data'].includes(name))continue;const p=posix.join(rel,name);safePath(p);const stat=await lstat(join(root,p));if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory()))throw Error(`Unsupported link/file ${p}`);if(stat.isDirectory())await walk(p);else{const bytes=await readFile(join(root,p));total+=bytes.length;if(total>250*1024*1024||files.size>=5000)throw Error('Payload limit exceeded');files.set(p,bytes);}}}await walk();
 const raw=files.get('.vykor-plugin/plugin.json');if(!raw)throw Error('Missing manifest');const manifest=JSON.parse(raw);if(manifest.schemaVersion!==1||!manifest.id||!manifest.name||!/^[a-z0-9][a-z0-9-]*$/.test(manifest.name)||!version.test(manifest.version))throw Error('Invalid manifest/version');manifest.license??=files.has('package.json')?JSON.parse(files.get('package.json')).license:undefined;if(!manifest.license||!files.get('LICENSE')?.length)throw Error('Missing license');
 function check(p){p=safePath(p);if(!files.has(p))throw Error(`Missing entrypoint/asset ${p}`);}
 const components=manifest.components??{};
 for(const [kind,entries]of Object.entries(components)){if(!['skills','agents','tools','mcpServers','apps','workflows'].includes(kind)||!Array.isArray(entries))throw Error('Invalid components');for(const entry of entries){const p=typeof entry==='string'?entry:entry.entry;check(p);if(['apps','mcpServers'].includes(kind)){const config=JSON.parse(files.get(safePath(p)));if(kind==='mcpServers')for(const server of Object.values(config.servers??{})){if(server.command==='node'&&server.args?.[0]&&!server.args[0].startsWith('-'))check(server.args[0]);}function visit(v,key=''){if(typeof v==='string'&&['entry','entryPoint','html','script','path'].includes(key)&&v.startsWith('./')){const local=posix.join(posix.dirname(safePath(p)),v);if(!files.has(local))check(v);}else if(Array.isArray(v))v.forEach(x=>visit(x,key));else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v))visit(x,k);}visit(config);}}}
 if(manifest.icon&&!manifest.icon.startsWith('data:')&&!manifest.icon.startsWith('https:'))check(manifest.icon);
 const presentation=catalogPresentation(manifest);
 const zip=new JSZip();for(const[p,b]of files)zip.file(`${manifest.name}/${p}`,b,{date:new Date('2000-01-01T00:00:00Z'),unixPermissions:0o100644,createFolders:false});const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:9},platform:'UNIX'});if(bytes.length>100*1024*1024)throw Error('Archive limit exceeded');return{manifest,presentation,bytes,sha256:digest(bytes),size:bytes.length,componentTypes:Object.entries(components).filter(([,v])=>v.length).map(([k])=>k==='mcpServers'?'mcp':k)};
}


