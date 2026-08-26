import { Construct } from "constructs";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as path from "path";
import { DB_NAME } from "./database";
import {
  BaseApiConstructProps,
  DEFAULT_LAMBDA_TIMEOUT,
  LAMBDA_RUNTIME,
} from "./shared";

export interface HealthApiProps extends BaseApiConstructProps {
  httpApi: HttpApi;
}

export class HealthApi extends Construct {
  constructor(scope: Construct, id: string, props: HealthApiProps) {
    super(scope, id);

    const healthFunction = new NodejsFunction(this, "HealthFunction", {
      entry: path.join(props.lambdaDir, "health.ts"),
      handler: "handler",
      runtime: LAMBDA_RUNTIME,
      timeout: DEFAULT_LAMBDA_TIMEOUT,
      environment: {
        DB_RESOURCE_ARN: props.database.cluster.clusterArn,
        DB_SECRET_ARN: props.database.secret.secretArn,
        DB_NAME,
      },
    });

    props.database.cluster.grantDataApiAccess(healthFunction);

    props.httpApi.addRoutes({
      path: "/health",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "HealthIntegration",
        healthFunction,
      ),
    });
  }
}
