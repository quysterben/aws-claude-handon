import { Stack, type StackProps, CfnOutput } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as path from "path";

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const httpApi = new HttpApi(this, "HttpApi", {
      apiName: "api",
    });

    const healthFunction = new NodejsFunction(this, "HealthFunction", {
      entry: path.join(__dirname, "..", "lambda", "health.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
    });

    httpApi.addRoutes({
      path: "/health",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "HealthIntegration",
        healthFunction,
      ),
    });

    new CfnOutput(this, "HttpApiUrl", { value: httpApi.apiEndpoint });
  }
}
