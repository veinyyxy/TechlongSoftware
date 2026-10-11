import { build, version } from "esbuild";
import { zipSync, unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import path from "node:path";
const root=fileURLToPath(new URL("../../../",import.meta.url)),privateRoot=await realpath("F:/ChatGPT_workshop"),args=process.argv.slice(2);
if(args.length!==2||args[0]!=="--out")throw new Error("SEALED_RUNTIME_FRESH_OUTPUT_REQUIRED");
const out=path.resolve(args[1]);if((await realpath(path.dirname(out))).toLowerCase()!==privateRoot.toLowerCase()||!/^techlong-f3b3-sealed-runtime-v3-[a-z0-9-]+$/.test(path.basename(out)))throw new Error("SEALED_RUNTIME_PRIVATE_OUTPUT_REQUIRED");
const hash=b=>createHash("sha256").update(b).digest("hex"),lock=await readFile(path.join(root,"package-lock.json")),packages=JSON.parse(lock).packages;
if(version!=="0.28.0"||packages["node_modules/esbuild"].version!==version||packages["node_modules/fflate"].version!=="0.7.4"||JSON.parse(await readFile(path.join(root,"node_modules/fflate/package.json"))).version!=="0.7.4")throw new Error("SEALED_RUNTIME_BUILDER_DRIFT");
await mkdir(out);const artifacts=[],inputs=new Set(),builtins=new Set(builtinModules.flatMap(x=>[x,`node:${x}`]));
for(const [kind,entry]of [["drain-v3","cell-drain-coordinator-v3.ts"],["ttl-v3-fixed","cell-ttl-executor-v3-fixed.ts"]]){
 const opts={absWorkingDir:root,entryPoints:[`ops/aws-sandbox/lambda/${entry}`],outfile:"index.js",platform:"node",target:"node22",format:"cjs",bundle:true,write:false,metafile:true,sourcemap:false,legalComments:"eof",logLevel:"silent"};
 const a=await build(opts),b=await build(opts),bytes=a.outputFiles[0].contents;if(hash(bytes)!==hash(b.outputFiles[0].contents))throw new Error("SEALED_RUNTIME_BUILD_NOT_REPRODUCIBLE");
 for(const file of Object.keys(a.metafile.inputs)){if(!file.startsWith("node_modules/"))inputs.add(file);if(kind==="drain-v3"&&/client-cloudformation|prepared-sealed-cell-ttl-executor-v3|aws-sdk-sealed-cell-cleanup-v3/.test(file))throw new Error("SEALED_DRAIN_LINKS_DELETER");}
 for(const value of Object.values(a.metafile.outputs))for(const i of value.imports)if(i.external&&!builtins.has(i.path))throw new Error("SEALED_RUNTIME_UNBUNDLED_DEPENDENCY");
 const dir=path.join(out,kind);await mkdir(dir);const bundle=path.join(dir,"index.js");await writeFile(bundle,bytes,{flag:"wx"});
 const smoke=spawnSync(process.execPath,["--input-type=commonjs","-e","const m=require(process.argv[1]);if(typeof m.handler!=='function')process.exit(2);m.handler({},{}).then(()=>process.exit(3),e=>{if(!String(e.message).includes('EVENT_INVALID'))process.exit(4)});",bundle],
  {cwd:dir,timeout:10000,encoding:"utf8",windowsHide:true,env:{PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT,TEMP:process.env.TEMP,TMP:process.env.TMP}});if(smoke.status!==0)throw new Error("SEALED_RUNTIME_STARTUP_NOT_VERIFIED");
 const contents={"index.js":[bytes,{mtime:new Date(1980,0,1),level:9}]},zip=zipSync(contents),decoded=unzipSync(zip);
 if(hash(zip)!==hash(zipSync(contents))||Object.keys(decoded).join(",")!=="index.js"||hash(decoded["index.js"])!==hash(bytes))throw new Error("SEALED_RUNTIME_ZIP_NOT_VERIFIED");
 await writeFile(path.join(out,`${kind}.zip`),zip,{flag:"wx"});artifacts.push({kind,zipSha256:hash(zip),zipBytes:zip.length,bundleSha256:hash(bytes),handler:"index.handler",runtime:"nodejs22.x",architecture:"x86_64"});
}
inputs.add("ops/aws-sandbox/scripts/build-sealed-runtime-v3-candidates.mjs");const sourcePins=[];for(const file of [...inputs].sort())sourcePins.push({file,sha256:hash(Buffer.from((await readFile(path.join(root,file),"utf8")).replace(/\r\n/g,"\n")))});
const report={schemaVersion:3,protocol:"sealed-business-runtime-candidates-v3",sourcePins,packageLockSha256:hash(lock),artifacts,reproducibleBuildVerified:true,dependencyFreeStartupVerified:true,
 invalidEventRejectedBeforeCredentials:true,drainDeletionRuntimeLinked:false,cloudMutationPerformed:false,databaseMutationPerformed:false,installationAuthorized:false,workerEnabled:false};
const bytes=JSON.stringify(report,null,2)+"\n";await writeFile(path.join(out,"artifact-review.json"),bytes,{flag:"wx"});console.log(JSON.stringify({out,reportFileSha256:hash(bytes),artifacts,installationAuthorized:false}));
