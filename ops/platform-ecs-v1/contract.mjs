import {canonical,same,hash} from '../platform-web-database-role-v1/contract.mjs';
import {sourceOnlyPolicy} from '../platform-web-credential-v1/contract.mjs';
export {canonical,same,hash};
export const must=(v,c)=>{if(!v)throw Error('PLATFORM_ECS_'+c);};
export const P=Object.freeze({account:'402010193138',region:'ca-central-1',profile:'techlong-sandbox-user',
  sourceArn:'arn:aws:iam::402010193138:user/techlong-sandbox-dev',sourceId:'AIDAV3GNMXTZEO7SHLC2X',
  accessStack:'techlong-sandbox-platform-access-v1',hostingStack:'techlong-sandbox-platform-hosting-v1',
  role:'TechlongSandboxPlatformWebExecutionRoleV1',boundary:'TechlongSandboxPlatformWebExecutionBoundaryV1',inline:'ExecutionOnly',
  roleArn:'arn:aws:iam::402010193138:role/TechlongSandboxPlatformWebExecutionRoleV1',
  boundaryArn:'arn:aws:iam::402010193138:policy/TechlongSandboxPlatformWebExecutionBoundaryV1',
  repository:'techlong-sandbox-platform-web',repositoryArn:'arn:aws:ecr:ca-central-1:402010193138:repository/techlong-sandbox-platform-web',
  imageDigest:'sha256:81fb8157fd9dcf834204a3b0c866d3fc8071386a4cbc1ff71f2ccac992ed4612',
  image:'402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-platform-web@sha256:81fb8157fd9dcf834204a3b0c866d3fc8071386a4cbc1ff71f2ccac992ed4612',
  secretArn:'arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/platform-web/neon-v1-UfFKVF',
  secretVersion:'6ea2ca59-9a24-4f3e-b16f-ec824f32bc5f',secretReviewSha:'a93b64169dd598d45832a7e9e0fc7317395fdd907cb7baa8c0f4a935b7c45b09',
  kmsArn:'arn:aws:kms:ca-central-1:402010193138:key/3af8de5c-dbb7-451a-83f3-983fb1673570',
  vpc:'vpc-011dab69fff93972b',subnets:['subnet-023b1a81311709ed3','subnet-059d0bb14c42ff523'],
  igw:'igw-0bd95cc8d2c24d5d5',routeTable:'rtb-006fb14f444eec219',hostedZone:'Z01473621BTTHKXBGOOEJ',domain:'console.sandbox.techlong.cloud',
  certificate:'arn:aws:acm:ca-central-1:402010193138:certificate/6d1f2880-9f83-449c-930a-6b17516ef49d',
  cluster:'techlong-sandbox-platform',service:'techlong-sandbox-platform-web',alb:'techlong-sandbox-platform',targetGroup:'techlong-platform-web-v1',
  logGroup:'/ecs/techlong-sandbox/platform-web',family:'techlong-sandbox-platform-web-v1',sslPolicy:'ELBSecurityPolicy-TLS13-1-2-2021-06'});
export const ACCESS_SCOPE=Object.freeze({cloudFormationCreateStack:1,namedIamResources:2,secretPolicyPuts:1,secretValueReads:0,
  sqlConnections:0,taskRuns:0,hostingDeployments:0,oldResourceDeletes:0,applicationWriteRetries:0});
export function handoffPolicy(){const p=sourceOnlyPolicy();p.Statement[0].Sid='OnlySourceAndReviewedExecutionRoleMayRead';
  p.Statement[0].Condition.ArnNotEquals['aws:PrincipalArn']=[P.sourceArn,P.roleArn];return p;}
export function normalizePolicy(p){if(typeof p==='string')p=JSON.parse(decodeURIComponent(p));const c=structuredClone(p);
  c.Statement=(Array.isArray(c.Statement)?c.Statement:[c.Statement]).map(s=>{for(const k of ['Action','NotAction','Resource','NotResource'])if(s[k])s[k]=[s[k]].flat().sort();
    for(const k of ['Principal','NotPrincipal'])if(s[k]&&typeof s[k]==='object')for(const n of Object.keys(s[k]))s[k][n]=[s[k][n]].flat().sort();
    if(s.Condition)for(const t of Object.values(s.Condition))for(const k of Object.keys(t))t[k]=[t[k]].flat().sort();return s;
  }).sort((a,b)=>(a.Sid??'').localeCompare(b.Sid??''));return c;}
export const policySame=(a,b)=>same(normalizePolicy(a),normalizePolicy(b));
export const safeCode=e=>/^PLATFORM_ECS_[A-Z0-9_]+$/.test(e?.message??'')?e.message:/^[A-Za-z0-9_]{1,80}$/.test(e?.name??'')?e.name:'ECS_OPERATION_FAILED';
