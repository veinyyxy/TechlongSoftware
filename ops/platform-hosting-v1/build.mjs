import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {buildEnvironment,assertBuildChildEnvironment,must} from './contract.mjs';
import {ROOT,makeBuildConfig} from './config.mjs';

export async function main(args=process.argv.slice(2)){
  must(process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true','CI_BUILD_ONLY');
  if(args.length===1&&args[0]==='--isolated-child'){
    assertBuildChildEnvironment(process.env);
    const {createBuilder}=await import('vite');await(await createBuilder(await makeBuildConfig())).buildApp();return;
  }
  must(args.length===0,'ARGUMENTS');
  // The child, not the caller's environment, is what the compiler can inspect.
  await new Promise((resolve,reject)=>{
    const c=spawn(process.execPath,[path.join(ROOT,'ops/platform-hosting-v1/build.mjs'),'--isolated-child'],{
      cwd:ROOT,env:buildEnvironment(process.env),windowsHide:true,stdio:['ignore','inherit','inherit']});
    const timer=setTimeout(()=>{c.kill();reject(Error('PLATFORM_HOSTING_BUILD_TIMEOUT'));},8*60000);
    c.once('error',()=>{clearTimeout(timer);reject(Error('PLATFORM_HOSTING_BUILD_START'));});
    c.once('exit',code=>{clearTimeout(timer);if(code===0)resolve();else reject(Error('PLATFORM_HOSTING_BUILD_FAILED'));});
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error('PLATFORM_HOSTING_BUILD_FAILED');process.exitCode=1;
});
