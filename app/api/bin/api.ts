#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { ApiStack } from "../lib/api-stack";

const app = new App();

new ApiStack(app, "ApiStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
