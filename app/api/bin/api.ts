#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { ApiStack } from "../lib/api-stack";
import { ClientStack } from "../lib/client-stack";

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const clientStack = new ClientStack(app, "ClientStack", { env });

new ApiStack(app, "ApiStack", {
  env,
  additionalAllowedOrigins: [clientStack.distributionUrl],
});
