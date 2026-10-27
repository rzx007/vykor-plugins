import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readBounded, loadSearchConfig } from '../tools/config.mjs';

/** Explicit operator setup: import a completed autoindex receipt, never invent freshness. */
export async function bindAutoindexReceipt(configPath, receiptPath) {
  if (resolve(configPath) !== resolve(dirname(configPath), 'xerj.json')) throw new Error('Configuration file must be named xerj.json');
  const config = await loadSearchConfig(dirname(configPath));
  if (!config.enabled) throw new Error('Enable configuration before explicitly binding a receipt');
  const bytes = await readBounded(receiptPath, 1_048_576);
  const receipt = JSON.parse(bytes);
  const complete = receipt.doc_kind === 'run' && Number.isInteger(receipt.generation) && receipt.generation > 0
    && Number.isInteger(receipt.files_indexed) && Number.isInteger(receipt.files_junk)
    && receipt.files_indexed >= 0 && receipt.files_junk >= 0
    && receipt.files_indexed + receipt.files_junk === receipt.unique_content_files
    && Number.isFinite(Date.parse(receipt.started)) && receipt.url === config.url;
  if (!complete) throw new Error('Incomplete or incompatible autoindex receipt');
  const root = await realpath(receipt.root);
  const matches = [];
  for (const project of config.projects) if (project.prefix === receipt.prefix && relative(root, await realpath(project.root)) === '') matches.push(project);
  if (matches.length !== 1) throw new Error('Receipt does not match exactly one configured project');
  const project = matches[0];
  const ledger = { corpus: project.corpus, prefix: project.prefix + '-', index_prefix: project.prefix + '-',
    url: config.url, indexed_at: receipt.started, autoindex_exit: receipt.files_junk ? 3 : 0,
    project_root: root, generation: receipt.generation, binding_origin: 'completed_autoindex_receipt',
    receipt_sha256: createHash('sha256').update(bytes).digest('hex') };
  const destination = join(config.codeHome, 'state', project.corpus + '.json');
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx' });
  return { corpus: project.corpus, path: destination, indexedAt: ledger.indexed_at, receiptSha256: ledger.receipt_sha256 };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--config' || args[2] !== '--receipt') throw new Error('Usage: node scripts/bind-autoindex.mjs --config <xerj.json> --receipt <successful autoindex --json output>');
  console.log(JSON.stringify(await bindAutoindexReceipt(resolve(args[1]), resolve(args[3])), null, 2));
}
