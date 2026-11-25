import {createHash, X509Certificate} from 'node:crypto';
import {readFile} from 'node:fs/promises';

// https://truststore.pki.rds.amazonaws.com/ca-central-1/ca-central-1-bundle.pem
const digest = '7e458e5489c48a92217efbe527da1203dc0fddebd802261fae9eed85fedb1e9f';
const rootNames = ['ECC384', 'RSA2048', 'RSA4096'].map(kind => `Amazon RDS ca-central-1 Root CA ${kind} G1`);

export async function checkRdsCaBundle(path = '/app/certs/amazon-rds.pem') {
  const bundle = await readFile(path);
  const sha256 = createHash('sha256').update(bundle).digest('hex');
  if (sha256 !== digest) throw Error('PLATFORM_IMAGE_RDS_CA_DIGEST');
  const certificates = bundle.toString('utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  const roots = certificates.map(pem => {
    const root = new X509Certificate(pem);
    if (!root.ca || !root.checkIssued(root) || !root.verify(root.publicKey)) throw Error('PLATFORM_IMAGE_RDS_CA_ROOT');
    return root.subject.split('\n').find(line => line.startsWith('CN='))?.slice(3);
  }).sort();
  if (JSON.stringify(roots) !== JSON.stringify(rootNames)) throw Error('PLATFORM_IMAGE_RDS_CA_REGION');
  return {region: 'ca-central-1', sha256, rootCount: roots.length};
}
