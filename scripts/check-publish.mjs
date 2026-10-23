import {resolve} from 'node:path';
import {assertPublishable} from './provenance.mjs';
await assertPublishable(resolve('.'));
console.log('Build provenance permits publication from this main-branch CI checkout');
