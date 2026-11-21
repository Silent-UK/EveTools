import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeConfig} from '../lib/runtime-config.mjs';
const env={BASE_URL:'https://tools.example.com',DATA_DIR:'/tmp/evetools',EVE_CLIENT_ID:'test',EVE_CLIENT_SECRET:'test',ENCRYPTION_KEY:'ab'.repeat(32),OWNER_CHARACTER_ID:'123',CORPORATION_ID:'456',CORPORATION_NAME:'Example',CORPORATION_TICKER:'EX',ESI_CONTACT:'https://example.com/contact'};
test('public startup requires operator credentials and identity without a developer owner fallback',()=>{
 assert.throws(()=>runtimeConfig({}),/OWNER_CHARACTER_ID/);const c=runtimeConfig(env);assert.equal(c.owner,123);assert.equal(c.corporationId,456);assert.equal(c.siteName,'EveTools');assert.equal(c.port,3014);assert.equal(c.allianceTicker,'');
 for(const patch of [{OWNER_CHARACTER_ID:'0'},{CORPORATION_ID:'bad'},{ENCRYPTION_KEY:'x'},{BASE_URL:'https://example.com/path'},{BASE_URL:'http://example.com'},{PORT:'65536'}])assert.throws(()=>runtimeConfig({...env,...patch}));
 assert.equal(runtimeConfig({...env,BASE_URL:'http://127.0.0.1:3014'}).base,'http://127.0.0.1:3014');
});
