import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  preflightT42RawImage,
  readT42RawImage,
  uploadT42RawImage,
} from "../ops/releases/first-open-ecr-raw-transfer.mjs";

const account = "402010193138";
const region = "ca-central-1";
const repositoryName = "techlong-sandbox-platform-web";
const registry = `${account}.dkr.ecr.${region}.amazonaws.com`;
const partSize = 5 * 1024 * 1024;
const sha = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");

async function fixture(t, { layerBytes = Buffer.from("fixture-layer"), short = "platform" } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "t42-ecr-raw-transfer-"));
  const files = [join(directory, "config.json"), join(directory, "layer.tar")];
  t.after(async () => {
    for (const file of files) await rm(file, { force: true });
    await rmdir(directory);
  });
  const platform = short === "platform";
  const manifestMediaType = platform ? "application/vnd.docker.distribution.manifest.v2+json" : "application/vnd.oci.image.manifest.v1+json";
  const layerMediaType = platform ? "application/vnd.docker.image.rootfs.diff.tar" : "application/vnd.oci.image.layer.v1.tar";
  const configMediaType = platform ? "application/vnd.docker.container.image.v1+json" : "application/vnd.oci.image.config.v1+json";
  const layer = { mediaType: layerMediaType, digest: sha(layerBytes), size: layerBytes.length };
  const configBytes = Buffer.from(JSON.stringify({ architecture: "amd64", os: "linux", rootfs: { type: "layers", diff_ids: [layer.digest] } }));
  const config = { mediaType: configMediaType, digest: sha(configBytes), size: configBytes.length };
  const wire = JSON.stringify({ schemaVersion: 2, mediaType: manifestMediaType, config, layers: [layer] }, null, 2) + "\n";
  const manifest = sha(wire);
  await Promise.all([writeFile(files[0], configBytes), writeFile(files[1], layerBytes)]);
  const target = {
    short, repositoryName: platform ? repositoryName : "techlong-sandbox-speedfeast",
    imageTag: `t42-sandbox-${manifest.slice(7, 23)}`,
    manifest, config: config.digest, manifestMediaType, wire,
    blobs: [config, layer].map(({ digest, size }, index) => ({ digest, size, file: files[index] })),
  };
  return { target, bytes: new Map([[config.digest, configBytes], [layer.digest, layerBytes]]) };
}

function scopedRegistry(target, controls = {}) {
  const calls = [];
  const scope = { registryId: account, repositoryName: target.repositoryName };
  const uploads = new Map();
  const completed = new Map();
  const image = imageManifest => ({ ...scope, imageId: { imageDigest: target.manifest, imageTag: target.imageTag },
    imageManifest, imageManifestMediaType: target.manifestMediaType });
  const assertScope = request => assert.deepEqual({ registryId: request.registryId, repositoryName: request.repositoryName }, scope);

  async function write(operation, request) {
    calls.push(operation);
    switch (operation) {
      case "DescribeRepositories":
        assert.deepEqual(request, { registryId: account, repositoryNames: [target.repositoryName] });
        return { repositories: [{ ...scope, registryId: controls.foreignRegistry ? "123456789012" : account,
          repositoryArn: `arn:aws:ecr:${region}:${account}:repository/${target.repositoryName}`,
          repositoryUri: `${registry}/${target.repositoryName}`, imageTagMutability: "IMMUTABLE" }] };
      case "BatchGetImage":
        assert.deepEqual(request, { ...scope, imageIds: [{ imageTag: target.imageTag }] });
        return controls.tagExists ? { images: [image(target.wire)] }
          : { images: [], failures: [{ failureCode: "ImageNotFound", imageId: { imageTag: target.imageTag } }] };
      case "BatchCheckLayerAvailability":
        assert.deepEqual(request, { ...scope, layerDigests: target.blobs.map(blob => blob.digest) });
        return { layers: target.blobs.map(blob => ({ layerDigest: blob.digest,
          layerAvailability: controls.existingDigests?.has(blob.digest) ? "AVAILABLE" : "UNAVAILABLE" })) };
      case "InitiateLayerUpload": {
        assert.deepEqual(request, scope);
        const uploadId = `3196f69e-ed36-11f0-9fa7-0242ac12${String(uploads.size + 1).padStart(4, "0")}`;
        uploads.set(uploadId, { offset: 0, parts: [] });
        return { uploadId, partSize };
      }
      case "UploadLayerPart": {
        assertScope(request);
        const upload = uploads.get(request.uploadId);
        assert.ok(upload);
        assert.equal(request.partFirstByte, upload.offset);
        const bytes = Buffer.from(request.layerPartBlob);
        assert.equal(request.partLastByte, upload.offset + bytes.length - 1);
        upload.offset += bytes.length;
        upload.parts.push(bytes);
        return { ...scope, uploadId: request.uploadId, lastByteReceived: request.partLastByte + (controls.badOffset ? 1 : 0) };
      }
      case "CompleteLayerUpload": {
        assertScope(request);
        const upload = uploads.get(request.uploadId);
        const bytes = Buffer.concat(upload.parts);
        const [layerDigest] = request.layerDigests;
        assert.deepEqual(request.layerDigests, [sha(bytes)]);
        assert.equal(target.blobs.find(blob => blob.digest === layerDigest)?.size, bytes.length);
        assert.equal(completed.has(layerDigest), false);
        completed.set(layerDigest, bytes);
        return { ...scope, uploadId: request.uploadId, layerDigest };
      }
      case "PutImage":
        assert.deepEqual(request, { ...scope, imageTag: target.imageTag, imageManifest: target.wire,
          imageManifestMediaType: target.manifestMediaType, imageDigest: target.manifest });
        if (controls.putError) throw controls.putError;
        return { image: image(target.wire) };
      default:
        assert.fail(`Unexpected writer action ${operation}`);
    }
  }

  async function read(operation, request) {
    calls.push("independent:" + operation);
    assert.equal(operation, "BatchGetImage");
    assert.deepEqual(request, { ...scope, imageIds: [{ imageDigest: target.manifest }] });
    const found = image(target.wire + (controls.rewriteRead ? "\n" : ""));
    return { images: [{ ...found, imageId: { imageDigest: target.manifest } }] };
  }

  return { calls, completed, read, write };
}

test("ECR upload preserves the archived bytes, manifest type and separate digest readback", async t => {
  const { target, bytes } = await fixture(t, { layerBytes: Buffer.alloc(partSize + 17, 0xa7) });
  const remote = scopedRegistry(target, { existingDigests: new Set([target.config]) });
  const missing = await preflightT42RawImage(target, remote.write);
  assert.deepEqual(missing, [target.blobs[1]]);
  assert.deepEqual(await uploadT42RawImage(target, missing, remote.write), {
    registryId: account, repositoryName, imageTag: target.imageTag, imageDigest: target.manifest,
  });
  assert.deepEqual(remote.completed, new Map([[target.blobs[1].digest, bytes.get(target.blobs[1].digest)]]));
  assert.deepEqual(await readT42RawImage(target, remote.read), {
    registryId: account, repositoryName, imageDigest: target.manifest,
    imageConfigDigest: target.config, manifestMediaType: target.manifestMediaType,
  });
  assert.deepEqual(remote.calls, ["DescribeRepositories", "BatchGetImage", "BatchCheckLayerAvailability",
    "InitiateLayerUpload", "UploadLayerPart", "UploadLayerPart", "CompleteLayerUpload", "PutImage", "independent:BatchGetImage"]);
});

test("the tenant registry keeps the OCI manifest type and skips already available blobs", async t => {
  const { target } = await fixture(t, { short: "tenant" });
  const remote = scopedRegistry(target, { existingDigests: new Set(target.blobs.map(blob => blob.digest)) });
  const missing = await preflightT42RawImage(target, remote.write);
  assert.deepEqual(missing, []);
  assert.equal((await uploadT42RawImage(target, missing, remote.write)).imageDigest, target.manifest);
  assert.equal((await readT42RawImage(target, remote.read)).manifestMediaType, target.manifestMediaType);
  assert.deepEqual(remote.calls, ["DescribeRepositories", "BatchGetImage", "BatchCheckLayerAvailability",
    "PutImage", "independent:BatchGetImage"]);
});

test("an occupied ECR tag stops preflight even when it refers to the expected manifest", async t => {
  const { target } = await fixture(t);
  const remote = scopedRegistry(target, { tagExists: true });
  await assert.rejects(() => preflightT42RawImage(target, remote.write));
  assert.deepEqual(remote.calls, ["DescribeRepositories", "BatchGetImage"]);
});

test("a foreign registry ID stops preflight before requesting its tag", async t => {
  const { target } = await fixture(t);
  const remote = scopedRegistry(target, { foreignRegistry: true });
  await assert.rejects(() => preflightT42RawImage(target, remote.write));
  assert.deepEqual(remote.calls, ["DescribeRepositories"]);
});

test("a wrong ECR part offset stops before completing the upload or writing the next blob", async t => {
  const { target } = await fixture(t);
  const remote = scopedRegistry(target, { badOffset: true });
  const missing = await preflightT42RawImage(target, remote.write);
  await assert.rejects(() => uploadT42RawImage(target, missing, remote.write));
  assert.deepEqual(remote.calls, ["DescribeRepositories", "BatchGetImage", "BatchCheckLayerAvailability",
    "InitiateLayerUpload", "UploadLayerPart"]);
  assert.equal(remote.completed.size, 0);
});

test("a same-size local blob change cannot complete an ECR layer upload", async t => {
  const { target } = await fixture(t);
  const remote = scopedRegistry(target);
  const missing = await preflightT42RawImage(target, remote.write);
  await writeFile(target.blobs[0].file, Buffer.alloc(target.blobs[0].size));
  await assert.rejects(() => uploadT42RawImage(target, missing, remote.write));
  assert.ok(!remote.calls.includes("CompleteLayerUpload"));
  assert.ok(!remote.calls.includes("PutImage"));
  assert.ok(remote.calls.filter(operation => operation === "InitiateLayerUpload").length <= 1);
  assert.equal(remote.completed.size, 0);
});

test("independent ECR readback rejects reserialized bytes despite the expected reported digest", async t => {
  const { target } = await fixture(t);
  const remote = scopedRegistry(target, { rewriteRead: true });
  await assert.rejects(() => readT42RawImage(target, remote.read));
  assert.deepEqual(remote.calls, ["independent:BatchGetImage"]);
});

test("an uncertain PutImage response does not repeat the write", async t => {
  const { target } = await fixture(t);
  const error = Error("simulated lost PutImage response");
  const remote = scopedRegistry(target, { existingDigests: new Set(target.blobs.map(blob => blob.digest)), putError: error });
  const missing = await preflightT42RawImage(target, remote.write);
  assert.deepEqual(missing, []);
  await assert.rejects(() => uploadT42RawImage(target, missing, remote.write));
  assert.deepEqual(remote.calls, ["DescribeRepositories", "BatchGetImage", "BatchCheckLayerAvailability", "PutImage"]);
});
