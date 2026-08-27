import { Stack, type StackProps, CfnOutput } from "aws-cdk-lib";
import type { Construct } from "constructs";
import * as path from "path";
import { FrontendHosting } from "./constructs/frontend-hosting";

export class ClientStack extends Stack {
  public readonly distributionUrl: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const buildPath = path.join(__dirname, "..", "..", "client", "build");

    const hosting = new FrontendHosting(this, "Hosting", { buildPath });

    this.distributionUrl = `https://${hosting.distribution.distributionDomainName}`;

    new CfnOutput(this, "DistributionUrl", { value: this.distributionUrl });
    new CfnOutput(this, "BucketName", { value: hosting.bucket.bucketName });
  }
}
