import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {digest} from './lib.mjs';

export const marketRepository='https://github.com/rzx007/vykor-plugins';
export function checkoutState(root,expectedCommit){
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const commit=git(['rev-parse','HEAD']);
 if(!/^[a-f0-9]{40}$/.test(commit)||expectedCommit&&commit!==expectedCommit)throw Error('Checkout commit mismatch');
 return {commit,dirty:git(['status','--porcelain=v1','--untracked-files=all'])!==''};
}
export async function writeProvenance(output,state,catalog){
 const provenance={schemaVersion:1,repository:marketRepository,commit:state.commit,preview:state.dirty,catalogSha256:digest(catalog)};
 await writeFile(join(output,'build-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
 return provenance;
}
export async function readProvenance(output){
 const provenance=JSON.parse(await readFile(join(output,'build-provenance.json')));
 if(provenance.schemaVersion!==1||provenance.repository!==marketRepository||!/^[a-f0-9]{40}$/.test(provenance.commit)||typeof provenance.preview!=='boolean')throw Error('Invalid build provenance');
 if(provenance.catalogSha256!==digest(await readFile(join(output,'marketplace.json'))))throw Error('Catalog does not match build provenance');
 return provenance;
}
export async function assertPublishable(root,env=process.env){
 const provenance=await readProvenance(join(root,'dist'));
 if(provenance.preview)throw Error('Cannot publish preview built from uncommitted changes');
 if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!=='rzx007/vykor-plugins'||env.GITHUB_REF!=='refs/heads/main'||!['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME))throw Error('Publish requires main-branch GitHub Actions CI');
 const state=checkoutState(root,provenance.commit);
 if(state.dirty||env.GITHUB_SHA!==provenance.commit)throw Error('Publish checkout/CI commit does not match clean build provenance');
 return provenance;
}
