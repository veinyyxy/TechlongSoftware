import test from 'node:test';
import assert from 'node:assert/strict';
import { env } from 'cloudflare:workers';
import { platformControlEnabled,getPlatformControlStatus } from '../lib/deployments/controller-v6/runtime.ts';
import { CONTROL_SCOPE } from '../lib/deployments/controller-v6/contract.ts';
test('actual runtime ignores accidental enable flag and never accesses private binding without published release and short local lease',async()=>{
  let reads=0;env.TECHLONG_PLATFORM_CONTROLLER_ENABLED='true';
  Object.defineProperty(env,'TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY',{configurable:true,get(){reads++;throw Error('NO_KEY_READ');}});
  Object.defineProperty(env,'TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL',{configurable:true,get(){reads++;throw Error('NO_DB_READ');}});
  try{assert.equal(platformControlEnabled(),false);const status=await getPlatformControlStatus(CONTROL_SCOPE.instanceId);
    assert.equal(status.enabled,false);assert.deepEqual(status.plans,[]);assert.equal(reads,0);
  }finally{delete env.TECHLONG_PLATFORM_CONTROLLER_ENABLED;delete env.TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY;delete env.TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL;}
});
