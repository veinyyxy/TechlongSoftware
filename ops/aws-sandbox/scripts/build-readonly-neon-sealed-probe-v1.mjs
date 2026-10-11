import { build, version } from "esbuild";
import { zipSync, unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root=fileURLToPath(new URL("../../../",import.meta.url)),args=process.argv.slice(2),privateRoot=await realpath("F:/ChatGPT_workshop");
if(args.length!==2||args[0]!=="--out")throw new Error("NEON_PROBE_FRESH_OUTPUT_REQUIRED");
const out=path.resolve(args[1]);if((await realpath(path.dirname(out))).toLowerCase()!==privateRoot.toLowerCase()||!/^techlong-f3b3-neon-sealed-artifacts-[a-z0-9-]+$/.test(path.basename(out)))throw new Error("NEON_PROBE_OUTPUT_OUT_OF_SCOPE");
const sha=b=>createHash("sha256").update(b).digest("hex"),lockBytes=await readFile(path.join(root,"package-lock.json")),lock=JSON.parse(lockBytes);
if(version!=="0.28.0"||lock.packages["node_modules/esbuild"].version!==version||lock.packages["node_modules/fflate"].version!=="0.7.4"||
 JSON.parse(await readFile(path.join(root,"node_modules/fflate/package.json"))).version!=="0.7.4")throw new Error("NEON_PROBE_BUILDER_DRIFT");
await mkdir(out);
const options={absWorkingDir:root,entryPoints:["ops/aws-sandbox/lambda/readonly-neon-sealed-probe-v1.ts"],outfile:"index.js",platform:"node",target:"node22",format:"cjs",bundle:true,write:false,metafile:true,sourcemap:false,legalComments:"eof",logLevel:"silent"};
const a=await build(options),b=await build(options),bytes=a.outputFiles[0].contents;
if(sha(bytes)!==sha(b.outputFiles[0].contents))throw new Error("NEON_PROBE_BUILD_NOT_REPRODUCIBLE");
const builtins=new Set(builtinModules.flatMap(x=>[x,`node:${x}`])),inputs=new Set();
for(const file of Object.keys(a.metafile.inputs)){
 if(!file.startsWith("node_modules/"))inputs.add(file);
 if(/prepared-|aws-sdk-sealed|sealed-cell-cleanup-authority|sealed-cell-cleanup-evidence|client-dynamodb|lib-dynamodb|client-cloudformation|client-ecs|client-s3|admission-fence/.test(file))throw new Error("NEON_PROBE_LINKS_MUTATION_RUNTIME");
}
for(const output of Object.values(a.metafile.outputs))for(const item of output.imports)if(item.external&&!builtins.has(item.path))throw new Error("NEON_PROBE_UNBUNDLED_DEPENDENCY");
const bundle=path.join(out,"index.js");await writeFile(bundle,bytes,{flag:"wx"});
const smoke=spawnSync(process.execPath,["--input-type=commonjs","-e","const m=require(process.argv[1]);if(typeof m.handler!=='function')process.exit(2);m.handler({},{}).then(()=>process.exit(3),e=>{if(e.message!=='NEON_PROBE_EVENT_INVALID')process.exit(4)});",bundle],
 {cwd:out,encoding:"utf8",timeout:10000,windowsHide:true,env:{PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT,TEMP:process.env.TEMP,TMP:process.env.TMP}});
if(smoke.status!==0)throw new Error("NEON_PROBE_STARTUP_NOT_VERIFIED");
const contents={"index.js":[bytes,{mtime:new Date(1980,0,1),level:9}]},zip=zipSync(contents),decoded=unzipSync(zip);
if(sha(zip)!==sha(zipSync(contents))||Object.keys(decoded).join(",")!=="index.js"||sha(decoded["index.js"])!==sha(bytes))throw new Error("NEON_PROBE_ZIP_NOT_VERIFIED");
await writeFile(path.join(out,"ttl-neon.zip"),zip,{flag:"wx"});inputs.add("ops/aws-sandbox/scripts/build-readonly-neon-sealed-probe-v1.mjs");
const sourcePins=[];for(const file of [...inputs].sort())sourcePins.push({file,sha256:sha(Buffer.from((await readFile(path.join(root,file),"utf8")).replace(/\r\n/g,"\n")))});
const artifact={zipSha256:sha(zip),zipBytes:zip.length,bundleSha256:sha(bytes),file:"ttl-neon.zip",handler:"index.handler",runtime:"nodejs22.x",architecture:"x86_64"};
const report={schemaVersion:1,protocol:"neon-sealed-readonly-artifacts-v1",sourcePins,packageLockSha256:sha(lockBytes),esbuildVersion:version,zipBuilderVersion:"0.7.4",artifact,
 reproducibleBuildVerified:true,dependencyFreeStartupVerified:true,invalidEventRejectedBeforeCredentials:true,mutationRuntimeLinked:false,cloudMutationPerformed:false,databaseConnected:false,installationAuthorized:false};
const reportBytes=JSON.stringify(report,null,2)+"\n";await writeFile(path.join(out,"artifact-review.json"),reportBytes,{flag:"wx"});console.log(JSON.stringify({out,reportFileSha256:sha(reportBytes),artifact,installationAuthorized:false}));
