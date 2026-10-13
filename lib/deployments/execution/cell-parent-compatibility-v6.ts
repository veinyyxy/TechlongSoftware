import { cellV3Fail } from "../cloudformation/shared-cell-stack-v3.ts";
import { AwsSdkCellParentInstallationReaderV5 } from "./cell-parent-compatibility-v5.ts";
import { cellParentIamCompatibilityViewV6 } from "./cell-parent-iam-compatibility-v6.ts";
import { CELL_PARENT_BOUNDARY_V4, CELL_PARENT_INLINE_V4, type CellParentRuntimeBindingV4 } from "./cell-birth-parent-v4.ts";
import { CELL_BIRTH_COORDINATOR_ROLE_V3 } from "./cell-birth-registration-v3.ts";
import type { CellParentInstallationSdkV4, CellParentInstallationProfileV4, CellParentLocalRuntimeV4 } from "./aws-sdk-cell-birth-parent-installation-v4.ts";

/** Only IAM's two exact document responses are adapted, after complete V6
 * validation. V5's exact $LATEST normalization and V4's private brands, real
 * identity, role/trust, table freeze, code/bundle and double read are retained.
 * This class alone neither installs IAM nor authorizes invoking the function. */
export class AwsSdkCellParentInstallationReaderV6 extends AwsSdkCellParentInstallationReaderV5 {
  private readonly originalSdk: CellParentInstallationSdkV4;
  private readonly compatibilityProfile: CellParentInstallationProfileV4;
  private readonly compatibilityClock: () => number;
  constructor(sdk: CellParentInstallationSdkV4, profile: CellParentInstallationProfileV4, now: () => number = Date.now) {
    super(sdk, profile, now); this.originalSdk = { ...sdk, commands: Object.freeze({ ...sdk.commands }), iam: { send: sdk.iam.send.bind(sdk.iam) } };
    this.compatibilityProfile = profile; this.compatibilityClock = now;
  }
  override read(binding: CellParentRuntimeBindingV4, stackId: string, signal: AbortSignal, local?: CellParentLocalRuntimeV4) {
    const sdk = this.originalSdk, commands = sdk.commands;
    const send: CellParentInstallationSdkV4["iam"]["send"] = async (command, options) => {
      const result = await sdk.iam.send(command, options), input = (command as { input: Record<string, unknown> }).input;
      if (command instanceof commands.inline) {
        if (input.RoleName !== CELL_BIRTH_COORDINATOR_ROLE_V3.split("/").at(-1) || input.PolicyName !== CELL_PARENT_INLINE_V4) cellV3Fail("CELL_PARENT_V6_INLINE_REQUEST_INVALID");
        return { ...result, PolicyDocument: cellParentIamCompatibilityViewV6(result.PolicyDocument, stackId, "inline") };
      }
      if (command instanceof commands.boundaryVersion) {
        if (input.PolicyArn !== CELL_PARENT_BOUNDARY_V4 || input.VersionId !== binding.boundaryVersionId) cellV3Fail("CELL_PARENT_V6_BOUNDARY_REQUEST_INVALID");
        const version = result.PolicyVersion as Record<string, unknown>;
        if (!version) cellV3Fail("CELL_PARENT_V6_BOUNDARY_RESPONSE_INVALID");
        return { ...result, PolicyVersion: { ...version, Document: cellParentIamCompatibilityViewV6(version.Document, stackId, "boundary") } };
      }
      return result;
    };
    return new AwsSdkCellParentInstallationReaderV5({ ...sdk, iam: { send } }, this.compatibilityProfile, this.compatibilityClock).read(binding, stackId, signal, local);
  }
}
