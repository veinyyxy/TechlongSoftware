// Read-only metadata audit only; no publisher-write command or credential install.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {publisherDatabaseConfigV6,DATABASE_V6} from './io.mjs';
import {readControlPrivilegesV6,inspectControlPrivilegesV6} from './privileges.mjs';
export async function main(args=process.argv.slice(2)){
  if(args.length!==2||args[0]!=='--output')throw Error('PUBLISHER_AUDIT_ARGS');
  const output=path.resolve(args[1]);
  if(path.dirname(output).toLowerCase()!==path.resolve('F:/ChatGPT_workshop').toLowerCase()||
    !/^techlong-w6g-privileges-[a-z0-9-]+$/.test(path.basename(output))||
    ['NODE_OPTIONS','NODE_EXTRA_CA_CERTS','NODE_PATH','DATABASE_URL'].some(k=>process.env[k])||process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')
    throw Error('PUBLISHER_AUDIT_ENVIRONMENT');
  const config=parseEnv(await readFile(new URL('../../.env.local',import.meta.url),'utf8'));
  const client=new pg.Client(await publisherDatabaseConfigV6(config.DATABASE_URL));let sessionError=false;
  client.on('error',()=>{sessionError=true;});await mkdir(output);
  try{await client.connect();const catalog=await readControlPrivilegesV6(client);
    if(sessionError)throw Error('PUBLISHER_AUDIT_SESSION');
    const result={...inspectControlPrivilegesV6(catalog,DATABASE_V6.roleOid),checkedAtUtc:new Date().toISOString(),
      databaseWriteSubmissions:0,businessRowsRead:0,awsCalls:0,appPrivateKeyReads:0};
    for(const [name,value] of Object.entries({catalog,result}))await writeFile(path.join(output,name+'.json'),JSON.stringify(value,null,2)+'\n',{flag:'wx',flush:true});
    console.log(JSON.stringify({...result,output},null,2));return result;
  }finally{await client.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{
  console.error('PUBLISHER_AUDIT_UNAVAILABLE_DETAILS_WITHHELD_NO_WRITE');process.exitCode=1;
});
