// Public candidate coordinates only. Not a published cloud binding.
export const TARGET=Object.freeze({oldJobId:'job_9b57b43a6b88f37202b29170',newJobId:'job_a60423b885fef3e4326213f7',
  oldRequestId:'6fcf8b8da439ddac097d44fd529ebee0f0eea2644be718f31866243f8fd7b57b',
  clientRequestId:'17004827-71da-4e61-9bb3-26cbf6fbb1ba',requestId:'3bb1acc176722d5196a1e507f34e11c0fae512a1cee915a7320ac458047dafe9',runMs:30000});
export const SUCCESSFUL_PREDECESSOR='job_9db8466fd95cef0c23ad6bfc';
export const CLOUD_CANDIDATE=Object.freeze({schema:'techlong/a604-cloud-binding-candidate/v1',state:'UNPUBLISHED',
  jobId:TARGET.newJobId,successfulPredecessorJobId:SUCCESSFUL_PREDECESSOR,replacesHeldJobId:TARGET.oldJobId,
  packageReference:null,closureSha256:null,frozenSourceCommit:null,reusableCommit:null,activationInstalled:false,executionAuthorized:false});
export function assertPublishedCandidate(){throw Error('A604_BINDING_NOT_PUBLISHED');}
